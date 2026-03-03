import mongoose from 'mongoose';

const shopStatisticSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    isPreferred: {
      type: Boolean,
      default: false,
    },
    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ratingCount: {
      type: Number,
      default: 0,
    },
    chatResponseRate: {
      type: Number,
      default: 100, // as percentage (0-100%)
    },
    cancelDutyRate: {
      type: Number,
      default: 0, // as percentage (0-100%)
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
shopStatisticSchema.index({ sellerId: 1 });
shopStatisticSchema.index({ isPreferred: 1 });
shopStatisticSchema.index({ ratingAverage: -1 });

const ShopStatistic = mongoose.model('ShopStatistic', shopStatisticSchema);

export default ShopStatistic;
