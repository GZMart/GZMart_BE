import mongoose from "mongoose";

/**
 * ReturnRequest Model - RMA (Return Merchandise Authorization)
 * Handles both refund (cancel) and exchange requests
 */
const returnRequestSchema = new mongoose.Schema(
  {
    // Reference to original order
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    // User who created the return request
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Request number for tracking
    requestNumber: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },

    // Type of request
    type: {
      type: String,
      enum: ["undetermined", "refund", "exchange"],
      required: true,
      default: "undetermined",
      description:
        "undetermined = buyer chưa chọn loại xử lý, seller sẽ quyết định refund hoặc exchange",
    },

    // Items to be returned/exchanged
    items: [
      {
        orderItemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "OrderItem",
          required: true,
        },
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        productName: String,
        variantName: String,
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: Number,
        // For exchange: new variant requested
        exchangeToVariantId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "InventoryItem",
        },
        exchangeToVariantName: String,
      },
    ],

    // Reason for return
    reason: {
      type: String,
      required: true,
      enum: [
        "wrong_size", // Size không vừa
        "defective", // Sản phẩm lỗi
        "wrong_item", // Gửi sai hàng
        "not_as_described", // Không đúng mô tả
        "damaged_in_shipping", // Hư hỏng trong vận chuyển
        "change_of_mind", // Đổi ý (chỉ trong 24h)
        "other",
      ],
    },

    // Detailed description
    description: {
      type: String,
      required: true,
      minlength: [10, "Mô tả phải ít nhất 10 ký tự"],
      maxlength: [1000, "Mô tả không được quá 1000 ký tự"],
    },

    // Evidence images
    images: [
      {
        type: String,
        description: "URLs to uploaded images showing the issue",
      },
    ],

    // Request status
    status: {
      type: String,
      enum: [
        "pending", // Chờ seller xem xét
        "approved", // Seller chấp nhận
        "rejected", // Seller từ chối
        "items_returned", // Buyer đã gửi hàng về
        "processing", // Đang xử lý (refund hoặc exchange)
        "completed", // Hoàn thành
        "cancelled", // Buyer hủy yêu cầu
      ],
      default: "pending",
      index: true,
    },

    // Seller response
    sellerResponse: {
      respondedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      respondedAt: Date,
      decision: {
        type: String,
        enum: ["approve", "reject", "request_more_info"],
      },
      notes: String,
      rejectionReason: String,
    },

    // Refund details (if type = refund)
    refund: {
      amount: {
        type: Number,
        min: 0,
        description: "Total refund amount in VND",
      },
      coinAmount: {
        type: Number,
        min: 0,
        description: "Coin amount to refund to user wallet",
      },
      refundedAt: Date,
      transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletTransaction",
      },
    },

    // Exchange details (if type = exchange)
    exchange: {
      newOrderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
        description: "New order created for exchange",
      },
      priceDifference: {
        type: Number,
        default: 0,
        description:
          "Price difference if exchange item has different price (positive = buyer pays more)",
      },
      additionalPaymentRequired: {
        type: Boolean,
        default: false,
      },
      exchangedAt: Date,
    },

    // Return shipping info
    returnShipping: {
      trackingNumber: String,
      shippingProvider: String,
      estimatedReturnDate: Date,
      actualReturnDate: Date,
      shippingCost: {
        type: Number,
        default: 0,
        description: "Who pays return shipping depends on reason",
      },
      paidBy: {
        type: String,
        enum: ["buyer", "seller", "split"],
        description:
          "buyer pays if change_of_mind, seller pays if defective/wrong_item",
      },
    },

    // Logistics flow tracking for refund/exchange operations
    logistics: {
      flowType: {
        type: String,
        enum: ["refund", "exchange", null],
        default: null,
      },
      currentStep: {
        type: String,
        default: "buyer_submitted",
      },
      steps: [
        {
          code: String,
          title: String,
          startedAt: Date,
          durationSeconds: {
            type: Number,
            default: null,
            min: 1,
          },
          autoCompleteAt: Date,
          completed: {
            type: Boolean,
            default: false,
          },
          completedAt: Date,
          note: String,
        },
      ],
    },

    // Timeline tracking
    timeline: [
      {
        status: String,
        description: String,
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        role: String,
        notes: String,
      },
    ],

    // Auto-reject if seller doesn't respond
    autoRejectAt: {
      type: Date,
      description: "Auto-approve if seller doesn't respond within 3 days",
    },

    // Business rules validation
    eligibility: {
      isEligible: {
        type: Boolean,
        default: true,
      },
      ineligibilityReason: String,
      orderDeliveredDate: Date,
      daysAfterDelivery: Number,
    },

    // Admin notes (internal)
    adminNotes: String,

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// Indexes for performance
returnRequestSchema.index({ userId: 1, createdAt: -1 });
returnRequestSchema.index({ orderId: 1 });
returnRequestSchema.index({ status: 1, createdAt: -1 });
returnRequestSchema.index({ requestNumber: 1 }, { unique: true });

