import mongoose from "mongoose";
import InventoryItem from "../models/InventoryItem.js";
import InventoryTransaction from "../models/InventoryTransaction.js";
import Voucher from "../models/Voucher.js";
import Deal from "../models/Deal.js";
import Product from "../models/Product.js";
import OrderItem from "../models/OrderItem.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import { isPreOrderProduct } from "./preOrderSla.js";

/** Chuẩn hoá line items (populate hoặc load theo id) cho rollback / PayOS deduct. */
async function resolveOrderLineItems(order) {
  const raw = order.items || [];
  if (raw.length === 0) return [];
  const first = raw[0];
  if (
    first &&
    typeof first === "object" &&
    first.sku != null &&
    !(first instanceof mongoose.Types.ObjectId)
  ) {
    return raw;
  }
  const ids = raw.map((x) =>
    x instanceof mongoose.Types.ObjectId ? x : x._id || x,
  );
  return OrderItem.find({ _id: { $in: ids } });
}

/**
 * Deduct inventory, vouchers, and flash sales for an order
 * This should only be called when payment is confirmed (COD or PayOS paid)
 *
 * @param {Object} order - The order document (populated with items)
 * @param {Array} validItems - Array of {cartItem, model, product, flashSaleInfo}
 * @param {Array} validVouchers - Array of validated vouchers
 * @param {String} userId - User ID who created the order
 * @returns {Promise<void>}
 */
/**
 * Tăng usageCount mỗi mã 1 lần cho cả checkout (dù tách nhiều Order theo seller).
 * Gọi khi tạo đơn thành công; webhook PayOS sẽ bỏ qua toàn bộ khi resourcesDeducted === true.
 * @param {string[]} rawCodes
 * @param {{ session?: import('mongoose').ClientSession } | null} options
 */
export async function incrementVoucherUsageForCheckout(rawCodes, options = null) {
  const session = options?.session;
  const seen = new Set();
  for (const c of rawCodes || []) {
    const code = String(c || "")
      .trim()
      .toUpperCase();
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    const result = await Voucher.findOneAndUpdate(
      { code },
      { $inc: { usageCount: 1 } },
      session ? { session } : undefined,
    );
    if (!result) {
      console.warn(
        `[OrderInventory] No voucher found to increment usage for code: ${code}`,
      );
    }
  }
}

