import mongoose from "mongoose";

/**
 * Supplier Model
 * Represents suppliers from which goods are purchased
 */
const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Supplier name is required"],
      trim: true,
      maxlength: [200, "Supplier name cannot exceed 200 characters"],
      index: true,
    },
    contactPerson: {
      type: String,
      trim: true,
      maxlength: [100, "Contact person name cannot exceed 100 characters"],
    },
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true; // Allow empty
          return /^[\d\s\-\+\(\)]+$/.test(v);
        },
        message: "Invalid phone number format",
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          if (!v) return true; // Allow empty
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Invalid email format",
      },
    },
    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
    },
    status: {
      type: String,
      enum: {
        values: ["Active", "Inactive"],
        message: "Status must be either Active or Inactive",
      },
      default: "Active",
      index: true,
    },
    reliabilityScore: {
      type: Number,
      min: [0, "Reliability score cannot be negative"],
      max: [100, "Reliability score cannot exceed 100"],
      default: 50,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator is required"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes for performance
supplierSchema.index({ name: 1, status: 1 });
supplierSchema.index({ createdAt: -1 });

// Virtual for total purchase orders
supplierSchema.virtual("totalOrders", {
  ref: "PurchaseOrder",
  localField: "_id",
  foreignField: "supplierId",
  count: true,
});

// Set JSON and Object transformation options
supplierSchema.set("toJSON", { virtuals: true });
supplierSchema.set("toObject", { virtuals: true });

export default mongoose.model("Supplier", supplierSchema);
