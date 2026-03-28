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
import * as flashSaleService from "../services/flashsale.service.js";
import { getShopProgramPriceForVariant } from "../services/product.service.js";
import { validateAndCalculateVouchers } from "../utils/voucherValidator.js";
import * as orderTrackingService from "../services/orderTracking.service.js";
import NotificationService from "../services/notification.service.js";
import {
  deductOrderResources,
  clearUserCart,
} from "../utils/orderInventory.js";
import mongoose from "mongoose";

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

// Helper: Generate Order Number
const generateOrderNumber = () => `ORD-${  Date.now()  }-${  Math.floor(Math.random() * 1000)}`;

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

// Helper to check stock via InventoryItem (source of truth)
const checkStock = async (productId, sku, qty, modelStock = 0) => {
  const inventoryItem = await InventoryItem.findOne({ productId, sku }).lean();
  const currentStock = inventoryItem ? inventoryItem.quantity : modelStock;
  return { available: currentStock >= qty, currentStock };
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
      const flashSaleInfo = await flashSaleService.getFlashSalePrice(
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

  // DEBUG: log raw request payload to diagnose 400
  console.log("[createOrder] Request payload:", {
    hasShippingAddress: !!shippingAddress,
    paymentMethod,
    hasLiveItems: Array.isArray(liveItems),
    liveItemsCount: liveItems?.length,
    liveItems,
    cartItemIds,
    voucherIds,
  });

  if (!shippingAddress || !paymentMethod) {
    return next(
      new ErrorResponse(
        "Please provide shipping address and payment method",
        400,
      ),
    );
  }

  // Track live order item IDs (persisted inside transaction)
  const liveOrderItemIds = [];

  /** Sum of (unit price × qty) for live lines — same logic as OrderItem.effectivePrice */
  let liveItemsMonetarySubtotal = 0;

  // === Pre-transaction validation for live session items ===
  if (liveItems && liveItems.length > 0) {
    for (const liveItem of liveItems) {
      const product = await Product.findById(liveItem.productId)
        .select("name models sellerId images tiers")
        .lean();
      if (!product) {
        return next(new ErrorResponse(`Product ${liveItem.productId} not found`, 400));
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
        return next(new ErrorResponse(`Variant not found for product ${product.name}`, 400));
      }
      if (targetModel.stock < liveItem.quantity) {
        return next(new ErrorResponse(
          `Insufficient stock for ${product.name} (${liveItem.color} / ${liveItem.size}). Available: ${targetModel.stock}`,
          400,
        ));
      }

      const clientPrice = Number(liveItem.price);
      const lineUnit =
        Number.isFinite(clientPrice) && clientPrice > 0
          ? clientPrice
          : Number(targetModel.price) || 0;
      const qty = Math.max(1, Number(liveItem.quantity) || 1);
      liveItemsMonetarySubtotal += lineUnit * qty;
    }
  }

  // 1. Get Cart — skip if order contains only live-session items
  let cartItems = [];
  let cart = null;
  const hasLiveItems = Array.isArray(liveItems) && liveItems.length > 0;

  if (!hasLiveItems) {
    // ── Normal cart order (no live-session items) ──────────────────
    cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return next(new ErrorResponse("Cart is empty", 400));
    }

    const query = { cartId: cart._id };
    if (cartItemIds && Array.isArray(cartItemIds) && cartItemIds.length > 0) {
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
    if (cartItemIds && Array.isArray(cartItemIds) && cartItemIds.length > 0) {
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
  } else {
    // ── Live-session-only order: cart may be empty — this is fine ──
    console.log("[createOrder] Live-session-only order — skipping cart validation.", {
      liveItems: liveItems.length,
      cartItemIds,
    });
  }

  // DUPLICATE ORDER PREVENTION (BUG 9): Check for recent duplicate orders
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentOrder = await Order.findOne({
    userId: req.user._id,
    totalPrice: { $exists: true },
    createdAt: { $gte: fiveMinutesAgo },
    status: { $nin: ["cancelled", "refunded"] },
  }).sort({ createdAt: -1 });

  if (recentOrder) {
    // Calculate if this is a duplicate (same total price and similar timestamp)
    const timeDiff = Date.now() - new Date(recentOrder.createdAt).getTime();
    if (timeDiff < 10000) {
      // Less than 10 seconds
      return next(
        new ErrorResponse(
          "Duplicate order detected. Please wait before creating another order.",
          429,
        ),
      );
    }
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

    // Check pricing: Flash Sale > Shop Program > Original
    const flashSaleInfo = await flashSaleService.getFlashSalePrice(
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

  // 3. Validate Vouchers & Calculate Discount
  const {
    totalDiscount,
    validVouchers,
    errors: voucherErrors,
  } = await validateAndCalculateVouchers(
    voucherIds || [],
    cartItems,
    req.user._id,
  );

  if (voucherErrors.length > 0 && (voucherIds || []).length > 0) {
    // Only fail if user tried to apply vouchers but they're invalid
    return next(new ErrorResponse(voucherErrors.join(", "), 400));
  }

  const discount = totalDiscount;

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
    subtotal + appliedShippingCost + tax - discount + appliedGiftBoxFee,
  );

  // 5. Create Order with Transaction Support
  const appliedCodes = validVouchers.map((v) => v.code).join(", ");

  // Start MongoDB transaction for data consistency
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userInTx = await User.findById(req.user._id).session(session);
    if (!userInTx) {
      throw new ErrorResponse("User not found", 404);
    }

    const coinPlanAmount = Math.min(
      Math.max(0, userInTx.reward_point || 0),
      payableBeforeCoin,
    );

    const order = await Order.create(
      [
        {
          userId: req.user._id,
          orderNumber: generateOrderNumber(),
          status: "pending",
          totalPrice: payableBeforeCoin,
          payableBeforeCoin,
          subtotal,
          shippingAddress,
          shippingMethod: shippingMethod || undefined,
          shippingCost: appliedShippingCost,
          giftBoxFee: includeGiftBox ? appliedGiftBoxFee : 0,
          paymentMethod,
          notes,
          discount,
          discountAmount: discount,
          discountCode: appliedCodes || undefined,
          isActive: true,
          items: [],
          resourcesDeducted: false, // Will be set to true after deduction
          liveSessionVoucherId: liveSessionVoucherId || null,
          fromLiveSession: fromLiveSession || null,
        },
      ],
      { session },
    );
    const createdOrder = order[0];

    // Deduct GZCoin first (expiring soon packets are consumed first)
    const coinDeduction = await deductCoinsForOrder({
      user: userInTx,
      requestedAmount: coinPlanAmount,
      orderId: createdOrder._id,
      orderNumber: createdOrder.orderNumber,
      session,
    });

    createdOrder.coinUsedAmount = coinDeduction.deductedAmount;
    createdOrder.coinUsageDetails = coinDeduction.usageDetails;
    createdOrder.totalPrice = Math.max(
      0,
      payableBeforeCoin - coinDeduction.deductedAmount,
    );

    // 5. Create Order Items
    const orderItemIds = [];
    for (const {
      cartItem,
      model,
      product,
      flashSaleInfo,
      finalPrice,
      isShopProgram,
    } of validItems) {
      // Create Order Item
      const orderItem = await OrderItem.create(
        [
          {
            orderId: createdOrder._id,
            productId: product._id,
            modelId: model._id,
            sku: model.sku,
            quantity: cartItem.quantity,
            price: finalPrice,
            tierSelections: {
              size: cartItem.size,
              color: cartItem.color,
            },
            subtotal: finalPrice * cartItem.quantity,
            originalPrice: model.price,
            isFlashSale: flashSaleInfo.isFlashSale,
            isShopProgram,
          },
        ],
        { session },
      );

      orderItemIds.push(orderItem[0]._id);
    }

    // Create OrderItem documents for live session items
    for (const liveItem of liveItems || []) {
      // Re-fetch product and model within transaction for consistency
      const product = await Product.findById(liveItem.productId)
        .select("name models sellerId images tiers")
        .lean()
        .session(session);

      if (!product) {
        throw new ErrorResponse(`Product ${liveItem.productId} not found`, 400);
      }

      let targetModel = null;
      if (product.models && product.models.length > 0) {
        if (product.tiers && product.tiers.length > 0) {
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

      if (!targetModel) {
        targetModel =
          product.models?.find((m) => m.isActive !== false) ||
          product.models?.[0];
      }

      if (!targetModel) {
        throw new ErrorResponse(`Variant not found for product ${product.name}`, 400);
      }
      if (targetModel.stock < liveItem.quantity) {
        throw new ErrorResponse(
          `Insufficient stock for ${product.name} (${liveItem.color} / ${liveItem.size}). Available: ${targetModel.stock}`,
          400,
        );
      }

      const effectivePrice = liveItem.price ?? targetModel.price ?? 0;

      // Create OrderItem document
      const orderItem = await OrderItem.create(
        [
          {
            orderId: createdOrder._id,
            productId: liveItem.productId,
            modelId: targetModel._id,
            sku: targetModel.sku || null,
            tierSelections: new Map(
              (product.tiers || []).map((tier, idx) => [
                tier.name,
                idx ===
                  product.tiers.findIndex((t) =>
                    /color|màu|mau/.test(t.name.toLowerCase()),
                  )
                  ? String(liveItem.color || 'Default')
                  : idx ===
                    product.tiers.findIndex((t) =>
                      /size|kích|kich/.test(t.name.toLowerCase()),
                    )
                    ? String(liveItem.size || 'Default')
                    : 'Default',
              ]),
            ),
            quantity: liveItem.quantity,
            subtotal: effectivePrice * liveItem.quantity,
            originalPrice: targetModel.price || effectivePrice,
            price: effectivePrice,
            color: liveItem.color || 'Default',
            size: liveItem.size || 'Default',
            image: liveItem.image || product.images?.[0] || null,
            name: product.name,
            isFlashSale: false,
            isShopProgram: false,
          },
        ],
        { session },
      );

      liveOrderItemIds.push(orderItem[0]._id);
    }

    // Add order items to order document (include both cart and live items)
    createdOrder.items = [...orderItemIds, ...liveOrderItemIds];
    await createdOrder.save({ session });

    // 6. Deduct Resources ONLY for COD (Cash on Delivery)
    // For PayOS, resources will be deducted after payment confirmation
    const isCOD =
      paymentMethod === "cod" || paymentMethod === "cash_on_delivery";
    const isFullyPaidByCoin = createdOrder.totalPrice <= 0;

    if (isCOD || isFullyPaidByCoin) {
      // Deduct inventory, vouchers, and flash sales immediately for COD
      await deductOrderResources(
        createdOrder,
        validItems,
        validVouchers,
        req.user._id,
      );
      createdOrder.resourcesDeducted = true;

      if (isFullyPaidByCoin) {
        createdOrder.paymentStatus = "paid";
        createdOrder.paymentDate = new Date();
        // Keep order pending until seller explicitly processes it.
        createdOrder.status = "pending";
      } else {
        createdOrder.paymentStatus = "pending"; // COD will be marked as paid when buyer confirms receipt
      }

      await createdOrder.save({ session });

      // Clear cart for COD / fully paid-by-coin using utility function with transaction support
      await clearUserCart(req.user._id, session);
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // After successful transaction, do non-critical operations

    // Notify seller about new order via Socket.io
    const user = await User.findById(req.user._id);
    orderTrackingService.notifySellerNewOrder(createdOrder._id.toString(), {
      orderNumber: createdOrder.orderNumber,
      totalPrice: createdOrder.totalPrice,
      items: orderItemIds,
      createdAt: createdOrder.createdAt,
      customerName: user?.fullName || "Customer",
    });

    // Notify Buyer via New Notification System
    try {
      await NotificationService.createNotification(
        req.user._id,
        "Đặt hàng thành công",
        `Đơn hàng ${createdOrder.orderNumber} của bạn đã được tiếp nhận và đang chờ xác nhận.`,
        "ORDER",
        { orderId: createdOrder._id.toString() },
      );
    } catch (notifErr) {
      console.error("Failed to send buyer notification:", notifErr);
    }

    // Populate order items before sending response
    await createdOrder.populate("items");

    res.status(201).json({
      success: true,
      data: createdOrder,
      payment: {
        payableBeforeCoin,
        coinUsed: createdOrder.coinUsedAmount || 0,
        amountDue: createdOrder.totalPrice,
        fullyPaidByCoin: createdOrder.totalPrice <= 0,
      },
    });
  } catch (error) {
    // Rollback transaction on error
    await session.abortTransaction();
    session.endSession();
    console.error("Error creating order:", error);
    return next(
      new ErrorResponse(
        error.message || "Failed to create order. Please try again.",
        500,
      ),
    );
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
          select: "fullName email avatar",
        },
      });

      return {
        ...order.toObject(),
        items,
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
      select: "name slug images sellerId",
      populate: {
        path: "sellerId",
        select: "fullName email avatar",
      },
    });
    console.log(`[DEBUG] Items found: ${items.length}`);

    res.status(200).json({
      success: true,
      data: {
        ...order.toObject(),
        items,
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
  const order = await Order.findById(req.params.id);

  if (!order) {
    return next(new ErrorResponse("Order not found", 404));
  }

  // Verify ownership
  if (order.userId.toString() !== req.user._id.toString()) {
    return next(new ErrorResponse("Not authorized", 401));
  }

  // Must be delivered before confirming
  if (order.status !== "delivered") {
    return next(
      new ErrorResponse(
        `Cannot confirm receipt for order with status: ${order.status}`,
        400,
      ),
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

  await order.save();

  // Notify via Socket
  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "completed",
    {
      orderNumber: order.orderNumber,
      completedAt: order.completedAt,
      buyerId: order.userId,
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
  orderTrackingService.notifyBuyerStatusChange(
    order._id.toString(),
    "delivered",
    {
      orderNumber: order.orderNumber,
      deliveredAt: order.deliveredAt,
      buyerId: order.userId,
    },
  );

  res.status(200).json({
    success: true,
    message: "Order marked as delivered successfully",
    data: order,
  });
});
