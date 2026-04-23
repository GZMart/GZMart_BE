import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import Product from "../models/Product.js";
import InventoryItem from "../models/InventoryItem.js";
import InventoryTransaction from "../models/InventoryTransaction.js";
// import FlashSaleProduct from "../models/FlashSaleProduct.js";
import Deal from "../models/Deal.js";
import User from "../models/User.js";
import Coin from "../models/Coin.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import * as campaignService from "../services/campaign.service.js";
import { getShopProgramPriceForVariant } from "../services/product.service.js";
import { validateAndCalculateVouchers } from "../utils/voucherValidator.js";
import * as orderTrackingService from "../services/orderTracking.service.js";
import NotificationService from "../services/notification.service.js";
import { clearUserCart } from "../utils/orderInventory.js";
import mongoose from "mongoose";
import { isPayOsConfigured } from "../config/payos.config.js";
import { getSocketIO } from "../utils/socketIO.js";
import {
  buildPreOrderFieldsFromProduct,
  orderHasPreOrderSlaBreach,
  isPreOrderProduct,
} from "../utils/preOrderSla.js";
import {
  applyOrderSettlement,
  computeOrderFinancialSnapshot,
} from "../services/financialSettlement.service.js";

function emitLivestreamSessionStatsTick(liveSessionId) {
  if (!liveSessionId) {
    return;
  }
  const sid = String(liveSessionId);
  const io = getSocketIO();
  if (io) {
    io.to(`livestream_${sid}`).emit("livestream_session_stats_tick", {
      sessionId: sid,
    });
  }
}

// @desc    Get checkout info (user details)
// @route   GET /api/orders/checkout-info
// @access  Private
export const getCheckoutInfo = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ErrorResponse("User not found", 404));
  }

  res.status(200).json({
    success: true,
    data: {
      firstName: user.fullName ? user.fullName.split(" ")[0] : "",
      lastName: user.fullName
        ? user.fullName.split(" ").slice(1).join(" ")
        : "",
      email: user.email,
      phone: user.phone || "",
      address: user.address || "",
      state: user.provinceName || "", // Default or from DB
      country: "Vietnam", // Changed from Australia
    },
  });
});

// Helper: Calculate Shipping Fee
const calculateShippingFee = (subtotal, city = "") => {
  // Free shipping for orders > 500k
  if (subtotal >= 500000) {
    return 0;
  }

  // Example logic: HCM = 20k, others = 35k
  // In reality, this would call a shipping provider API
  if (city && (city.includes("Hồ Chí Minh") || city.includes("HCM"))) {
    return 20000;
  }
  return 35000;
};

const normalizeFee = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round(parsed);
};

const normalizeAddressForSignature = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();

const buildOrderRequestSignature = ({
  paymentMethod,
  shippingAddress,
  cartItems = [],
  liveItems = [],
  voucherIds = [],
  useCoin,
  includeGiftBox,
}) => {
  const cartPart = cartItems
    .map((item) => `cart:${item._id}:${Number(item.quantity) || 0}`)
    .sort()
    .join("|");

  const livePart = (liveItems || [])
    .map(
      (item) =>
        `live:${item.productId || ""}:${item.modelId || ""}:${item.color || ""}:${item.size || ""}:${Number(item.quantity) || 0}`,
    )
    .sort()
    .join("|");

  const voucherPart = (voucherIds || [])
    .map((id) => String(id))
    .sort()
    .join(",");

  return [
    String(paymentMethod || ""),
    normalizeAddressForSignature(shippingAddress),
    cartPart,
    livePart,
    voucherPart,
    includeGiftBox ? "gift:1" : "gift:0",
    useCoin === false ? "coin:0" : "coin:1",
  ].join("::");
};

// Helper: Generate Order Number
const generateOrderNumber = () =>
  `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const generateCheckoutGroupId = () =>
  `CHK-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

// Deduct GZCoin using packets with nearest expiration first.
const deductCoinsForOrder = async ({
  user,
  requestedAmount,
  orderId,
  orderNumber,
  session,
}) => {
  const amountToDeduct = Math.max(0, Math.floor(Number(requestedAmount || 0)));
  if (amountToDeduct <= 0) {
    return {
      deductedAmount: 0,
      usageDetails: [],
      balanceBefore: user.reward_point || 0,
      balanceAfter: user.reward_point || 0,
    };
  }

  const now = new Date();

  const expiringPackets = await Coin.find({
    userId: user._id,
    status: "active",
    remainingAmount: { $gt: 0 },
    expiresAt: { $ne: null, $gt: now },
  })
    .sort({ expiresAt: 1, createdAt: 1 })
    .session(session);

  const neverExpirePackets = await Coin.find({
    userId: user._id,
    status: "active",
    remainingAmount: { $gt: 0 },
    expiresAt: null,
  })
    .sort({ createdAt: 1 })
    .session(session);

  const packets = [...expiringPackets, ...neverExpirePackets];

  let remaining = amountToDeduct;
  const usageDetails = [];

  for (const packet of packets) {
    if (remaining <= 0) {
      break;
    }

    const useAmount = Math.min(packet.remainingAmount, remaining);
    packet.remainingAmount -= useAmount;
    if (packet.remainingAmount === 0) {
      packet.status = "depleted";
    }
    await packet.save({ session });

    usageDetails.push({
      packetId: packet._id,
      source: packet.source,
      amountUsed: useAmount,
      expiresAt: packet.expiresAt,
      remainingInPacket: packet.remainingAmount,
    });

    remaining -= useAmount;
  }

  const deductedAmount = amountToDeduct - remaining;

  if (deductedAmount <= 0) {
    return {
      deductedAmount: 0,
      usageDetails: [],
      balanceBefore: user.reward_point || 0,
      balanceAfter: user.reward_point || 0,
    };
  }

  const balanceBefore = user.reward_point || 0;
  const balanceAfter = Math.max(0, balanceBefore - deductedAmount);

  await WalletTransaction.create(
    [
      {
        userId: user._id,
        type: "purchase",
        amount: -deductedAmount,
        balanceBefore,
        balanceAfter,
        description: `Use GZCoin for order ${orderNumber}`,
        reference: { orderId },
        status: "completed",
        metadata: {
          packetsUsed: usageDetails,
        },
      },
    ],
    { session },
  );

  user.reward_point = balanceAfter;
  await user.save({ session });

  return {
    deductedAmount,
    usageDetails,
    balanceBefore,
    balanceAfter,
  };
};

// Helper: stock check via InventoryItem (aligns with reserveVariantStock)
const checkStock = async (productId, sku, qty, modelStock = 0) => {
  const inventoryItem = await InventoryItem.findOne({ productId, sku }).lean();
  const currentStock = inventoryItem ? inventoryItem.quantity : modelStock;
  return { available: currentStock >= qty, currentStock };
};

