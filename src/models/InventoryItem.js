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

const inventoryItemSchema = new mongoose.Schema(
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
    quantity: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Quantity cannot be negative"],
    },
    costPrice: {
      type: Number,
      default: 0,
      min: [0, "Cost price cannot be negative"],
    },
    // Tracks whether the cost was set manually or auto-pushed from a completed PO
    costSource: {
      type: String,
      enum: ["manual", "po"],
      default: "manual",
    },
    costSourcePoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseOrder",
      default: null,
    },
    reservedQuantity: {
      type: Number,
      default: 0,
      min: [0, "Reserved quantity cannot be negative"],
    },
    warehouseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Warehouse",
      default: null,
      index: true,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: 0,
    },
    lastRestockDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "discontinued"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Virtual for available quantity (quantity - reserved)
inventoryItemSchema.virtual("availableQuantity").get(function () {
  return Math.max(0, this.quantity - this.reservedQuantity);
});

// Virtual for stock status
inventoryItemSchema.virtual("stockStatus").get(function () {
  if (this.quantity === 0) return "out_of_stock";
  if (this.quantity <= this.lowStockThreshold) return "low_stock";
  return "in_stock";
});

// Virtual for stock value
inventoryItemSchema.virtual("stockValue").get(function () {
  return this.quantity * this.costPrice;
});

// Indexes for performance
inventoryItemSchema.index({ productId: 1, warehouseId: 1 });
inventoryItemSchema.index({ quantity: 1, status: 1 });
inventoryItemSchema.index({ sku: 1, warehouseId: 1 }, { unique: true }); // Compound unique

// Static method to find or create inventory item
inventoryItemSchema.statics.findOrCreate = async function (
  productId,
  modelId,
  sku,
  warehouseId = null,
) {
  let item = await this.findOne({ sku, warehouseId });

  if (!item) {
    item = await this.create({
      productId,
      modelId,
      sku: normalizeSkuValue(sku),
      quantity: 0,
      costPrice: 0,
      warehouseId,
    });
  }

  return item;
};

// Method to update stock with weighted average cost
inventoryItemSchema.methods.addStock = function (quantity, newCostPrice) {
  if (quantity <= 0) {
    throw new Error("Quantity must be positive for addStock");
  }

  const oldQuantity = this.quantity;
  const oldCostPrice = this.costPrice || 0;

  // Calculate weighted average cost price
  const totalOldValue = oldQuantity * oldCostPrice;
  const totalNewValue = quantity * (newCostPrice || 0);
  const totalQuantity = oldQuantity + quantity;

  this.quantity = totalQuantity;

  // Update cost price using weighted average
  if (totalQuantity > 0) {
    this.costPrice = (totalOldValue + totalNewValue) / totalQuantity;
  }

  this.lastRestockDate = new Date();
};

// Method to reduce stock
inventoryItemSchema.methods.reduceStock = function (quantity) {
  if (quantity <= 0) {
    throw new Error("Quantity must be positive for reduceStock");
  }

  if (this.availableQuantity < quantity) {
    throw new Error(
      `Insufficient stock. Available: ${this.availableQuantity}, Requested: ${quantity}`,
    );
  }

  this.quantity -= quantity;
};

// Method to set stock directly (for adjustments)
inventoryItemSchema.methods.setStock = function (newQuantity) {
  if (newQuantity < 0) {
    throw new Error("Stock quantity cannot be negative");
  }

  this.quantity = newQuantity;
};

export default mongoose.model("InventoryItem", inventoryItemSchema);
