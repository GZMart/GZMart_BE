/**
 * [Phase 3 - 5.2] Batch Embedding Cron Job
 *
 * Runs every night at 2:00 AM to create/refresh embeddings for products that:
 * - Don't have any embedding yet, OR
 * - Haven't been updated in the last EMBEDDING_TTL_DAYS
 *
 * This ensures the vector search index stays fresh without hammering the
 * embedding API on every product create/update.
 */
import cron from "node-cron";
import Product from "../models/Product.js";
import embeddingService from "../services/embedding.service.js";

const BATCH_SIZE = 20;
const EMBEDDING_TTL_DAYS = 7;

let isRunning = false;

/**
 * Find and embed products that are missing embeddings or have stale ones.
 * Processes in batches of BATCH_SIZE to avoid memory/API rate-limit issues.
 */
async function runBatchEmbedding() {
  if (isRunning) {
    console.log("[BatchEmbed] Job already running, skipping this invocation.");
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[BatchEmbed] Starting nightly embedding job at ${new Date().toISOString()}`);

  try {
    const cutoffDate = new Date(Date.now() - EMBEDDING_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Find products that need embedding:
    // - No embedding field, OR
    // - embedding array is empty, OR
    // - embeddingUpdatedAt is older than TTL
    const products = await Product.find({
      $or: [
        { embedding: { $exists: false } },
        { embedding: { $size: 0 } },
        { embeddingUpdatedAt: { $lt: cutoffDate } },
      ],
      status: "active",
    })
      .select("_id name brand")
      .limit(BATCH_SIZE)
      .lean();

    console.log(`[BatchEmbed] Found ${products.length} product(s) needing embedding`);

    if (!products.length) {
      console.log("[BatchEmbed] No products need embedding, exiting.");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const product of products) {
      try {
        const text = [product.name, product.brand].filter(Boolean).join(" | ");
        if (!text.trim()) {
          console.warn(`[BatchEmbed] Empty text for product ${product._id}, skipping`);
          failCount++;
          continue;
        }

        const embedding = await embeddingService.getEmbedding(text);

        await Product.updateOne(
          { _id: product._id },
          {
            $set: {
              embedding,
              embeddingText: text,
              embeddingUpdatedAt: new Date(),
            },
          }
        );

        successCount++;
        console.log(
          `[BatchEmbed] ✓ ${product._id}: "${product.name.slice(0, 40)}${product.name.length > 40 ? "…" : ""}"`
        );
      } catch (err) {
        failCount++;
        console.error(`[BatchEmbed] ✗ ${product._id} failed:`, err.message);
      }
    }

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[BatchEmbed] Finished at ${new Date().toISOString()} in ${elapsedMs}ms. Success: ${successCount}, Failed: ${failCount}`
    );
  } catch (err) {
    console.error("[BatchEmbed] Job error:", err);
  } finally {
    isRunning = false;
  }
}

// ── Schedule: every night at 2:00 AM ──────────────────────────────
cron.schedule("0 2 * * *", () => {
  runBatchEmbedding().catch((err) => {
    console.error("[BatchEmbed] Unhandled rejection in scheduled run:", err);
  });
});

/**
 * Export for manual / one-off runs (useful for dev and admin scripts).
 * Usage: `node -e "import('./jobs/batchEmbedding.job.js').then(m => m.runBatchEmbedding())"`
 */
export { runBatchEmbedding };

export default cron;
