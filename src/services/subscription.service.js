import SubscriptionPlan from "../models/SubscriptionPlan.js";
import SubscriptionPayment from "../models/SubscriptionPayment.js";
import BuyerSubscription from "../models/BuyerSubscription.js";
import Voucher from "../models/Voucher.js";
import SavedVoucher from "../models/SavedVoucher.js";
import VoucherCampaign from "../models/VoucherCampaign.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { buildVipDailyVoucherCode } from "../utils/vipVoucherCode.util.js";
import { getVipDayBoundsICT } from "../utils/vipVoucherDay.util.js";
import {
  grantVipSubscriptionDailyVouchersForUser,
  ensureSavedVoucherLink,
} from "./autoVoucher.service.js";

/** @deprecated dùng buildVipDailyVoucherCode — giữ export tương thích */
export const buildVipCode = buildVipDailyVoucherCode;

const DEFAULT_VIP_DAILY_SLOTS = [
  {
    name: "VIP 15k hôm nay",
    discountType: "amount",
    discountValue: 15000,
    maxDiscountAmount: 15000,
    minBasketPrice: 0,
  },
  {
    name: "VIP 10% tối đa 20k",
    discountType: "percent",
    discountValue: 10,
    maxDiscountAmount: 20000,
    minBasketPrice: 100000,
  },
];

/**
 * Chỉ giữ một gói active: ưu tiên tên "GZMart VIP", không thì bản ghi tạo sớm nhất.
 */
const enforceSingleActiveSubscriptionPlan = async () => {
  const actives = await SubscriptionPlan.find({ isActive: true }).sort({
    createdAt: 1,
  });
  if (actives.length <= 1) return;
  const preferred =
    actives.find((p) => p.name === "GZMart VIP") ?? actives[0];
  await SubscriptionPlan.updateMany(
    { isActive: true, _id: { $ne: preferred._id } },
    { $set: { isActive: false } },
  );
};

/**
 * Đảm bảo đúng một gói active (lần đầu: upsert mặc định, cùng nội dung seed).
 */
export const ensureActiveSubscriptionPlan = async () => {
  await enforceSingleActiveSubscriptionPlan();

  let plan = await SubscriptionPlan.findOne({ isActive: true }).sort({
    createdAt: -1,
  });

  if (plan) {
    return plan;
  }

  await SubscriptionPlan.findOneAndUpdate(
    { name: "GZMart VIP" },
    {
      $set: {
        name: "GZMart VIP",
        priceVnd: 99000,
        durationDays: 30,
        isActive: true,
        dailySlots: DEFAULT_VIP_DAILY_SLOTS,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await enforceSingleActiveSubscriptionPlan();
  plan = await SubscriptionPlan.findOne({ isActive: true }).sort({
    createdAt: -1,
  });
  return plan;
};

export const createPendingSubscriptionPayment = async (userId) => {
  const plan = await ensureActiveSubscriptionPlan();
  if (!plan) {
    throw new ErrorResponse("Chưa cấu hình gói VIP", 400);
  }
  return { plan, amount: plan.priceVnd };
};

export const markSubscriptionPaymentPaid = async (paymentDoc) => {
  if (paymentDoc.status === "completed") {
    return { already: true };
  }
  const plan = await SubscriptionPlan.findById(paymentDoc.planId);
  if (!plan) {
    throw new ErrorResponse("Gói không tồn tại", 500);
  }
  const now = new Date();
  const addMs = plan.durationDays * 864e5;

  const existing = await BuyerSubscription.findOne({
    userId: paymentDoc.userId,
    status: "active",
  });
  const base = existing && existing.validUntil > now ? existing.validUntil : now;
  const validUntil = new Date(base.getTime() + addMs);

  if (existing) {
    existing.validUntil = validUntil;
    existing.planId = plan._id;
    existing.lastPaymentId = paymentDoc._id;
    await existing.save();
  } else {
    await BuyerSubscription.create({
      userId: paymentDoc.userId,
      planId: plan._id,
      status: "active",
      validFrom: now,
      validUntil,
      lastPaymentId: paymentDoc._id,
    });
  }

  paymentDoc.status = "completed";
  await paymentDoc.save();
  return { already: false };
};

export const grantDailyVipVouchersForUser = async (userId) => {
  const sub = await BuyerSubscription.findOne({ userId, status: "active" });
  if (!sub) return 0;
  const now = new Date();
  if (now < sub.validFrom || now > sub.validUntil) return 0;

  const vipCampaigns = await VoucherCampaign.find({
    triggerType: "vip_subscription_daily",
    isActive: true,
  }).sort({ _id: 1 });
  if (vipCampaigns.length > 0) {
    return grantVipSubscriptionDailyVouchersForUser(userId, vipCampaigns, now);
  }

  const plan = await SubscriptionPlan.findById(sub.planId);
  if (!plan || !plan.dailySlots?.length) return 0;

  const { ymd, start, end } = getVipDayBoundsICT(now);
  // Mỗi dailySlot = tối đa 1 voucher / user / ngày (uniqueKey có planId + index slot)
  let count = 0;
  for (let i = 0; i < plan.dailySlots.length; i += 1) {
    const slot = plan.dailySlots[i];
    const code = buildVipDailyVoucherCode(
      userId,
      ymd,
      `p:${plan._id.toString()}:s:${i}`,
    );
    const exists = await Voucher.findOne({ code });
    if (exists) {
      await ensureSavedVoucherLink(userId, exists._id);
      continue;
    }

    let v;
    try {
      v = await Voucher.create({
        name: slot.name,
        code,
        type: "system_vip_daily",
        discountType: slot.discountType,
        discountValue: slot.discountValue,
        maxDiscountAmount: slot.maxDiscountAmount,
        minBasketPrice: slot.minBasketPrice ?? 0,
        usageLimit: 1,
        maxPerBuyer: 1,
        startTime: start,
        endTime: end,
        status: "active",
        displaySetting: "public",
        applyTo: "all",
      });
    } catch (e) {
      if (e?.code === 11000) {
        const dup = await Voucher.findOne({ code });
        if (dup) {
          await ensureSavedVoucherLink(userId, dup._id);
        }
        continue;
      }
      throw e;
    }
    await ensureSavedVoucherLink(userId, v._id);
    count += 1;
  }
  return count;
};

export const getMySubscription = async (userId) => {
  const sub = await BuyerSubscription.findOne({ userId, status: "active" })
    .sort({ validUntil: -1 })
    .populate("planId", "name priceVnd durationDays dailySlots")
    .lean();
  return sub;
};
