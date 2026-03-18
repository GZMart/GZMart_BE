import { AccessToken } from "livekit-server-sdk";
import LiveSession from "../models/LiveSession.js";
import logger from "../utils/logger.js";

const LIVEKIT_URL = process.env.LIVEKIT_URL || "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";

function generateRoomName(shopId) {
  return `live_${shopId}_${Date.now()}`;
}

export async function createSession(shopId, userId, title = "Live stream") {
  const roomName = generateRoomName(shopId);
  const session = await LiveSession.create({
    shopId,
    title,
    status: "scheduled",
    liveKitRoomName: roomName,
  });
  return session;
}

export async function startSession(sessionId, shopId, userId) {
  const session = await LiveSession.findOne({
    _id: sessionId,
    shopId,
    status: "scheduled",
  });
  if (!session) throw new Error("Session not found or already started");

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `host_${userId}`,
    name: "Host",
    metadata: JSON.stringify({ role: "host" }),
  });
  at.addGrant({
    roomJoin: true,
    room: session.liveKitRoomName,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  session.status = "live";
  session.startedAt = new Date();
  session.liveKitToken = token;
  await session.save({ validateBeforeSave: false });

  return { session, token };
}

export async function getViewerToken(sessionId, userId, displayName = "Viewer") {
  const session = await LiveSession.findById(sessionId).select("liveKitRoomName status");
  if (!session || session.status !== "live") throw new Error("Live session not available");

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: userId ? `viewer_${userId}` : `viewer_${Date.now()}`,
    name: displayName,
    metadata: JSON.stringify({ role: "viewer" }),
  });
  at.addGrant({
    roomJoin: true,
    room: session.liveKitRoomName,
    canPublish: false,
    canSubscribe: true,
  });

  return await at.toJwt();
}

export async function endSession(sessionId, shopId, userId) {
  const session = await LiveSession.findOne({
    _id: sessionId,
    shopId,
    status: "live",
  });
  if (!session) throw new Error("Session not found or already ended");
  session.status = "ended";
  session.endedAt = new Date();
  await session.save();
  return session;
}

export async function getActiveSessionByShop(shopId) {
  return LiveSession.findOne({ shopId, status: "live" }).sort({ startedAt: -1 });
}