// Reserve stock atomically for a specific product variant.
// Product.models[].stock is the primary checkout constraint; InventoryItem.quantity is kept in sync.
const reserveVariantStock = async ({
  session,
  product,
  model,
  quantity,
  order,
  userId,
  itemLabel = "",
}) => {
  const requestedQuantity = Math.max(1, Number(quantity) || 0);
  if (requestedQuantity <= 0) {
    throw new ErrorResponse("Invalid quantity requested", 400);
  }

  const previousStock = Number(model.stock || 0);

  const updatedProduct = await Product.findOneAndUpdate(
    {
      _id: product._id,
      "models._id": model._id,
      "models.stock": { $gte: requestedQuantity },
    },
    {
      $inc: { "models.$.stock": -requestedQuantity },
    },
    {
      new: true,
      session,
    },
  );

  if (!updatedProduct) {
    throw new ErrorResponse(
      `Insufficient stock for ${product.name || "product"}${itemLabel ? ` (${itemLabel})` : ""}. Inventory changed or item is out of stock.`,
      409,
    );
  }

  const inventoryQuery = {
    productId: product._id,
    modelId: model._id,
    sku: model.sku,
  };

  const inventoryItem =
    await InventoryItem.findOne(inventoryQuery).session(session);
  let inventoryUpdated = null;

  if (inventoryItem) {
    inventoryUpdated = await InventoryItem.findOneAndUpdate(
      {
        ...inventoryQuery,
        quantity: { $gte: requestedQuantity },
      },
      {
        $inc: { quantity: -requestedQuantity },
      },
      {
        new: true,
        session,
      },
    );

    if (!inventoryUpdated) {
      throw new ErrorResponse(
        `Inventory changed for ${product.name || "product"}${itemLabel ? ` (${itemLabel})` : ""}. Please retry checkout.`,
        409,
      );
    }
  }

  await InventoryTransaction.create(
    [
      {
        productId: product._id,
        modelId: model._id,
        sku: model.sku,
        type: "out",
        quantity: -requestedQuantity,
        stockBefore: previousStock,
        stockAfter: previousStock - requestedQuantity,
        referenceType: "order",
        referenceId: order._id,
        createdBy: userId,
        note: `Order ${order.orderNumber}${itemLabel ? ` - ${itemLabel}` : ""}`,
      },
    ],
    { session },
  );

  return {
    updatedProduct,
    inventoryUpdated,
    previousStock,
    currentStock: previousStock - requestedQuantity,
  };
};

// @desc    Preview order calculations (Shipping, Total)
// @route   POST /api/orders/preview
// @access  Private
export const previewOrder = asyncHandler(async (req, res, next) => {
  const { city, voucherIds, cartItemIds, shippingCost, giftBoxFee } = req.body;

  // 1. Get Cart
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
    return next(new ErrorResponse("Cart is empty", 400));
  }

  // Build query to get cart items
  const query = { cartId: cart._id };
  // If cartItemIds provided, only get those specific items
  if (cartItemIds && Array.isArray(cartItemIds) && cartItemIds.length > 0) {
    query._id = { $in: cartItemIds };
  }

  const cartItems = await CartItem.find(query).populate("productId");
  if (cartItems.length === 0) {
    return next(new ErrorResponse("Cart is empty", 400));
  }

  // 2. Calculate Subtotal (re-check promotion prices)
  let subtotal = 0;
  for (const item of cartItems) {
    if (!item.productId) {
      continue;
    }
    const product = item.productId;

    // Find model for this variant
    const colorTierIndex =
      product.tiers?.findIndex(
        (t) =>
          t.name.toLowerCase() === "color" ||
          t.name.toLowerCase() === "màu sắc",
      ) ?? -1;
    const sizeTierIndex =
      product.tiers?.findIndex(
        (t) =>
          t.name.toLowerCase() === "size" ||
          t.name.toLowerCase() === "kích thước",
      ) ?? -1;
    const model = product.models?.find((m) => {
      const colorMatch =
        colorTierIndex === -1 ||
        product.tiers[colorTierIndex].options[m.tierIndex[colorTierIndex]] ===
          item.color;
      const sizeMatch =
        sizeTierIndex === -1 ||
        product.tiers[sizeTierIndex].options[m.tierIndex[sizeTierIndex]] ===
          item.size;
      return colorMatch && sizeMatch;
    });

    let unitPrice = item.price;
    if (model) {
      const modelIdx = product.models.findIndex(
        (m) => m._id.toString() === model._id.toString(),
      );
      const flashSaleInfo = await campaignService.getCampaignPrice(
        product._id,
        model.price,
      );
      if (flashSaleInfo.isFlashSale) {
        unitPrice = flashSaleInfo.price;
      } else {
        const spInfo = await getShopProgramPriceForVariant(
          product._id,
          modelIdx,
          model.price,
        );
        if (spInfo.isShopProgram) {
          unitPrice = spInfo.price;
        }
      }
    }
    subtotal += unitPrice * item.quantity;
  }

  // 3. Calculate Voucher Discount
  const {
    totalDiscount,
    validVouchers,
    errors: voucherErrors,
  } = await validateAndCalculateVouchers(
    voucherIds || [],
    cartItems,
    req.user._id,
  );
  const discount = totalDiscount;

  // 4. Calculate Fees
  const computedShippingCost = calculateShippingFee(subtotal, city);
  const appliedShippingCost = normalizeFee(shippingCost, computedShippingCost);
  const appliedGiftBoxFee = normalizeFee(giftBoxFee, 0);
  const tax = 0;
  const total =
    subtotal + appliedShippingCost + tax - discount + appliedGiftBoxFee;

  // Estimate coin usage for preview (user's reward_point)
  const user = await User.findById(req.user._id);
  const balanceBefore = user?.reward_point || 0;
  const payableBeforeCoin = Math.max(0, total);
  const coinEstimate = Math.min(balanceBefore, payableBeforeCoin);

  res.status(200).json({
    success: true,
    data: {
      subtotal,
      shippingCost: appliedShippingCost,
      giftBoxFee: appliedGiftBoxFee,
      tax,
      discount,
      total,
      itemCount: cartItems.length,
      appliedVouchers: validVouchers,
      voucherErrors,
      // Coin preview fields
      payableBeforeCoin,
      coinEstimate,
      balanceBefore,
    },
  });
});

