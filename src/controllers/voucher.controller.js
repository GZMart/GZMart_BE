import Voucher from "../models/Voucher.js";
import SavedVoucher from "../models/SavedVoucher.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import User from "../models/User.js";
import Order from "../models/Order.js";
import { ErrorResponse as ApiError } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import NotificationService from "../services/notification.service.js";

// Helper functions for buyer voucher eligibility
async function isNewBuyer(userId) {
  const completedOrders = await Order.countDocuments({
    userId,
    status: { $in: ["completed", "delivered"] },
  });
  return completedOrders === 0;
}

async function isRepeatBuyer(userId, minOrderCount = 2) {
  const completedOrders = await Order.countDocuments({
    userId,
    status: { $in: ["completed", "delivered"] },
  });
  return completedOrders >= minOrderCount;
}

async function isShopFollower(userId, shopId) {
  if (!shopId) return false;
  const Follow = (await import("../models/Follow.js")).default;
  const follow = await Follow.findOne({
    followerId: userId,
    followingId: shopId,
  });
  return !!follow;
}

// @desc    Create a new voucher
// @route   POST /api/vouchers
// @access  Seller/Admin
export const createVoucher = asyncHandler(async (req, res) => {
  const {
    name,
    code,
    type,
    discountType,
    discountValue,
    minBasketPrice,
    usageLimit,
    maxPerBuyer,
    startTime,
    endTime,
    displaySetting,
    applyTo,
    appliedProducts,
  } = req.body;

  // 1. Check if code exists
  const existingVoucher = await Voucher.findOne({ code: code.toUpperCase() });
  if (existingVoucher) {
    throw new ApiError("Voucher code already exists", 400);
  }

  // 2. Validate Dates
  if (new Date(startTime) >= new Date(endTime)) {
    throw new ApiError("End time must be after start time", 400);
  }

  // 3. Create Voucher
  const voucher = await Voucher.create({
    name,
    code: code.toUpperCase(),
    type,
    discountType,
    discountValue,
    minBasketPrice: minBasketPrice || 0,
    usageLimit,
    maxPerBuyer: maxPerBuyer || 1,
    startTime,
    endTime,
    displaySetting: displaySetting || "public",
    applyTo: applyTo || "all",
    appliedProducts: applyTo === "specific" ? appliedProducts : [],
    appliedProducts: applyTo === "specific" ? appliedProducts : [],
    shopId: req.user._id, // Save Creator ID
  });

  // 4. Notify followers (fire-and-forget, non-blocking)
  if (displaySetting !== 'private') {
    const seller = await User.findById(req.user._id, 'shopName fullName').lean();
    const shopName = seller?.shopName || seller?.fullName || 'Shop';
    const discountLabel = discountType === 'percent'
      ? `${discountValue}%`
      : new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(discountValue);
    NotificationService.notifyShopFollowers(
      req.user._id,
      `🎟️ ${shopName} vừa phát hành voucher mới!`,
      `Voucher "${voucher.name}" — Giảm ${discountLabel}. Lưu ngay trước khi hết!`,
      'VOUCHER',
      { shopId: req.user._id.toString(), voucherCode: voucher.code }
    );
  }

  res.status(201).json({
    success: true,
    message: "Voucher created successfully",
    data: voucher,
  });
});

// @desc    Get all vouchers (with filters)
// @route   GET /api/vouchers
// @access  Seller/Admin
export const getVouchers = asyncHandler(async (req, res) => {
  const { status, type, page = 1, limit = 10 } = req.query;

  // Build Query
  const query = { shopId: req.user._id }; // Filter by Current Owner
  if (type) query.type = type;

  // Status Filter (Computed on the fly based on dates)
  const now = new Date();
  if (status === "ongoing" || status === "active") {
    query.startTime = { $lte: now };
    query.endTime = { $gte: now };
    query.status = "active";
  } else if (status === "upcoming") {
    query.startTime = { $gt: now };
  } else if (status === "expired") {
    query.endTime = { $lt: now };
  }

  // Pagination
  const skip = (page - 1) * limit;

  const vouchers = await Voucher.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit));

  const total = await Voucher.countDocuments(query);

  res.status(200).json({
    success: true,
    count: vouchers.length,
    total,
    page: Number(page),
    pages: Math.ceil(total / limit),
    data: vouchers,
  });
});

