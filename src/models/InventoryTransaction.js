import mongoose from "mongoose";

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
          return val !== 0;
        },
        message: "Quantity cannot be zero",
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
  }
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
  inventoryTransactionSchema
);