// @desc    Place new order
// @route   POST /api/orders
// @access  Private
export const createOrder = asyncHandler(async (req, res, next) => {
  const {
    shippingAddress,
    paymentMethod,
    shippingMethod,
    shippingCost,
    giftBoxFee,
    includeGiftBox,
    notes,
    city,
    _quantity,
    voucherIds,
    cartItemIds,
    liveItems,
    liveSessionVoucherId,
    fromLiveSession,
  } = req.body;

  if (!shippingAddress || !paymentMethod) {
    return next(
      new ErrorResponse(
        "Please provide shipping address and payment method",
        400,
      ),
    );
  }

  if (paymentMethod === "payos" && !isPayOsConfigured()) {
    return next(
      new ErrorResponse(
        "PayOS is not configured on server. Please choose Cash on Delivery.",
        400,
      ),
    );
  }

  const liveValidatedItems = [];

  /** Sum of (unit price × qty) for live lines — same logic as OrderItem.effectivePrice */
  let liveItemsMonetarySubtotal = 0;

  /** CartItem-shaped rows for voucher validation when order includes live-only lines (DB cart empty). */
  const liveVirtualCartRows = [];

  // === Pre-transaction validation for live session items ===
  if (liveItems && liveItems.length > 0) {
    for (const liveItem of liveItems) {
      const product = await Product.findById(liveItem.productId)
        .select("name models sellerId images tiers preOrderDays")
        .lean();
      if (!product) {
        return next(
          new ErrorResponse(`Product ${liveItem.productId} not found`, 400),
        );
      }

      // Find the model matching color + size by examining tierIndex
      let targetModel = null;
      if (product.models && product.models.length > 0) {
        if (product.tiers && product.tiers.length > 0) {
          // Map color/size strings to tierIndex positions
          const colorIdx = product.tiers.findIndex((t) =>
            /color|màu|mau/.test(t.name.toLowerCase()),
          );
          const sizeIdx = product.tiers.findIndex((t) =>
            /size|kích|kich/.test(t.name.toLowerCase()),
          );

          targetModel = product.models.find((m) => {
            if (!m.tierIndex || m.tierIndex.length === 0) {
              return false;
            }
            const colorMatch =
              colorIdx === -1 ||
              m.tierIndex[colorIdx] ===
                product.tiers[colorIdx].options?.findIndex(
                  (o) =>
                    String(o).toLowerCase() ===
                    String(liveItem.color || "Default").toLowerCase(),
                );
            const sizeMatch =
              sizeIdx === -1 ||
              m.tierIndex[sizeIdx] ===
                product.tiers[sizeIdx].options?.findIndex(
                  (o) =>
                    String(o).toLowerCase() ===
                    String(liveItem.size || "Default").toLowerCase(),
                );
            return colorMatch && sizeMatch;
          });
        }
      }

      // If no tier-based model found, use first active model
      if (!targetModel) {
        targetModel =
          product.models?.find((m) => m.isActive !== false) ||
          product.models?.[0];
      }

      if (!targetModel) {
        return next(
          new ErrorResponse(
            `Variant not found for product ${product.name}`,
            400,
          ),
        );
      }
      const qty = Math.max(1, Number(liveItem.quantity) || 1);

      if (!isPreOrderProduct(product) && targetModel.stock < qty) {
        return next(
          new ErrorResponse(
            `Insufficient stock for ${product.name} (${liveItem.color} / ${liveItem.size}). Available: ${targetModel.stock}`,
            400,
          ),
        );
      }

      const clientPrice = Number(liveItem.price);
      const lineUnit =
        Number.isFinite(clientPrice) && clientPrice > 0
          ? clientPrice
          : Number(targetModel.price) || 0;
      liveItemsMonetarySubtotal += lineUnit * qty;

      liveVirtualCartRows.push({
        productId: product,
        price: lineUnit,
        quantity: qty,
      });

      liveValidatedItems.push({
        product,
        targetModel,
        quantity: qty,
        price: lineUnit,
        color: liveItem.color || "Default",
        size: liveItem.size || "Default",
        image: liveItem.image || product.images?.[0] || null,
      });
    }
  }

  // 1. Get Cart
  // - No live lines: require cart (all items or selected cartItemIds).
  // - Live + cart (mixed): load selected cart lines when cartItemIds is non-empty.
  // - Live-only: cartItemIds empty — cartItems stays [].
  let cartItems = [];
  let cart = null;
  const hasLiveItems = Array.isArray(liveItems) && liveItems.length > 0;
  const hasCartItemSelection =
    cartItemIds && Array.isArray(cartItemIds) && cartItemIds.length > 0;

  if (!hasLiveItems) {
    // ── Normal cart order (no live-session items) ──────────────────
    cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return next(new ErrorResponse("Cart is empty", 400));
    }

    const query = { cartId: cart._id };
    if (hasCartItemSelection) {
      query._id = { $in: cartItemIds };
    }

    cartItems = await CartItem.find(query).populate("productId");
    if (cartItems.length === 0) {
      console.error("[createOrder] cartItems query returned 0 results.", {
        userId: req.user._id,
        cartId: cart?._id,
        cartItemIds,
        query,
      });
      return next(new ErrorResponse("Cart is empty", 400));
    }

    // SECURITY FIX (BUG 8): Validate that all cartItemIds belong to this user's cart
    if (hasCartItemSelection) {
      const foundItemIds = cartItems.map((item) => item._id.toString());
      const requestedItemIds = cartItemIds.map((id) => id.toString());
      const invalidItems = requestedItemIds.filter(
        (id) => !foundItemIds.includes(id),
      );

      if (invalidItems.length > 0) {
        return next(
          new ErrorResponse(
            "Some cart items do not belong to your cart or do not exist",
            403,
          ),
        );
      }
    }
  } else if (hasCartItemSelection) {
    // ── Mixed: live items + cart lines ─────────────────────────────
    cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return next(new ErrorResponse("Cart is empty", 400));
    }

    cartItems = await CartItem.find({
      cartId: cart._id,
      _id: { $in: cartItemIds },
    }).populate("productId");

    if (cartItems.length === 0) {
      return next(new ErrorResponse("Cart is empty", 400));
    }

    const foundItemIds = cartItems.map((item) => item._id.toString());
    const requestedItemIds = cartItemIds.map((id) => id.toString());
    const invalidItems = requestedItemIds.filter(
      (id) => !foundItemIds.includes(id),
    );

    if (invalidItems.length > 0) {
      return next(
        new ErrorResponse(
          "Some cart items do not belong to your cart or do not exist",
          403,
        ),
      );
    }
  }
  // else: live-only — cartItems remains []

  // DUPLICATE ORDER PREVENTION: block only same payload submitted in a short window.
  const useCoin = req.body.useCoin === false ? false : true;
  const requestSignature = buildOrderRequestSignature({
    paymentMethod,
    shippingAddress,
    cartItems,
    liveItems,
    voucherIds,
    useCoin,
    includeGiftBox,
  });

  const duplicateWindowMs = 15000;
  const duplicateCutoff = new Date(Date.now() - duplicateWindowMs);
  const duplicateOrder = await Order.findOne({
    userId: req.user._id,
    requestSignature,
    createdAt: { $gte: duplicateCutoff },
    status: { $nin: ["cancelled", "refunded"] },
  }).sort({ createdAt: -1 });

  if (duplicateOrder) {
    return next(
      new ErrorResponse(
        "Duplicate order detected. Please wait before creating another order.",
        429,
      ),
    );
  }

  // 2. Validate Stock & Calculate Subtotal
  let subtotal = 0;
  const validItems = [];

  for (const item of cartItems) {
    if (!item.productId) {
      continue;
    } // Skip deleted products

    // Find model to get SKU
    const product = item.productId;
    // We need to re-find the model to get the SKU.
    // Ideally CartItem should store SKU, but currently it stores color/size.
    // Let's assume we find it again.
    const colorTierIndex = product.tiers.findIndex(
      (t) =>
        t.name.toLowerCase() === "color" || t.name.toLowerCase() === "màu sắc",
    );
    const sizeTierIndex = product.tiers.findIndex(
      (t) =>
        t.name.toLowerCase() === "size" ||
        t.name.toLowerCase() === "kích thước",
    );

    const model = product.models.find((m) => {
      const colorMatch =
        colorTierIndex === -1 ||
        product.tiers[colorTierIndex].options[m.tierIndex[colorTierIndex]] ===
          item.color;
      const sizeMatch =
        sizeTierIndex === -1 ||
        product.tiers[sizeTierIndex].options[m.tierIndex[sizeTierIndex]] ===
          item.size;
      return colorMatch && sizeMatch;
    });

    if (!model) {
      return next(
        new ErrorResponse(
          `Product variant ${product.name} (${item.color}, ${item.size}) is no longer available`,
          400,
        ),
      );
    }

    if (!isPreOrderProduct(product)) {
      const { available, currentStock } = await checkStock(
        product._id,
        model.sku,
        item.quantity,
        model.stock,
      );
      if (!available) {
        return next(
          new ErrorResponse(
            `Insufficient stock for ${product.name}. Available: ${currentStock}`,
            400,
          ),
        );
      }
    }

    // Check pricing: Flash Sale > Shop Program > Original
    const flashSaleInfo = await campaignService.getCampaignPrice(
      product._id,
      model.price,
    );
    let finalPrice = model.price;
    let isShopProgram = false;
    const modelIdx = product.models.findIndex(
      (m) => m._id.toString() === model._id.toString(),
    );

    if (flashSaleInfo.isFlashSale) {
      finalPrice = flashSaleInfo.price;
    } else {
      const spInfo = await getShopProgramPriceForVariant(
        product._id,
        modelIdx,
        model.price,
      );
      if (spInfo.isShopProgram) {
        finalPrice = spInfo.price;
        isShopProgram = true;
      }
    }

    subtotal += finalPrice * item.quantity;
    validItems.push({
      cartItem: item,
      model,
      product,
      flashSaleInfo,
      finalPrice,
      isShopProgram,
    });
  }

  subtotal += liveItemsMonetarySubtotal;

  // Voucher rules need product/seller context from live lines too (live-only orders have cartItems = [])
  const cartItemsForVouchers = [...cartItems, ...liveVirtualCartRows];

  // 3. Validate Vouchers & Calculate Discount
  const {
    totalDiscount,
    validVouchers,
    errors: voucherErrors,
  } = await validateAndCalculateVouchers(
    voucherIds || [],
    cartItemsForVouchers,
    req.user._id,
  );

  if (voucherErrors.length > 0 && (voucherIds || []).length > 0) {
    // Only fail if user tried to apply vouchers but they're invalid
    return next(new ErrorResponse(voucherErrors.join(", "), 400));
  }

  const discount = totalDiscount;

  /** Canonical session for stats — set from live voucher and/or fromLiveSession + liveItems */
  let resolvedLiveSessionId = null;

  // 3b. Validate & apply live session voucher (separate from regular voucherIds)
  let liveVoucherDiscount = 0;
  let liveVoucherCode = null;
  if (liveSessionVoucherId) {
    const Voucher = (await import("../models/Voucher.js")).default;
    const LiveSession = (await import("../models/LiveSession.js")).default;

    const liveVoucher = await Voucher.findById(liveSessionVoucherId);
    if (!liveVoucher || liveVoucher.type !== "live") {
      return next(new ErrorResponse("Invalid live session voucher", 400));
    }
    if (!liveVoucher.liveSessionId) {
      return next(
        new ErrorResponse(
          "This voucher is not linked to any live session",
          400,
        ),
      );
    }

    const { getRoomViewers } =
      await import("../services/livestreamRedis.service.js");
    const session = await LiveSession.findById(
      liveVoucher.liveSessionId,
    ).lean();
    if (!session) {
      return next(new ErrorResponse("Live session no longer exists", 400));
    }
    if (session.status !== "live") {
      return next(
        new ErrorResponse(
          "Live session has ended — voucher cannot be used",
          400,
        ),
      );
    }
    const viewerIds = await getRoomViewers(
      liveVoucher.liveSessionId.toString(),
    );
    const isInPresence = viewerIds.includes(req.user._id.toString());
    /** Checkout flow often leaves the viewer page before POST /orders — socket/Redis may not list the buyer anymore. */
    const checkoutFromSameLiveSession =
      hasLiveItems &&
      fromLiveSession &&
      mongoose.Types.ObjectId.isValid(fromLiveSession) &&
      String(fromLiveSession) === String(liveVoucher.liveSessionId);

    if (!isInPresence && !checkoutFromSameLiveSession) {
      return next(
        new ErrorResponse(
          "You must be in the live session to use this voucher",
          400,
        ),
      );
    }

    // Check time & usage
    const now = new Date();
    if (
      liveVoucher.status !== "active" ||
      liveVoucher.startTime > now ||
      liveVoucher.endTime < now
    ) {
      return next(
        new ErrorResponse("This voucher is no longer available", 400),
      );
    }
    if (liveVoucher.usageCount >= liveVoucher.usageLimit) {
      return next(
        new ErrorResponse("This voucher has reached its usage limit", 400),
      );
    }

    // Calculate discount (same logic as voucherValidator) — include live-only lines
    const rowsForLiveVoucherShop = [...cartItems, ...liveVirtualCartRows];
    const applicableSubtotal = rowsForLiveVoucherShop
      .filter(
        (ci) =>
          ci.productId?.sellerId?.toString() === liveVoucher.shopId?.toString(),
      )
      .reduce((sum, ci) => sum + Number(ci.price) * Number(ci.quantity), 0);

    if (
      liveVoucher.minBasketPrice &&
      applicableSubtotal < liveVoucher.minBasketPrice
    ) {
      return next(
        new ErrorResponse(
          `Minimum order ${liveVoucher.minBasketPrice?.toLocaleString()}đ required for this voucher`,
          400,
        ),
      );
    }

    if (liveVoucher.discountType === "amount") {
      liveVoucherDiscount = Math.min(
        liveVoucher.discountValue,
        applicableSubtotal,
      );
    } else {
      liveVoucherDiscount = Math.round(
        applicableSubtotal * (liveVoucher.discountValue / 100),
      );
      if (liveVoucher.maxDiscountAmount) {
        liveVoucherDiscount = Math.min(
          liveVoucherDiscount,
          liveVoucher.maxDiscountAmount,
        );
      }
    }

    liveVoucherCode = liveVoucher.code;
    resolvedLiveSessionId = liveVoucher.liveSessionId;
  }

  // Live line items must be attributed to an active session (explicit id or via voucher above)
  if (hasLiveItems) {
    if (!resolvedLiveSessionId) {
      if (
        !fromLiveSession ||
        !mongoose.Types.ObjectId.isValid(fromLiveSession)
      ) {
        return next(
          new ErrorResponse(
            "fromLiveSession is required when ordering live showcase items",
            400,
          ),
        );
      }
      const LiveSession = (await import("../models/LiveSession.js")).default;
      const ls = await LiveSession.findById(fromLiveSession).lean();
      if (!ls || ls.status !== "live") {
        return next(
          new ErrorResponse(
            "Live session is not active or no longer exists",
            400,
          ),
        );
      }
      resolvedLiveSessionId = new mongoose.Types.ObjectId(fromLiveSession);
    } else if (
      fromLiveSession &&
      String(resolvedLiveSessionId) !== String(fromLiveSession)
    ) {
      return next(
        new ErrorResponse(
          "Live session does not match the applied live voucher",
          400,
        ),
      );
    }
  }

  // Include live voucher discount in total discount
  const totalDiscountAmount = discount + liveVoucherDiscount;

  // 4. Calculate Totals
  const computedShippingCost = calculateShippingFee(
    subtotal,
    city || shippingAddress,
  );
  const appliedShippingCost = normalizeFee(shippingCost, computedShippingCost);
  const appliedGiftBoxFee = normalizeFee(giftBoxFee, 0);
  const tax = 0;
  const payableBeforeCoin = Math.max(
    0,
    subtotal +
      appliedShippingCost +
      tax -
      totalDiscountAmount +
      appliedGiftBoxFee,
  );

  const sellerBucketsMap = new Map();
  const ensureSellerBucket = (sellerId) => {
    if (!sellerBucketsMap.has(sellerId)) {
      sellerBucketsMap.set(sellerId, {
        sellerId,
        subtotal: 0,
      });
    }
    return sellerBucketsMap.get(sellerId);
  };

  for (const line of validItems) {
    const sellerId = line.product?.sellerId?.toString();
    if (!sellerId) {
      return next(
        new ErrorResponse("Cannot resolve seller for cart item", 400),
      );
    }
    const bucket = ensureSellerBucket(sellerId);
    bucket.subtotal +=
      Number(line.finalPrice || 0) * Number(line.cartItem?.quantity || 0);
  }

  for (const line of liveValidatedItems) {
    const sellerId = line.product?.sellerId?.toString();
    if (!sellerId) {
      return next(
        new ErrorResponse("Cannot resolve seller for live item", 400),
      );
    }
    const bucket = ensureSellerBucket(sellerId);
    bucket.subtotal += Number(line.price || 0) * Number(line.quantity || 0);
  }

  const sellerBuckets = Array.from(sellerBucketsMap.values());
  if (sellerBuckets.length === 0) {
    return next(new ErrorResponse("No valid order items found", 400));
  }

  let remainingDiscount = totalDiscountAmount;
  const sellerBucketPricing = sellerBuckets.map((bucket, index) => {
    const bucketShipping = index === 0 ? appliedShippingCost : 0;
    const bucketGiftBox = index === 0 && includeGiftBox ? appliedGiftBoxFee : 0;
    const bucketTax = index === 0 ? tax : 0;
    const gross =
      Number(bucket.subtotal || 0) + bucketShipping + bucketGiftBox + bucketTax;
    const bucketDiscount = Math.min(remainingDiscount, gross);
    remainingDiscount -= bucketDiscount;

    return {
      ...bucket,
      shippingCost: bucketShipping,
      giftBoxFee: bucketGiftBox,
      tax: bucketTax,
      discountAmount: bucketDiscount,
      payableBeforeCoin: Math.max(0, gross - bucketDiscount),
    };
  });

  // 5. Create Order with Transaction Support
  const appliedCodes = validVouchers.map((v) => v.code).join(", ");
  const checkoutGroupId = generateCheckoutGroupId();
  const session = await mongoose.startSession();
  let createdOrders = [];

  try {
    await session.withTransaction(async () => {
      const userInTx = await User.findById(req.user._id).session(session);
      if (!userInTx) {
        throw new ErrorResponse("User not found", 404);
      }

      const coinPlanAmount = useCoin
        ? Math.min(Math.max(0, userInTx.reward_point || 0), payableBeforeCoin)
        : 0;

      const orderBySeller = new Map();
      const orderItemsByOrderId = new Map();

      for (const bucket of sellerBucketPricing) {
        const order = await Order.create(
          [
            {
              userId: req.user._id,
              orderNumber: generateOrderNumber(),
              checkoutGroupId,
              sellerId: bucket.sellerId,
              status: "pending",
              totalPrice: bucket.payableBeforeCoin,
              payableBeforeCoin: bucket.payableBeforeCoin,
              subtotal: bucket.subtotal,
              shippingAddress,
              shippingMethod: shippingMethod || undefined,
              shippingCost: bucket.shippingCost,
              giftBoxFee: bucket.giftBoxFee,
              tax: bucket.tax,
              paymentMethod,
              notes,
              discount: bucket.discountAmount,
              discountAmount: bucket.discountAmount,
              discountCode:
                [appliedCodes, liveVoucherCode].filter(Boolean).join(", ") ||
                undefined,
              isActive: true,
              requestSignature,
              items: [],
              resourcesDeducted: false,
              liveSessionId: resolvedLiveSessionId || null,
              liveSessionVoucherId: liveSessionVoucherId || null,
              fromLiveSession:
                fromLiveSession != null && fromLiveSession !== ""
                  ? String(fromLiveSession)
                  : null,
              financialSnapshot: computeOrderFinancialSnapshot({
                subtotal: bucket.subtotal,
                shippingCost: bucket.shippingCost,
                giftBoxFee: bucket.giftBoxFee,
                tax: bucket.tax,
                discountAmount: bucket.discountAmount,
                payableBeforeCoin: bucket.payableBeforeCoin,
                financialSnapshot: {
                  baseAmount: bucket.payableBeforeCoin,
                  adminRate: 0.1,
                  sellerRate: 0.9,
                },
              }),
            },
          ],
          { session },
        );

        const created = order[0];
        createdOrders.push(created);
        orderBySeller.set(bucket.sellerId, created);
        orderItemsByOrderId.set(String(created._id), []);
      }

      const primaryOrder = createdOrders[0];
      const preOrderAnchor = primaryOrder.createdAt || new Date();

      const coinDeduction = await deductCoinsForOrder({
        user: userInTx,
        requestedAmount: coinPlanAmount,
        orderId: primaryOrder._id,
        orderNumber: primaryOrder.orderNumber,
        session,
      });

      let remainingCoin = coinDeduction.deductedAmount;
      createdOrders = createdOrders.map((order, idx) => {
        const payable = Number(order.payableBeforeCoin || 0);
        const usedCoin = Math.min(remainingCoin, payable);
        remainingCoin -= usedCoin;
        order.coinUsedAmount = usedCoin;
        order.coinUsageDetails = idx === 0 ? coinDeduction.usageDetails : [];
        order.totalPrice = Math.max(0, payable - usedCoin);
        return order;
      });

      for (const {
        cartItem,
        model,
        product,
        flashSaleInfo,
        finalPrice,
        isShopProgram,
      } of validItems) {
        const sellerId = product?.sellerId?.toString();
        const targetOrder = orderBySeller.get(sellerId);
        if (!targetOrder) {
          throw new ErrorResponse("Cannot map cart item to seller order", 500);
        }

        if (!isPreOrderProduct(product)) {
          await reserveVariantStock({
            session,
            product,
            model,
            quantity: cartItem.quantity,
            order: targetOrder,
            userId: req.user._id,
            itemLabel: `${product.name} (${cartItem.color} / ${cartItem.size})`,
          });
        }

        const preOrderSnap = buildPreOrderFieldsFromProduct(
          product.preOrderDays,
          preOrderAnchor,
        );

        const cartTierSelections = new Map();
        if (product.tiers && product.tiers.length > 0 && model && model.tierIndex) {
          product.tiers.forEach((tier, idx) => {
            const optIdx = model.tierIndex[idx];
            const val = (optIdx != null && optIdx >= 0) ? tier.options[optIdx] : "Default";
            cartTierSelections.set(tier.name, String(val));
          });
        }

        const orderItem = await OrderItem.create(
          [
            {
              orderId: targetOrder._id,
              productId: product._id,
              modelId: model._id,
              sku: model.sku,
              quantity: cartItem.quantity,
              price: finalPrice,
              tierSelections: cartTierSelections,
              subtotal: finalPrice * cartItem.quantity,
              originalPrice: model.price,
              isFlashSale: flashSaleInfo.isFlashSale,
              isShopProgram,
              ...preOrderSnap,
            },
          ],
          { session },
        );

        orderItemsByOrderId.get(String(targetOrder._id)).push(orderItem[0]._id);
      }

      for (const liveItem of liveValidatedItems) {
        const product = liveItem.product;
        const targetModel = liveItem.targetModel;
        const sellerId = product?.sellerId?.toString();
        const targetOrder = orderBySeller.get(sellerId);

        if (!targetOrder) {
          throw new ErrorResponse("Cannot map live item to seller order", 500);
        }

        if (!isPreOrderProduct(product)) {
          await reserveVariantStock({
            session,
            product,
            model: targetModel,
            quantity: liveItem.quantity,
            order: targetOrder,
            userId: req.user._id,
            itemLabel: `${product.name} (${liveItem.color} / ${liveItem.size})`,
          });
        }

        const effectivePrice = liveItem.price ?? targetModel.price ?? 0;
        const preOrderSnapLive = buildPreOrderFieldsFromProduct(
          product.preOrderDays,
          preOrderAnchor,
        );

        const liveTierSelections = new Map();
        if (product.tiers && product.tiers.length > 0 && targetModel && targetModel.tierIndex) {
          product.tiers.forEach((tier, idx) => {
            const optIdx = targetModel.tierIndex[idx];
            const val = (optIdx != null && optIdx >= 0) ? tier.options[optIdx] : "Default";
            liveTierSelections.set(tier.name, String(val));
          });
        }

        const orderItem = await OrderItem.create(
          [
            {
              orderId: targetOrder._id,
              productId: product._id,
              modelId: targetModel._id,
              sku: targetModel.sku || null,
              tierSelections: liveTierSelections,
              quantity: liveItem.quantity,
              subtotal: effectivePrice * liveItem.quantity,
              originalPrice: targetModel.price || effectivePrice,
              price: effectivePrice,
              color: liveItem.color || "Default",
              size: liveItem.size || "Default",
              image: liveItem.image || product.images?.[0] || null,
              name: product.name,
              isFlashSale: false,
              isShopProgram: false,
              ...preOrderSnapLive,
            },
          ],
          { session },
        );

        orderItemsByOrderId.get(String(targetOrder._id)).push(orderItem[0]._id);
      }

      const isCOD =
        paymentMethod === "cod" || paymentMethod === "cash_on_delivery";

      let allFullyPaidByCoin = true;
      for (const order of createdOrders) {
        const itemIds = orderItemsByOrderId.get(String(order._id)) || [];
        order.items = itemIds;
        order.resourcesDeducted = true;

        const paidByCoin = Number(order.totalPrice || 0) <= 0;
        if (paidByCoin) {
          order.paymentStatus = "paid";
          order.paymentDate = new Date();
          order.status = "pending";
        } else {
          allFullyPaidByCoin = false;
          if (isCOD) {
            order.paymentStatus = "pending";
          }
        }

        await order.save({ session });
      }

      if (isCOD || allFullyPaidByCoin) {
        await clearUserCart(req.user._id, session);
      }
    });

    // After successful transaction, do non-critical operations

    const user = await User.findById(req.user._id);

    for (const order of createdOrders) {
      orderTrackingService.notifySellerNewOrder(order._id.toString(), {
        orderNumber: order.orderNumber,
        totalPrice: order.totalPrice,
        items: order.items || [],
        createdAt: order.createdAt,
        customerName: user?.fullName || "Customer",
      });
    }

    if (createdOrders[0]?.liveSessionId) {
      emitLivestreamSessionStatsTick(createdOrders[0].liveSessionId);
    }

    // Notify Buyer via New Notification System
    try {
      await NotificationService.createNotification(
        req.user._id,
        "Đặt hàng thành công",
        createdOrders.length > 1
          ? `Đã tạo ${createdOrders.length} đơn hàng từ một lần checkout. Nhấn để xem chi tiết.`
          : `Đơn hàng ${createdOrders[0].orderNumber} của bạn đã được tiếp nhận và đang chờ xác nhận.`,
        "ORDER",
        {
          orderId: createdOrders[0]._id.toString(),
          checkoutGroupId,
        },
      );
    } catch (notifErr) {
      console.error("Failed to send buyer notification:", notifErr);
    }

    const createdOrderIds = createdOrders.map((o) => o._id);
    const populatedOrders = await Order.find({ _id: { $in: createdOrderIds } })
      .populate("items")
      .sort({ createdAt: 1 });

    const primaryOrder = populatedOrders[0];
    const coinUsedTotal = populatedOrders.reduce(
      (sum, order) => sum + Number(order.coinUsedAmount || 0),
      0,
    );
    const amountDueTotal = populatedOrders.reduce(
      (sum, order) => sum + Number(order.totalPrice || 0),
      0,
    );

    res.status(201).json({
      success: true,
      data: primaryOrder,
      checkoutGroupId,
      orders: populatedOrders,
      payment: {
        payableBeforeCoin,
        coinUsed: coinUsedTotal,
        amountDue: amountDueTotal,
        fullyPaidByCoin: amountDueTotal <= 0,
      },
    });
  } catch (error) {
    console.error("Error creating order:", error);
    return next(
      new ErrorResponse(
        error.message || "Failed to create order. Please try again.",
        error.statusCode || 500,
      ),
    );
  } finally {
    await session.endSession();
  }
});

