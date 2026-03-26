/**
 * Multi-strategy Redis cache for AI price suggestions.
 *
 * Design:
 * - Cache key = `${productId}|${currentPrice}|${marketHash}` (strategy NOT in key)
 * - One Redis key stores ALL 4 strategies at once: { balanced, penetration, profit, clearance }
 * - TTL: 15 minutes (same as existing MongoDB cache)
 * - On strategy request: check Redis first → if any strategy missing → call LLM once for ALL 4
 * - This way switching strategies is INSTANT (no 30s wait)
 *
 * Fallback: If Redis unavailable, falls back to existing MongoDB per-strategy cache.
 */

import redis from "./redis.service.js";

const STRATEGIES = ["balanced", "penetration", "profit", "clearance"];
const TTL = 5 * 60; // 5 minutes — short TTL for free-tier memory efficiency

const CACHE_KEY_PREFIX = "ps:";

/**
 * Build the Redis key (no strategy — all strategies share one key).
 */
function makeCacheKey(productId, currentPrice, marketHash) {
  return `ps:${productId}|${currentPrice}|${marketHash}`;
}

/**
 * Build marketHash from top-5 competitor prices.
 */
function makeMarketHash(competitors) {
  return competitors
    .slice(0, 5)
    .map((c) => c.models?.[0]?.price || c.originalPrice)
    .join("|");
}

/**
 * Get all cached strategies for a product.
 * Returns { balanced: {...}, penetration: {...}, ... } or null if cache miss.
 */
async function getAllStrategies(productId, currentPrice, competitors, sellerId) {
  const marketHash = makeMarketHash(competitors);
  const key = makeCacheKey(productId, currentPrice, marketHash);

  const cached = await redis.get(key);
  if (!cached) {
    console.log(`[Redis Cache] MISS - key: ${key}`);
    return null;
  }

  // Validate: ensure sellerId matches (privacy)
  if (cached.sellerId !== sellerId) {
    console.log(`[Redis Cache] HIT but sellerId mismatch - cached: ${cached.sellerId}, requested: ${sellerId}`);
    return null;
  }

  console.log(`[Redis Cache] HIT - key: ${key}, strategies: ${Object.keys(cached.strategies).join(",")}`);
  return cached.strategies;
}

/**
 * Get a specific strategy from cache.
 * Returns the strategy result or null if not cached.
 */
async function getStrategy(productId, currentPrice, competitors, sellerId, strategy) {
  const all = await getAllStrategies(productId, currentPrice, competitors, sellerId);
  return all?.[strategy] ?? null;
}

/**
 * Save all 4 strategy results to Redis.
 * Silently no-ops if Redis unavailable (MongoDB fallback still works).
 */
async function saveAllStrategies(productId, currentPrice, competitors, sellerId, strategies) {
  const marketHash = makeMarketHash(competitors);
  const key = makeCacheKey(productId, currentPrice, marketHash);

  const payload = {
    sellerId,
    strategies,
    savedAt: Date.now(),
  };

  await redis.set(key, payload, TTL);
}

/**
 * Check which strategies are already cached vs missing.
 * Returns { cached: ["balanced"], missing: ["penetration", "profit", "clearance"] }
 */
async function diffStrategies(productId, currentPrice, competitors, sellerId) {
  const all = await getAllStrategies(productId, currentPrice, competitors, sellerId);

  if (!all) {
    return { cached: [], missing: STRATEGIES };
  }

  const cached = STRATEGIES.filter((s) => all[s] && all[s].suggestedPrice != null);
  const missing = STRATEGIES.filter((s) => !all[s] || all[s].suggestedPrice == null);

  return { cached, missing };
}

/**
 * Clear all price-suggestion cache keys from Redis.
 * Call this from a cron job or admin endpoint to free memory.
 */
async function clearAllCache() {
  try {
    const keys = await redis.client?.keys(`${CACHE_KEY_PREFIX}*`);
    if (!keys || keys.length === 0) return { deleted: 0 };

    const deleted = await redis.client?.del(keys);
    console.log(`[Redis Cache] Cleared ${deleted} price-suggestion keys.`);
    return { deleted: deleted ?? 0 };
  } catch (err) {
    console.warn("[Redis Cache] clearAllCache error:", err.message);
    return { deleted: 0, error: err.message };
  }
}

/**
 * Clear cache for a specific product.
 */
async function clearCache(productId) {
  try {
    const pattern = `${CACHE_KEY_PREFIX}${productId}|*`;
    const keys = await redis.client?.keys(pattern);
    if (!keys || keys.length === 0) return { deleted: 0 };

    const deleted = await redis.client?.del(keys);
    console.log(`[Redis Cache] Cleared ${deleted} keys for product ${productId}.`);
    return { deleted: deleted ?? 0 };
  } catch (err) {
    console.warn(`[Redis Cache] clearCache(${productId}) error:`, err.message);
    return { deleted: 0, error: err.message };
  }
}

export default {
  STRATEGIES,
  TTL,
  getAllStrategies,
  getStrategy,
  saveAllStrategies,
  diffStrategies,
  clearAllCache,
  clearCache,
  makeCacheKey,
  makeMarketHash,
};
