import * as livestreamService from "../services/livestream.service.js";
import * as livestreamRedisService from "../services/livestreamRedis.service.js";
import logger from "../utils/logger.js";
import { getSocketIO } from "../utils/socketIO.js";
import LiveSession from "../models/LiveSession.js";
import Product from "../models/Product.js";
import Voucher from "../models/Voucher.js";
import crypto from "crypto";
import * as livestreamHandoff from "../services/livestreamHandoff.service.js";
import * as livestreamStatsService from "../services/livestreamStats.service.js";
import { getActiveFlashSaleForProduct } from "../services/product.service.js";

/** POST /api/livestream/session/:sessionId/handoff — mint one-time link token (scheduled sessions only). */
export async function createSessionHandoff(req, res, next) {
  try {
    const { sessionId } = req.params;
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Forbidden" });
    }
    const session = await LiveSession.findById(sessionId).lean();
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    if (String(session.shopId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (session.status !== "scheduled") {
      return res.status(400).json({
        message: "Handoff is only available before going live (session must be scheduled).",
      });
    }
    const { token, expiresAt } = livestreamHandoff.createHandoff(sessionId, req.user._id);
    res.json({ success: true, data: { token, expiresAt } });
  } catch (e) {
    next(e);
  }
}

/** POST /api/livestream/handoff/exchange — consume token; requires same seller account logged in. */
export async function exchangeHandoff(req, res, next) {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "token required" });
    }
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Forbidden" });
    }
    const row = livestreamHandoff.consumeHandoff(token);
    if (!row) {
      return res.status(400).json({ message: "Invalid or expired handoff token" });
    }
    if (String(row.sellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "This link was issued for another account" });
    }
    res.json({
      success: true,
      data: { sessionId: row.sessionId, sellerId: row.sellerId },
    });
  } catch (e) {
    next(e);
  }
}

export async function createSession(req, res, next) {
  try {
    const { title } = req.body || {};
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });
    const shopId = req.user._id; // seller = shop owner
    const session = await livestreamService.createSession(shopId, req.user._id, title);
    res.status(201).json(session);
  } catch (e) {
    next(e);
  }
}

export async function startSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });
    const { session, token } = await livestreamService.startSession(
      sessionId,
      req.user._id,
      req.user._id
    );
    res.json({ session, token });
  } catch (e) {
    next(e);
  }
}

export async function mintHostToken(req, res, next) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { sessionId } = req.params;
    const { session, token } = await livestreamService.mintHostTokenForLiveSession(
      sessionId,
      req.user._id,
      req.user._id
    );
    res.json({ session, token });
  } catch (e) {
    next(e);
  }
}

export async function getViewerToken(req, res, next) {
  try {
    const { sessionId } = req.params;
    const userId = req.user?._id;
    const displayName = req.user?.fullName || "Viewer";
    const token = await livestreamService.getViewerToken(sessionId, userId, displayName);
    res.json({ token });
  } catch (e) {
    next(e);
  }
}

export async function endSession(req, res, next) {
  try {
    const { sessionId } = req.params;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });
    const session = await livestreamService.endSession(
      sessionId,
      req.user._id,
      req.user._id
    );
    const io = getSocketIO();
    if (io) {
      io.to(`livestream_${sessionId}`).emit("livestream_session_ended", {
        sessionId: String(sessionId),
      });
    }
    res.json(session);
  } catch (e) {
    next(e);
  }
}

/** GET /api/livestream/session/:sessionId/stats — seller-only revenue & units for this session */
export async function getSessionStats(req, res, next) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { sessionId } = req.params;
    const data = await livestreamStatsService.getSessionStats(sessionId, req.user._id);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

/** GET /api/livestream/sessions/history — seller-only paginated ended sessions + revenue summary */
export async function getSessionsHistory(req, res, next) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { page, limit } = req.query;
    const data = await livestreamStatsService.listEndedSessionsHistory(req.user._id, {
      page,
      limit,
    });
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

export async function getActiveByShop(req, res, next) {
  try {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ message: "shopId required" });
    const session = await livestreamService.getActiveSessionByShop(shopId);
    res.setHeader("Cache-Control", "private, max-age=30");
    res.json(session || null);
  } catch (e) {
    next(e);
  }
}

