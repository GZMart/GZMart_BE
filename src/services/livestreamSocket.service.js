// src/services/livestreamSocket.service.js
// Socket.IO handlers for GZMart Live
// - Viewer count: managed by this service (Redis in-memory) + emitted on join/chat/leave
// - Chat: persisted to Redis, then broadcast via Socket.IO to all room members
// - Role: auto-detected from socket handshake data (seller role set by server middleware)

import logger from "../utils/logger.js";
import {
  addViewerToRoom,
  removeViewerFromRoom,
  storeChatMessage,
  incrementViewerCount,
  decrementViewerCount,
  getViewerCount,
} from './livestreamRedis.service.js';

export function setupLiveStreamHandlers(io, socket) {
  const userId = socket.data.userId || socket.id;
  const isSeller = socket.data.role === 'seller';

  // ---- livestream_join ----
  socket.on('livestream_join', async ({ sessionId, displayName }) => {
    if (!sessionId) return;

    try {
      socket.join(`livestream_${sessionId}`);
      socket.data.currentRoom = `livestream_${sessionId}`;

      await addViewerToRoom(sessionId, userId);
      const viewerCount = await incrementViewerCount(sessionId);

      // Emit current viewer count to the joining user and everyone in the room
      io.to(`livestream_${sessionId}`).emit('livestream_viewer_update', { count: viewerCount });

      // Broadcast "X đã vào phiên live" to ALL viewers (including the joiner) for floating toast
      const safeDisplayName = displayName || 'Viewer';
      io.to(`livestream_${sessionId}`).emit('livestream_join', { displayName: safeDisplayName });

      logger.info(`[Livestream] ${safeDisplayName} (${userId}, seller=${isSeller}) joined session ${sessionId} — count: ${viewerCount}`);
    } catch (err) {
      logger.error(`[Livestream] Error in join (${sessionId}):`, err.message);
    }
  });

  // ---- livestream_chat ----
  // ALL chat (buyer & seller) goes through Socket.IO → Redis → broadcast.
  // Server auto-assigns role based on socket auth data (seller = socket.data.role === 'seller').
  // Buyer: sends via this event (role: 'buyer') — stored + broadcast by this handler.
  // Seller: also sends via this event (role: 'seller') — stored + broadcast by this handler.
  socket.on(
    'livestream_chat',
    async ({ sessionId, content, displayName, userId: msgUserId, role: msgRole }) => {
    if (!sessionId || !content?.trim()) return;

    const safeContent = String(content).trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!safeContent) return;

    // Use a single, server-generated ID so deduplication is reliable across channels
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Prefer client userId (Mongo id from JWT / app) so senderId matches FE refs.
    // socket.data.userId is often unset → was falling back to socket.id and broke dedup.
    const resolvedUserId = msgUserId != null && msgUserId !== ''
      ? String(msgUserId)
      : String(userId);

    // Role: explicit payload wins (seller dashboard sends role: 'seller'), else socket auth
    const role =
      msgRole === 'seller' || msgRole === 'buyer'
        ? msgRole
        : isSeller
          ? 'seller'
          : 'buyer';

    const message = {
      sessionId,
      content: safeContent,
      displayName:
        displayName || (role === 'seller' ? 'Seller' : 'Anonymous'),
      userId: resolvedUserId,
      senderId: resolvedUserId,
      timestamp: new Date().toISOString(),
      role,
      isOwn: false,
    };

    // Persist to Redis for chat history API (late joiners via GET /session/:id/messages)
    try {
      await storeChatMessage(sessionId, messageId, message);
    } catch (err) {
      logger.warn(`[Livestream] Failed to persist chat message: ${err.message}`);
    }

    // Broadcast to EVERYONE in the room including sender
    // Each client skips the message locally if senderId matches their own userId
    io.to(`livestream_${sessionId}`).emit('livestream_chat_message', { id: messageId, ...message });
    },
  );

  // ---- livestream_leave ----
  socket.on('livestream_leave', async ({ sessionId }) => {
    if (!sessionId) return;

    try {
      socket.leave(`livestream_${sessionId}`);
      await removeViewerFromRoom(sessionId, userId);
      const viewerCount = await decrementViewerCount(sessionId);

      // Emit updated viewer count to remaining room members
      io.to(`livestream_${sessionId}`).emit('livestream_viewer_update', { count: Math.max(0, viewerCount) });

      logger.info(`[Livestream] User ${userId} left session ${sessionId} — count: ${viewerCount}`);
    } catch (err) {
      logger.error(`[Livestream] Error in leave (${sessionId}):`, err.message);
    }
  });

  // ---- disconnect ----
  socket.on('disconnect', async () => {
    const room = socket.data.currentRoom;
    if (room) {
      try {
        const sessionId = room.replace('livestream_', '');
        await removeViewerFromRoom(sessionId, userId);
        const viewerCount = await decrementViewerCount(sessionId);
        io.to(`livestream_${sessionId}`).emit('livestream_viewer_update', { count: Math.max(0, viewerCount) });
        logger.info(`[Livestream] User ${userId} disconnected from session ${sessionId} — count: ${viewerCount}`);
      } catch (err) {
        logger.error(`[Livestream] Error in disconnect:`, err.message);
      }
    }
  });
}
