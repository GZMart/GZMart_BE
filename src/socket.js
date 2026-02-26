import logger from './utils/logger.js';
import { saveMessage } from './services/chat.service.js';

export default function setupSocketHandlers(io) {
  // User-socket mapping 
  const userSocketMap = new Map();

  io.on('connection', socket => {
    logger.info(`Socket connected: ${socket.id}`);

    // Join user-specific room for notifications
    socket.on('join_user_room', userId => {
      socket.join(`user_${userId}`);
      userSocketMap.set(userId, socket.id);
      logger.info(`Socket ${socket.id} joined user room: user_${userId}`);
    });

    // Join specific conversation room
    socket.on('join_conversation', conversationId => {
      socket.join(conversationId);
      logger.info(`Socket ${socket.id} joined conversation ${conversationId}`);
    });

    // Receive and broadcast new message
    socket.on('send_message', async message => {
      // message: { conversationId, sender, receiver, content }
      try {
        const saved = await saveMessage(message);
        
        // Emit to conversation room (so sender and receiver in the room get it)
        io.to(message.conversationId).emit('receive_message', saved);
        
        // Also emit notification to receiver's user room if they are not in the conversation
        io.to(`user_${message.receiver}`).emit('new_message_notification', saved);
        
      } catch (err) {
        logger.error('Error saving message:', err);
        socket.emit('error_message', 'Could not save message');
      }
    });

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);
      // Clean up user-socket mapping
      for (const [userId, socketId] of userSocketMap.entries()) {
        if (socketId === socket.id) {
          userSocketMap.delete(userId);
          logger.info(`Removed user ${userId} from socket mapping`);
          break;
        }
      }
    });
  });
}
