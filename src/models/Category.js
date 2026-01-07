import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: [100, "Category name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    image: {
      type: String,
      default: null,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    level: {
      type: Number,
      default: 1,
      min: 1,
      max: 3,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    productCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for performance
categorySchema.index({ slug: 1 });
categorySchema.index({ parentId: 1 });
categorySchema.index({ status: 1 });

export default mongoose.model("Category", categorySchema);
