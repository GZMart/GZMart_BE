import cron from 'node-cron';
import Product from '../models/Product.js';
import ShopStatistic from '../models/ShopStatistic.js';
import logger from '../utils/logger.js';

export const calculateShopRatings = async () => {
  try {
    logger.info('Starting daily shop rating calculation job...');

    // Aggregate average rating and total review counts for each seller
    const sellerStats = await Product.aggregate([
      {
        // Only include products that have at least been reviewed or have a rating
        // Optional: you can include all products, but it's more accurate to only average products with reviews or ratings
        $match: {
          status: 'active',
          $or: [{ reviewCount: { $gt: 0 } }, { rating: { $gt: 0 } }]
        }
      },
      {
        $group: {
          _id: '$sellerId',
          ratingAverage: { $avg: '$rating' },
          ratingCount: { $sum: '$reviewCount' }
        }
      }
    ]);

    for (const stat of sellerStats) {
      const sellerId = stat._id;
      if (!sellerId) continue;

      // Ensure rating is rounded to 1 decimal place max (e.g., 4.8)
      const roundedRating = Math.round(stat.ratingAverage * 10) / 10;

      await ShopStatistic.findOneAndUpdate(
        { sellerId },
        {
          $set: {
            ratingAverage: roundedRating,
            ratingCount: stat.ratingCount
          }
        },
        { new: true, upsert: true }
      );
    }

    // Optional: Reset shops that lost all their active products or reviews to 0
    // Get all shop statistic documents
    const allShopStats = await ShopStatistic.find({});
    for (const shop of allShopStats) {
      const hasReviews = sellerStats.find(
        (s) => s._id && shop.sellerId && s._id.toString() === shop.sellerId.toString()
      );
      if (!hasReviews) {
        // If shop has no products with reviews, reset to 0
        shop.ratingAverage = 0;
        shop.ratingCount = 0;
        await shop.save();
      }
    }

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