export const deductOrderResources = async (
  order,
  validItems,
  validVouchers,
  userId,
) => {
  // 1. Increment voucher usage counts
  for (const v of validVouchers) {
    await Voucher.findByIdAndUpdate(v.voucherId, {
      $inc: { usageCount: 1 },
    });
  }

  // 2. Deduct inventory and update flash sales
  for (const { cartItem, model, product, flashSaleInfo } of validItems) {
    if (isPreOrderProduct(product)) {
      try {
        if (!order || !order.resourcesDeducted) {
          await Product.findByIdAndUpdate(product._id, {
            $inc: { sold: cartItem.quantity },
          });
          console.log(
            `[OrderInventory] COD - Pre-order: +sold only ${product._id} +${cartItem.quantity} (no inventory deduct)`,
          );
        }
      } catch (err) {
        console.error(
          `[OrderInventory] Pre-order sold increment failed for ${product._id}:`,
          err,
        );
      }
      continue;
    }

    // Update flash sale sold quantity if applicable
    if (flashSaleInfo.isFlashSale && flashSaleInfo.flashSaleId) {
      await Deal.findByIdAndUpdate(flashSaleInfo.flashSaleId, {
        $inc: { soldCount: cartItem.quantity },
      });
    }

    // Deduct Inventory from InventoryItem (source of truth)
    const inventoryItem = await InventoryItem.findOne({
      productId: product._id,
      sku: model.sku,
    });
    const currentStock = inventoryItem ? inventoryItem.quantity : model.stock;

    // Update InventoryItem
    if (inventoryItem) {
      inventoryItem.reduceStock(cartItem.quantity);
      await inventoryItem.save();
      console.log(
        `[OrderInventory] COD - Deducted inventory: ${model.sku} -${cartItem.quantity} (${currentStock} → ${inventoryItem.quantity})`,
      );

      // CRITICAL FIX: Sync stock with Product.models[].stock
      const modelInProduct = product.models.id(model._id);
      if (modelInProduct) {
        modelInProduct.stock = Math.max(0, inventoryItem.quantity);
        await product.save();
        console.log(
          `[OrderInventory] COD - Synced Product.models[].stock for SKU: ${model.sku} → ${modelInProduct.stock}`,
        );
      } else {
        console.warn(
          `[OrderInventory] COD - Model not found in Product.models for modelId: ${model._id}`,
        );
      }
    } else {
      console.warn(
        `[OrderInventory] COD - No inventory item found for SKU: ${model.sku}`,
      );

      // Fallback: still deduct from Product.models[].stock to prevent stock not changing
      const modelInProduct = product.models.id(model._id);
      if (modelInProduct) {
        modelInProduct.stock = Math.max(
          0,
          Number(modelInProduct.stock || 0) - Number(cartItem.quantity || 0),
        );
        await product.save();
        console.log(
          `[OrderInventory] COD - Fallback deducted Product.models[].stock for SKU: ${model.sku} → ${modelInProduct.stock}`,
        );
      }
    }

    // Create transaction log
    await InventoryTransaction.create({
      productId: product._id,
      modelId: model._id,
      sku: model.sku,
      type: "out",
      quantity: -cartItem.quantity,
      stockBefore: currentStock,
      stockAfter: currentStock - cartItem.quantity,
      referenceType: "order",
      referenceId: order._id,
      createdBy: userId,
      note: `Order ${order.orderNumber}`,
    });

    // Increment Product.sold (UX: show sold count immediately) if not already deducted for this order
    try {
      if (!order || !order.resourcesDeducted) {
        await Product.findByIdAndUpdate(product._id, {
          $inc: { sold: cartItem.quantity },
        });
        console.log(
          `[OrderInventory] Incremented Product.sold for product ${product._id} +${cartItem.quantity}`,
        );
      } else {
        console.log(
          `[OrderInventory] Skipped Product.sold increment for product ${product._id} (resourcesDeducted already true)`,
        );
      }
    } catch (err) {
      console.error(
        `[OrderInventory] Failed to increment Product.sold for ${product._id}:`,
        err,
      );
    }
  }
};

/**
 * Rollback inventory, vouchers, and flash sales for a cancelled/failed order
 *
 * @param {Object} order - The order document (populated with items)
 * @returns {Promise<void>}
 */
