import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product is required"],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: false,
      index: true,
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1 star"],
      max: [5, "Rating cannot be more than 5 stars"],
    },
    title: {
      type: String,
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
      default: null,
    },
    content: {
      type: String,
      required: [true, "Review content is required"],
      trim: true,
      minlength: [10, "Review content must be at least 10 characters"],
      maxlength: [5000, "Review content cannot exceed 5000 characters"],
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: function (arr) {
          return arr.length <= 5;
        },
        message: "Maximum 5 images allowed per review",
      },
    },
    helpful: {
      type: Number,
      default: 0,
      min: 0,
    },
    unhelpful: {
      type: Number,
      default: 0,
      min: 0,
    },
    helpfulBy: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    unhelpfulBy: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "approved",
      index: true,
    },
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes
reviewSchema.index({ productId: 1, status: 1 });
reviewSchema.index({ userId: 1, createdAt: -1 });
reviewSchema.index({ productId: 1, rating: 1 });
reviewSchema.index({ createdAt: -1 });
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true }); // One review per product per user

export default mongoose.model("Review", reviewSchema);
