import { AccessToken } from "livekit-server-sdk";
import LiveSession from "../models/LiveSession.js";
import Product from "../models/Product.js";
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
    metadata: JSON.stringify({ role: "host", sessionId: session._id.toString() }),
  });
  at.addGrant({
    roomJoin: true,
    room: session.liveKitRoomName,
    canPublish: true,
    canPublishData: true,
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
    metadata: JSON.stringify({ role: "viewer", sessionId }),
  });
  at.addGrant({
    roomJoin: true,
    room: session.liveKitRoomName,
    canPublish: false,
    canPublishData: true,
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

export async function addSessionProducts(sessionId, shopId, productIds) {
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  const uniqueIds = [...new Set(productIds.map((id) => id.toString()))];
  const existing = new Set(session.products.map((p) => p.toString()));
  for (const id of uniqueIds) {
    if (!existing.has(id)) session.products.push(id);
  }
  await session.save();
  return Product.find({ _id: { $in: session.products } })
    .select('name thumbnail images originalPrice models tiers')
    .lean({ virtuals: true });
}

export async function removeSessionProduct(sessionId, shopId, productId) {
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  session.products = session.products.filter(
    (p) => p.toString() !== productId.toString()
  );
  await session.save();
  return Product.find({ _id: { $in: session.products } })
    .select('name thumbnail images originalPrice models tiers')
    .lean({ virtuals: true });
}

export async function addSessionVouchers(sessionId, shopId, voucherIds) {
  const mongoose = await import('mongoose');
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  if (!session.vouchers) session.vouchers = [];
  const uniqueIds = [...new Set(voucherIds.map((id) => id.toString()))];
  const existing = new Set(session.vouchers.map((v) => v.toString()));
  for (const id of uniqueIds) {
    if (!existing.has(id)) session.vouchers.push(new mongoose.Types.ObjectId(id));
  }
  await session.save();
  return session.populate("vouchers", "code discountType discountValue minBasketPrice name");
}

export async function removeSessionVoucher(sessionId, shopId, voucherId) {
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  session.vouchers = (session.vouchers || []).filter(
    (v) => v.toString() !== voucherId.toString()
  );
  await session.save();
  return session.populate("vouchers", "code discountType discountValue minBasketPrice name");
}

export async function getSessionProductList(sessionId, shopId) {
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  return Product.find({ _id: { $in: session.products } })
    .select('name thumbnail images originalPrice models tiers')
    .lean({ virtuals: true });
}

export async function pinProduct(sessionId, shopId, productId) {
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  if (!session.products.some((p) => p.toString() === productId.toString())) {
    session.products.push(productId);
  }
  session.pinnedProduct = productId;
  await session.save();
  return Product.find({ _id: { $in: session.products } })
    .select('name thumbnail images originalPrice models tiers')
    .lean({ virtuals: true });
}

export async function unpinProduct(sessionId, shopId) {
  const session = await LiveSession.findOne({ _id: sessionId, shopId });
  if (!session) throw new Error("Session not found or unauthorized");
  session.pinnedProduct = null;
  await session.save();
  return Product.find({ _id: { $in: session.products } })
    .select('name thumbnail images originalPrice models tiers')
    .lean({ virtuals: true });
}

/**
 * Build the syntax guide payload for a live session.
 * Returns null if orderSyntax is disabled or no valid product exists.
 *
 * @param {object} session        — LiveSession lean document (already has orderSyntax)
 * @param {object} pinnedProduct  — Product lean document with tiers, or null
 * @returns {object|null}
 */
export async function buildSyntaxGuide(session, pinnedProduct) {
  const os = session?.orderSyntax;
  if (!os?.enabled || !os?.prefix) return null;

  let product = pinnedProduct;

  if (!product && os.productId) {
    product = await Product.findById(os.productId)
      .select('name thumbnail images models tiers')
      .lean();
  }

  if (!product && session.products?.length > 0) {
    product = await Product.findById(session.products[0])
      .select('name thumbnail images models tiers')
      .lean();
  }

  if (!product) return null;

  return {
    sessionId: String(session._id),
    prefix: os.prefix,
    variantTiers: (os.variantTiers ?? []).map((t) => ({
      name: t.name,
      options: t.options ?? [],
    })),
    product: {
      _id: String(product._id),
      name: product.name,
      thumbnail: product.thumbnail ?? product.images?.[0] ?? null,
      tiers: (product.tiers ?? []).map((tier) => ({
        name: tier.name,
        options: tier.options ?? [],
      })),
    },
  };
}
