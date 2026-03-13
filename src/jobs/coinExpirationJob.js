import cron from "node-cron";
import coinService from "../services/coin.service.js";

/**
 * Coin Expiration Job
 * Runs daily to:
 * 1. Expire old coins
 * 2. Sync user balances
 * 3. Send expiration notifications
 */

// Run every day at 2:00 AM
const coinExpirationJob = cron.schedule(
  "0 2 * * *",
  async () => {
    console.log("[CoinExpirationJob] Starting daily coin expiration check...");

    try {
      // 1. Expire old coins
      const expireResult = await coinService.expireOldCoins();
      console.log(
        `[CoinExpirationJob] Expired ${expireResult.expiredCount} coin packets`,
      );

      // 2. Sync user balances (to fix any inconsistencies)
      const syncResult = await coinService.syncUserBalances();
      console.log(
        `[CoinExpirationJob] Synced ${syncResult.syncedCount} user balances`,
      );

      // 3. Send expiration notifications (3 days before expiration)
      const notifyResult = await coinService.sendExpirationNotifications(3);
      console.log(
        `[CoinExpirationJob] Sent ${notifyResult.notificationsSent} expiration notifications`,
      );

      console.log(
        "[CoinExpirationJob] Daily coin expiration check completed ✓",
      );
    } catch (error) {
      console.error(
        "[CoinExpirationJob] Error during coin expiration check:",
        error,
      );
    }
  },
  {
    scheduled: false, // Don't start immediately
    timezone: "Asia/Ho_Chi_Minh", // Vietnam timezone
  },
);

// Run coin expiration check every hour (for more frequent checks)
const hourlyExpirationJob = cron.schedule(
  "0 * * * *",
  async () => {
    console.log("[CoinExpirationJob] Hourly coin expiration check...");

    try {
      const result = await coinService.expireOldCoins();
      if (result.expiredCount > 0) {
        console.log(
          `[CoinExpirationJob] Expired ${result.expiredCount} coin packets (hourly check)`,
        );
      }
    } catch (error) {
      console.error("[CoinExpirationJob] Error during hourly check:", error);
    }
  },
  {
    scheduled: false,
    timezone: "Asia/Ho_Chi_Minh",
  },
);

export const startCoinJobs = () => {
  coinExpirationJob.start();
  hourlyExpirationJob.start();
  console.log("[CoinExpirationJob] Coin expiration jobs started ✓");
};

export const stopCoinJobs = () => {
  coinExpirationJob.stop();
  hourlyExpirationJob.stop();
  console.log("[CoinExpirationJob] Coin expiration jobs stopped");
};

export default {
  startCoinJobs,
  stopCoinJobs,
  coinExpirationJob,
  hourlyExpirationJob,
};
