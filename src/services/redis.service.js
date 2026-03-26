/**
 * Redis client service — singleton with graceful fallback.
 * If Redis is unavailable, all cache operations are no-ops.
 * The application continues to work (but slower — no caching).
 */

let redisClient = null;
let isConnected = false;

async function getClient() {
  if (redisClient) return redisClient;

  const REDIS_URL = process.env.REDIS_URL;
  if (!REDIS_URL) {
    console.warn("[redis] REDIS_URL not set — caching disabled");
    return null;
  }

  try {
    const { default: Redis } = await import("ioredis");
    // Do not parse REDIS_URL with `new URL()` — Upstash passwords can contain
    // characters that break URL parsing and would disable Redis with zero remote traffic.
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 10000,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn(`[redis] Connection failed after ${times} attempts — disabling`);
          return null;
        }
        return Math.min(times * 300, 2000);
      },
    });

    redisClient.on("connect", () => {
      isConnected = true;
      console.log("[redis] Connected");
    });
    redisClient.on("ready", () => {
      isConnected = true;
      console.log("[redis] Ready");
    });
    redisClient.on("error", (err) => {
      if (isConnected) {
        console.warn("[redis] Error:", err.message);
      }
    });
    redisClient.on("close", () => {
      isConnected = false;
      console.warn("[redis] Connection closed");
    });

    await redisClient.connect().catch((err) => {
      console.warn("[redis] Connect failed:", err.message);
      redisClient = null;
    });
    if (!redisClient) return null;
    isConnected = true;
    return redisClient;
  } catch (err) {
    console.warn("[redis] Init failed — caching disabled:", err.message);
    redisClient = null;
    return null;
  }
}

function isAvailable() {
  return isConnected && redisClient !== null;
}

// ── Exported API ──────────────────────────────────────────────────────────────

/**
 * GET from Redis. Returns null on miss / unavailable.
 */
async function get(key) {
  const client = await getClient();
  if (!client) return null;
  try {
    const val = await client.get(key);
    return val ? JSON.parse(val) : null;
  } catch (err) {
    console.warn("[redis] GET error:", err.message);
    return null;
  }
}

/**
 * SET to Redis with TTL (seconds). Silently no-ops on failure.
 */
async function set(key, value, ttlSeconds = 900) {
  const client = await getClient();
  if (!client) return;
  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    console.warn("[redis] SET error:", err.message);
  }
}

/**
 * MGET from Redis. Returns null on miss / unavailable.
 */
async function mget(keys) {
  const client = await getClient();
  if (!client) return null;
  try {
    const vals = await client.mget(keys);
    return vals.map((v) => (v ? JSON.parse(v) : null));
  } catch (err) {
    console.warn("[redis] MGET error:", err.message);
    return null;
  }
}

/**
 * MSET to Redis with TTL (seconds). Silently no-ops on failure.
 */
async function mset(keyValuePairs, ttlSeconds = 900) {
  const client = await getClient();
  if (!client) return;
  try {
    const pipeline = client.pipeline();
    for (const [key, value] of keyValuePairs) {
      pipeline.setex(key, ttlSeconds, JSON.stringify(value));
    }
    await pipeline.exec();
  } catch (err) {
    console.warn("[redis] MSET error:", err.message);
  }
}

/**
 * DEL from Redis. Silently no-ops on failure.
 */
async function del(key) {
  const client = await getClient();
  if (!client) return;
  try {
    await client.del(key);
  } catch (err) {
    console.warn("[redis] DEL error:", err.message);
  }
}

export default {
  getClient,
  isAvailable,
  get,
  set,
  mget,
  mset,
  del,
};
