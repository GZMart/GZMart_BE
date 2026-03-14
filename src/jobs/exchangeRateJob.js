import cron from "node-cron";
import { refreshExchangeRate, getCurrentRate } from "../services/exchangeRate.service.js";
import logger from "../utils/logger.js";

/**
 * Fetch the latest CNY→VND exchange rate from external APIs
 * and persist it to the database.
 */
export const runExchangeRateSync = async () => {
  logger.info("[ExchangeRate Job] Starting exchange rate sync...");
  try {
    const record = await refreshExchangeRate();

    if (record) {
      logger.info(
        `[ExchangeRate Job] ✓ Updated: 1 CNY = ${record.rate.toFixed(2)} VND (source: ${record.apiSource})`
      );
    } else {
      // All external APIs failed — log current rate so we know what's in use
      const current = await getCurrentRate();
      logger.warn(
        `[ExchangeRate Job] ✗ All API sources failed. ` +
          `Keeping last known rate: ${current?.rate ?? 3500} VND/CNY`
      );
    }
  } catch (err) {
    logger.error(`[ExchangeRate Job] Unexpected error: ${err.message}`);
  }
};

/**
 * Start the exchange rate cron job.
 *
 * Schedule:  every 6 hours  →  "0 *\/6 * * *"
 *   00:00, 06:00, 12:00, 18:00 every day
 *
 * On server start it also runs once immediately so the DB
 * always has a fresh rate without waiting 6 hours.
 */
export const startExchangeRateJob = () => {
  // Run immediately on startup
  runExchangeRateSync();

  // Then every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    logger.info("[ExchangeRate Job] Cron triggered (every 6 hours)");
    await runExchangeRateSync();
  });

  logger.info(
    "[ExchangeRate Job] Initialized — syncs every 6 hours (0 */6 * * *)"
  );
};
