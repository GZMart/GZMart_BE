import cron from "node-cron";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import VoucherCampaign from "../models/VoucherCampaign.js";
import { processOccasionCampaign } from "../services/autoVoucher.service.js";

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Map occasion → (month, day) hoặc custom.
 * Ngày Tết Nguyên đán thay đổi mỗi năm → dùng CUSTOM trong campaign config.
 */
const OCCASION_DATES = {
  NEW_YEAR:      { month: 0,  day: 1  },
  BLACK_FRIDAY:  { month: 10, day: 29 },
  CHRISTMAS:     { month: 11, day: 25 },
  VALENTINE:     { month: 1,  day: 14 },
  WOMEN_DAY:     { month: 2,  day: 8  },
  LUNAR_NEW_YEAR:{ custom: true },
  CUSTOM:         { custom: true },
};

/**
 * Kiểm tra hôm nay có phải ngày của campaign occasion không.
 */
const isOccasionDayToday = (campaign) => {
  const today = dayjs().tz("Asia/Ho_Chi_Minh");
  const config = OCCASION_DATES[campaign.occasion];

  if (!config) return false;

  if (config.custom) {
    return (
      today.date() === campaign.customDate &&
      today.month() + 1 === campaign.customMonth
    );
  }

  return (
    today.month() + 1 === config.month &&
    today.date() === config.day
  );
};

/**
 * Cron job chạy mỗi ngày 08:15 ICT.
 * Với mỗi occasion campaign đang active, kiểm tra nếu hôm nay là ngày
 * của dịp đó thì tạo voucher cho tất cả buyer.
 */
export const startOccasionVoucherJob = () => {
  cron.schedule(
    "15 8 * * *",
    async () => {
      console.log("[OccasionVoucher] Starting daily occasion voucher check...");

      try {
        const today = dayjs().tz("Asia/Ho_Chi_Minh");
        console.log(`[OccasionVoucher] Today: ${today.format("YYYY-MM-DD")}`);

        const campaigns = await VoucherCampaign.find({
          triggerType: "occasion",
          isActive: true,
        }).lean();

        if (campaigns.length === 0) {
          console.log("[OccasionVoucher] No active occasion campaigns found.");
          return;
        }

        let totalCreated = 0;
        for (const campaign of campaigns) {
          if (!isOccasionDayToday(campaign)) {
            console.log(
              `[OccasionVoucher] Campaign "${campaign.name}" (${campaign.occasion}) — not today, skipping.`
            );
            continue;
          }

          console.log(
            `[OccasionVoucher] Campaign "${campaign.name}" — today is the occasion day! Processing...`
          );
          const created = await processOccasionCampaign(campaign);
          totalCreated += created;
          console.log(
            `[OccasionVoucher] Campaign "${campaign.name}": ${created} voucher(s) created.`
          );
        }

        console.log(
          `[OccasionVoucher] Done. Total: ${totalCreated} voucher(s) created.`
        );
      } catch (error) {
        console.error("[OccasionVoucher] Error during execution:", error);
      }
    },
    {
      timezone: "Asia/Ho_Chi_Minh",
    }
  );

  console.log(
    "[OccasionVoucher] Cron job registered — runs daily at 08:15 ICT."
  );
};