// @desc    Get single voucher
// @route   GET /api/vouchers/:id
// @access  Seller/Buyer
export const getVoucherById = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).populate(
    "appliedProducts",
    "name images models originalPrice sku",
  );

  if (!voucher) {
    throw new ApiError("Voucher not found", 404);
  }

  res.status(200).json({
    success: true,
    data: voucher,
  });
});

// @desc    Update voucher
// @route   PUT /api/vouchers/:id
// @access  Seller/Admin
export const updateVoucher = asyncHandler(async (req, res) => {
  let voucher = await Voucher.findById(req.params.id);

  if (!voucher) {
    throw new ApiError("Voucher not found", 404);
  }

  // Check Ownership
  if (voucher.shopId.toString() !== req.user._id.toString()) {
    throw new ApiError("Not authorized to update this voucher", 403);
  }

  // Prevent key field updates if active/used?
  // For now allow updating mostly everything except code if needed
  // But usually code should be immutable or handled carefully

  voucher = await Voucher.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    success: true,
    message: "Voucher updated",
    data: voucher,
  });
});

// @desc    Delete voucher
// @route   DELETE /api/vouchers/:id
// @access  Seller/Admin
export const deleteVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);

  if (!voucher) {
    throw new ApiError("Voucher not found", 404);
  }

  // Check Ownership
  if (voucher.shopId.toString() !== req.user._id.toString()) {
    throw new ApiError("Not authorized to delete this voucher", 403);
  }

  await voucher.deleteOne();

  res.status(200).json({
    success: true,
    message: "Voucher deleted",
  });
});

