import { autoProgressActiveLogisticsLegs } from "../services/rma.service.js";

const RMA_LOGISTICS_SYNC_INTERVAL_MS = 5000;

export const startRmaLogisticsSyncJob = () => {
  console.log(
    `[RMA Logistics Sync] Starting background sync every ${RMA_LOGISTICS_SYNC_INTERVAL_MS / 1000}s`,
  );

  setInterval(async () => {
    try {
      const progressed = await autoProgressActiveLogisticsLegs();
      if (progressed > 0) {
        console.log(
          `[RMA Logistics Sync] Auto-progressed ${progressed} request(s)`,
        );
      }
    } catch (error) {
      console.error("[RMA Logistics Sync] Failed:", error);
    }
  }, RMA_LOGISTICS_SYNC_INTERVAL_MS);
};

export default {
  startRmaLogisticsSyncJob,
};