/** GET /api/livestream/sessions/live — public: all live sessions for discovery (homepage) */
export async function listPublicLiveSessions(req, res, next) {
  try {
    const { limit } = req.query;
    const rows = await livestreamService.listPublicLiveSessions(limit);
    const data = await Promise.all(
      rows.map(async (s) => ({
        ...s,
        viewerCount: await livestreamRedisService.getCachedViewerCount(String(s._id)),
      })),
    );
    data.sort((a, b) => {
      const va = Number(a.viewerCount) || 0;
      const vb = Number(b.viewerCount) || 0;
      if (vb !== va) {
        return vb - va;
      }
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return tb - ta;
    });
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
}

// GET /api/livestream/health — stream health + viewer stats for monitoring
export const getStreamHealth = async (req, res) => {
  try {
    // Count active streams from MongoDB
    const activeStreams = await LiveSession.countDocuments({ status: "live" });

    res.json({
      success: true,
      data: {
        activeStreams,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("[StreamHealth]", err);
    res.status(500).json({ success: false, message: "Health check failed" });
  }
};

// GET /api/livestream/session/:sessionId
export const getSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await LiveSession.findById(sessionId)
      .populate('shopId', 'fullName avatar')
      .lean();

    if (!session) return res.status(404).json({ message: 'Session not found' });

    const viewerCount = await livestreamRedisService.getCachedViewerCount(sessionId);

    res.json({
      success: true,
      data: {
        ...session,
        viewerCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/livestream/session/:sessionId/products
export const getSessionProducts = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await LiveSession.findById(sessionId).lean();
    if (!session) return res.status(404).json({ message: 'Session not found' });

    let products = [];
    let pinnedProduct = null;

    // Fetch pinnedProduct independently (always needed for buyer overlay)
    if (session.pinnedProduct) {
      pinnedProduct = await Product.findById(session.pinnedProduct)
        // models required for virtual `price` (min variant price)
        .select('name thumbnail images originalPrice models tiers')
        .lean({ virtuals: true });
    }

    // If session has curated products, return them
    if (session.products && session.products.length > 0) {
      products = await Product.find({ _id: { $in: session.products }, status: "active" })
        .select('name thumbnail images originalPrice models tiers')
        .lean({ virtuals: true });
    } else {
      // Fallback: return top 5 recent active products of this shop
      products = await Product.find({
        shopId: session.shopId,
        status: "active",
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name thumbnail images originalPrice models tiers')
        .lean({ virtuals: true });
    }

    const enrichWithFlash = async (prod) => {
      if (!prod?._id) return prod;
      const refPrice =
        typeof prod.price === "number" && !Number.isNaN(prod.price)
          ? prod.price
          : typeof prod.originalPrice === "number"
            ? prod.originalPrice
            : 0;
      const flashSale = await getActiveFlashSaleForProduct(prod._id, refPrice);
      return { ...prod, flashSale };
    };

    products = await Promise.all((products || []).map((p) => enrichWithFlash(p)));
    if (pinnedProduct) {
      pinnedProduct = await enrichWithFlash(pinnedProduct);
    }

    const likeCount = await livestreamRedisService.getLikeCount(sessionId);
    return res.json({ success: true, data: { products, likeCount, pinnedProduct } });
  } catch (err) {
    next(err);
  }
};

// POST /api/livestream/session/:sessionId/products — add products to session
export const addSessionProducts = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { productIds } = req.body;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: "productIds must be a non-empty array" });
    }

    const products = await livestreamService.addSessionProducts(
      sessionId,
      req.user._id,
      productIds
    );
    const io = getSocketIO();
    if (io) io.to(`livestream_${sessionId}`).emit("livestream_products_update", { products });
    res.json({ success: true, data: { products } });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/livestream/session/:sessionId/products/:productId — remove one product
export const removeSessionProduct = async (req, res, next) => {
  try {
    const { sessionId, productId } = req.params;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });

    const products = await livestreamService.removeSessionProduct(
      sessionId,
      req.user._id,
      productId
    );
    const io = getSocketIO();
    if (io) io.to(`livestream_${sessionId}`).emit("livestream_products_update", { products });
    res.json({ success: true, data: { products } });
  } catch (err) {
    next(err);
  }
};

// GET /api/livestream/session/:sessionId/vouchers
export const getSessionVouchers = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await LiveSession.findById(sessionId).lean();
    if (!session) return res.status(404).json({ message: "Session not found" });

    const now = new Date();
    const vouchers = await Voucher.find({
      _id: { $in: session.vouchers || [] },
      status: 'active',
      startTime: { $lte: now },
      endTime: { $gte: now },
    })
      .select("code discountType discountValue minBasketPrice name startTime endTime status")
      .lean();

    res.json({ success: true, data: { vouchers } });
  } catch (err) {
    next(err);
  }
};