// Virtual: Calculate refund eligibility
returnRequestSchema.virtual("isRefundEligible").get(function () {
  // Must be within 7 days of delivery for refund
  if (!this.eligibility?.orderDeliveredDate) return false;

  const daysSinceDelivery = this.eligibility.daysAfterDelivery || 0;

  // Strict rules:
  // - change_of_mind: only within 24 hours
  // - defective/wrong_item: within 7 days
  // - other reasons: within 3 days
  if (this.reason === "change_of_mind") {
    return daysSinceDelivery <= 1;
  } else if (
    ["defective", "wrong_item", "damaged_in_shipping"].includes(this.reason)
  ) {
    return daysSinceDelivery <= 7;
  } else {
    return daysSinceDelivery <= 3;
  }
});

// Pre-save: Generate request number (backup, mainly for timeline)
returnRequestSchema.pre("save", async function () {
  if (!this.requestNumber) {
    // Format: RMA-YYYYMMDD-XXXXX
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, "");
    const random = Math.floor(10000 + Math.random() * 90000);
    this.requestNumber = `RMA-${dateStr}-${random}`;
  }

  // Add to timeline
  if (this.isModified("status")) {
    this.timeline.push({
      status: this.status,
      description: `Request status changed to ${this.status}`,
      updatedAt: new Date(),
    });
  }
});

// Static method: Check eligibility
returnRequestSchema.statics.checkEligibility = async function (orderId) {
  const Order = mongoose.model("Order");
  const order = await Order.findById(orderId);

  if (!order) {
    return {
      isEligible: false,
      reason: "Order not found",
    };
  }

  // Check order status
  const eligibleStatuses = ["delivered", "completed"];
  if (!eligibleStatuses.includes(order.status)) {
    return {
      isEligible: false,
      reason: `Order must be delivered or completed. Current status: ${order.status}`,
    };
  }

  // Check if already has pending return request
  const existingRequest = await this.findOne({
    orderId,
    status: { $in: ["pending", "approved", "items_returned", "processing"] },
  });

  if (existingRequest) {
    return {
      isEligible: false,
      reason: `Already has active return request: ${existingRequest.requestNumber}`,
    };
  }

  // Check delivery date
  const deliveredDate = order.customerConfirmedAt || order.completedAt;
  if (!deliveredDate) {
    return {
      isEligible: false,
      reason: "Delivery date not confirmed",
    };
  }

  const daysSinceDelivery = Math.floor(
    (Date.now() - deliveredDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  // General rule: within 7 days
  if (daysSinceDelivery > 7) {
    return {
      isEligible: false,
      reason: `Return period expired. Delivered ${daysSinceDelivery} days ago (max 7 days)`,
    };
  }

  return {
    isEligible: true,
    deliveredDate,
    daysSinceDelivery,
  };
};

const ReturnRequest = mongoose.model("ReturnRequest", returnRequestSchema);

export default ReturnRequest;
