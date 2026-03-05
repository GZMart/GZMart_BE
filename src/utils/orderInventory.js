import InventoryItem from "../models/InventoryItem.js";
import InventoryTransaction from "../models/InventoryTransaction.js";
import Voucher from "../models/Voucher.js";
import Deal from "../models/Deal.js";
import Product from "../models/Product.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";

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
  }
};

/**
 * Rollback inventory, vouchers, and flash sales for a cancelled/failed order
 *
 * @param {Object} order - The order document (populated with items)
 * @returns {Promise<void>}
 */
export const rollbackOrderResources = async (order) => {
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
  if (!order.items || order.items.length === 0) {
    return;
  }

  for (const item of order.items) {
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

      // Create rollback transaction log
      await InventoryTransaction.create({
        productId: item.productId,
        modelId: item.modelId,
        sku: item.sku,
        type: "in",
        quantity: item.quantity,
        stockBefore: currentStock,
        stockAfter: currentStock + item.quantity,
        referenceType: "order_rollback",
        referenceId: order._id,
        note: `Rollback for cancelled order ${order.orderNumber}`,
      });
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
  if (!order.items || order.items.length === 0) {
    console.warn(
      `[OrderInventory] No items found in order ${order.orderNumber}`,
    );
    return;
  }

  for (const item of order.items) {
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
    } else {
      console.warn(`[OrderInventory] No inventory found for SKU: ${item.sku}`);
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
