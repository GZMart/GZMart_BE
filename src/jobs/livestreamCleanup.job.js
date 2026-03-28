// src/jobs/livestreamCleanup.job.js
import cron from "node-cron";
import LiveSession from "../models/LiveSession.js";
import logger from "../utils/logger.js";

export function startLivestreamCleanupJob() {
  cron.schedule("*/5 * * * *", async () => {
    logger.info("[Livestream Cleanup] Running...");

    try {

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const stuckSessions = await LiveSession.find({
        status: "live",
        startedAt: { $lt: twoHoursAgo },
      });

      for (const session of stuckSessions) {
        await LiveSession.findByIdAndUpdate(session._id, {
          status: "ended",
          endedAt: new Date(),
        });
        logger.info(`[Livestream Cleanup] Force-ended stuck session: ${session._id}`);
      }

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Only force-end stuck sessions; do NOT try to delete scheduledAt (field doesn't exist)
      const { deletedCount } = await LiveSession.deleteMany({
        status: "ended",
        endedAt: { $lt: oneDayAgo },
      });

      logger.info(`[Livestream Cleanup] Done. Force-ended ${stuckSessions.length} stuck sessions, deleted ${deletedCount} old ended sessions.`);
    } catch (err) {
      logger.error("[Livestream Cleanup] Error:", err);
    }
  });

  logger.info("[Livestream Cleanup] Job scheduled (every 5 minutes)");
}