// @desc    Get applicable vouchers for buyer's current cart
// @route   GET /api/vouchers/applicable
// @access  Private (Buyer)
export const getApplicableVouchers = asyncHandler(async (req, res, next) => {
  // 1. Get cart
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
    return res.status(200).json({ success: true, data: [] });
  }

  let cartItems = await CartItem.find({ cartId: cart._id }).populate({
    path: "productId",
    select: "name sellerId images originalPrice models",
  });

  // Optional subset (must match checkout preview: POST /api/orders/preview cartItemIds)
  const rawCartItemIds = req.query.cartItemIds;
  if (rawCartItemIds !== undefined && rawCartItemIds !== null && rawCartItemIds !== "") {
    const idList = Array.isArray(rawCartItemIds)
      ? rawCartItemIds
      : String(rawCartItemIds)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    const allowed = new Set(
      idList.filter((id) => /^[a-fA-F0-9]{24}$/.test(String(id))),
    );
    if (allowed.size > 0) {
      cartItems = cartItems.filter((ci) => allowed.has(ci._id.toString()));
    }
  }

  if (cartItems.length === 0) {
    return res.status(200).json({ success: true, data: [] });
  }

  // 2. Extract unique seller IDs and product IDs
  const sellerIds = [
    ...new Set(
      cartItems
        .filter((item) => item.productId?.sellerId)
        .map((item) => item.productId.sellerId.toString()),
    ),
  ];
  const productIds = cartItems
    .filter((item) => item.productId)
    .map((item) => item.productId._id.toString());

  // 3. Get saved voucher IDs for this buyer
  const savedVouchers = await SavedVoucher.find({
    userId: req.user._id,
  }).lean();
  const savedVoucherIds = savedVouchers.map((sv) => sv.voucherId.toString());

  // 4. Query applicable vouchers (public + user's saved private vouchers)
  const now = new Date();
  const systemTypes = ["system_shipping", "system_order"];
  const allTypes = ["shop", "product", "new_buyer", "repeat_buyer", "follower", ...systemTypes];

  // Query 1: public vouchers from shops in cart
  const publicVouchers = await Voucher.find({
    status: "active",
    startTime: { $lte: now },
    endTime: { $gte: now },
    displaySetting: "public",
    type: { $in: allTypes },
    $or: [
      // Vouchers tied to shops in cart
      { shopId: { $in: sellerIds } },
      // OR system vouchers (no shopId = global)
      ...(sellerIds.length > 0 ? [{ shopId: null }] : []),
    ],
    $expr: { $lt: ["$usageCount", "$usageLimit"] },
  })
    .populate("appliedProducts", "name")
    .lean();

  // Query 2: user's saved private vouchers (valid only, not expired)
  const savedPrivateVoucherDocs = savedVoucherIds.length > 0
    ? await Voucher.find({
        _id: { $in: savedVoucherIds },
        status: "active",
        startTime: { $lte: now },
        endTime: { $gte: now },
        displaySetting: "private",
        $expr: { $lt: ["$usageCount", "$usageLimit"] },
      })
        .populate("appliedProducts", "name")
        .lean()
    : [];

  // Combine: deduplicate by _id (private saved vouchers take precedence if somehow duplicated)
  const voucherMap = new Map();
  publicVouchers.forEach((v) => voucherMap.set(v._id.toString(), v));
  savedPrivateVoucherDocs.forEach((v) => voucherMap.set(v._id.toString(), v));
  const vouchers = Array.from(voucherMap.values());

  // 4b. Query live vouchers the buyer has saved
  const liveVouchers = savedVoucherIds.length > 0
    ? await Voucher.find({
        _id: { $in: savedVoucherIds },
        type: "live",
        liveSessionId: { $ne: null },
        status: "active",
        startTime: { $lte: now },
        endTime: { $gte: now },
      })
        .populate("liveSessionId", "status")
        .lean()
    : [];

  // Get all active live session IDs (status = "live") the buyer has saved vouchers for
  // NOTE: We no longer require the buyer to currently be in the Redis room.
  // Rationale: buyer may have saved the voucher while watching, then navigated to checkout.
  // The session.status = "live" check ensures we only include vouchers from currently-live sessions.
  // Session status check below is sufficient
  const activeSessionIds = new Set();
  for (const v of liveVouchers) {
    if (v.liveSessionId && v.liveSessionId.status === "live") {
      // Session is still live — include this voucher regardless of Redis presence
      activeSessionIds.add(v.liveSessionId._id.toString());
    }
  }

  // Filter live vouchers: only include if session is live
  const liveVouchersFiltered = liveVouchers.filter((v) => {
    const session = v.liveSessionId;
    return session && session.status === "live" && activeSessionIds.has(session._id.toString());
  });

  // 4. Filter and enrich
  const sellerNames = {};
  const sellers = await User.find(
    { _id: { $in: sellerIds } },
    "fullName shopName",
  ).lean();
  sellers.forEach((s) => {
    sellerNames[s._id.toString()] = s.shopName || s.fullName || "Shop";
  });

  // Calculate subtotal per seller for minBasketPrice check
  const sellerSubtotals = {};
  let cartSubtotal = 0;
  for (const item of cartItems) {
    if (!item.productId?.sellerId) continue;
    const sid = item.productId.sellerId.toString();
    sellerSubtotals[sid] =
      (sellerSubtotals[sid] || 0) + item.price * item.quantity;
    cartSubtotal += item.price * item.quantity;
  }

  const applicableVouchers = [];
  for (const voucher of vouchers) {
    const shopId = voucher.shopId?.toString();
    const isSystemType = ["system_shipping", "system_order"].includes(voucher.type);
    const shopSubtotal = isSystemType ? cartSubtotal : (sellerSubtotals[shopId] || 0);

    // Filter product vouchers with specific appliedProducts
    let applicableProductNames = [];
    if (voucher.type === "product" && voucher.applyTo === "specific") {
      const appliedSet = new Set(
        (voucher.appliedProducts || []).map((p) => (p._id || p).toString()),
      );
      const matchingProducts = cartItems.filter((item) =>
        appliedSet.has(item.productId?._id?.toString()),
      );
      if (matchingProducts.length === 0) continue;
      applicableProductNames = matchingProducts.map(
        (item) => item.productId.name,
      );
    }

    // Filter by buyer eligibility for buyer voucher types
    let isEligible = true;
    let ineligibleReason = null;

    if (voucher.type === "new_buyer") {
      const eligible = await isNewBuyer(req.user._id);
      if (!eligible) {
        isEligible = false;
        ineligibleReason = "Only valid for first-time buyers";
      }
    } else if (voucher.type === "repeat_buyer") {
      const minOrders = voucher.minOrderCount || 2;
      const eligible = await isRepeatBuyer(req.user._id, minOrders);
      if (!eligible) {
        isEligible = false;
        ineligibleReason = `Requires at least ${minOrders} completed orders`;
      }
    } else if (voucher.type === "follower") {
      const eligible = await isShopFollower(req.user._id, voucher.shopId?.toString());
      if (!eligible) {
        isEligible = false;
        ineligibleReason = "You must follow this shop";
      }
    }

    if (!isEligible) {
      // Still add to list but mark as ineligible
      applicableVouchers.push({
        _id: voucher._id,
        code: voucher.code,
        name: voucher.name,
        type: voucher.type,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        maxDiscountAmount: voucher.maxDiscountAmount || null,
        minBasketPrice: voucher.minBasketPrice || 0,
        shopName: sellerNames[shopId] || "Shop",
        shopId,
        endTime: voucher.endTime,
        applicableProductNames,
        estimatedSaving: 0,
        eligible: false,
        ineligibleReason,
        isSaved: savedVoucherIds.includes(voucher._id.toString()),
      });
      continue;
    }

    // Calculate estimated saving
    let estimatedSaving = 0;
    const applicableSubtotal =
      voucher.type === "product" && voucher.applyTo === "specific"
        ? cartItems
            .filter((item) => {
              const appliedSet = new Set(
                (voucher.appliedProducts || []).map((p) =>
                  (p._id || p).toString(),
                ),
              );
              return appliedSet.has(item.productId?._id?.toString());
            })
            .reduce((sum, item) => sum + item.price * item.quantity, 0)
        : shopSubtotal;

    if (voucher.discountType === "amount") {
      estimatedSaving = Math.min(voucher.discountValue, applicableSubtotal);
    } else if (voucher.discountType === "percent") {
      estimatedSaving = Math.round(
        applicableSubtotal * (voucher.discountValue / 100),
      );
      if (voucher.maxDiscountAmount) {
        estimatedSaving = Math.min(estimatedSaving, voucher.maxDiscountAmount);
      }
    }

    // Check minBasketPrice eligibility
    const meetsMinBasket =
      !voucher.minBasketPrice || applicableSubtotal >= voucher.minBasketPrice;

    // Hide voucher entirely if buyer exceeded maxPerBuyer
    if (voucher.maxPerBuyer) {
      const buyerUsageCount = await Order.countDocuments({
        userId: req.user._id,
        discountCode: { $regex: voucher.code, $options: "i" },
        status: { $nin: ["cancelled", "refunded"] },
      });
      if (buyerUsageCount >= voucher.maxPerBuyer) {
        continue;
      }
    }

    applicableVouchers.push({
      _id: voucher._id,
      code: voucher.code,
      name: voucher.name,
      type: voucher.type,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      maxDiscountAmount: voucher.maxDiscountAmount || null,
      minBasketPrice: voucher.minBasketPrice || 0,
      shopName: sellerNames[shopId] || "Shop",
      shopId,
      endTime: voucher.endTime,
      applicableProductNames,
      estimatedSaving,
      eligible: meetsMinBasket,
      ineligibleReason: !meetsMinBasket
        ? `Minimum order ${voucher.minBasketPrice?.toLocaleString()}₫`
        : null,
      isSaved: savedVoucherIds.includes(voucher._id.toString()),
    });
  }

  // 4c. Append live vouchers to the result
  for (const v of liveVouchersFiltered) {
    const shopId = v.shopId?.toString();
    const shopSubtotal = sellerSubtotals[shopId] || 0;
    const isSaved = true; // already filtered from saved list

    let estimatedSaving = 0;
    if (v.discountType === "amount") {
      estimatedSaving = Math.min(v.discountValue, shopSubtotal);
    } else if (v.discountType === "percent") {
      estimatedSaving = Math.round(shopSubtotal * (v.discountValue / 100));
      if (v.maxDiscountAmount) {
        estimatedSaving = Math.min(estimatedSaving, v.maxDiscountAmount);
      }
    }
    const meetsMinBasket = !v.minBasketPrice || shopSubtotal >= v.minBasketPrice;

    applicableVouchers.push({
      _id: v._id,
      code: v.code,
      name: v.name,
      type: v.type,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscountAmount: v.maxDiscountAmount || null,
      minBasketPrice: v.minBasketPrice || 0,
      shopName: sellerNames[shopId] || "Shop",
      shopId,
      endTime: v.endTime,
      estimatedSaving,
      eligible: meetsMinBasket,
      ineligibleReason: !meetsMinBasket
        ? `Minimum order ${v.minBasketPrice?.toLocaleString()}₫`
        : null,
      isSaved,
      isLiveVoucher: true,
    });
  }

  res.status(200).json({ success: true, data: applicableVouchers });
});

