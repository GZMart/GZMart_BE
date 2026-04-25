import asyncHandler from "express-async-handler";
import VoucherCampaign from "../models/VoucherCampaign.js";
import User from "../models/User.js";
import BuyerSubscription from "../models/BuyerSubscription.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

// @desc    Get all campaigns
// @route   GET /api/voucher-campaigns
// @access  Private/Admin
export const getCampaigns = asyncHandler(async (req, res) => {
  const { triggerType, isActive } = req.query;
  const filter = {};
  if (triggerType) filter.triggerType = triggerType;
  if (isActive !== undefined) filter.isActive = isActive === "true";

  const campaigns = await VoucherCampaign.find(filter)
    .populate("createdBy", "fullName")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, data: campaigns });
});

// @desc    Get campaign by ID
// @route   GET /api/voucher-campaigns/:id
// @access  Private/Admin
export const getCampaignById = asyncHandler(async (req, res) => {
  const campaign = await VoucherCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("Campaign not found");
  }
  res.status(200).json({ success: true, data: campaign });
});

// @desc    Create campaign
// @route   POST /api/voucher-campaigns
// @access  Private/Admin
export const createCampaign = asyncHandler(async (req, res) => {
  const {
    name,
    code,
    triggerType,
    occasion,
    customDate,
    customMonth,
    voucherStartOffset,
    voucherValidityDays,
    voucherName,
    voucherType,
    discountType,
    discountValue,
    maxDiscountAmount,
    minBasketPrice,
    usageLimit,
    maxPerBuyer,
    isActive,
  } = req.body;

  if (!name || !code || !voucherValidityDays || !voucherName || !discountValue) {
    res.status(400);
    throw new Error("Missing required fields: name, code, voucherValidityDays, voucherName, discountValue");
  }

  const exists = await VoucherCampaign.findOne({ code });
  if (exists) {
    res.status(400);
    throw new Error("Campaign code already exists");
  }

  if (triggerType === "vip_subscription_daily") {
    if (voucherType !== "system_vip_daily") {
      res.status(400);
      throw new Error(
        "Voucher type must be system_vip_daily for VIP subscription daily campaigns"
      );
    }
  }

  const campaign = new VoucherCampaign({
    name,
    code,
    triggerType,
    occasion,
    customDate,
    customMonth,
    voucherStartOffset: voucherStartOffset || 0,
    voucherValidityDays,
    voucherName,
    voucherType,
    discountType,
    discountValue,
    maxDiscountAmount: maxDiscountAmount || undefined,
    minBasketPrice: minBasketPrice || 0,
    usageLimit: usageLimit || 1000,
    maxPerBuyer: maxPerBuyer || 1,
    isActive: isActive !== false,
    createdBy: req.user._id,
  });

  const created = await campaign.save();
  res.status(201).json({ success: true, data: created });
});

// @desc    Update campaign
// @route   PUT /api/voucher-campaigns/:id
// @access  Private/Admin
export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await VoucherCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("Campaign not found");
  }

  const updatableFields = [
    "name", "code", "triggerType", "occasion",
    "customDate", "customMonth", "voucherStartOffset",
    "voucherValidityDays", "voucherName", "voucherType",
    "discountType", "discountValue", "maxDiscountAmount",
    "minBasketPrice", "usageLimit", "maxPerBuyer", "isActive",
  ];

  updatableFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      campaign[field] = req.body[field];
    }
  });

  if (
    campaign.triggerType === "vip_subscription_daily" &&
    campaign.voucherType !== "system_vip_daily"
  ) {
    res.status(400);
    throw new Error(
      "Voucher type must be system_vip_daily for VIP subscription daily campaigns"
    );
  }

  await campaign.save();
  res.status(200).json({ success: true, data: campaign });
});

// @desc    Delete campaign
// @route   DELETE /api/voucher-campaigns/:id
// @access  Private/Admin
export const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await VoucherCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("Campaign not found");
  }
  await campaign.deleteOne();
  res.status(200).json({ success: true, message: "Campaign deleted" });
});

// @desc    Preview: đếm số user sẽ nhận được voucher nếu campaign chạy hôm nay
// @route   POST /api/voucher-campaigns/:id/preview
// @access  Private/Admin
export const previewCampaign = asyncHandler(async (req, res) => {
  const campaign = await VoucherCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("Campaign not found");
  }

  const today = dayjs().tz("Asia/Ho_Chi_Minh");
  const todayDay = today.date();
  const todayMonth = today.month() + 1;

  let estimatedRecipients = 0;

  if (campaign.triggerType === "birthday") {
    const buyers = await User.find({
      dateOfBirth: { $ne: null },
      isDeleted: false,
    }).select("_id dateOfBirth").lean();

    estimatedRecipients = buyers.filter((buyer) => {
      if (!buyer.dateOfBirth) return false;
      const bd = dayjs(buyer.dateOfBirth).tz("Asia/Ho_Chi_Minh");
      return bd.date() === todayDay && bd.month() + 1 === todayMonth;
    }).length;

    return res.status(200).json({
      success: true,
      data: {
        estimatedRecipients,
        message: `${estimatedRecipients} user(s) have birthday today. They will receive "${campaign.voucherName}".`,
      },
    });
  }

  if (campaign.triggerType === "vip_subscription_daily") {
    const now = new Date();
    estimatedRecipients = await BuyerSubscription.countDocuments({
      status: "active",
      validFrom: { $lte: now },
      validUntil: { $gte: now },
    });
    return res.status(200).json({
      success: true,
      data: {
        estimatedRecipients,
        message: `${estimatedRecipients} buyer(s) with active VIP subscription (today).`,
      },
    });
  }

  if (campaign.triggerType === "occasion") {
    estimatedRecipients = await User.countDocuments({ isDeleted: false });
    return res.status(200).json({
      success: true,
      data: {
        estimatedRecipients,
        message: `${estimatedRecipients} active user(s) will receive "${campaign.voucherName}".`,
      },
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      estimatedRecipients: 0,
      message: "Unknown trigger type for preview.",
    },
  });
});

// @desc    Trigger campaign manually (test — không kiểm tra ngày)
// @route   POST /api/voucher-campaigns/:id/trigger
// @access  Private/Admin
export const triggerCampaign = asyncHandler(async (req, res) => {
  const campaign = await VoucherCampaign.findById(req.params.id);
  if (!campaign) {
    res.status(404);
    throw new Error("Campaign not found");
  }

  if (!campaign.isActive) {
    res.status(400);
    throw new Error("Campaign is not active");
  }

  // Lazy import để tránh circular dependency
  let created = 0;
  if (campaign.triggerType === "birthday") {
    const { processBirthdayCampaign } = await import(
      "../services/autoVoucher.service.js"
    );
    created = await processBirthdayCampaign(campaign);
  } else if (campaign.triggerType === "vip_subscription_daily") {
    const { processVipSubscriptionDailyCampaign } = await import(
      "../services/autoVoucher.service.js"
    );
    created = await processVipSubscriptionDailyCampaign(campaign);
  } else if (campaign.triggerType === "occasion") {
    const { processOccasionCampaign } = await import(
      "../services/autoVoucher.service.js"
    );
    created = await processOccasionCampaign(campaign);
  } else {
    res.status(400);
    throw new Error("Unsupported campaign trigger type");
  }

  res.status(200).json({
    success: true,
    data: {
      created,
      message: `Created ${created} voucher(s) for campaign "${campaign.name}".`,
    },
  });
});
