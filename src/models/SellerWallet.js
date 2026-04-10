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
        "order_payment", // Thu nhập từ đơn hàng hoàn thành
        "order_refund", // Hoàn tiền từ đơn hàng bị hủy/refund
        "payout", // Rút tiền (khấu trừ khỏi số dư)
        "admin_adjustment", // Điều chỉnh thủ công bởi admin
        "platform_fee", // Phí nền tảng
        "pending_release", // Tiền chờ giải ngân (hold)
        "reward_point_withdrawal", // Rút balance thành reward_point
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
  },
);

// Index để query nhanh
sellerWalletTransactionSchema.index({ sellerId: 1, createdAt: -1 });
sellerWalletTransactionSchema.index({ sellerId: 1, type: 1, status: 1 });

// Virtual: hướng giao dịch (credit/debit)
sellerWalletTransactionSchema.virtual("direction").get(function () {
  return this.amount >= 0 ? "credit" : "debit";
});

// Static: Ghi giao dịch và cập nhật số dư seller (atomic)
sellerWalletTransactionSchema.statics.recordTransaction = async function (
  data,
  session = null,
) {
  const SellerWallet = mongoose.model("SellerWallet");

  const queryOptions = session ? { session } : {};

  // Tìm hoặc tạo ví cho seller
  let wallet = await SellerWallet.findOne({ sellerId: data.sellerId }).session(
    session || null,
  );
  if (!wallet) {
    wallet = await SellerWallet.create(
      [
        {
          sellerId: data.sellerId,
          balance: 0,
          pendingBalance: 0,
          totalEarning: 0,
          totalPayout: 0,
        },
      ],
      queryOptions,
    );
    wallet = wallet[0];
  }

  const balanceBefore = wallet.balance;
  const balanceAfter = balanceBefore + data.amount;

  // Kiểm tra số dư không âm
  if (balanceAfter < 0) {
    throw new Error(
      `Số dư không đủ. Hiện tại: ${balanceBefore.toLocaleString()} VND, Cần: ${Math.abs(data.amount).toLocaleString()} VND`,
    );
  }

  // Tạo bản ghi giao dịch
  const transaction = await this.create(
    [
      {
        sellerId: data.sellerId,
        type: data.type,
        amount: data.amount,
        balanceBefore,
        balanceAfter,
        description: data.description,
        status: data.status || "completed",
        reference: data.reference || {},
        metadata: data.metadata || {},
      },
    ],
    queryOptions,
  );

  // Cập nhật số dư ví
  const updateData = {
    balance: balanceAfter,
  };

  // Cập nhật pendingBalance nếu là giao dịch pending
  if (data.type === "pending_release" || data.status === "pending") {
    updateData.pendingBalance = (wallet.pendingBalance || 0) + data.amount;
  }

  // Cập nhật tổng thu nhập/rút tiền
  if (
    data.amount > 0 &&
    data.type !== "payout" &&
    data.type !== "admin_adjustment"
  ) {
    updateData.totalEarning = (wallet.totalEarning || 0) + data.amount;
  }
  if (data.type === "payout") {
    updateData.totalPayout = (wallet.totalPayout || 0) + Math.abs(data.amount);
  }

  await SellerWallet.updateOne(
    { _id: wallet._id },
    { $set: updateData },
    queryOptions,
  );

  console.log(
    `[SellerWallet] Transaction: Seller ${data.sellerId} | ${data.type} | ` +
      `${data.amount >= 0 ? "+" : ""}${data.amount.toLocaleString()} VND | ` +
      `Số dư: ${balanceBefore.toLocaleString()} → ${balanceAfter.toLocaleString()} VND`,
  );

  return transaction[0];
};

