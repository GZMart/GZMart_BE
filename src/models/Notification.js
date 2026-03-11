import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['ORDER', 'SYSTEM', 'PROMOTION', 'OTHER'],
      default: 'SYSTEM',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    relatedData: {
      type: mongoose.Schema.Types.Mixed, // Can store orderId, promotionId, etc.
    },
  },
  {
    timestamps: true,
  }
);

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
