import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  type: {
    type: String,
    enum: ['text', 'product'],
    default: 'text',
  },
  content: {
    type: String,
    required: function () {
      return this.type === 'text';
    },
  },
  productInfo: {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    image: String,
    price: Number,
    originalPrice: Number,
    variant: String,
    slug: String,
    rating: Number,
    hasVoucher: Boolean,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  isRead: {
    type: Boolean,
    default: false,
  }
});

export default mongoose.model('Message', MessageSchema);
