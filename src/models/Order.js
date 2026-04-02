import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderNumber: {
      type: String,
      unique: true,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "packed",
        "shipped",
        "delivered",
        "completed",
        "cancelled",
        "refunded",
        "refund_pending",
        "under_investigation",
      ],
      default: "pending",
    },
    totalPrice: {
      type: Number,
      required: true,
    },
    subtotal: {
      type: Number,
      required: true,
    },
    shippingAddress: {
      type: String,
      required: true,
    },
    shippingMethod: {
      type: String,
    },
    shippingCost: {
      type: Number,
      default: 0,
    },
    giftBoxFee: {
      type: Number,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: [0, "Discount amount must be non-negative"],
      description:
        "Total discount value from flash sales and coupons in currency units",
    },
    coinUsedAmount: {
      type: Number,
      default: 0,
      min: [0, "Coin used amount must be non-negative"],
      description: "Amount covered by GZCoin before external payment",
    },
    payableBeforeCoin: {
      type: Number,
      default: 0,
      min: [0, "Payable amount before coin must be non-negative"],
      description: "Amount after voucher discount, before coin deduction",
    },
    coinUsageDetails: {
      type: [
        {
          packetId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Coin",
          },
          source: String,
          amountUsed: Number,
          expiresAt: Date,
          remainingInPacket: Number,
        },
      ],
      default: [],
    },
    discountCode: {
      type: String,
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ["vnpay", "cash_on_delivery", "payos"],
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "refund_pending"],
      default: "pending",
    },
    paymentDate: {
      type: Date,
    },
    trackingNumber: {
      type: String,
    },
    estimatedDelivery: {
      type: Date,
    },
    notes: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // ===== Order Tracking (Demo 60s) =====
    trackingCoordinates: {
      seller: {
        lat: Number,
        lng: Number,
        address: String,
      },
      buyer: {
        lat: Number,
        lng: Number,
        address: String,
      },
    },
    shippingStartedAt: Date,
    shippingEstimatedArrival: Date,
    deliveryTimerId: String, // Store setTimeout ID for cleanup if needed
    // ===== VNPay specific =====
    transactionId: String,
    vnpResponseCode: String,
    vnpTxnRef: String,
    vnpAmount: Number,
    vnpBankCode: String,
    vnpPayDate: String,
    vnpTransactionNo: String,

    // ===== PayOS specific =====
    payosOrderCode: String,
    payosPaymentLinkId: String,
    payosCheckoutUrl: String,
    payosQrCode: String,
    payosAccountNumber: String,
    payosAccountName: String,
    payosBin: String,
    payosReference: String,
    payosTransactionDateTime: String,
    payosCurrency: String,
    payosCode: String,
    payosDesc: String,
    payosCounterAccountBankId: String,
    payosCounterAccountBankName: String,
    payosCounterAccountName: String,
    payosCounterAccountNumber: String,
    payosVirtualAccountName: String,
    payosVirtualAccountNumber: String,
    payosChecksum: String,

    // ===== Refund =====
    refundedAt: Date,
    refundReason: String,
    refundAmount: Number,
    refundTransactionNo: String,
    refundResponseCode: String,
    refundError: String,
    refundAttemptedAt: Date,

    // ===== Cancel =====
    cancelledAt: Date,
    cancellationReason: String,

    // ===== Delivery / Shipper =====
    shipperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Assuming shipper is a User
    },
    assignedAt: Date,
    autoCompleteDueAt: Date,
    completedAt: Date,
    customerConfirmedAt: Date,

    // ===== GHN (Giao Hàng Nhanh) Integration =====
    ghnOrderCode: String, // GHN order code
    ghnSortingCode: String, // GHN sorting code
    ghnStatus: String, // Current GHN status
    ghnExpectedDeliveryTime: Date, // Expected delivery time from GHN
    ghnLeadTime: Date, // Lead time from GHN
    ghnShippingFee: Number, // Shipping fee from GHN
    ghnOrderInfo: {
      // Store full GHN order response
      type: mongoose.Schema.Types.Mixed,
    },
    ghnLastUpdate: Date, // Last update from GHN webhook
    ghnLogs: [
      // Track all GHN status changes
      {
        status: String,
        description: String,
        updatedAt: {
          type: Date,
          default: Date.now,
        },
        location: String,
        reason: String,
      },
    ],

    // ===== Order Items & History =====
    items: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "OrderItem",
      },
    ],
    statusHistory: [
      {
        status: String,
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        changedByRole: String,
        changedAt: {
          type: Date,
          default: Date.now,
        },
        reason: String,
        notes: String,
      },
    ],

    // ===== Resource Management =====
    resourcesDeducted: {
      type: Boolean,
      default: false,
      description: "Flag to track if inventory/vouchers have been deducted",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export default mongoose.model("Order", orderSchema);