// POST /api/livestream/session/:sessionId/vouchers — add vouchers to session
export const addSessionVouchers = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { voucherIds } = req.body;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });
    if (!Array.isArray(voucherIds) || voucherIds.length === 0) {
      return res.status(400).json({ message: "voucherIds must be a non-empty array" });
    }

    const session = await livestreamService.addSessionVouchers(sessionId, req.user._id, voucherIds);
    const io = getSocketIO();
    if (io) io.to(`livestream_${sessionId}`).emit("livestream_vouchers_update", { vouchers: session.vouchers });
    res.json({ success: true, data: { vouchers: session.vouchers } });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/livestream/session/:sessionId/vouchers/:voucherId — remove one voucher
export const removeSessionVoucher = async (req, res, next) => {
  try {
    const { sessionId, voucherId } = req.params;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });

    const session = await livestreamService.removeSessionVoucher(sessionId, req.user._id, voucherId);
    const io = getSocketIO();
    if (io) io.to(`livestream_${sessionId}`).emit("livestream_vouchers_update", { vouchers: session.vouchers });
    res.json({ success: true, data: { vouchers: session.vouchers } });
  } catch (err) {
    next(err);
  }
};

// POST /api/livestream/session/:sessionId/pin — pin a product to the live stream
export const pinProduct = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { productId } = req.body;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });
    if (!productId) return res.status(400).json({ message: "productId is required" });

    const products = await livestreamService.pinProduct(sessionId, req.user._id, productId);

    // Populate pinnedProduct with full details for buyer display
    const pinnedProductDoc = await Product.findById(productId)
      .select('name thumbnail images originalPrice models tiers')
      .lean({ virtuals: true });

    // Emit to all buyers in this session
    const io = getSocketIO();
    if (io) io.to(`livestream_${sessionId}`).emit("livestream_pin_update", {
      pinnedProduct: pinnedProductDoc,
      products,
    });

    // Emit updated syntax guide card to all buyers
    try {
      const { buildSyntaxGuide } = await import('../services/livestream.service.js');
      const session = await LiveSession.findById(sessionId).lean();
      const guide = await buildSyntaxGuide(session, pinnedProductDoc);
      if (guide) {
        io.to(`livestream_${sessionId}`).emit('livestream_syntax_guide', guide);
      } else {
        io.to(`livestream_${sessionId}`).emit('livestream_syntax_guide_clear', { sessionId });
      }
    } catch (guideErr) {
      console.error('[livestream] buildSyntaxGuide error:', guideErr.message);
    }

    res.json({ success: true, data: { products, pinnedProduct: pinnedProductDoc } });
  } catch (err) {
    next(err);
  }
};

// POST /api/livestream/session/:sessionId/unpin — unpin the current product
export const unpinProduct = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });

    const products = await livestreamService.unpinProduct(sessionId, req.user._id);

    // Emit to all buyers in this session
    const io = getSocketIO();
    if (io) io.to(`livestream_${sessionId}`).emit("livestream_pin_update", {
      pinnedProduct: null,
      products,
    });

    // Clear the syntax guide when product is unpinned
    try {
      const { buildSyntaxGuide } = await import('../services/livestream.service.js');
      const session = await LiveSession.findById(sessionId).lean();
      const guide = await buildSyntaxGuide(session, null);
      if (guide) {
        io.to(`livestream_${sessionId}`).emit('livestream_syntax_guide', guide);
      } else {
        io.to(`livestream_${sessionId}`).emit('livestream_syntax_guide_clear', { sessionId });
      }
    } catch (guideErr) {
      console.error('[livestream] buildSyntaxGuide error:', guideErr.message);
    }

    res.json({ success: true, data: { products, pinnedProduct: null } });
  } catch (err) {
    next(err);
  }
};

