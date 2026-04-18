import cron from 'node-cron';
import { recalculateAllShopRatings } from '../services/shopRating.service.js';
import logger from '../utils/logger.js';

export const calculateShopRatings = async () => {
  try {
    logger.info('Starting daily shop rating calculation job...');
    await recalculateAllShopRatings();
    logger.info('Successfully updated shop ratings.');
  } catch (error) {
    logger.error(`Error calculating shop ratings: ${error.message}`);
  }
};

// Start the cron job
export const initShopStatisticJobs = () => {
  // Run at 00:00 every day
  cron.schedule('0 0 * * *', async () => {
    logger.info('Running cron job: calculateShopRatings...');
    await calculateShopRatings();
  });
  logger.info('Shop statistic background jobs initialized.');
};