// @desc    Get my orders
// @route   GET /api/orders
// @access  Private
export const getMyOrders = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const orders = await Order.find({ userId: req.user._id })
    .populate("userId", "fullName email phone address location")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Order.countDocuments({ userId: req.user._id });

  // Populate items with productId and sellerId for each order
  const ordersWithItems = await Promise.all(
    orders.map(async (order) => {
      const items = await OrderItem.find({ orderId: order._id }).populate({
        path: "productId",
        select: "name slug images sellerId",
        populate: {
          path: "sellerId",
          select: "fullName email avatar address location",
        },
      });

      const plainItems = items.map((i) => (i.toObject ? i.toObject() : i));
      return {
        ...order.toObject(),
        items: plainItems,
        preOrderSlaBreached: orderHasPreOrderSlaBreach(
          order.status,
          plainItems,
        ),
      };
    }),
  );

  res.status(200).json({
    success: true,
    count: ordersWithItems.length,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
    data: ordersWithItems,
  });
});

/**
 * @desc    Generate Invoice
 * @route   GET /api/orders/:id/invoice
 * @access  Private
 */
export const generateInvoice = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id).populate(
    "userId",
    "fullName email phone address location",
  );

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  // Verify owner
  if (
    order.userId._id.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    return next(new ErrorResponse("Not authorized", 401));
  }

  // Fetch items separately with populate
  const items = await OrderItem.find({ orderId: order._id }).populate({
    path: "productId",
    select: "name slug images",
  });

  // Generate simple HTML invoice
  const itemsHTML = items
    .map(
      (item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.productId?.name || item.sku}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${item.price.toLocaleString()}</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${item.subtotal.toLocaleString()}</td>
    </tr>
  `,
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Invoice #${order.orderNumber}</title>
      <style>
        body { font-family: 'Helvetica Neue', 'Helvetica', Helvetica, Arial, sans-serif; color: #555; }
        .invoice-box { max-width: 800px; margin: auto; padding: 30px; border: 1px solid #eee; box-shadow: 0 0 10px rgba(0, 0, 0, .15); font-size: 16px; line-height: 24px; color: #555; }
        .invoice-header { display: flex; justify-content: space-between; margin-bottom: 50px; }
        .invoice-title { font-size: 45px; line-height: 45px; color: #333; }
        .invoice-details { text-align: right; }
        table { width: 100%; line-height: inherit; text-align: left; border-collapse: collapse; }
        table th { padding: 10px; background: #eee; border-bottom: 1px solid #ddd; font-weight: bold; }
        .total-row td { font-weight: bold; border-top: 2px solid #eee; padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="invoice-box">
        <div class="invoice-header">
           <div>
              <div class="invoice-title">INVOICE</div>
              <div>GZMart Inc.</div>
           </div>
           <div class="invoice-details">
              <div>Invoice #: ${order.orderNumber}</div>
              <div>Date: ${new Date(order.createdAt).toLocaleDateString()}</div>
           </div>
        </div>

        <div style="margin-bottom: 30px; display: flex; justify-content: space-between;">
           <div>
              <strong>Bill To:</strong><br/>
              ${order.userId.fullName}<br/>
              ${order.userId.email}<br/>
              ${order.userId.phone || ""}
           </div>
           <div style="text-align: right;">
              <strong>Ship To:</strong><br/>
              ${order.shippingAddress}
           </div>
        </div>

        <table>
           <thead>
              <tr>
                 <th>Item</th>
                 <th style="text-align: center;">Qty</th>
                 <th style="text-align: right;">Price</th>
                 <th style="text-align: right;">Total</th>
              </tr>
           </thead>
           <tbody>
              ${itemsHTML}
                <tr class="total-row">
                  <td colspan="3" style="text-align: right;">Subtotal:</td>
                  <td style="text-align: right;">$${order.subtotal.toLocaleString()}</td>
                </tr>
                <tr>
                  <td colspan="3" style="text-align: right;">Shipping:</td>
                  <td style="text-align: right;">$${order.shippingCost.toLocaleString()}</td>
                </tr>
                ${order.giftBoxFee ? `<tr><td colspan="3" style="text-align: right;">Gift Box Fee:</td><td style="text-align: right;">$${(order.giftBoxFee || 0).toLocaleString()}</td></tr>` : ""}
                ${order.discountAmount ? `<tr><td colspan="3" style="text-align: right;">Discount:</td><td style="text-align: right;">-$${(order.discountAmount || 0).toLocaleString()}</td></tr>` : ""}
                ${order.coinUsedAmount ? `<tr><td colspan="3" style="text-align: right;">GZCoin Used:</td><td style="text-align: right;">-$${(order.coinUsedAmount || 0).toLocaleString()} <div style="font-size:0.85em;color:#777">(Deducted from your GZCoin balance)</div></td></tr>` : ""}
                <tr>
                  <td colspan="3" style="text-align: right; font-size: 1.2em; font-weight: bold;">Total:</td>
                  <td style="text-align: right; font-size: 1.2em; font-weight: bold;">$${order.totalPrice.toLocaleString()}</td>
                </tr>
           </tbody>
        </table>
      </div>
    </body>
    </html>
  `;

  res.status(200).json({
    success: true,
    data: html,
  });
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = asyncHandler(async (req, res, next) => {
  console.log(`[DEBUG] getOrderById called for ID: ${req.params.id}`);

  // Check if ID is valid ObjectId
  if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
    console.log(`[DEBUG] Invalid Order ID format`);
    return next(new ErrorResponse("Invalid Order ID", 400));
  }

  const order = await Order.findById(req.params.id).populate(
    "userId",
    "fullName email phone address location",
  );

  if (!order) {
    console.log(`[DEBUG] Order not found`);
    return next(new ErrorResponse("Order not found", 404));
  }

  console.log(`[DEBUG] Order found: ${order._id}, User: ${order.userId}`);
  console.log(`[DEBUG] Req User: ${req.user?._id}, Role: ${req.user?.role}`);
  console.log(`[DEBUG] Comparison:`, {
    orderUserId: order.userId._id?.toString() || order.userId.toString(),
    reqUserId: req.user._id.toString(),
    orderUserIdType: typeof order.userId,
    hasIdProperty: !!order.userId._id,
  });

  // Verify owner - FIX: Handle populated userId
  const orderUserId = order.userId._id
    ? order.userId._id.toString()
    : order.userId.toString();
  if (orderUserId !== req.user._id.toString() && req.user.role !== "admin") {
    console.log(`[DEBUG] Authorization failed`);
    return next(new ErrorResponse("Not authorized", 401));
  }

  try {
    const items = await OrderItem.find({ orderId: order._id }).populate({
      path: "productId",
      // Include tiers and models so the frontend can reconstruct variant labels
      select:
        "name slug images sellerId tiers models preOrderDays originalPrice",
      populate: {
        path: "sellerId",
        select: "fullName email avatar address location",
      },
    });
    console.log(`[DEBUG] Items found: ${items.length}`);

    const plainItems = items.map((i) => (i.toObject ? i.toObject() : i));
    res.status(200).json({
      success: true,
      data: {
        ...order.toObject(),
        items: plainItems,
        preOrderSlaBreached: orderHasPreOrderSlaBreach(
          order.status,
          plainItems,
        ),
      },
    });
  } catch (err) {
    console.error("[DEBUG] Error finding/populating items:", err);
    throw err;
  }
});

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
export const cancelOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  if (order.userId.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse("Not authorized", 401));
  }

  if (order.status !== "pending") {
    return next(
      new ErrorResponse("Order cannot be cancelled in current status", 400),
    );
  }

  order.status = "cancelled";
  order.cancelledAt = Date.now();
  order.cancellationReason = req.body.reason || "User cancelled";
  await order.save();

  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "cancelled",
    {
      orderNumber: order.orderNumber,
      buyerId: order.userId,
      cancellationReason: order.cancellationReason,
    },
  );

  // Re-stock Inventory
  const items = await OrderItem.find({ orderId: order._id }).populate(
    "productId",
  );

  for (const item of items) {
    const product = item.productId;
    // Find model again (simplified)
    // Note: In a real app we might store SKU/ModelId in OrderItem to avoid re-finding
    // but here we iterate product models.
    const colorTierIndex = product.tiers.findIndex(
      (t) =>
        t.name.toLowerCase().includes("color") ||
        t.name.toLowerCase().includes("màu"),
    );
    const sizeTierIndex = product.tiers.findIndex(
      (t) =>
        t.name.toLowerCase().includes("size") ||
        t.name.toLowerCase().includes("kích"),
    );

    const model = product.models.find((m) => {
      const colorMatch =
        colorTierIndex === -1 ||
        product.tiers[colorTierIndex].options[m.tierIndex[colorTierIndex]] ===
          item.color;
      const sizeMatch =
        sizeTierIndex === -1 ||
        product.tiers[sizeTierIndex].options[m.tierIndex[sizeTierIndex]] ===
          item.size;
      return colorMatch && sizeMatch;
    });

    if (model) {
      // Restock InventoryItem (source of truth)
      const inventoryItem = await InventoryItem.findOne({
        productId: product._id,
        sku: model.sku,
      });
      const currentStock = inventoryItem ? inventoryItem.quantity : model.stock;

      // Update InventoryItem
      if (inventoryItem) {
        inventoryItem.addStock(item.quantity, inventoryItem.costPrice);
        await inventoryItem.save();
      }

      // Create return transaction log
      await InventoryTransaction.create({
        productId: product._id,
        modelId: model._id,
        sku: model.sku,
        type: "in",
        quantity: item.quantity,
        stockBefore: currentStock,
        stockAfter: currentStock + item.quantity,
        referenceType: "return",
        referenceId: order._id,
        createdBy: req.user._id,
        note: `Order Cancelled ${order.orderNumber}`,
      });

      // Revert flash sale sold quantity if it was a flash sale
      if (item.isFlashSale) {
        const flashSale = await Deal.findOne({
          productId: product._id,
          status: "active",
        });
        if (flashSale) {
          await Deal.findByIdAndUpdate(flashSale._id, {
            $inc: { soldCount: -item.quantity },
          });
        }
      }
    }
  }

  res.status(200).json({
    success: true,
    data: order,
  });
});