export const rollbackOrderResources = async (order) => {
  const creatorId =
    (typeof order?.userId === "object" && order?.userId?._id
      ? order.userId._id
      : order?.userId) || null;

  // Only rollback if resources were already deducted
  // Check if order has a flag indicating resources were deducted
  if (!order.resourcesDeducted) {
    return; // Nothing to rollback
  }

  // 1. Decrement voucher usage if discount was applied
  if (order.discountCode) {
    const voucherCodes = order.discountCode.split(", ");
    for (const code of voucherCodes) {
      await Voucher.findOneAndUpdate(
        { code: code.trim() },
        { $inc: { usageCount: -1 } },
      );
    }
  }

  // 2. Restore inventory and rollback flash sales
  const lineItems = await resolveOrderLineItems(order);
  if (!lineItems || lineItems.length === 0) {
    return;
  }

  for (const item of lineItems) {
    if (item.isPreOrder) {
      try {
        const prod = await Product.findById(item.productId);
        if (prod) {
          prod.sold = Math.max(
            0,
            Number(prod.sold || 0) - Number(item.quantity || 0),
          );
          await prod.save();
          console.log(
            `[OrderInventory] Rollback - Pre-order sold only: ${item.productId} -${item.quantity} → ${prod.sold}`,
          );
        }
      } catch (err) {
        console.error(
          `[OrderInventory] Rollback pre-order sold failed for ${item.productId}:`,
          err,
        );
      }
      continue;
    }

    // Rollback flash sale sold count
    if (item.isFlashSale) {
      // Find the flash sale/deal - note: we don't have flashSaleId stored,
      // so we need to find it by product and active status
      const deal = await Deal.findOne({
        productId: item.productId,
        status: "active",
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
      });

      if (deal) {
        await Deal.findByIdAndUpdate(deal._id, {
          $inc: { soldCount: -item.quantity },
        });
      }
    }

    // Restore inventory
    const inventoryItem = await InventoryItem.findOne({
      productId: item.productId,
      sku: item.sku,
    });

    if (inventoryItem) {
      const currentStock = inventoryItem.quantity;
      inventoryItem.quantity += item.quantity;
      await inventoryItem.save();
      console.log(
        `[OrderInventory] Rollback - Restored inventory: ${item.sku} +${item.quantity} (${currentStock} → ${inventoryItem.quantity})`,
      );

      // CRITICAL FIX: Sync stock with Product.models[].stock
      const product = await Product.findById(item.productId);
      if (product) {
        const model = product.models.id(item.modelId);
        if (model) {
          model.stock = Math.max(0, inventoryItem.quantity);
          await product.save();
          console.log(
            `[OrderInventory] Rollback - Synced Product.models[].stock for SKU: ${item.sku} → ${model.stock}`,
          );
        } else {
          console.warn(
            `[OrderInventory] Rollback - Model not found in Product.models for modelId: ${item.modelId}`,
          );
        }
      } else {
        console.warn(
          `[OrderInventory] Rollback - Product not found: ${item.productId}`,
        );
      }

      // Create rollback transaction log
      if (creatorId) {
        await InventoryTransaction.create({
          productId: item.productId,
          modelId: item.modelId,
          sku: item.sku,
          type: "in",
          quantity: item.quantity,
          stockBefore: currentStock,
          stockAfter: currentStock + item.quantity,
          referenceType: "adjustment",
          referenceId: order._id,
          createdBy: creatorId,
          note: `Rollback for cancelled order ${order.orderNumber}`,
        });
      } else {
        console.warn(
          `[OrderInventory] Rollback - missing creatorId for transaction log of order ${order.orderNumber}`,
        );
      }

      // Decrement Product.sold to reflect rollback
      try {
        const prod = await Product.findById(item.productId);
        if (prod) {
          prod.sold = Math.max(
            0,
            Number(prod.sold || 0) - Number(item.quantity || 0),
          );
          await prod.save();
          console.log(
            `[OrderInventory] Rollback - Decremented Product.sold for ${item.productId} -${item.quantity} → ${prod.sold}`,
          );
        }
      } catch (err) {
        console.error(
          `[OrderInventory] Failed to decrement Product.sold for ${item.productId}:`,
          err,
        );
      }
    }
  }

  // Mark that resources have been rolled back
  await order.updateOne({ resourcesDeducted: false });
};

/**
 * Deduct resources directly from an Order object (for webhook/async processing)
 * This reconstructs the necessary data from the order and its items
 *
 * @param {Object} order - The order document (must be populated with items)
 * @returns {Promise<void>}
 */
