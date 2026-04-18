// One-time handoff tokens for “continue on phone” (in-memory; single-process only).
import crypto from "crypto";

const HANDOFF_TTL_MS = 10 * 60 * 1000;
/** @type {Map<string, { sessionId: string, sellerId: string, exp: number }>} */
const store = new Map();

export function createHandoff(sessionId, sellerId) {
  const token = crypto.randomBytes(32).toString("hex");
  const exp = Date.now() + HANDOFF_TTL_MS;
  store.set(token, {
    sessionId: String(sessionId),
    sellerId: String(sellerId),
    exp,
  });
  return { token, expiresAt: new Date(exp).toISOString() };
}

/**
 * Validates token, returns payload and removes token (single-use).
 * @returns {{ sessionId: string, sellerId: string } | null}
 */
export function consumeHandoff(token) {
  if (!token || typeof token !== "string") {
    return null;
  }
  const row = store.get(token);
  if (!row) {
    return null;
  }
  if (Date.now() > row.exp) {
    store.delete(token);
    return null;
  }
  store.delete(token);
  return { sessionId: row.sessionId, sellerId: row.sellerId };
}
