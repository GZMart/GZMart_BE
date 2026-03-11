import NotificationService from '../services/notification.service.js';
import { sendResponse, sendError } from '../utils/response.js';

class NotificationController {
  /**
   * Fetch a user's notifications
   */
  async getNotifications(req, res) {
    try {
      const { limit = 10, skip = 0 } = req.query;
      const result = await NotificationService.getUserNotifications(
        req.user._id,
        parseInt(limit, 10),
        parseInt(skip, 10)
      );
      
      return sendResponse(res, 200, result, 'Notifications fetched successfully');
    } catch (error) {
      return sendError(res, 500, 'Error fetching notifications', [error.message]);
    }
  }

  /**
   * Get unread count
   */
  async getUnreadCount(req, res) {
    try {
      const count = await NotificationService.getUnreadCount(req.user._id);
      return sendResponse(res, 200, { count }, 'Unread count fetched');
    } catch (error) {
      return sendError(res, 500, 'Error fetching unread count', [error.message]);
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(req, res) {
    try {
      const { id } = req.params;
      const notification = await NotificationService.markAsRead(id, req.user._id);
      return sendResponse(res, 200, { notification }, 'Notification marked as read');
    } catch (error) {
      return sendError(res, error.message.includes('not found') ? 404 : 500, 'Error marking as read', [error.message]);
    }
  }

  /**
   * Mark all unread notifications as read
   */
  async markAllAsRead(req, res) {
    try {
      const result = await NotificationService.markAllAsRead(req.user._id);
      return sendResponse(res, 200, result, 'All notifications marked as read');
    } catch (error) {
      return sendError(res, 500, 'Error marking all as read', [error.message]);
    }
  }

  /**
   * Broadcast a notification to all users
   */
  async broadcastNotification(req, res) {
    try {
      // Check if user is admin (optional, assuming protected route handles it)
      if (req.user.role !== 'admin') {
         return sendError(res, 403, 'Only admins can broadcast notifications');
      }

      const { title, message, type, relatedData } = req.body;
      const result = await NotificationService.createGlobalNotification(
        title,
        message,
        type || 'SYSTEM',
        relatedData || null
      );
      
      return sendResponse(res, 201, result, 'Global notification broadcasted successfully');
    } catch (error) {
      return sendError(res, 500, 'Error broadcasting notification', [error.message]);
    }
  }
}

export default new NotificationController();
