// src/services/livestreamRedis.service.js
// Viewer presence: Redis SET (SCARD) when REDIS_URL is set; in-memory Set fallback otherwise.
// Chat / likes / active stream cache remain in-process unless migrated later.

import redis from "./redis.service.js";

const VIEWER_SET_TTL_SEC = 86400; // sliding TTL — refreshed on each join

function viewerRedisKey(sessionId) {
  return `livestream:${String(sessionId)}:viewers`;
}

/** @returns {Promise<import('ioredis').default | null>} */
async function getRedisClient() {
  return redis.getClient();
}

const viewerSetsFallback = new Map(); // sessionId -> Set<userId>
const chatMessages = new Map();      // sessionId -> [{ id, ...message }]
const activeStreams = new Map();    // sessionId -> sessionData
const likeCounts = new Map();        // sessionId -> number

// TTL tracking: key -> expiresAt timestamp
const ttlMap = new Map();

// --- Internal TTL helpers ---
function setTTL(key, ttlSeconds) {
  ttlMap.set(key, Date.now() + ttlSeconds * 1000);
}

function isExpired(key) {
  const expiresAt = ttlMap.get(key);
  if (expiresAt === undefined) return false;
  if (Date.now() > expiresAt) {
    ttlMap.delete(key);
    return true;
  }
  return false;
}

// --- Viewer presence (unique sockets / accounts per session) ---
export async function addViewerToRoom(sessionId, userId) {
  const sid = String(sessionId);
  const uid = String(userId);
  const client = await getRedisClient();
  if (client) {
    const key = viewerRedisKey(sid);
    try {
      await client.sadd(key, uid);
      await client.expire(key, VIEWER_SET_TTL_SEC);
    } catch (err) {
      console.warn("[livestreamRedis] SADD viewer error:", err.message);
    }
    return;
  }
  if (!viewerSetsFallback.has(sid)) viewerSetsFallback.set(sid, new Set());
  viewerSetsFallback.get(sid).add(uid);
}

export async function removeViewerFromRoom(sessionId, userId) {
  const sid = String(sessionId);
  const uid = String(userId);
  const client = await getRedisClient();
  if (client) {
    try {
      await client.srem(viewerRedisKey(sid), uid);
    } catch (err) {
      console.warn("[livestreamRedis] SREM viewer error:", err.message);
    }
    return;
  }
  const viewers = viewerSetsFallback.get(sid);
  if (viewers) viewers.delete(uid);
}

export async function getRoomViewers(sessionId) {
  const sid = String(sessionId);
  const client = await getRedisClient();
  if (client) {
    try {
      const ids = await client.smembers(viewerRedisKey(sid));
      return Array.isArray(ids) ? ids : [];
    } catch (err) {
      console.warn("[livestreamRedis] SMEMBERS error:", err.message);
      return [];
    }
  }
  const viewers = viewerSetsFallback.get(sid);
  return viewers ? [...viewers] : [];
}

export async function getViewerCount(sessionId) {
  const sid = String(sessionId);
  const client = await getRedisClient();
  if (client) {
    try {
      const n = await client.scard(viewerRedisKey(sid));
      return Math.max(0, Number(n) || 0);
    } catch (err) {
      console.warn("[livestreamRedis] SCARD error:", err.message);
      return 0;
    }
  }
  const viewers = viewerSetsFallback.get(sid);
  return viewers ? viewers.size : 0;
}

/** Same as getViewerCount — REST + sockets use one source of truth (Set cardinality). */
export async function getCachedViewerCount(sessionId) {
  return getViewerCount(sessionId);
}

// --- Chat Message Storage ---
const CHAT_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Normalize message timestamp (ISO string or ms number) for TTL pruning. */
function messageTimestampMs(m) {
  const t = m?.timestamp;
  if (t == null) return NaN;
  if (typeof t === "number" && Number.isFinite(t)) return t;
  const ms = Date.parse(String(t));
  return Number.isNaN(ms) ? NaN : ms;
}

export async function storeChatMessage(sessionId, messageId, message) {
  if (!chatMessages.has(sessionId)) chatMessages.set(sessionId, []);
  const msgs = chatMessages.get(sessionId);
  msgs.push({ id: messageId, ...message });
  const cutoff = Date.now() - CHAT_TTL_MS;
  const filtered = msgs.filter((m) => {
    const ms = messageTimestampMs(m);
    return Number.isFinite(ms) && ms >= cutoff;
  });
  chatMessages.set(sessionId, filtered.slice(-200)); // keep last 200
}

export async function getRecentChat(sessionId, limit = 50) {
  const msgs = chatMessages.get(sessionId);
  if (!msgs) return [];
  return msgs.slice(-limit);
}

// --- Active Stream Cache ---
export async function cacheActiveStream(sessionId, sessionData) {
  activeStreams.set(sessionId, sessionData);
  setTTL(`livestream:${sessionId}:active`, 30);
}

export async function getCachedActiveStream(sessionId) {
  if (isExpired(`livestream:${sessionId}:active`)) {
    activeStreams.delete(sessionId);
    return undefined;
  }
  return activeStreams.get(sessionId);
}

export async function invalidateActiveStream(sessionId) {
  const sid = String(sessionId);
  activeStreams.delete(sid);
  ttlMap.delete(`livestream:${sid}:active`);
  viewerSetsFallback.delete(sid);
  const client = await getRedisClient();
  if (client) {
    try {
      await client.del(viewerRedisKey(sid));
    } catch (err) {
      console.warn("[livestreamRedis] DEL viewers error:", err.message);
    }
  }
}

// --- Refresh presence TTL (called by heartbeat) ---
export async function refreshViewerPresence(sessionId, userId) {
  await addViewerToRoom(sessionId, userId);
}

// --- Like Count ---
export async function getLikeCount(sessionId) {
  return likeCounts.get(sessionId) ?? 0;
}

export async function incrementLikeCount(sessionId) {
  const current = likeCounts.get(sessionId) ?? 0;
  likeCounts.set(sessionId, current + 1);
  return current + 1;
}
