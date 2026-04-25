import cron from "node-cron";
import BuyerSubscription from "../models/BuyerSubscription.js";
import { grantDailyVipVouchersForUser } from "../services/subscription.service.js";

export const startVipSubscriptionVoucherJob = () => {
  // 00:05 ICT: phát sớm trong ngày (voucher hiệu lực 0:00–23:59 theo VN, tránh mất ~8h nếu chạy 8:00)
  cron.schedule(
    "5 0 * * *",
    async () => {
      const now = new Date();
      const subs = await BuyerSubscription.find({
        status: "active",
        validFrom: { $lte: now },
        validUntil: { $gte: now },
      })
        .select("userId")
        .lean();
      const userIds = [
        ...new Map(subs.map((s) => [s.userId.toString(), s.userId])).values(),
      ];
      for (const userId of userIds) {
        try {
          const n = await grantDailyVipVouchersForUser(userId);
          if (n > 0) {
            console.log(
              `[VIP] user ${userId} granted ${n} voucher(s)`,
            );
          }
        } catch (e) {
          console.error(`[VIP] user ${userId}`, e);
        }
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" },
  );
  console.log("[VIP] Daily voucher job registered — 00:05 Asia/Ho_Chi_Minh");
};
