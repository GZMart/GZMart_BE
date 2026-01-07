import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    orderNumber: {
      type: String,
      unique: true,
      required: [true, 'Order number is required'],
    },
    // Order Status: pending, processing, shipped, delivered, delivered_pending_confirmation, completed, cancelled, refunded, refund_pending, under_investigation
    status: {
      type: String,
      enum: {
        values: [
          'pending',
          'processing',
          'shipped',
          'delivered',
          'delivered_pending_confirmation',
          'completed',
          'cancelled',
          'refunded',
          'refund_pending',
          'under_investigation',
        ],
        message: '{VALUE} is not a valid order status',
      },
      default: 'pending',
      index: true,
    },

    // Pricing
    subtotal: {
      type: Number,
      required: [true, 'Subtotal is required'],
      min: [0, 'Subtotal cannot be negative'],
    },
    shippingCost: {
      type: Number,
      default: 0,
      min: [0, 'Shipping cost cannot be negative'],
    },
    tax: {
      type: Number,
      default: 0,
      min: [0, 'Tax cannot be negative'],
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
    },
    totalPrice: {
      type: Number,
      required: [true, 'Total price is required'],
      min: [0, 'Total price cannot be negative'],
    },
    discountCode: {
      type: String,
    },

    // Shipping
    shippingAddress: {
      type: String,
      required: [true, 'Shipping address is required'],
    },
    shippingMethod: {
      type: String,
      enum: {
        values: ['standard', 'express', 'next_day', 'store'],
        message: '{VALUE} is not a valid shipping method',
      },
      default: 'standard',
    },
    trackingNumber: {
      type: String,
    },
    estimatedDelivery: {
      type: Date,
    },
    shipperId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    assignedAt: {
      type: Date,
    },

    // Payment
    paymentMethod: {
      type: String,
      enum: {
        values: ['vnpay', 'cash_on_delivery', 'payos'],
        message: '{VALUE} is not a valid payment method',
      },
      required: [true, 'Payment method is required'],
    },
    paymentStatus: {
      type: String,
      enum: {
        values: ['pending', 'paid', 'failed', 'refunded', 'refund_pending'],
        message: '{VALUE} is not a valid payment status',
      },
      default: 'pending',
      index: true,
    },
    paymentDate: {
      type: Date,
    },

    // VNPay Fields
    transactionId: {
      type: String,
    },
    vnpResponseCode: {
      type: String,
    },
    vnpTxnRef: {
      type: String,
    },
    vnpAmount: {
      type: Number,
    },
    vnpBankCode: {
      type: String,
    },
    vnpPayDate: {
      type: String,
    },
    vnpTransactionNo: {
      type: String,
    },

    // PayOS Fields
    payosOrderCode: {
      type: String,
    },
    payosPaymentLinkId: {
      type: String,
    },
    payosCheckoutUrl: {
      type: String,
    },
    payosQrCode: {
      type: String,
    },
    payosAccountNumber: {
      type: String,
    },
    payosAccountName: {
      type: String,
    },
    payosBin: {
      type: String,
    },
    payosReference: {
      type: String,
    },
    payosTransactionDateTime: {
      type: String,
    },
    payosCurrency: {
      type: String,
    },
    payosCode: {
      type: String,
    },
    payosDesc: {
      type: String,
    },
    payosCounterAccountBankId: {
      type: String,
    },
    payosCounterAccountBankName: {
      type: String,
    },
    payosCounterAccountName: {
      type: String,
    },
    payosCounterAccountNumber: {
      type: String,
    },
    payosVirtualAccountName: {
      type: String,
    },
    payosVirtualAccountNumber: {
      type: String,
    },
    payosChecksum: {
      type: String,
    },

    // Refund
    refundedAt: {
      type: Date,
    },
    refundReason: {
      type: String,
    },
    refundAmount: {
      type: Number,
    },
    refundTransactionNo: {
      type: String,
    },
    refundResponseCode: {
      type: String,
    },
    refundError: {
      type: String,
    },
    refundAttemptedAt: {
      type: Date,
    },

    // Cancellation
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
    },

    // Order Items
    items: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OrderItem',
      },
    ],

    // Additional Info
    notes: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    autoCompleteDueAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    customerConfirmedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
orderSchema.index({ userId: 1, status: 1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ paymentStatus: 1 });

// Auto-generate orderNumber before saving
orderSchema.pre('save', async function (next) {
  if (!this.orderNumber) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    this.orderNumber = `ORD-${timestamp}-${random}`;
  }
  next();
});

const Order = mongoose.model('Order', orderSchema);

export default Order;
