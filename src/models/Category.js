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
      // Removed 'required' here because the pre-save middleware handles it
    },
    image: {
      type: String,
      default: null,
    },
    // From GZM-13: UI features
    icon: {
      type: String,
      default: null,
    },
    description: {
      type: String,
      trim: true,
      default: null,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    // From Dev: Hierarchy support
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    // From Dev: Hierarchy level
    level: {
      type: Number,
      default: 1,
      min: 1,
      max: 3,
    },
    // From GZM-13: Display ordering
    order: {
      type: Number,
      default: 0,
    },
    // From Dev: Standardized status enum (preferred over isActive boolean)
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    // From GZM-13: Featured flag
    isFeatured: {
      type: Boolean,
      default: false,
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes (Merged)
categorySchema.index({ slug: 1 });
categorySchema.index({ parentId: 1 });
categorySchema.index({ status: 1 });
categorySchema.index({ order: 1 });
categorySchema.index({ isFeatured: 1 });

// Pre-save middleware to generate slug (From GZM-13 - Preserved for VN char support)
categorySchema.pre("save", function (next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }
  next();
});

export default mongoose.model("Category", categorySchema);