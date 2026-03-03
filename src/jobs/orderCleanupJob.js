import cron from "node-cron";
import Order from "../models/Order.js";
import { rollbackOrderResources } from "../utils/orderInventory.js";

/**
 * Order Cleanup Job
 *
 * Runs every 15 minutes to:
 * 1. Auto-cancel pending PayOS orders older than 15 minutes
 * 2. Rollback resources for cancelled orders (if needed)
 * 3. Clean up orphaned pending orders
 *
 * FIX BUG 15: Prevent stale pending orders from locking inventory
 */

// Configuration
const PENDING_ORDER_TIMEOUT_MINUTES = 15;
const CRON_SCHEDULE = "*/15 * * * *"; // Every 15 minutes

/**
 * Cancel stale pending orders
 */
const cancelStalePendingOrders = async () => {
  try {
    console.log("[OrderCleanup] ========== START ==========");
    const timeoutDate = new Date(
      Date.now() - PENDING_ORDER_TIMEOUT_MINUTES * 60 * 1000,
    );

    // Find pending PayOS orders older than timeout
    const staleOrders = await Order.find({
      status: "pending",
      paymentStatus: "pending",
      paymentMethod: { $in: ["payos", "vnpay"] }, // Only online payment methods
      createdAt: { $lte: timeoutDate },
      isActive: true,
    }).populate("items");

    console.log(
      `[OrderCleanup] Found ${staleOrders.length} stale pending orders`,
    );

    let cancelledCount = 0;
    let rollbackCount = 0;

    for (const order of staleOrders) {
      try {
        // Rollback resources if they were deducted (should not happen for PayOS, but safety check)
        if (order.resourcesDeducted) {
          console.log(
            `[OrderCleanup] Rolling back resources for order ${order.orderNumber}`,
          );
          await rollbackOrderResources(order);
          rollbackCount++;
        }

        // Cancel the order
        order.status = "cancelled";
        order.paymentStatus = "failed";
        order.cancelledAt = new Date();
        order.cancellationReason = "Payment timeout - auto-cancelled by system";

        order.statusHistory.push({
          status: "cancelled",
          changedByRole: "system",
          changedAt: new Date(),
          reason: "Payment timeout - auto-cancelled after 15 minutes",
        });

        await order.save();
        cancelledCount++;

        console.log(
          `[OrderCleanup] Cancelled stale order: ${order.orderNumber} (Created: ${order.createdAt})`,
        );
      } catch (error) {
        console.error(
          `[OrderCleanup] Error processing order ${order.orderNumber}:`,
          error,
        );
      }
    }

    console.log(
      `[OrderCleanup] Completed: ${cancelledCount} orders cancelled, ${rollbackCount} rollbacks performed`,
    );
    console.log("[OrderCleanup] ========== END ==========");

    return { cancelledCount, rollbackCount };
  } catch (error) {
    console.error("[OrderCleanup] Job failed:", error);
    throw error;
  }
};

/**
 * Clean up old cancelled orders (optional - archive old data)
 */
const archiveOldCancelledOrders = async () => {
  try {
    // Archive cancelled orders older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await Order.updateMany(
      {
        status: "cancelled",
        cancelledAt: { $lte: thirtyDaysAgo },
        isActive: true,
      },
      {
        $set: { isActive: false },
      },
    );

    if (result.modifiedCount > 0) {
      console.log(
        `[OrderCleanup] Archived ${result.modifiedCount} old cancelled orders`,
      );
    }

    return result.modifiedCount;
  } catch (error) {
    console.error("[OrderCleanup] Archive job failed:", error);
    return 0;
  }
};

/**
 * Start the order cleanup cron job
 */
export const startOrderCleanupJob = () => {
  console.log(`[OrderCleanup] Starting cron job: ${CRON_SCHEDULE}`);

  // Schedule the main cleanup job
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log("\n[OrderCleanup] Running scheduled cleanup...");
    try {
      await cancelStalePendingOrders();
      await archiveOldCancelledOrders();
    } catch (error) {
      console.error("[OrderCleanup] Scheduled job error:", error);
    }
  });

  console.log("[OrderCleanup] Cron job started successfully");
  console.log(
    `[OrderCleanup] Will auto-cancel pending orders older than ${PENDING_ORDER_TIMEOUT_MINUTES} minutes`,
  );
};

/**
 * Manual trigger for cleanup (useful for testing or manual runs)
 */
export const runOrderCleanupNow = async () => {
  console.log("[OrderCleanup] Manual cleanup triggered");
  const result = await cancelStalePendingOrders();
  await archiveOldCancelledOrders();
  return result;
};

export default {
  startOrderCleanupJob,
  runOrderCleanupNow,
  cancelStalePendingOrders,
  archiveOldCancelledOrders,
};
