import mongoose from "mongoose";

/**
 * SellerWallet Model - Quản lý số dư và giao dịch tài chính của Seller
 *
 * Số dư Seller được tính toán dựa trên:
 * - Thu nhập từ đơn hàng hoàn thành (completed/delivered)
 * - Hoàn tiền từ đơn hàng bị hủy/trả lại
 * - Trạng thái "pending" cho đơn hàng chưa thanh toán xác nhận
 */
const sellerWalletTransactionSchema = new mongoose.Schema(
  {
    // Seller sở hữu ví
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Loại giao dịch
    type: {
      type: String,
      enum: [
        "order_payment",       // Thu nhập từ đơn hàng hoàn thành
        "order_refund",        // Hoàn tiền từ đơn hàng bị hủy/refund
        "payout",              // Rút tiền (khấu trừ khỏi số dư)
        "admin_adjustment",     // Điều chỉnh thủ công bởi admin
        "platform_fee",         // Phí nền tảng
        "pending_release",      // Tiền chờ giải ngân (hold)
      ],
      required: true,
      index: true,
    },

    // Số tiền (dương = credit, âm = debit)
    amount: {
      type: Number,
      required: true,
    },

    // Số dư sau giao dịch
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    // Số dư trước giao dịch
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },

    // Mô tả giao dịch
    description: {
      type: String,
      required: true,
    },

    // Trạng thái giao dịch
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled"],
      default: "completed",
      index: true,
    },

    // Tham chiếu đến đơn hàng liên quan
    reference: {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
      orderNumber: {
        type: String,
      },
      returnRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ReturnRequest",
      },
      payoutId: {
        type: mongoose.Schema.Types.ObjectId,
      },
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },

    // Metadata bổ sung
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Index để query nhanh
sellerWalletTransactionSchema.index({ sellerId: 1, createdAt: -1 });
sellerWalletTransactionSchema.index({ sellerId: 1, type: 1, status: 1 });

// Virtual: hướng giao dịch (credit/debit)
sellerWalletTransactionSchema.virtual("direction").get(function () {
  return this.amount >= 0 ? "credit" : "debit";
});

// Static: Ghi giao dịch và cập nhật số dư seller (atomic)
sellerWalletTransactionSchema.statics.recordTransaction = async function (data, session = null) {
  const SellerWallet = mongoose.model("SellerWallet");

  const queryOptions = session ? { session } : {};

  // Tìm hoặc tạo ví cho seller
  let wallet = await SellerWallet.findOne({ sellerId: data.sellerId }).session(session || null);
  if (!wallet) {
    wallet = await SellerWallet.create([{
      sellerId: data.sellerId,
      balance: 0,
      pendingBalance: 0,
      totalEarning: 0,
      totalPayout: 0,
    }], queryOptions);
    wallet = wallet[0];
  }

  const balanceBefore = wallet.balance;
  const balanceAfter = balanceBefore + data.amount;

  // Kiểm tra số dư không âm
  if (balanceAfter < 0) {
    throw new Error(
      `Số dư không đủ. Hiện tại: ${balanceBefore.toLocaleString()} VND, Cần: ${Math.abs(data.amount).toLocaleString()} VND`
    );
  }

  // Tạo bản ghi giao dịch
  const transaction = await this.create([{
    sellerId: data.sellerId,
    type: data.type,
    amount: data.amount,
    balanceBefore,
    balanceAfter,
    description: data.description,
    status: data.status || "completed",
    reference: data.reference || {},
    metadata: data.metadata || {},
  }], queryOptions);

  // Cập nhật số dư ví
  const updateData = {
    balance: balanceAfter,
  };

  // Cập nhật pendingBalance nếu là giao dịch pending
  if (data.type === "pending_release" || data.status === "pending") {
    updateData.pendingBalance = (wallet.pendingBalance || 0) + data.amount;
  }

  // Cập nhật tổng thu nhập/rút tiền
  if (data.amount > 0 && data.type !== "payout" && data.type !== "admin_adjustment") {
    updateData.totalEarning = (wallet.totalEarning || 0) + data.amount;
  }
  if (data.type === "payout") {
    updateData.totalPayout = (wallet.totalPayout || 0) + Math.abs(data.amount);
  }

  await SellerWallet.updateOne(
    { _id: wallet._id },
    { $set: updateData },
    queryOptions
  );

  console.log(
    `[SellerWallet] Transaction: Seller ${data.sellerId} | ${data.type} | ` +
    `${data.amount >= 0 ? '+' : ''}${data.amount.toLocaleString()} VND | ` +
    `Số dư: ${balanceBefore.toLocaleString()} → ${balanceAfter.toLocaleString()} VND`
  );

  return transaction[0];
};

// Static: Lấy thông tin số dư của seller
sellerWalletTransactionSchema.statics.getSellerWallet = async function (sellerId) {
  const SellerWallet = mongoose.model("SellerWallet");

  let wallet = await SellerWallet.findOne({ sellerId }).lean();
  if (!wallet) {
    // Tạo ví mới nếu chưa có
    wallet = await SellerWallet.create({
      sellerId,
      balance: 0,
      pendingBalance: 0,
      totalEarning: 0,
      totalPayout: 0,
    });
    wallet = wallet.toObject();
  }

  return wallet;
};

// Static: Lấy lịch sử giao dịch
sellerWalletTransactionSchema.statics.getTransactionHistory = async function (sellerId, limit = 20, skip = 0) {
  const transactions = await this.find({ sellerId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("reference.orderId", "orderNumber status")
    .lean();

  const total = await this.countDocuments({ sellerId });

  return { transactions, total };
};

const sellerWalletSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    // Số dư khả dụng (có thể rút/r chi tiêu)
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Số dư chờ xử lý (đơn hàng pending, refund đang xử lý)
    pendingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Tổng thu nhập từ trước đến nay
    totalEarning: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Tổng số tiền đã rút
    totalPayout: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Trạng thái ví
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: Số dư thực = balance - pendingBalance
sellerWalletSchema.virtual("availableBalance").get(function () {
  return Math.max(0, this.balance - this.pendingBalance);
});

// Virtual: Tổng số dư (balance + pending)
sellerWalletSchema.virtual("totalBalance").get(function () {
  return this.balance;
});

// Index
sellerWalletSchema.index({ sellerId: 1 });

const SellerWallet = mongoose.model("SellerWallet", sellerWalletSchema);
const SellerWalletTransaction = mongoose.model("SellerWalletTransaction", sellerWalletTransactionSchema);

export { SellerWallet, SellerWalletTransaction };
export default SellerWallet;