// Static: Lấy thông tin số dư của seller
sellerWalletTransactionSchema.statics.getSellerWallet = async function (
  sellerId,
) {
  const SellerWallet = mongoose.model("SellerWallet");

  let wallet = await SellerWallet.findOne({ sellerId }).lean();
  if (!wallet) {
    // Tạo ví mới nếu chưa có
    wallet = await SellerWallet.create({
      sellerId,
      balance: 0,
      pendingBalance: 0,
      pendingWithdrawal: 0,
      totalEarning: 0,
      totalPayout: 0,
    });
    wallet = wallet.toObject();
  }

  return wallet;
};

// Static: Lấy lịch sử giao dịch
sellerWalletTransactionSchema.statics.getTransactionHistory = async function (
  sellerId,
  limit = 20,
  skip = 0,
  filters = {},
) {
  const { type, search } = filters;
  const query = { sellerId };

  // Filter theo type
  if (type) {
    query.type = type;
  }

  // Filter theo search (mã giao dịch / description)
  if (search) {
    query.$or = [
      { _id: new RegExp(search, "i") },
      { description: new RegExp(search, "i") },
    ];
  }

  const [transactions, total] = await Promise.all([
    this.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("reference.orderId", "orderNumber status")
      .lean(),
    this.countDocuments(query),
  ]);

  return { transactions, total };
};

