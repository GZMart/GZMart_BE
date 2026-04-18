import mongoose from "mongoose";

/**
 * Coin Model
 * Tracks individual coin packets with expiration dates (like Shopee Coin)
 *
 * Business Rules:
 * - Refund/topup/seller convert coins: No expiration (expiresAt = null)
 * - System coins (rewards, promotions): 14 days expiration
 * - FIFO usage: Coins expiring soonest are used first
 */
const coinSchema = new mongoose.Schema(
  {
    // User who owns this coin packet
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Source of the coins
    source: {
      type: String,
      enum: [
        "refund", // From return/refund - NO EXPIRATION
        "topup", // User tops up coins with real money - NO EXPIRATION
        "seller_convert", // Seller converts VND balance to coins - NO EXPIRATION
        "reward", // From completing orders, reviews, etc. - 14 days
        "promotion", // From promotional campaigns - 14 days
        "admin_grant", // Admin manually granted - 14 days
        "signup_bonus", // New user signup bonus - 14 days
        "referral", // Referral rewards - 14 days
      ],
      required: true,
      index: true,
    },

    // Original amount of coins in this packet
    originalAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    // Remaining amount (decreases as coins are used)
    remainingAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function (v) {
          return v <= this.originalAmount;
        },
        message: "Remaining amount cannot exceed original amount",
      },
    },

    // Expiration date (null = never expires, used for refund coins)
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    // Status
    status: {
      type: String,
      enum: ["active", "expired", "depleted"],
      default: "active",
      index: true,
    },

    // Reference to source transaction
    sourceTransaction: {
      // WalletTransaction that created this coin packet
      transactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "WalletTransaction",
      },
      // Reference to related documents
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Order",
      },
      returnRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ReturnRequest",
      },
    },

    // Description
    description: {
      type: String,
      required: true,
    },

    // Metadata for additional info
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Expiration notification sent
    expirationNotificationSent: {
      type: Boolean,
      default: false,
    },

    // When the coins were expired (if status = expired)
    expiredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
coinSchema.index({ userId: 1, status: 1, expiresAt: 1 });
coinSchema.index({ userId: 1, createdAt: -1 });
coinSchema.index({ expiresAt: 1, status: 1 });

// Virtual: Is this coin packet expired?
coinSchema.virtual("isExpired").get(function () {
  if (!this.expiresAt) return false; // Never expires
  return new Date() > this.expiresAt;
});

// Virtual: Days until expiration
coinSchema.virtual("daysUntilExpiration").get(function () {
  if (!this.expiresAt) return null; // Never expires
  const now = new Date();
  const diff = this.expiresAt - now;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
});

// Pre-save: Auto-update status
coinSchema.pre("save", function () {
  // If remaining amount is 0, mark as depleted
  if (this.remainingAmount === 0 && this.status === "active") {
    this.status = "depleted";
  }

  // If expired, mark as expired
  if (
    this.expiresAt &&
    new Date() > this.expiresAt &&
    this.status === "active"
  ) {
    this.status = "expired";
    this.expiredAt = new Date();
  }
});

// Static method: Create coin packet with auto expiration
coinSchema.statics.createCoinPacket = async function (data) {
  const { userId, source, amount, description, sourceTransaction, metadata } =
    data;

  // Calculate expiration date
  let expiresAt = null;

  // Money-backed sources never expire
  const NON_EXPIRING_SOURCES = new Set(["refund", "topup", "seller_convert"]);
  if (NON_EXPIRING_SOURCES.has(source)) {
    expiresAt = null;
  } else {
    // Other sources: 14 days from now
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);
  }

  const coinPacket = await this.create({
    userId,
    source,
    originalAmount: amount,
    remainingAmount: amount,
    expiresAt,
    description,
    sourceTransaction: sourceTransaction || {},
    metadata: metadata || {},
  });

  console.log(
    `[Coin] Created packet: User ${userId} | ${source} | ${amount} coins | Expires: ${expiresAt ? expiresAt.toISOString() : "Never"}`,
  );

  return coinPacket;
};

// Static method: Get user's available coins (FIFO order - expiring soonest first)
coinSchema.statics.getAvailableCoins = async function (userId) {
  const coins = await this.find({
    userId,
    status: "active",
    remainingAmount: { $gt: 0 },
    $or: [
      { expiresAt: null }, // Never expires
      { expiresAt: { $gt: new Date() } }, // Not yet expired
    ],
  }).sort({
    expiresAt: 1, // Expiring soonest first (null/never expires will be last)
    createdAt: 1, // Oldest first among same expiration
  });

  return coins;
};

// Static method: Get user's total available coin balance
coinSchema.statics.getUserBalance = async function (userId) {
  const result = await this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        status: "active",
        remainingAmount: { $gt: 0 },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      },
    },
    {
      $group: {
        _id: null,
        totalBalance: { $sum: "$remainingAmount" },
        totalPackets: { $sum: 1 },
      },
    },
  ]);

  return result[0]
    ? {
        balance: result[0].totalBalance,
        packets: result[0].totalPackets,
      }
    : { balance: 0, packets: 0 };
};

// Static method: Deduct coins (FIFO - use expiring coins first)
coinSchema.statics.deductCoins = async function (userId, amount) {
  if (amount <= 0) {
    throw new Error("Deduction amount must be positive");
  }

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Get available coins in FIFO order
    const coins = await this.getAvailableCoins(userId);

    let remainingToDeduct = amount;
    const usedPackets = [];

    for (const coin of coins) {
      if (remainingToDeduct <= 0) break;

      const deductFromThis = Math.min(coin.remainingAmount, remainingToDeduct);

      coin.remainingAmount -= deductFromThis;

      if (coin.remainingAmount === 0) {
        coin.status = "depleted";
      }

      await coin.save({ session });

      usedPackets.push({
        packetId: coin._id,
        source: coin.source,
        amountUsed: deductFromThis,
        remainingInPacket: coin.remainingAmount,
      });

      remainingToDeduct -= deductFromThis;
    }

    // Check if user had enough coins
    if (remainingToDeduct > 0) {
      throw new Error(
        `Insufficient coins. Required: ${amount}, Available: ${amount - remainingToDeduct}`,
      );
    }

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[Coin] Deducted ${amount} coins from user ${userId} using ${usedPackets.length} packet(s)`,
    );

    return {
      deducted: amount,
      packetsUsed: usedPackets,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// Static method: Expire old coins (called by cron job)
coinSchema.statics.expireOldCoins = async function () {
  const now = new Date();

  const result = await this.updateMany(
    {
      expiresAt: { $lte: now },
      status: "active",
    },
    {
      $set: {
        status: "expired",
        expiredAt: now,
      },
    },
  );

  console.log(`[Coin] Expired ${result.modifiedCount} coin packets`);

  return result;
};

// Static method: Get coins expiring soon (for notifications)
coinSchema.statics.getExpiringSoon = async function (days = 3) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  const coins = await this.find({
    status: "active",
    expiresAt: {
      $lte: futureDate,
      $gt: new Date(),
    },
    expirationNotificationSent: false,
  }).populate("userId", "email fullName");

  return coins;
};

const Coin = mongoose.model("Coin", coinSchema);

export default Coin;
