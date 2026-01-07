import mongoose from 'mongoose';

const flashSaleProductSchema = new mongoose.Schema(
  {
    flashSaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FlashSale',
      required: [true, 'Flash sale ID is required'],
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
      index: true,
    },
    discountPercent: {
      type: Number,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100%'],
    },
    flashPrice: {
      type: Number,
      required: [true, 'Flash price is required'],
      min: [0, 'Flash price cannot be negative'],
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
flashSaleProductSchema.index({ flashSaleId: 1, productId: 1 }, { unique: true });
flashSaleProductSchema.index({ productId: 1 });

const FlashSaleProduct = mongoose.model('FlashSaleProduct', flashSaleProductSchema);

export default FlashSaleProduct;
