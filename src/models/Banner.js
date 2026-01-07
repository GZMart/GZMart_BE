import mongoose from "mongoose";

const bannerSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Banner title is required"],
      trim: true,
    },
    subtitle: {
      type: String,
      trim: true,
      default: null,
    },
    image: {
      type: String,
      required: [true, "Banner image is required"],
    },
    imageSmall: {
      type: String,
      default: null,
      comment: "Image for mobile devices",
    },
    link: {
      type: String,
      default: null,
      comment: "Link to product/category/page",
    },
    linkType: {
      type: String,
      enum: ["product", "category", "deal", "external", "none"],
      default: "none",
    },
    order: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    clickCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
bannerSchema.index({ isActive: 1, order: 1 });
bannerSchema.index({ startDate: 1, endDate: 1 });

// Virtual for is currently active
bannerSchema.virtual("isCurrentlyActive").get(function () {
  if (!this.isActive) return false;

  const now = new Date();
  if (this.startDate && this.startDate > now) return false;
  if (this.endDate && this.endDate < now) return false;

  return true;
});

export default mongoose.model("Banner", bannerSchema);
