// src/services/livestreamRedis.service.js
// In-memory fallback — single-process only (no cross-server sync)

const viewerSets = new Map();       // sessionId -> Set<userId>
const viewerCounts = new Map();      // sessionId -> number
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

function cleanExpiredViewerSet(sessionId) {
  const viewers = viewerSets.get(sessionId);
  if (!viewers) return;
  for (const [key, exp] of ttlMap.entries()) {
    if (key.startsWith(`livestream:${sessionId}:presence`) && Date.now() > exp) {
      ttlMap.delete(key);
    }
  }
}

// --- Viewer Presence ---
export async function addViewerToRoom(sessionId, userId) {
  if (!viewerSets.has(sessionId)) viewerSets.set(sessionId, new Set());
  viewerSets.get(sessionId).add(userId);
  setTTL(`livestream:${sessionId}:presence:${userId}`, 30);
}

export async function removeViewerFromRoom(sessionId, userId) {
  const viewers = viewerSets.get(sessionId);
  if (viewers) viewers.delete(userId);
  ttlMap.delete(`livestream:${sessionId}:presence:${userId}`);
}

export async function getRoomViewers(sessionId) {
  cleanExpiredViewerSet(sessionId);
  const viewers = viewerSets.get(sessionId);
  return viewers ? [...viewers] : [];
}

export async function getViewerCount(sessionId) {
  cleanExpiredViewerSet(sessionId);
  const viewers = viewerSets.get(sessionId);
  return viewers ? viewers.size : 0;
}

// --- Viewer Count (simple counter) ---
export async function incrementViewerCount(sessionId) {
  const current = viewerCounts.get(sessionId) || 0;
  const next = current + 1;
  viewerCounts.set(sessionId, next);
  setTTL(`livestream:${sessionId}:count`, 10);
  return next;
}

export async function decrementViewerCount(sessionId) {
  const current = viewerCounts.get(sessionId) || 0;
  const next = Math.max(0, current - 1);
  viewerCounts.set(sessionId, next);
  setTTL(`livestream:${sessionId}:count`, 10);
  return next;
}

export async function getCachedViewerCount(sessionId) {
  if (isExpired(`livestream:${sessionId}:count`)) return 0;
  return viewerCounts.get(sessionId) ?? 0;
}

export async function setViewerCount(sessionId, count) {
  viewerCounts.set(sessionId, count);
  setTTL(`livestream:${sessionId}:count`, 10);
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
  activeStreams.delete(sessionId);
  ttlMap.delete(`livestream:${sessionId}:active`);
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
