import Voucher from "../models/Voucher.js";
import VoucherCampaign from "../models/VoucherCampaign.js";
import User from "../models/User.js";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Sinh code voucher duy nhất:
 * BIRTHDAY_campaign_buyerLast4_shortId hoặc EVT_campaign_buyerLast4_shortId
 */
const generateVoucherCode = (campaign, buyerId) => {
  const prefix = campaign.triggerType === "birthday" ? "BD" : "EV";
  const buyerSuffix = buyerId.toString().slice(-4).toUpperCase();
  return `${prefix}${buyerSuffix}`;
};

/**
 * Tạo một voucher cho một buyer từ campaign.
 * @param {Object} campaign - VoucherCampaign document
 * @param {Object} buyer - User document
 * @returns {Object|null} Voucher đã tạo, hoặc null nếu đã tồn tại
 */
export const createVoucherForBuyer = async (campaign, buyer) => {
  const now = new Date();

  // Tính startDate: hôm nay + offset (âm = trước, dương = sau)
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() + (campaign.voucherStartOffset || 0));
  startDate.setHours(0, 0, 0, 0);

  // Tính endDate: startDate + validityDays
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + campaign.voucherValidityDays);
  endDate.setHours(23, 59, 59, 999);

  const uniqueCode = generateVoucherCode(campaign, buyer._id);

  // Kiểm tra tránh duplicate (cron có thể chạy nhiều lần/ngày)
  const existing = await Voucher.findOne({ code: uniqueCode });
  if (existing) return null;

  const voucher = new Voucher({
    name: campaign.voucherName,
    code: uniqueCode,
    type: campaign.voucherType,
    discountType: campaign.discountType,
    discountValue: campaign.discountValue,
    maxDiscountAmount: campaign.maxDiscountAmount || null,
    minBasketPrice: campaign.minBasketPrice || 0,
    usageLimit: campaign.usageLimit || 1000,
    maxPerBuyer: campaign.maxPerBuyer || 1,
    startTime: startDate,
    endTime: endDate,
    status: "active",
    shopId: null,
    displaySetting: "public",
    applyTo: "all",
  });

  await voucher.save();

  // Gửi notification
  try {
    const { default: NotificationService } = await import(
      "../services/notification.service.js"
    );
    const occasionLabel =
      campaign.triggerType === "birthday"
        ? "Birthday"
        : campaign.occasion || "Special";

    await NotificationService.createNotification(
      buyer._id,
      `Your ${occasionLabel} Voucher is here!`,
      `You received "${campaign.voucherName}" — valid until ${endDate.toLocaleDateString(
        "vi-VN"
      )}. Code: ${uniqueCode}`,
      "VOUCHER",
      { voucherId: voucher._id.toString(), code: uniqueCode }
    );
  } catch (notifErr) {
    console.error("[autoVoucher] Notification failed:", notifErr.message);
  }

  return voucher;
};

/**
 * Kiểm tra buyer đã nhận birthday voucher từ campaign này trong năm nay chưa.
 */
const hasReceivedBirthdayVoucherThisYear = async (campaign, buyerId) => {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const buyerSuffix = buyerId.toString().slice(-4).toUpperCase();
  const existing = await Voucher.findOne({
    code: { $regex: `^BD${buyerSuffix}` },
    createdAt: { $gte: yearStart },
  });
  return !!existing;
};

/**
 * Kiểm tra buyer đã nhận occasion voucher từ campaign này trong năm nay chưa.
 */
const hasReceivedOccasionVoucherThisYear = async (campaign, buyerId) => {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const buyerSuffix = buyerId.toString().slice(-4).toUpperCase();
  const existing = await Voucher.findOne({
    code: { $regex: `^EV${buyerSuffix}` },
    createdAt: { $gte: yearStart },
  });
  return !!existing;
};

/**
 * Process birthday campaign: tìm tất cả buyer có sinh nhật hôm nay,
 * tạo voucher cho những người chưa nhận trong năm nay.
 * @param {Object} campaign - VoucherCampaign document
 * @returns {number} Số voucher đã tạo
 */
export const processBirthdayCampaign = async (campaign) => {
  // Dùng dayjs với timezone ICT để tránh lệch ngày do UTC
  const today = dayjs().tz("Asia/Ho_Chi_Minh");
  const todayDay = today.date();
  const todayMonth = today.month() + 1;

  const buyers = await User.find({
    dateOfBirth: { $ne: null },
    isDeleted: false,
  })
    .select("_id dateOfBirth")
    .lean();

  // Lọc buyer có sinh nhật hôm nay (so sánh theo ngày/tháng, bỏ qua năm)
  const birthdayMatches = buyers.filter((buyer) => {
    if (!buyer.dateOfBirth) return false;
    const bd = dayjs(buyer.dateOfBirth).tz("Asia/Ho_Chi_Minh");
    return bd.date() === todayDay && bd.month() + 1 === todayMonth;
  });

  if (birthdayMatches.length === 0) return 0;

  let created = 0;
  for (const buyer of birthdayMatches) {
    const alreadyReceived = await hasReceivedBirthdayVoucherThisYear(
      campaign,
      buyer._id
    );
    if (!alreadyReceived) {
      const v = await createVoucherForBuyer(campaign, buyer);
      if (v) created++;
    }
  }

  return created;
};

/**
 * Process occasion campaign: tạo voucher cho tất cả buyer active
 * chưa nhận voucher occasion này trong năm nay.
 * @param {Object} campaign - VoucherCampaign document
 * @returns {number} Số voucher đã tạo
 */
export const processOccasionCampaign = async (campaign) => {
  const buyers = await User.find({ isDeleted: false })
    .select("_id")
    .lean();

  if (buyers.length === 0) return 0;

  let created = 0;
  for (const buyer of buyers) {
    const alreadyReceived = await hasReceivedOccasionVoucherThisYear(
      campaign,
      buyer._id
    );
    if (!alreadyReceived) {
      const v = await createVoucherForBuyer(campaign, buyer);
      if (v) created++;
    }
  }

  return created;
};
