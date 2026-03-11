import Notification from '../models/Notification.js';
import { getSocketIO } from '../utils/socketIO.js';
import logger from '../utils/logger.js';

class NotificationService {
  /**
   * Create a new notification and emit a real-time event to the user
   */
  async createNotification(recipientId, title, message, type = 'SYSTEM', relatedData = null) {
    try {
      // 1. Save to database
      const notification = new Notification({
        recipientId,
        title,
        message,
        type,
        relatedData,
      });
      await notification.save();

      // 2. Emit real-time event to the user's specific room
      const io = getSocketIO();
      if (io) {
        // We know users join room `user_${userId}` based on socket.js logic
        io.to(`user_${recipientId.toString()}`).emit('new_notification', notification);
      } else {
        logger.warn('Socket.io instance not found, real-time notification not sent.');
      }

      return notification;
    } catch (error) {
      logger.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Create a global notification for ALL users
   */
  async createGlobalNotification(title, message, type = 'SYSTEM', relatedData = null) {
    try {
      // 1. Get all user IDs
      const User = (await import('../models/User.js')).default;
      const users = await User.find({}, '_id');

      // 2. Prepare bulk insert array
      const notifications = users.map(user => ({
        recipientId: user._id,
        title,
        message,
        type,
        relatedData,
      }));

      // 3. Bulk save to database
      await Notification.insertMany(notifications);

      // 4. Emit real-time event to everyone
      const io = getSocketIO();
      if (io) {
        // Broadcast a generic new notification to all connected sockets
        const displayNotif = {
           title, message, type, relatedData,
           createdAt: new Date(), 
           isRead: false
        }
        io.emit('new_notification', displayNotif);
      } else {
        logger.warn('Socket.io instance not found, global notification not sent.');
      }

      return { success: true, count: notifications.length };
    } catch (error) {
      logger.error('Error creating global notification:', error);
      throw error;
    }
  }

  /**
   * Get notifications for a user
   */
  async getUserNotifications(userId, limit = 10, skip = 0) {
    try {
      const notifications = await Notification.find({ recipientId: userId })
        .sort({ createdAt: -1 }) // Newest first
        .skip(skip)
        .limit(limit);
      
      const total = await Notification.countDocuments({ recipientId: userId });
      
      return { notifications, total };
    } catch (error) {
      logger.error('Error fetching user notifications:', error);
      throw error;
    }
  }

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId) {
    try {
      const count = await Notification.countDocuments({ 
        recipientId: userId, 
        isRead: false 
      });
      return count;
    } catch (error) {
      logger.error('Error fetching unread count:', error);
      throw error;
    }
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId, userId) {
    try {
      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipientId: userId },
        { isRead: true },
        { new: true }
      );
      
      if (!notification) {
        throw new Error('Notification not found or unauthorized');
      }
      
      return notification;
    } catch (error) {
      logger.error('Error marking notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all unread notifications as read for a user
   */
  async markAllAsRead(userId) {
    try {
      const result = await Notification.updateMany(
        { recipientId: userId, isRead: false },
        { isRead: true }
      );
      return result;
    } catch (error) {
      logger.error('Error marking all notifications as read:', error);
      throw error;
    }
  }
}

export default new NotificationService();
