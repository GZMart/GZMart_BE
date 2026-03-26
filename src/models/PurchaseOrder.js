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
      default: null,   // optional — PO can exist without a linked listing
    },
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,   // optional — set when linked to a specific model/variant
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
    // --- Giá gốc bằng ¥ CNY (Tệ) ---
    unitPriceCny: {
      type: Number,
      default: 0,
      min: [0, "Unit price CNY cannot be negative"],
    },
    // unitPrice giữ lại để backward compat (VNĐ = unitPriceCny × exchangeRate)
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
    // --- Trọng lượng & kích thước (1 unit) ---
    weightKg: {
      type: Number,
      default: 0,
      min: [0, "Weight cannot be negative"],
    },
    dimLength: { type: Number, default: 0, min: 0 }, // cm
    dimWidth:  { type: Number, default: 0, min: 0 }, // cm
    dimHeight: { type: Number, default: 0, min: 0 }, // cm
    // --- Kết quả tính toán (computed khi complete) ---
    chargeableWeightKg: { type: Number, default: 0 }, // max(actual, vol) × qty
    landedCostUnit:     { type: Number, default: 0 }, // LC/unit sau phân bổ (VNĐ)
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
        values: [
          "Draft",
          "PENDING_APPROVAL",
          "ORDERED",
          "ARRIVED_VN",
          "COMPLETED",
          "Pending",
          "Completed",
          "Cancelled",
        ],
        message:
          "Status must be one of: Draft, PENDING_APPROVAL, ORDERED, ARRIVED_VN, COMPLETED, Pending, Completed, Cancelled",
      },
      default: "PENDING_APPROVAL",
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
    // =================================================================
    // CẤU HÌNH NHẬP HÀNG QUẢNG CHÂU
    // =================================================================
    importConfig: {
      exchangeRate: {
        type: Number,
        default: 3500,
        min: [0, "Exchange rate must be positive"],
      }, // VNĐ/CNY
      buyingServiceFeeRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 1,
      }, // 0–1 (e.g. 0.05 = 5%)
      shippingRatePerKg: {
        type: Number,
        default: 0,
        min: 0,
      }, // VNĐ/kg
      shippingRatePerM3: {
        type: Number,
        default: 0,
        min: 0,
      }, // VNĐ/m³ (alternative)
      useVolumetricShipping: {
        type: Boolean,
        default: true,
      }, // áp dụng cước theo chargeable weight
    },
    // Tổng cân nặng sau khi đóng gói (kg) — dùng để tính cước vận chuyển
    totalWeightKg: {
      type: Number,
      default: 0,
      min: [0, "Total weight cannot be negative"],
    },
    // Chi phí cố định của đơn hàng
    fixedCosts: {
      cnDomesticShippingCny: { type: Number, default: 0, min: 0 }, // Ship nội TQ (CNY)
      packagingCostVnd:      { type: Number, default: 0, min: 0 }, // Đóng gỗ/bảo hiểm (VNĐ)
      vnDomesticShippingVnd: { type: Number, default: 0, min: 0 }, // Ship nội VN (VNĐ)
    },
    // =================================================================
    // TOTALS (tính tự động)
    // =================================================================
    totalAmount: {
      type: Number,
      required: [true, "Total amount is required"],
      min: [0, "Total amount cannot be negative"],
      default: 0,
    }, // Tổng tiền hàng (VNĐ)
    shippingCost: {
      type: Number,
      default: 0,
      min: [0, "Shipping cost cannot be negative"],
    }, // Cước vận chuyển QT (VNĐ, computed)
    taxAmount: {
      type: Number,
      default: 0,
      min: [0, "Tax amount cannot be negative"],
    }, // Thuế NK (nếu có)
    otherCost: {
      type: Number,
      default: 0,
      min: [0, "Other cost cannot be negative"],
    }, // Chi phí khác thủ công
    finalAmount: {
      type: Number,
      required: [true, "Final amount is required"],
      min: [0, "Final amount cannot be negative"],
      default: 0,
    }, // Tổng cộng tất cả
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
    completedAt: {
      type: Date,
      default: null,
      description: "Ngày PO được đánh dấu COMPLETED — dùng cho dashboard cost analysis",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Indexes for performance
purchaseOrderSchema.index({ supplierId: 1, status: 1 });
purchaseOrderSchema.index({ status: 1, createdAt: -1 });
purchaseOrderSchema.index({ expectedDeliveryDate: 1 });
purchaseOrderSchema.index({ createdBy: 1, createdAt: -1 });

// Auto-calculate totalAmount and finalAmount before save
// Stage 1 (PENDING_APPROVAL, ORDERED): totalAmount + buyingFee only
// Stage 2 (COMPLETED): full landed cost with shipping, fixed costs, tax, other
purchaseOrderSchema.pre("save", async function () {
  const rate = this.importConfig?.exchangeRate || 3500;

  // Calculate total goods amount from items
  if (this.items && this.items.length > 0) {
    this.totalAmount = this.items.reduce((sum, item) => {
      const priceVnd =
        item.unitPriceCny > 0 ? item.unitPriceCny * rate : item.unitPrice;
      item.unitPrice  = priceVnd;
      item.totalPrice = item.quantity * priceVnd;
      return sum + item.totalPrice;
    }, 0);
  }

  const buyingFeeVnd = (this.totalAmount || 0) * (this.importConfig?.buyingServiceFeeRate || 0);

  const isStage2 = ["COMPLETED", "Completed"].includes(this.status);

  if (isStage2 && this.totalWeightKg > 0 && this.importConfig?.shippingRatePerKg > 0) {
    this.shippingCost = this.totalWeightKg * this.importConfig.shippingRatePerKg;
  } else {
    this.shippingCost = this.shippingCost ?? 0;
  }

  const cnDomesticVnd = (this.fixedCosts?.cnDomesticShippingCny || 0) * rate;
  const packagingVnd  = this.fixedCosts?.packagingCostVnd  || 0;
  const vnDomesticVnd = this.fixedCosts?.vnDomesticShippingVnd || 0;

  if (isStage2) {
    this.finalAmount =
      (this.totalAmount  || 0) +
      (this.shippingCost || 0) +
      (this.taxAmount    || 0) +
      (this.otherCost    || 0) +
      cnDomesticVnd +
      packagingVnd  +
      vnDomesticVnd +
      buyingFeeVnd;
  } else {
    this.finalAmount = (this.totalAmount || 0) + buyingFeeVnd;
  }
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