// @desc    Confirm receipt of order (Delivered -> Completed)
// @route   PUT /api/orders/:id/confirm-receipt
// @access  Private (Buyer only)
export const confirmReceipt = asyncHandler(async (req, res, next) => {
  const session = await mongoose.startSession();
  let order;

  try {
    await session.withTransaction(async () => {
      order = await Order.findById(req.params.id).session(session);

      if (!order) {
        throw new ErrorResponse("Order not found", 404);
      }

      // Verify ownership
      if (order.userId.toString() !== req.user._id.toString()) {
        throw new ErrorResponse("Not authorized", 401);
      }

      // Must be delivered before confirming
      if (order.status !== "delivered") {
        throw new ErrorResponse(
          `Cannot confirm receipt for order with status: ${order.status}`,
          400,
        );
      }

      // Update to completed
      order.status = "completed";
      order.completedAt = new Date();
      order.customerConfirmedAt = new Date();

      // CRITICAL FIX: Mark COD orders as paid when buyer confirms receipt
      if (
        order.paymentMethod === "cod" ||
        order.paymentMethod === "cash_on_delivery"
      ) {
        order.paymentStatus = "paid";
        order.paidAt = new Date();
      }

      order.statusHistory.push({
        status: "completed",
        changedBy: req.user._id,
        changedByRole: req.user.role,
        changedAt: new Date(),
        notes: "Người mua đã xác nhận nhận hàng",
      });

      await order.save({ session });
      await applyOrderSettlement({ orderId: order._id, session });
    });
  } catch (error) {
    session.endSession();
    if (error instanceof ErrorResponse) {
      return next(error);
    }
    return next(error);
  }

  session.endSession();

  // Notify via Socket
  // Derive sellerId from order items if order.sellerId not present
  let notifySellerId = null;
  try {
    const oi = await OrderItem.findOne({ orderId: order._id }).populate({
      path: "productId",
      select: "sellerId",
      populate: { path: "sellerId", select: "_id" },
    });
    if (oi && oi.productId) {
      notifySellerId =
        oi.productId.sellerId?._id || oi.productId.sellerId || null;
    }
  } catch (e) {
    console.error("Error deriving sellerId for notify on confirmReceipt:", e);
  }

  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "completed",
    {
      orderNumber: order.orderNumber,
      completedAt: order.completedAt,
      buyerId: order.userId,
      sellerId: notifySellerId,
    },
  );

  res.status(200).json({
    success: true,
    message: "Order completed successfully. You can now review the products.",
    data: order,
  });
});

