import mongoose from "mongoose";

/**
 * WalletTransaction Model
 * Track all coin/wallet transactions for users
 */
const walletTransactionSchema = new mongoose.Schema(
  {
    // User whose wallet is affected
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Transaction type
    type: {
      type: String,
      enum: [
        "refund", // Refund from return request
        "purchase", // Coin deduction from purchase
        "reward", // Reward points earned
        "admin_adjustment", // Manual admin adjustment
        "promotion", // Promotional bonus
        "withdrawal", // User withdrawal (future feature)
      ],
      required: true,
      index: true,
    },

    // Amount (positive = credit, negative = debit)
    amount: {
      type: Number,
      required: true,
      description:
        "Positive for credit (add coins), negative for debit (subtract coins)",
    },

    // Balance after transaction
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    // Balance before transaction
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },

    // Transaction description
    description: {
      type: String,
      required: true,
    },

    // Reference to related documents
    reference: {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
      returnRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ReturnRequest",
      },
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },

    // Transaction status
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "reversed"],
      default: "completed",
      index: true,
    },

    // Metadata
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      description: "Additional data like refund details, order number, etc.",
    },

    // For refunds: original payment info
    originalPayment: {
      method: String,
      amount: Number,
      transactionId: String,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, status: 1 });
walletTransactionSchema.index({ "reference.orderId": 1 });
walletTransactionSchema.index({ "reference.returnRequestId": 1 });

// Virtual: Transaction direction
walletTransactionSchema.virtual("direction").get(function () {
  return this.amount >= 0 ? "credit" : "debit";
});

// Static method: Record transaction and update user balance
walletTransactionSchema.statics.recordTransaction = async function (data) {
  const User = mongoose.model("User");
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Get user
    const user = await User.findById(data.userId).session(session);
    if (!user) {
      throw new Error("User not found");
    }

    const balanceBefore = user.reward_point || 0;
    const balanceAfter = balanceBefore + data.amount;

    // Validate: balance cannot go negative
    if (balanceAfter < 0) {
      throw new Error(
        `Insufficient balance. Current: ${balanceBefore}, Required: ${Math.abs(data.amount)}`,
      );
    }

    // Create transaction record
    const transaction = await this.create(
      [
        {
          userId: data.userId,
          type: data.type,
          amount: data.amount,
          balanceBefore,
          balanceAfter,
          description: data.description,
          reference: data.reference || {},
          status: "completed",
          metadata: data.metadata || {},
          originalPayment: data.originalPayment || {},
        },
      ],
      { session },
    );

    // Update user balance
    user.reward_point = balanceAfter;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[WalletTransaction] Recorded: User ${user.email} | ${data.type} | ${data.amount} coins | Balance: ${balanceBefore} → ${balanceAfter}`,
    );

    return transaction[0];
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[WalletTransaction] Error:", error);
    throw error;
  }
};

// Static method: Calculate user total earned/spent
walletTransactionSchema.statics.getUserStats = async function (userId) {
  const stats = await this.aggregate([
    {
      $match: { userId: mongoose.Types.ObjectId(userId), status: "completed" },
    },
    {
      $group: {
        _id: null,
        totalEarned: {
          $sum: {
            $cond: [{ $gt: ["$amount", 0] }, "$amount", 0],
          },
        },
        totalSpent: {
          $sum: {
            $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0],
          },
        },
        transactionCount: { $sum: 1 },
      },
    },
  ]);

  return stats[0] || { totalEarned: 0, totalSpent: 0, transactionCount: 0 };
};

const WalletTransaction = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema,
);

export default WalletTransaction;
