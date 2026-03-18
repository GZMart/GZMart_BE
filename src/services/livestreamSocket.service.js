import LiveSession from "../models/LiveSession.js";
import logger from "../utils/logger.js";

const roomSessions = new Map(); // roomId -> { sessionId, shopId }

export function setupLiveStreamHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("livestream_join", async (data) => {
      try {
        const { sessionId, userId, displayName } = data || {};
        const session = await LiveSession.findById(sessionId);
        if (!session || session.status !== "live") {
          socket.emit("livestream_error", { message: "Session not available" });
          return;
        }
        const roomId = `livestream_${sessionId}`;
        socket.join(roomId);
        roomSessions.set(roomId, { sessionId, shopId: session.shopId });
        socket.emit("livestream_joined", { roomId, sessionId });
      } catch (e) {
        logger.error("livestream_join error:", e);
        socket.emit("livestream_error", { message: e.message });
      }
    });

    socket.on("livestream_chat", async (data) => {
      try {
        const { sessionId, content, displayName } = data || {};
        const session = await LiveSession.findById(sessionId);
        if (!session || session.status !== "live") return;
        const roomId = `livestream_${sessionId}`;
        const msg = {
          id: Date.now().toString(),
          content,
          displayName: displayName || "Anonymous",
          userId: data.userId || null,
          timestamp: new Date().toISOString(),
        };
        io.to(roomId).emit("livestream_chat_message", msg);
      } catch (e) {
        logger.error("livestream_chat error:", e);
      }
    });

    socket.on("livestream_leave", (data) => {
      const { sessionId } = data || {};
      if (sessionId) socket.leave(`livestream_${sessionId}`);
    });
  });
}