// GET /api/livestream/session/:sessionId/messages — chat history for late joiners
export const getSessionMessages = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
  const messages = await livestreamRedisService.getRecentChat(sessionId, limit);
  res.json({
    success: true,
    data: messages,
  });
  } catch (err) {
    next(err);
  }
};

// POST /api/livestream/session/:sessionId/like — server-side like with dedup
export const likeSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user?._id?.toString() || req.body?.userId;

    const session = await LiveSession.findById(sessionId).lean();
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (session.status !== 'live') return res.status(400).json({ message: 'Stream is not live' });

    const newCount = await livestreamRedisService.incrementLikeCount(sessionId);
    res.json({ success: true, data: { likeCount: newCount } });
  } catch (err) {
    next(err);
  }
};

// GET /api/livestream/session/:sessionId/config — full session config including orderSyntax
export const getSessionConfig = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await LiveSession.findById(sessionId)
      .select("orderSyntax")
      .lean();

    if (!session) return res.status(404).json({ message: "Session not found" });

    res.json({ success: true, data: { orderSyntax: session.orderSyntax } });
  } catch (err) {
    next(err);
  }
};

// PUT /api/livestream/session/:sessionId — update session metadata (e.g., orderSyntax)
export const updateSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const { orderSyntax } = req.body;

    console.log('[BE] updateSession called — sessionId:', sessionId, 'body:', JSON.stringify(req.body));

    if (req.user.role !== "seller") return res.status(403).json({ message: "Forbidden" });

    const session = await LiveSession.findById(sessionId);
    if (!session) return res.status(404).json({ message: "Session not found" });

    // Guard: only allow updates to own session
    if (session.shopId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (orderSyntax !== undefined) {
      const rawTiers = orderSyntax.variantTiers;
      session.orderSyntax = {
        enabled: Boolean(orderSyntax.enabled),
        prefix: typeof orderSyntax.prefix === "string" ? orderSyntax.prefix.trim().replace(/^#/, "") : "",
        productId: orderSyntax.productId || null,
        // Store the tier names + allowed options the seller configured.
        // When saving we normalise each tier name so the FE parser can use it
        // as a guaranteed anchor token (e.g. "Màu sắc" → "màu sắc").
        variantTiers: Array.isArray(rawTiers)
          ? rawTiers.map((tier) => ({
              name: typeof tier.name === "string" ? tier.name.trim().toLowerCase() : "",
              options: Array.isArray(tier.options)
                ? tier.options.map((o) => String(o).trim())
                : [],
            }))
          : null,
      };
    }

    await session.save();
    console.log('[BE] Session saved — orderSyntax:', JSON.stringify(session.orderSyntax));

    // Broadcast updated config to all buyers in this session
    const io = getSocketIO();
    console.log('[BE] SocketIO instance:', io ? 'exists' : 'NULL', 'room: livestream_' + sessionId);
    if (io) {
      io.to(`livestream_${sessionId}`).emit("livestream_config_update", {
        sessionId,
        orderSyntax: session.orderSyntax,
      });
      console.log('[BE] Emitted livestream_config_update to room livestream_' + sessionId);
    } else {
      console.warn('[BE] Could not emit — SocketIO not initialized');
    }

    // Re-emit syntax guide so all buyers get the updated guide
    try {
      const { buildSyntaxGuide } = await import('../services/livestream.service.js');
      const updatedSession = await LiveSession.findById(sessionId).lean();

      // Fetch the currently pinned product so the syntax guide reflects it
      const pinnedProductDoc = updatedSession.pinnedProduct
        ? await Product.findById(updatedSession.pinnedProduct)
            .select('name thumbnail tiers variants price shopId')
            .lean()
        : null;

      const guide = await buildSyntaxGuide(updatedSession, pinnedProductDoc);
      if (guide) {
        io.to(`livestream_${sessionId}`).emit('livestream_syntax_guide', guide);
      } else {
        io.to(`livestream_${sessionId}`).emit('livestream_syntax_guide_clear', { sessionId });
      }
    } catch (guideErr) {
      console.error('[livestream] buildSyntaxGuide error:', guideErr.message);
    }

    res.json({ success: true, data: { orderSyntax: session.orderSyntax } });
  } catch (err) {
    console.error('[BE] updateSession error:', err);
    next(err);
  }
};

