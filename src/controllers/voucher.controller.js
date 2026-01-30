import Voucher from "../models/Voucher.js";
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