// Static: Lấy lịch sử rút reward_point
sellerWalletTransactionSchema.statics.getRewardPointWithdrawals =
  async function (sellerId, limit = 20, skip = 0) {
    const transactions = await this.find({
      sellerId,
      type: "reward_point_withdrawal",
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await this.countDocuments({
      sellerId,
      type: "reward_point_withdrawal",
    });

    return { transactions, total };
  };

// Static: Tạo yêu cầu rút reward_point (tạo pending withdrawal)
sellerWalletTransactionSchema.statics.createRewardPointWithdrawalRequest =
  async function (data) {
    const User = mongoose.model("User");
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      // Lấy ví và kiểm tra số dư
      const SellerWallet = mongoose.model("SellerWallet");
      const wallet = await SellerWallet.findOne({
        sellerId: data.sellerId,
      }).session(session);
      if (!wallet) {
        throw new Error("Wallet not found");
      }

      const availableBalance = wallet.balance - (wallet.pendingBalance || 0);
      if (availableBalance < data.amount) {
        throw new Error(
          `Số dư khả dụng không đủ. Khả dụng: ${availableBalance.toLocaleString()} VND, Yêu cầu: ${data.amount.toLocaleString()} VND`,
        );
      }

      const balanceBefore = wallet.balance;
      const balanceAfter = balanceBefore - data.amount;

      // Tạo bản ghi withdrawal (pending)
      const transaction = await this.create(
        [
          {
            sellerId: data.sellerId,
            type: "reward_point_withdrawal",
            amount: -data.amount,
            balanceBefore,
            balanceAfter,
            description: `Yêu cầu rút ${data.amount.toLocaleString()} VND → ${data.rewardPointAmount.toLocaleString()} Reward Points (${data.conversionRate || 1} VND = 1 RP)`,
            status: "pending",
            reference: {
              payoutId: data.payoutId,
            },
            metadata: {
              rewardPointAmount: data.rewardPointAmount,
              conversionRate: data.conversionRate || 1,
              targetUserId: data.targetUserId,
              withdrawalMethod: data.withdrawalMethod || "bank_transfer",
              bankAccount: data.bankAccount || null,
              requestNote: data.requestNote || null,
            },
          },
        ],
        { session },
      );

      // Cập nhật pendingBalance
      await SellerWallet.updateOne(
        { _id: wallet._id },
        {
          $inc: {
            balance: -data.amount,
            pendingWithdrawal: data.amount,
          },
        },
        { session },
      );

      await session.commitTransaction();
      session.endSession();

      console.log(
        `[SellerWallet] Reward Point Withdrawal Request: Seller ${data.sellerId} | ` +
          `-${data.amount.toLocaleString()} VND | +${data.rewardPointAmount.toLocaleString()} RP | Status: pending`,
      );

      return transaction[0];
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[SellerWallet] Error creating withdrawal request:", error);
      throw error;
    }
  };

// Static: Xử lý hoàn tất withdrawal (admin hoặc hệ thống gọi)
sellerWalletTransactionSchema.statics.processRewardPointWithdrawal =
  async function (transactionId, adminId = null, action = "approve") {
    const User = mongoose.model("User");
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      const transaction = await this.findOne({
        _id: transactionId,
        type: "reward_point_withdrawal",
        status: "pending",
      }).session(session);

      if (!transaction) {
        throw new Error("Withdrawal request not found or already processed");
      }

      const SellerWallet = mongoose.model("SellerWallet");
      const wallet = await SellerWallet.findOne({
        sellerId: transaction.sellerId,
      }).session(session);

      if (action === "approve") {
        // Cộng reward_point cho user đích
        const targetUserId = transaction.metadata?.targetUserId;
        if (targetUserId) {
          const targetUser = await User.findById(targetUserId).session(session);
          if (!targetUser) {
            throw new Error("Target user not found");
          }

          const rpBefore = targetUser.reward_point || 0;
          targetUser.reward_point =
            rpBefore + (transaction.metadata?.rewardPointAmount || 0);
          await targetUser.save({ session });

          console.log(
            `[SellerWallet] Reward Points credited: User ${targetUserId} | ` +
              `+${(transaction.metadata?.rewardPointAmount || 0).toLocaleString()} RP | ` +
              `Balance: ${rpBefore} → ${targetUser.reward_point}`,
          );
        }

        // Hoàn tất withdrawal
        transaction.status = "completed";
        transaction.reference = transaction.reference || {};
        transaction.reference.adminId = adminId;
        transaction.metadata = transaction.metadata || {};
        transaction.metadata.processedAt = new Date();
        transaction.metadata.processedBy = adminId;
        await transaction.save({ session });

        // Cập nhật ví: balance đã bị trừ khi tạo request, chỉ cần giảm pendingWithdrawal
        if (wallet) {
          // transaction.amount là âm (-data.amount), nên cộng vào = trừ đi pendingWithdrawal
          wallet.pendingWithdrawal = Math.max(
            0,
            (wallet.pendingWithdrawal || 0) + transaction.amount,
          );
          await wallet.save({ session });
        }

        console.log(
          `[SellerWallet] Withdrawal approved: ${transaction._id} | ` +
            `Seller: ${transaction.sellerId} | Completed`,
        );
      } else if (action === "reject") {
        // Hoàn tiền lại vào ví
        const refundAmount = Math.abs(transaction.amount);
        const balanceBefore = wallet ? wallet.balance : 0;

        if (wallet) {
          wallet.balance += refundAmount;
          wallet.pendingWithdrawal = Math.max(
            0,
            (wallet.pendingWithdrawal || 0) + transaction.amount,
          );
          await wallet.save({ session });
        }

        transaction.status = "rejected";
        transaction.reference = transaction.reference || {};
        transaction.reference.adminId = adminId;
        transaction.metadata = transaction.metadata || {};
        transaction.metadata.processedAt = new Date();
        transaction.metadata.processedBy = adminId;
        transaction.metadata.rejectedReason =
          transaction.metadata?.rejectedReason || "Rejected by admin";
        await transaction.save({ session });

        console.log(
          `[SellerWallet] Withdrawal rejected: ${transaction._id} | ` +
            `Seller: ${transaction.sellerId} | Refunded: +${refundAmount.toLocaleString()} VND`,
        );
      }

      await session.commitTransaction();
      session.endSession();

      return transaction;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[SellerWallet] Error processing withdrawal:", error);
      throw error;
    }
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
    },

    // Tổng số VND đã chuyển thành RP
    totalConvertedToRP: {
      type: Number,
      default: 0,
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

    // Số dư chờ rút (đã request nhưng chưa xử lý)
    pendingWithdrawal: {
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
  },
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
const SellerWalletTransaction = mongoose.model(
  "SellerWalletTransaction",
  sellerWalletTransactionSchema,
);

export { SellerWallet, SellerWalletTransaction };
export default SellerWallet;