// @desc    Validate a voucher code entered manually by buyer
// @route   POST /api/vouchers/validate-code
// @access  Private (Buyer)
export const validateVoucherCode = asyncHandler(async (req, res, next) => {
  const { code } = req.body;

  if (!code) {
    throw new ApiError("Voucher code is required", 400);
  }

  const now = new Date();
  const voucher = await Voucher.findOne({
    code: code.toUpperCase().trim(),
    status: "active",
    startTime: { $lte: now },
    endTime: { $gte: now },
    type: { $in: ["shop", "product", "private", "new_buyer", "repeat_buyer", "follower", "system_shipping", "system_order"] },
  })
    .populate("appliedProducts", "name")
    .lean();

  if (!voucher) {
    throw new ApiError("Invalid or expired voucher code", 400);
  }

  // Check usage limit
  if (voucher.usageCount >= voucher.usageLimit) {
    throw new ApiError("This voucher has reached its usage limit", 400);
  }

  // Check buyer eligibility for buyer voucher types
  if (voucher.type === "new_buyer") {
    const eligible = await isNewBuyer(req.user._id);
    if (!eligible) {
      throw new ApiError("This voucher is only valid for first-time buyers", 400);
    }
  } else if (voucher.type === "repeat_buyer") {
    const minOrders = voucher.minOrderCount || 2;
    const eligible = await isRepeatBuyer(req.user._id, minOrders);
    if (!eligible) {
      throw new ApiError(
        `This voucher requires at least ${minOrders} completed orders`,
        400
      );
    }
  } else if (voucher.type === "follower") {
    const eligible = await isShopFollower(req.user._id, voucher.shopId?.toString());
    if (!eligible) {
      throw new ApiError("You must follow this shop to use this voucher", 400);
    }
  }

  // Get cart to check applicability
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
    throw new ApiError("Your cart is empty", 400);
  }

  const cartItems = await CartItem.find({ cartId: cart._id }).populate({
    path: "productId",
    select: "name sellerId",
  });

  // Check if voucher's shop has products in cart
  const shopItems = cartItems.filter(
    (item) =>
      item.productId?.sellerId?.toString() === voucher.shopId?.toString(),
  );

  if (shopItems.length === 0) {
    throw new ApiError(
      "This voucher is not applicable to any product in your cart",
      400,
    );
  }

  // Calculate subtotal for the voucher's shop
  const shopSubtotal = shopItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );

  // For product-specific vouchers, check appliedProducts
  let applicableProductNames = [];
  let applicableSubtotal = shopSubtotal;

  if (voucher.type === "product" && voucher.applyTo === "specific") {
    const appliedSet = new Set(
      (voucher.appliedProducts || []).map((p) => (p._id || p).toString()),
    );
    const matching = cartItems.filter((item) =>
      appliedSet.has(item.productId?._id?.toString()),
    );
    if (matching.length === 0) {
      throw new ApiError(
        "This voucher is not applicable to any product in your cart",
        400,
      );
    }
    applicableSubtotal = matching.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    applicableProductNames = matching.map((item) => item.productId.name);
  }

  // Calculate estimated saving
  let estimatedSaving = 0;
  if (voucher.discountType === "amount") {
    estimatedSaving = Math.min(voucher.discountValue, applicableSubtotal);
  } else if (voucher.discountType === "percent") {
    estimatedSaving = Math.round(
      applicableSubtotal * (voucher.discountValue / 100),
    );
    if (voucher.maxDiscountAmount) {
      estimatedSaving = Math.min(estimatedSaving, voucher.maxDiscountAmount);
    }
  }

  // Check minBasketPrice eligibility
  const meetsMinBasket =
    !voucher.minBasketPrice || applicableSubtotal >= voucher.minBasketPrice;

  // Get shop name
  const seller = await User.findById(
    voucher.shopId,
    "fullName shopName",
  ).lean();

  res.status(200).json({
    success: true,
    data: {
      _id: voucher._id,
      code: voucher.code,
      name: voucher.name,
      type: voucher.type,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      maxDiscountAmount: voucher.maxDiscountAmount || null,
      minBasketPrice: voucher.minBasketPrice || 0,
      shopName: seller?.shopName || seller?.fullName || "Shop",
      shopId: voucher.shopId,
      endTime: voucher.endTime,
      applicableProductNames,
      estimatedSaving,
      eligible: meetsMinBasket,
      ineligibleReason: !meetsMinBasket
        ? `Minimum order ${voucher.minBasketPrice?.toLocaleString()}₫`
        : null,
    },
  });
});

