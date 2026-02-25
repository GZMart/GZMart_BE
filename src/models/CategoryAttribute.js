import mongoose from "mongoose";

const categoryAttributeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Attribute name is required"],
      trim: true,
      maxlength: [100, "Attribute name cannot exceed 100 characters"],
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    type: {
      type: String,
      enum: ["text", "number", "date", "select"],
      default: "select",
      comment: "Attribute input type",
    },
    options: {
      type: [String],
      required: [true, "Options are required for select type"],
      validate: {
        validator: function (arr) {
          return arr && arr.length > 0;
        },
        message: "Options must have at least one value",
      },
    },
    isRequired: {
      type: Boolean,
      default: false,
    },
    isFilterable: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    unit: {
      type: String,
      trim: true,
      maxlength: [20, "Unit cannot exceed 20 characters"],
    },
    minValue: {
      type: Number,
      default: null,
    },
    maxValue: {
      type: Number,
      default: null,
    },
    helpText: {
      type: String,
      trim: true,
      maxlength: [200, "Help text cannot exceed 200 characters"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes
categoryAttributeSchema.index({ categoryId: 1, status: 1 });
categoryAttributeSchema.index({ slug: 1 }, { unique: true });
categoryAttributeSchema.index({ displayOrder: 1 });

// Generate slug before save
categoryAttributeSchema.pre("save", function () {
  if (this.isModified("name") && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }
});

export default mongoose.model("CategoryAttribute", categoryAttributeSchema);
