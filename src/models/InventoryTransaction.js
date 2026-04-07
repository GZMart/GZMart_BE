import mongoose from "mongoose";

/** Strip Vietnamese diacritics + uppercase. Used as a Mongoose setter for SKU fields. */
function normalizeSkuValue(v) {
  if (!v || typeof v !== "string") return v;
  return v
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D");
}

const inventoryTransactionSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product is required"],
      index: true,
    },
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Model ID is required"],
      index: true,
    },
    sku: {
      type: String,
      required: [true, "SKU is required"],
      trim: true,
      uppercase: true,
      set: normalizeSkuValue,
      index: true,
    },
    type: {
      type: String,
      enum: ["in", "out", "adjust", "return", "damage"],
      required: [true, "Transaction type is required"],
      index: true,
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      validate: {
        validator: function (val) {
          if (val === 0) return false;

          // Business rule: enforce sign based on transaction type
          if (this.type === "in" && val <= 0) {
            return false; // "in" must be positive
          }
          if (this.type === "out" && val >= 0) {
            return false; // "out" must be negative
          }
          if (this.type === "return" && val <= 0) {
            return false; // "return" must be positive
          }
          // "adjust" and "damage" can be either positive or negative

          return true;
        },
        message: function (props) {
          if (props.value === 0) {
            return "Quantity cannot be zero";
          }
          if (this.type === "in") {
            return "Quantity must be positive for 'in' transactions";
          }
          if (this.type === "out") {
            return "Quantity must be negative for 'out' transactions";
          }
          if (this.type === "return") {
            return "Quantity must be positive for 'return' transactions";
          }
          return "Invalid quantity for transaction type";
        },
      },
    },
    stockBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    stockAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    costPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    totalCost: {
      type: Number,
      min: 0,
      default: null,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [500, "Note cannot exceed 500 characters"],
    },
    referenceType: {
      type: String,
      enum: ["order", "manual", "return", "adjustment", "initial"],
      default: "manual",
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Creator is required"],
      index: true,
    },
    status: {
      type: String,
      enum: ["completed", "cancelled", "pending"],
      default: "completed",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes for performance
inventoryTransactionSchema.index({ productId: 1, createdAt: -1 });
inventoryTransactionSchema.index({ sku: 1, createdAt: -1 });
inventoryTransactionSchema.index({ type: 1, createdAt: -1 });
inventoryTransactionSchema.index({ createdBy: 1, createdAt: -1 });
inventoryTransactionSchema.index({ createdAt: -1 });

// Calculate total cost before save
inventoryTransactionSchema.pre("save", async function () {
  if (this.costPrice && this.quantity) {
    this.totalCost = Math.abs(this.quantity) * this.costPrice;
  }
});

export default mongoose.model(
  "InventoryTransaction",
  inventoryTransactionSchema,
);