// @desc    Get shop vouchers with buyer eligibility check
// @route   GET /api/vouchers/shop/:shopId/eligible
// @access  Private (Buyer) - checks eligibility based on user's order history and follow status
export const getShopVouchersWithEligibility = asyncHandler(async (req, res) => {
  const { shopId } = req.params;
  const now = new Date();

  // Query all public vouchers for this shop
  const vouchers = await Voucher.find({
    shopId,
    status: "active",
    startTime: { $lte: now },
    endTime: { $gte: now },
    displaySetting: "public",
    $expr: { $lt: ["$usageCount", "$usageLimit"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  // If user is logged in, check eligibility
  let savedSet = new Set();
  let eligibilityMap = {};
  if (req.user) {
    // Get saved vouchers
    const saved = await SavedVoucher.find({
      userId: req.user._id,
      voucherId: { $in: vouchers.map((v) => v._id) },
    }).lean();
    savedSet = new Set(saved.map((s) => s.voucherId.toString()));

    // Check eligibility for buyer voucher types in parallel
    const eligibilityChecks = vouchers
      .filter((v) => ["new_buyer", "repeat_buyer", "follower"].includes(v.type))
      .map(async (voucher) => {
        let eligible = true;
        let ineligibleReason = null;

        if (voucher.type === "new_buyer") {
          eligible = await isNewBuyer(req.user._id);
          if (!eligible) {
            ineligibleReason = "Chỉ dành cho người mua lần đầu";
          }
        } else if (voucher.type === "repeat_buyer") {
          const minOrders = voucher.minOrderCount || 2;
          eligible = await isRepeatBuyer(req.user._id, minOrders);
          if (!eligible) {
            ineligibleReason = `Cần ít nhất ${minOrders} đơn hàng`;
          }
        } else if (voucher.type === "follower") {
          eligible = await isShopFollower(req.user._id, voucher.shopId?.toString());
          if (!eligible) {
            ineligibleReason = "Cần follow shop để sử dụng";
          }
        }

        return {
          voucherId: voucher._id.toString(),
          eligible,
          ineligibleReason,
        };
      });

    const results = await Promise.all(eligibilityChecks);
    results.forEach((r) => {
      eligibilityMap[r.voucherId] = r;
    });
  }

  const result = vouchers.map((v) => {
    const voucherId = v._id.toString();
    const eligibility = eligibilityMap[voucherId];

    return {
      _id: v._id,
      code: v.code,
      name: v.name,
      type: v.type,
      discountType: v.discountType,
      discountValue: v.discountValue,
      maxDiscountAmount: v.maxDiscountAmount || null,
      minBasketPrice: v.minBasketPrice || 0,
      usageCount: v.usageCount,
      usageLimit: v.usageLimit,
      endTime: v.endTime,
      isSaved: savedSet.has(voucherId),
      // Eligibility info
      eligible: eligibility ? eligibility.eligible : true,
      ineligibleReason: eligibility ? eligibility.ineligibleReason : null,
    };
  });

  res.status(200).json({ success: true, data: result });
});

// @desc    Get active public vouchers for a shop (buyer browsing)
// @route   GET /api/vouchers/shop/:shopId
// @access  Public (optionalAuth for saved status)
export const getShopVouchers = asyncHandler(async (req, res) => {
  const { shopId } = req.params;
  const now = new Date();

  const vouchers = await Voucher.find({
    shopId,
    status: "active",
    startTime: { $lte: now },
    endTime: { $gte: now },
    displaySetting: "public",
    $expr: { $lt: ["$usageCount", "$usageLimit"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  // If user is logged in, mark which vouchers they've saved
  let savedSet = new Set();
  if (req.user) {
    const saved = await SavedVoucher.find({
      userId: req.user._id,
      voucherId: { $in: vouchers.map((v) => v._id) },
    }).lean();
    savedSet = new Set(saved.map((s) => s.voucherId.toString()));
  }

  const result = vouchers.map((v) => ({
    _id: v._id,
    code: v.code,
    name: v.name,
    type: v.type,
    discountType: v.discountType,
    discountValue: v.discountValue,
    maxDiscountAmount: v.maxDiscountAmount || null,
    minBasketPrice: v.minBasketPrice || 0,
    usageCount: v.usageCount,
    usageLimit: v.usageLimit,
    endTime: v.endTime,
    isSaved: savedSet.has(v._id.toString()),
  }));

  res.status(200).json({ success: true, data: result });
});

// @desc    Save/claim a voucher
// @route   POST /api/vouchers/:id/save
// @access  Private (Buyer)
export const saveVoucher = asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id);
  if (!voucher) {
    throw new ApiError("Voucher not found", 404);
  }

  // Check voucher is still active and valid
  const now = new Date();
  if (
    voucher.status !== "active" ||
    voucher.startTime > now ||
    voucher.endTime < now
  ) {
    throw new ApiError("This voucher is no longer available", 400);
  }

  if (voucher.usageCount >= voucher.usageLimit) {
    throw new ApiError("This voucher has reached its usage limit", 400);
  }

  // For live vouchers: no Redis/live-session check needed here.
  // The voucher's liveSessionId field already links it to a specific session.
  // getApplicableVouchers will re-validate the session is live when buyer uses it.
  // A buyer can save a live voucher after watching the session (e.g. from checkout page).
  const existingSaved = await SavedVoucher.findOne({
    userId: req.user._id,
    voucherId: req.params.id,
  });
  if (existingSaved) {
    return res
      .status(200)
      .json({ success: true, message: "Voucher already saved" });
  }

  await SavedVoucher.create({
    userId: req.user._id,
    voucherId: req.params.id,
  });

  res
    .status(201)
    .json({ success: true, message: "Voucher saved successfully" });
});

// @desc    Remove saved voucher
// @route   DELETE /api/vouchers/:id/save
// @access  Private (Buyer)
export const unsaveVoucher = asyncHandler(async (req, res) => {
  await SavedVoucher.findOneAndDelete({
    userId: req.user._id,
    voucherId: req.params.id,
  });

  res.status(200).json({ success: true, message: "Voucher removed" });
});

// @desc    Get IDs of all vouchers saved by current buyer
// @route   GET /api/vouchers/saved/ids
// @access  Private (Buyer)
export const getSavedVoucherIds = asyncHandler(async (req, res) => {
  const saved = await SavedVoucher.find({ userId: req.user._id })
    .select("voucherId")
    .lean();
  const ids = saved.map((s) => s.voucherId.toString());
  res.json({ success: true, data: { ids } });
});
