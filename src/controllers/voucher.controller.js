import Voucher from "../models/Voucher.js";
import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import User from "../models/User.js";
import Order from "../models/Order.js";
import { ErrorResponse as ApiError } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

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
  if (status === "ongoing") {
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

  const cartItems = await CartItem.find({ cartId: cart._id }).populate({
    path: "productId",
    select: "name sellerId images originalPrice models",
  });

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

  // 3. Query applicable vouchers
  const now = new Date();
  const vouchers = await Voucher.find({
    status: "active",
    startTime: { $lte: now },
    endTime: { $gte: now },
    displaySetting: "public",
    type: { $in: ["shop", "product"] },
    shopId: { $in: sellerIds },
    $expr: { $lt: ["$usageCount", "$usageLimit"] },
  })
    .populate("appliedProducts", "name")
    .lean();

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
  for (const item of cartItems) {
    if (!item.productId?.sellerId) continue;
    const sid = item.productId.sellerId.toString();
    sellerSubtotals[sid] =
      (sellerSubtotals[sid] || 0) + item.price * item.quantity;
  }

  const applicableVouchers = [];
  for (const voucher of vouchers) {
    const shopId = voucher.shopId?.toString();
    const shopSubtotal = sellerSubtotals[shopId] || 0;

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
    type: { $in: ["shop", "product", "private"] },
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
