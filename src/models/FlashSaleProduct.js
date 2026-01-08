import mongoose from 'mongoose';

const flashSaleProductSchema = new mongoose.Schema(
  {
    // Product Information
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required'],
      unique: true,
      index: true,
    },
    
    // Flash Sale Information
    salePrice: {
      type: Number,
      required: [true, 'Sale price is required'],
      min: [0, 'Sale price cannot be negative'],
    },
    totalQuantity: {
      type: Number,
      required: [true, 'Total quantity is required'],
      min: [1, 'Total quantity must be at least 1'],
    },
    soldQuantity: {
      type: Number,
      default: 0,
      min: [0, 'Sold quantity cannot be negative'],
    },
    startAt: {
      type: Date,
      required: [true, 'Start date is required'],
      index: true,
    },
    endAt: {
      type: Date,
      required: [true, 'End date is required'],
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: ['upcoming', 'active', 'ended', 'cancelled'],
        message: '{VALUE} is not a valid status',
      },
      default: 'upcoming',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
flashSaleProductSchema.index({ startAt: 1, endAt: 1 });
flashSaleProductSchema.index({ status: 1 });

// Pre-save: Update status based on current time
flashSaleProductSchema.pre('save', async function () {
  const now = new Date();
  if (now < this.startAt) {
    this.status = 'upcoming';
  } else if (now >= this.startAt && now <= this.endAt && this.status !== 'cancelled') {
    this.status = 'active';
  } else if (now > this.endAt && this.status !== 'cancelled') {
    this.status = 'ended';
  }
});

const FlashSaleProduct = mongoose.model('FlashSaleProduct', flashSaleProductSchema);

export default FlashSaleProduct;
