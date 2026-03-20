import mongoose from "mongoose";

/**
 * Supplier Model
 * Specialized for cross-border e-commerce (Taobao/1688 suppliers)
 */

// ─────────────────────────────────────────────────────────────────────────
// Sub-schema definitions for nested objects
// ─────────────────────────────────────────────────────────────────────────

const contactSchema = new mongoose.Schema(
  {
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
    wechatId: {
      type: String,
      trim: true,
      maxlength: [100, "WeChat ID cannot exceed 100 characters"],
    },
    aliwangwangId: {
      type: String,
      trim: true,
      maxlength: [100, "Aliwangwang ID cannot exceed 100 characters"],
    },
  },
  { _id: false },
);

const addressInfoSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      trim: true,
      maxlength: [500, "Address cannot exceed 500 characters"],
    },
    returnAddress: {
      type: String,
      trim: true,
      maxlength: [500, "Return address cannot exceed 500 characters"],
    },
    platformUrl: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return /^https?:\/\/.+/.test(v);
        },
        message: "Platform URL must start with http:// or https://",
      },
    },
  },
  { _id: false },
);

const billingInfoSchema = new mongoose.Schema(
  {
    taxCode: {
      type: String,
      trim: true,
      maxlength: [50, "Tax code cannot exceed 50 characters"],
    },
    bankName: {
      type: String,
      trim: true,
      maxlength: [150, "Bank name cannot exceed 150 characters"],
    },
    accountName: {
      type: String,
      trim: true,
      maxlength: [150, "Account name cannot exceed 150 characters"],
    },
    accountNumber: {
      type: String,
      trim: true,
      maxlength: [50, "Account number cannot exceed 50 characters"],
    },
    defaultCurrency: {
      type: String,
      enum: {
        values: ["CNY", "VND"],
        message: "Currency must be either CNY or VND",
      },
      default: "CNY",
    },
    paymentTerms: {
      type: String,
      trim: true,
      maxlength: [200, "Payment terms cannot exceed 200 characters"],
    },
  },
  { _id: false },
);

// ─────────────────────────────────────────────────────────────────────────
// Main Supplier Schema
// ─────────────────────────────────────────────────────────────────────────

const supplierSchema = new mongoose.Schema(
  {
    // ─── General Information ─────────────────────────────────────────────
    name: {
      type: String,
      required: [true, "Supplier name is required"],
      trim: true,
      maxlength: [200, "Supplier name cannot exceed 200 characters"],
      index: true,
    },
    category: {
      type: [String],
      default: [],
      maxlength: [10, "Cannot have more than 10 categories"],
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

    // ─── Contact Information ─────────────────────────────────────────────
    contact: {
      type: contactSchema,
      default: () => ({}),
    },

    // ─── Address & Platform Information ──────────────────────────────────
    addressInfo: {
      type: addressInfoSchema,
      default: () => ({}),
    },

    // ─── Billing & Payment Information ───────────────────────────────────
    billingInfo: {
      type: billingInfoSchema,
      default: () => ({}),
    },

    // ─── Logistics ───────────────────────────────────────────────────────
    leadTimeDays: {
      type: Number,
      default: 0,
      min: [0, "Lead time cannot be negative"],
    },

    // ─── Additional Information ──────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
    },

    // ─── Audit Fields ────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────
// Indexes for performance
// ─────────────────────────────────────────────────────────────────────────
supplierSchema.index({ name: 1, status: 1 });
supplierSchema.index({ createdAt: -1 });
supplierSchema.index({ "contact.wechatId": 1 });
supplierSchema.index({ "contact.aliwangwangId": 1 });
supplierSchema.index({ category: 1 });

// ─────────────────────────────────────────────────────────────────────────
// Virtual for total purchase orders
// ─────────────────────────────────────────────────────────────────────────
supplierSchema.virtual("totalOrders", {
  ref: "PurchaseOrder",
  localField: "_id",
  foreignField: "supplierId",
  count: true,
});

// ─────────────────────────────────────────────────────────────────────────
// Configuration for JSON and Object transformation
// ─────────────────────────────────────────────────────────────────────────
supplierSchema.set("toJSON", { virtuals: true });
supplierSchema.set("toObject", { virtuals: true });

export default mongoose.model("Supplier", supplierSchema);