// POST /api/livestream/webhook — LiveKit sends participant events here
// LiveKit signs requests with HMAC-SHA256 using LIVEKIT_API_SECRET
function verifyLiveKitSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(JSON.stringify(body));
    const expected = hmac.digest("base64");
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ── Helper: extract sessionId from webhook event payload ──────────────────
// Tries participant.metadata (for participant_joined/left),
// then room.metadata (for room_finished),
// then falls back to stripping "live_" from room name.
function extractSessionId(event) {
  // Try participant.metadata (participant_joined / participant_left)
  if (event.participant?.metadata) {
    try {
      const meta = JSON.parse(event.participant.metadata);
      if (meta.sessionId) return meta.sessionId;
    } catch (_) { /* fall through */ }
  }
  // Try room.metadata (room_finished)
  if (event.room?.metadata) {
    try {
      const meta = JSON.parse(event.room.metadata);
      if (meta.sessionId) return meta.sessionId;
    } catch (_) { /* fall through */ }
  }
  // Fallback: strip "live_" prefix from room name
  const roomName = typeof event.room === "string"
    ? event.room
    : event.room?.name;
  if (roomName) {
    const stripped = String(roomName).replace("live_", "");
    // Only use as sessionId if it looks like a MongoDB ObjectId (24 hex chars)
    if (/^[0-9a-fA-F]{24}$/.test(stripped)) return stripped;
  }
  return null;
}

export const handleLiveKitWebhook = async (req, res) => {
  const event = req.body;

  if (!event || !event.event) {
    return res.status(400).json({ message: "Invalid webhook payload" });
  }

  const signature = req.headers["livekit-signature"];
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (apiSecret && !verifyLiveKitSignature(event, signature, apiSecret)) {
    logger.warn("[LiveKit Webhook] Invalid signature — rejecting request");
    return res.status(401).json({ message: "Invalid signature" });
  }

  try {
    switch (event.event) {
      case "participant_joined": {
        const { room, participant } = event;
        if (!room) break;
        const sessionId = extractSessionId(event);
        if (!sessionId) {
          logger.warn("[LiveKit Webhook] participant_joined: could not extract sessionId from", { room, participant: participant?.identity });
          break;
        }
        // Viewer counts come only from Socket.IO livestream_join/leave (Redis SET) — LiveKit would double-count with the same participants.
        logger.info(`[LiveKit Webhook] participant_joined: ${participant?.identity} in ${room} (session ${sessionId})`);
        break;
      }

      case "participant_left": {
        const { room, participant } = event;
        if (!room) break;
        const sessionId = extractSessionId(event);
        if (!sessionId) {
          logger.warn("[LiveKit Webhook] participant_left: could not extract sessionId from", { room, participant: participant?.identity });
          break;
        }
        logger.info(`[LiveKit Webhook] participant_left: ${participant?.identity} in ${room} (session ${sessionId})`);
        break;
      }

      case "room_started": {
        logger.info(`[LiveKit Webhook] room_started: ${event.room?.name}`);
        break;
      }

      case "room_finished": {
        const { room } = event;
        const roomName = room?.name || room;
        if (!roomName) break;
        const sessionId = extractSessionId(event) || String(roomName).replace("live_", "");
        try {
          await livestreamRedisService.invalidateActiveStream(sessionId);
        } catch (_) { /* non-fatal — Redis unavailable */ }
        try {
          await LiveSession.findByIdAndUpdate(sessionId, { status: "ended", endedAt: new Date() });
        } catch (_) { /* non-fatal — session may not exist or already ended */ }
        logger.info(`[LiveKit Webhook] room_finished: ${roomName} (session ${sessionId})`);
        break;
      }

      default:
        logger.info(`[LiveKit Webhook] unhandled event: ${event.event}`);
    }

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error("[LiveKit Webhook] Error:", err);
    res.status(200).json({ success: true }); // Always 200 so LiveKit doesn't retry
  }
};
