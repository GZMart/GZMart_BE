import Voucher from "../models/Voucher.js";

// @desc    Get all system vouchers
// @route   GET /api/vouchers/system
// @access  Private/Admin
export const getSystemVouchers = async (req, res) => {
  try {
    const vouchers = await Voucher.find({
      shopId: null,
      type: { $in: ["system_shipping", "system_order"] },
    }).sort({ createdAt: -1 });

    res.json(vouchers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get system voucher by ID
// @route   GET /api/vouchers/system/:id
// @access  Private/Admin
export const getSystemVoucherById = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({
      _id: req.params.id,
      shopId: null,
    });

    if (voucher) {
      res.json(voucher);
    } else {
      res.status(404).json({ message: "Voucher not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create system voucher
// @route   POST /api/vouchers/system
// @access  Private/Admin
export const createSystemVoucher = async (req, res) => {
  try {
    const {
      name,
      code,
      type, // system_shipping or system_order
      discountType, // amount or percent
      discountValue,
      minBasketPrice,
      usageLimit,
      maxPerBuyer,
      startTime,
      endTime,
      isActive,
    } = req.body;

    const voucherExists = await Voucher.findOne({ code });

    if (voucherExists) {
      return res.status(400).json({ message: "Voucher code already exists" });
    }

    const voucher = new Voucher({
      name,
      code,
      type,
      discountType: discountType || "amount", // Default to amount for system vouchers usually
      discountValue,
      minBasketPrice,
      usageLimit,
      maxPerBuyer,
      startTime,
      endTime,
      status: isActive ? "active" : "inactive",
      shopId: null, // Critical: System vouchers have no shop
      displaySetting: "public", // Always public for now
      applyTo: "all",
    });

    const createdVoucher = await voucher.save();
    res.status(201).json(createdVoucher);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update system voucher
// @route   PUT /api/vouchers/system/:id
// @access  Private/Admin
export const updateSystemVoucher = async (req, res) => {
  try {
    const {
      name,
      code,
      type,
      discountValue,
      minBasketPrice,
      usageLimit,
      maxPerBuyer,
      startTime,
      endTime,
      isActive,
    } = req.body;

    const voucher = await Voucher.findOne({ _id: req.params.id, shopId: null });

    if (voucher) {
      voucher.name = name || voucher.name;
      voucher.code = code || voucher.code;
      voucher.type = type || voucher.type;
      voucher.discountValue = discountValue || voucher.discountValue;
      voucher.minBasketPrice =
        minBasketPrice !== undefined ? minBasketPrice : voucher.minBasketPrice;
      voucher.usageLimit = usageLimit || voucher.usageLimit;
      voucher.maxPerBuyer = maxPerBuyer || voucher.maxPerBuyer;
      voucher.startTime = startTime || voucher.startTime;
      voucher.endTime = endTime || voucher.endTime;

      if (isActive !== undefined) {
        voucher.status = isActive ? "active" : "inactive";
      }

      const updatedVoucher = await voucher.save();
      res.json(updatedVoucher);
    } else {
      res.status(404).json({ message: "Voucher not found" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete system voucher
// @route   DELETE /api/vouchers/system/:id
// @access  Private/Admin
export const deleteSystemVoucher = async (req, res) => {
  try {
    const voucher = await Voucher.findOne({ _id: req.params.id, shopId: null });

    if (voucher) {
      voucher.status = "deleted"; // Soft delete
      await voucher.save();
      res.json({ message: "Voucher removed" });
    } else {
      res.status(404).json({ message: "Voucher not found" });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
