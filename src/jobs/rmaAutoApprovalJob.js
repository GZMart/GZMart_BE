import cron from "node-cron";
import { autoApproveExpiredRequests } from "../services/rma.service.js";

/**
 * RMA Auto-Approval Job
 *
 * Runs every day at 2 AM to:
 * 1. Auto-approve return requests if seller doesn't respond within 3 days
 * 2. Protect buyer rights by ensuring timely processing
 *
 * Business Rule: If seller doesn't respond within 3 days, automatically approve
 * to maintain buyer trust and prevent delayed refunds/exchanges
 */

const CRON_SCHEDULE = "0 2 * * *"; // Every day at 2 AM

/**
 * Auto-approve expired pending requests
 */
const runAutoApproval = async () => {
  try {
    console.log("[RMA AutoApproval] ========== START ==========");
    console.log("[RMA AutoApproval] Checking for expired pending requests...");

    const approvedCount = await autoApproveExpiredRequests();

    console.log(
      `[RMA AutoApproval] Completed: ${approvedCount} requests auto-approved`,
    );
    console.log("[RMA AutoApproval] ========== END ==========");

    return { approvedCount };
  } catch (error) {
    console.error("[RMA AutoApproval] Job failed:", error);
    throw error;
  }
};

/**
 * Start the RMA auto-approval cron job
 */
export const startRmaAutoApprovalJob = () => {
  // Schedule the job
  cron.schedule(CRON_SCHEDULE, async () => {
    console.log("\n[RMA AutoApproval] Running scheduled auto-approval...");
    try {
      await runAutoApproval();
    } catch (error) {
      console.error("[RMA AutoApproval] Scheduled job error:", error);
    }
  });
};

/**
 * Manual trigger (for testing or admin use)
 */
export const runRmaAutoApprovalNow = async () => {
  console.log("[RMA AutoApproval] Manual trigger initiated");
  const result = await runAutoApproval();
  return result;
};

export default {
  startRmaAutoApprovalJob,
  runRmaAutoApprovalNow,
};
