import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
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
      default: 'pending',
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
    tax: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    discountCode: {
      type: String,
    },
    paymentMethod: {
      type: String,
      required: true,
      enum: ['vnpay', 'cash_on_delivery', 'payos'],
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'refund_pending'],
      default: 'pending',
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
      ref: 'User', // Assuming shipper is a User
    },
    assignedAt: Date,
    autoCompleteDueAt: Date,
    completedAt: Date,
    customerConfirmedAt: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export default mongoose.model('Order', orderSchema);
