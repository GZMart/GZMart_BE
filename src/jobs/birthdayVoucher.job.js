import cron from "node-cron";
import VoucherCampaign from "../models/VoucherCampaign.js";
import { processBirthdayCampaign } from "../services/autoVoucher.service.js";

/**
 * Cron job chạy mỗi ngày 8h sáng (ICT).
 * Tìm tất cả birthday campaign đang active, process cho từng campaign.
 */
export const startBirthdayVoucherJob = () => {
  // Mỗi ngày lúc 08:00 ICT
  cron.schedule(
    "0 8 * * *",
    async () => {
      console.log("[BirthdayVoucher] Starting daily birthday voucher check...");

      try {
        const campaigns = await VoucherCampaign.find({
          triggerType: "birthday",
          isActive: true,
        }).lean();

        if (campaigns.length === 0) {
          console.log("[BirthdayVoucher] No active birthday campaigns found.");
          return;
        }

        let totalCreated = 0;
        for (const campaign of campaigns) {
          const created = await processBirthdayCampaign(campaign);
          totalCreated += created;
          console.log(
            `[BirthdayVoucher] Campaign "${campaign.name}": ${created} voucher(s) created.`
          );
        }

        console.log(
          `[BirthdayVoucher] Done. Total: ${totalCreated} voucher(s) created.`
        );
      } catch (error) {
        console.error("[BirthdayVoucher] Error during execution:", error);
      }
    },
    {
      timezone: "Asia/Ho_Chi_Minh",
    }
  );

  console.log(
    "[BirthdayVoucher] Cron job registered — runs daily at 08:00 ICT."
  );
};
