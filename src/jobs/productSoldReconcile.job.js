import cron from "node-cron";
import OrderItem from "../models/OrderItem.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import logger from "../utils/logger.js";

/**
 * Reconcile Product.sold by aggregating confirmed OrderItems
 * Uses orders with resourcesDeducted = true and not cancelled as source of truth
 */
export const runProductSoldReconcile = async () => {
  logger.info("[ReconcileSold] Starting product sold reconciliation job...");
  try {
    const pipeline = [
      // Join order to filter only confirmed/deducted orders
      {
        $lookup: {
          from: "orders",
          localField: "orderId",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: "$order" },
      {
        $match: {
          "order.resourcesDeducted": true,
          "order.status": { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: "$productId",
          totalSold: { $sum: "$quantity" },
        },
      },
    ];

    const agg = await OrderItem.aggregate(pipeline).allowDiskUse(true);

    const productIds = agg.map((r) => r._id.toString());

    // Update each product sold value
    for (const row of agg) {
      try {
        await Product.updateOne(
          { _id: row._id },
          { $set: { sold: row.totalSold } },
        );
        logger.info(
          `[ReconcileSold] Set Product ${row._id} sold = ${row.totalSold}`,
        );
      } catch (err) {
        logger.error(
          `[ReconcileSold] Failed to update product ${row._id}: ${err.message}`,
        );
      }
    }

    // For products without any confirmed sales, set sold = 0
    try {
      await Product.updateMany(
        { _id: { $nin: productIds } },
        { $set: { sold: 0 } },
      );
      logger.info(
        "[ReconcileSold] Reset sold=0 for products with no confirmed sales",
      );
    } catch (err) {
      logger.error(
        "[ReconcileSold] Failed to reset zero-sold products:",
        err.message,
      );
    }

    logger.info("[ReconcileSold] Reconciliation completed.");
  } catch (err) {
    logger.error("[ReconcileSold] Job error:", err);
  }
};

export const initProductSoldReconcileJob = () => {
  // Run daily at 03:00 AM
  cron.schedule("0 3 * * *", async () => {
    logger.info("[ReconcileSold] Scheduled run triggered");
    await runProductSoldReconcile();
  });

  logger.info("Product sold reconciliation job initialized (daily 03:00)");
};

export default cron;
