import mongoose from 'mongoose';

/** Strip Vietnamese diacritics + uppercase. Used as a Mongoose setter for SKU fields. */
function normalizeSkuValue(v) {
  if (!v || typeof v !== 'string') return v;
  return v
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D');
}

const orderItemSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: [true, 'Order ID is required'],
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
    },
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Model/Variant ID is required'],
    },
    sku: {
      type: String,
      required: [true, 'SKU is required'],
      set: normalizeSkuValue,
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    tierSelections: {
      type: Map,
      of: String,
      required: [true, 'Tier selections are required'],
    },
    subtotal: {
      type: Number,
      required: [true, 'Subtotal is required'],
      min: [0, 'Subtotal cannot be negative'],
    },
    originalPrice: {
      type: Number,
      min: [0, 'Original price cannot be negative'],
    },
    isFlashSale: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
orderItemSchema.index({ orderId: 1 });
orderItemSchema.index({ productId: 1 });
orderItemSchema.index({ modelId: 1 });
orderItemSchema.index({ sku: 1 });

const OrderItem = mongoose.model('OrderItem', orderItemSchema);

export default OrderItem;
