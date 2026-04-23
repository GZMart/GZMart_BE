import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    cartId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cart',
      required: [true, 'Cart ID is required'],
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
      index: true,
    },
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1'],
    },
    size: {
      type: String,
      required: [true, 'Size is required'],
      trim: true,
    },
    color: {
      type: String,
      required: [true, 'Color is required'],
      trim: true,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price must be non-negative'],
    },
    image: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound index to prevent duplicate items with same specs in the same cart
cartItemSchema.index({ cartId: 1, productId: 1, size: 1, color: 1, modelId: 1 }, { unique: true });

const CartItem = mongoose.model('CartItem', cartItemSchema);

export default CartItem;
