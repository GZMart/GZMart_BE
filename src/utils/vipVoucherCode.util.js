import crypto from "crypto";

/**
 * Mã voucher VIP hàng ngày (đúng 20 ký tự, Voucher.code max 20).
 * Deterministic theo (user, ngày ICT, **uniqueKey**).
 *
 * - `c:${campaignId}`: mỗi **campaign** VIP daily → tối đa **1 mã / user / ngày** cho campaign đó
 *   (cron chạy lại hay trigger tay vẫn trùng mã → bỏ qua, không phát trùng).
 * - Nhiều campaign (vd. 2 campaign) → cùng ngày user có tối đa **2 mã khác nhau** (mỗi campaign 1).
 * - `p:${planId}:s:${i}`: fallback từ SubscriptionPlan.dailySlots — mỗi slot một mã / user / ngày.
 */
export const buildVipDailyVoucherCode = (userId, dayStr, uniqueKey) => {
  const h = crypto
    .createHash("sha256")
    .update(`gzmart:vip-daily:${String(userId)}:${dayStr}:${String(uniqueKey)}`)
    .digest("hex")
    .toUpperCase();
  const tail = h.slice(0, 9);
  return `SVD${dayStr}${tail}`;
};