// @desc    Mark order as delivered (when map animation completes)
// @route   PUT /api/orders/:id/mark-delivered
// @access  Private (Buyer only - triggered by map animation completion)
export const markAsDelivered = asyncHandler(async (req, res, next) => {
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  // Verify ownership
  if (order.userId.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse("Not authorized", 401));
  }

  // Only mark as delivered if currently shipping or shipped
  if (order.status !== "shipping" && order.status !== "shipped") {
    return next(
      new ErrorResponse(
        `Cannot mark as delivered for order with status: ${order.status}. Order must be in shipping or shipped status.`,
        400,
      ),
    );
  }

  // Cancel auto-delivery timer if exists
  orderTrackingService.cancelDeliveryTimer(order._id.toString());

  // Update to delivered
  order.status = "delivered";
  order.deliveredAt = new Date();
  order.statusHistory.push({
    status: "delivered",
    changedBy: req.user._id,
    changedByRole: req.user.role,
    changedAt: new Date(),
    notes: "Đơn hàng đã được giao đến địa chỉ (tự động từ map tracking)",
  });

  await order.save();

  // Notify via Socket
  // Derive sellerId from order items if order.sellerId not present
  let notifySellerId = null;
  try {
    const oi = await OrderItem.findOne({ orderId: order._id }).populate({
      path: "productId",
      select: "sellerId",
      populate: { path: "sellerId", select: "_id" },
    });
    if (oi && oi.productId) {
      notifySellerId =
        oi.productId.sellerId?._id || oi.productId.sellerId || null;
    }
  } catch (e) {
    console.error("Error deriving sellerId for notify on markAsDelivered:", e);
  }

  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "delivered",
    {
      orderNumber: order.orderNumber,
      deliveredAt: order.deliveredAt,
      buyerId: order.userId,
      sellerId: notifySellerId,
    },
  );

  res.status(200).json({
    success: true,
    message: "Order marked as delivered successfully",
    data: order,
  });
});
