import * as livestreamService from "../services/livestream.service.js";

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
    res.json(session);
  } catch (e) {
    next(e);
  }
}

export async function getActiveByShop(req, res, next) {
  try {
    const { shopId } = req.query;
    if (!shopId) return res.status(400).json({ message: "shopId required" });
    const session = await livestreamService.getActiveSessionByShop(shopId);
    res.json(session || null);
  } catch (e) {
    next(e);
  }
}