export const deductOrderResourcesFromOrder = async (order) => {
  // Skip if already deducted
  if (order.resourcesDeducted) {
    console.log(
      `[OrderInventory] Resources already deducted for order ${order.orderNumber}`,
    );
    return;
  }

  console.log(
    `[OrderInventory] Starting resource deduction for order ${order.orderNumber}`,
  );

  // 1. Deduct voucher usage
  if (order.discountCode) {
    const voucherCodes = order.discountCode.split(", ");
    for (const code of voucherCodes) {
      const trimmedCode = code.trim();
      const result = await Voucher.findOneAndUpdate(
        { code: trimmedCode },
        { $inc: { usageCount: 1 } },
      );
      console.log(
        `[OrderInventory] Incremented voucher usage: ${trimmedCode}`,
        result ? "✓" : "✗",
      );
    }
  }

  // 2. Deduct inventory and flash sales for each item
  const lineItems = await resolveOrderLineItems(order);
  if (!lineItems || lineItems.length === 0) {
    console.warn(
      `[OrderInventory] No items found in order ${order.orderNumber}`,
    );
    return;
  }

  for (const item of lineItems) {
    if (item.isPreOrder) {
      try {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { sold: item.quantity },
        });
        console.log(
          `[OrderInventory] Pre-order (payment): +sold only ${item.productId} +${item.quantity}`,
        );
      } catch (err) {
        console.error(
          `[OrderInventory] Pre-order sold increment failed for ${item.productId}:`,
          err,
        );
      }
      continue;
    }

    // Handle flash sale sold count
    if (item.isFlashSale) {
      // Find active flash sale/deal for this product
      const deal = await Deal.findOne({
        productId: item.productId,
        status: "active",
        startDate: { $lte: new Date() },
        endDate: { $gte: new Date() },
      });

      if (deal) {
        await Deal.findByIdAndUpdate(deal._id, {
          $inc: { soldCount: item.quantity },
        });
        console.log(
          `[OrderInventory] Incremented flash sale sold: ${deal._id} +${item.quantity}`,
        );
      }
    }

    // Deduct inventory
    const inventoryItem = await InventoryItem.findOne({
      productId: item.productId,
      sku: item.sku,
    });

    const currentStock = inventoryItem ? inventoryItem.quantity : 0;

    if (inventoryItem) {
      inventoryItem.reduceStock(item.quantity);
      await inventoryItem.save();
      console.log(
        `[OrderInventory] Deducted inventory: ${item.sku} -${item.quantity} (${currentStock} → ${currentStock - item.quantity})`,
      );

      // CRITICAL FIX: Sync stock with Product.models[].stock
      const product = await Product.findById(item.productId);
      if (product) {
        const model = product.models.id(item.modelId);
        if (model) {
          model.stock = Math.max(0, inventoryItem.quantity);
          await product.save();
          console.log(
            `[OrderInventory] Synced Product.models[].stock for SKU: ${item.sku} → ${model.stock}`,
          );
        }
      }

      // Create transaction log
      await InventoryTransaction.create({
        productId: item.productId,
        modelId: item.modelId,
        sku: item.sku,
        type: "out",
        quantity: -item.quantity,
        stockBefore: currentStock,
        stockAfter: currentStock - item.quantity,
        referenceType: "order",
        referenceId: order._id,
        createdBy: order.userId,
        note: `Order ${order.orderNumber} (Payment confirmed)`,
      });

      // Increment Product.sold to reflect this confirmed sale
      try {
        await Product.findByIdAndUpdate(item.productId, {
          $inc: { sold: item.quantity },
        });
        console.log(
          `[OrderInventory] Incremented Product.sold for product ${item.productId} +${item.quantity}`,
        );
      } catch (err) {
        console.error(
          `[OrderInventory] Failed to increment Product.sold for ${item.productId}:`,
          err,
        );
      }
    } else {
      console.warn(`[OrderInventory] No inventory found for SKU: ${item.sku}`);

      // Fallback: still deduct Product.models[].stock when inventory record does not exist
      const product = await Product.findById(item.productId);
      if (product) {
        const model = product.models.id(item.modelId);
        if (model) {
          const beforeStock = Number(model.stock || 0);
          model.stock = Math.max(0, beforeStock - Number(item.quantity || 0));
          await product.save();
          console.log(
            `[OrderInventory] Fallback deducted Product.models[].stock for SKU: ${item.sku} (${beforeStock} → ${model.stock})`,
          );
        }
      }

      await InventoryTransaction.create({
        productId: item.productId,
        modelId: item.modelId,
        sku: item.sku,
        type: "out",
        quantity: -item.quantity,
        stockBefore: currentStock,
        stockAfter: Math.max(0, currentStock - item.quantity),
        referenceType: "order",
        referenceId: order._id,
        createdBy: order.userId,
        note: `Order ${order.orderNumber} (Payment confirmed, fallback)`,
      });
    }
  }

  // Mark resources as deducted
  await order.updateOne({ resourcesDeducted: true });
  console.log(
    `[OrderInventory] Resources deducted successfully for order ${order.orderNumber}`,
  );
};

/**
 * Clear cart after successful payment
 * @param {String} userId - User ID
 * @param {Object} [session] - Optional MongoDB session for transaction support
 * @returns {Promise<void>}
 */
export const clearUserCart = async (userId, session = null) => {
  const cart = await Cart.findOne({ userId });
  if (cart) {
    if (session) {
      await CartItem.deleteMany({ cartId: cart._id }, { session });
      cart.totalPrice = 0;
      await cart.save({ session });
    } else {
      await CartItem.deleteMany({ cartId: cart._id });
      cart.totalPrice = 0;
      await cart.save();
    }
    console.log(`[OrderInventory] Cart cleared for user ${userId}`);
  }
};
