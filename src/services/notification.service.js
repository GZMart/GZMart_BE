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
   * Notify all followers of a shop
   * @param {ObjectId} shopId - The seller/shop user ID
   * @param {string} title
   * @param {string} message
   * @param {string} type - VOUCHER | FLASH_SALE | PROMOTION | ANNOUNCEMENT
   * @param {Object} relatedData - optional extra data (shopId, voucherCode, etc.)
   */
  async notifyShopFollowers(shopId, title, message, type = 'PROMOTION', relatedData = null) {
    try {
      const Follow = (await import('../models/Follow.js')).default;

      // 1. Get all follower IDs for this shop
      const follows = await Follow.find({ followingId: shopId }, 'followerId');
      if (!follows || follows.length === 0) {
        logger.info(`No followers found for shop ${shopId}, skip notification.`);
        return { success: true, count: 0 };
      }

      const followerIds = follows.map(f => f.followerId);

      // 2. Prepare merged relatedData (always include shopId)
      const mergedRelated = { shopId: shopId.toString(), ...(relatedData || {}) };

      // 3. Bulk insert notification records
      const docs = followerIds.map(followerId => ({
        recipientId: followerId,
        title,
        message,
        type,
        relatedData: mergedRelated,
      }));
      await Notification.insertMany(docs);

      // 4. Emit real-time event to each follower's socket room
      const io = getSocketIO();
      if (io) {
        const displayNotif = {
          title, message, type,
          relatedData: mergedRelated,
          createdAt: new Date(),
          isRead: false,
        };
        followerIds.forEach(followerId => {
          io.to(`user_${followerId.toString()}`).emit('new_notification', displayNotif);
        });
      } else {
        logger.warn('Socket.io instance not found, follower notifications not sent in real-time.');
      }

      logger.info(`Sent "${type}" notification to ${followerIds.length} follower(s) of shop ${shopId}`);
      return { success: true, count: followerIds.length };
    } catch (error) {
      // Fire-and-forget: log but don't crash the main request
      logger.error('Error notifying shop followers:', error);
      return { success: false, count: 0 };
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
