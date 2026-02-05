import mongoose from "mongoose";

/**
 * Purchase Order Model
 * Represents orders placed to suppliers for importing goods
 */

const purchaseOrderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product is required"],
    },
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, "Model ID (variant) is required"],
    },
    sku: {
      type: String,
      required: [true, "SKU is required"],
      trim: true,
      uppercase: true,
    },
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    variantName: {
      type: String,
      trim: true,
      default: "",
    },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price (import price) is required"],
      min: [0, "Unit price cannot be negative"],
    },
    totalPrice: {
      type: Number,
      required: true,
      min: [0, "Total price cannot be negative"],
    },
  },
  { _id: false },
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Purchase Order code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: [true, "Supplier is required"],
    },
    status: {
      type: String,
      enum: {
        values: ["Draft", "Pending", "Completed", "Cancelled"],
        message:
          "Status must be one of: Draft, Pending, Completed, or Cancelled",
      },
      default: "Draft",
    },
    items: {
      type: [purchaseOrderItemSchema],
      required: [true, "Purchase Order must have at least one item"],
      validate: {
        validator: function (arr) {
          return arr.length > 0;
        },
        message: "Purchase Order must contain at least one item",
      },
    },
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
      default: 0,
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: [0, "Shipping cost cannot be negative"],
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: [0, "Tax amount cannot be negative"],
    },
    otherCost: {
      type: Number,
      default: 0,
      min: [0, "Other cost cannot be negative"],
    },
    finalAmount: {
      type: Number,
      required: [true, "Final amount is required"],
      min: [0, "Final amount cannot be negative"],
      default: 0,
    },
    expectedDeliveryDate: {
      type: Date,
      required: [true, "Expected delivery date is required"],
    },
    receivedDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, "Notes cannot exceed 1000 characters"],
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
    },
    completedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes for performance
purchaseOrderSchema.index({ code: 1 });
purchaseOrderSchema.index({ supplierId: 1, status: 1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ expectedDeliveryDate: 1 });
purchaseOrderSchema.index({ createdBy: 1, createdAt: -1 });

// Auto-calculate totalAmount before save
purchaseOrderSchema.pre("save", function (next) {
  // Calculate total amount from items
  if (this.items && this.items.length > 0) {
    this.totalAmount = this.items.reduce((sum, item) => {
      item.totalPrice = item.quantity * item.unitPrice;
      return sum + item.totalPrice;
    }, 0);
  }

  // Calculate final amount including all costs
  this.finalAmount =
    this.totalAmount + this.shippingCost + this.taxAmount + this.otherCost;

  next();
});

// Static method to generate unique PO code
purchaseOrderSchema.statics.generateCode = async function () {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `PO${year}${month}`;

  // Find the latest PO with this prefix
  const lastPO = await this.findOne({
    code: new RegExp(`^${prefix}`),
  }).sort({ code: -1 });

  let sequence = 1;
  if (lastPO) {
    const lastSequence = parseInt(lastPO.code.slice(-4));
    sequence = lastSequence + 1;
  }

  return `${prefix}${String(sequence).padStart(4, "0")}`;
};

export default mongoose.model("PurchaseOrder", purchaseOrderSchema);
