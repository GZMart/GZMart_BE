import mongoose from 'mongoose';

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      unique: true,
      index: true,
    },
    totalPrice: {
      type: Number,
      default: 0,
      min: [0, 'Total price must be non-negative'],
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual populate for cart items
cartSchema.virtual('items', {
  ref: 'CartItem',
  localField: '_id',
  foreignField: 'cartId',
});

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;
