import Coin from "../models/Coin.js";
import WalletTransaction from "../models/WalletTransaction.js";
import User from "../models/User.js";
import mongoose from "mongoose";

/**
 * Coin Service
 * Handles all coin-related operations with expiration tracking
 */

/**
 * Add coins to user's wallet
 * @param {Object} data - { userId, source, amount, description, sourceTransaction, metadata }
 * @returns {Object} - Created coin packet and updated balance
 */
export const addCoins = async (data) => {
  const { userId, source, amount, description, sourceTransaction, metadata } =
    data;

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Get user
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new Error("User not found");
    }

    const balanceBefore = user.reward_point || 0;

    // Create coin packet
    const coinPacket = await Coin.createCoinPacket({
      userId,
      source,
      amount,
      description,
      sourceTransaction,
      metadata,
    });

    // Record wallet transaction
    const transaction = await WalletTransaction.create(
      [
        {
          userId,
          type: source,
          amount,
          balanceBefore,
          balanceAfter: balanceBefore + amount,
          description,
          reference: sourceTransaction || {},
          status: "completed",
          metadata: {
            ...metadata,
            coinPacketId: coinPacket._id,
            expiresAt: coinPacket.expiresAt,
          },
        },
      ],
      { session },
    );

    // Update user's reward_point balance
    user.reward_point = balanceBefore + amount;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[CoinService] Added ${amount} coins to user ${user.email} | Source: ${source} | Balance: ${balanceBefore} → ${user.reward_point}`,
    );

    return {
      success: true,
      coinPacket,
      transaction: transaction[0],
      balance: {
        before: balanceBefore,
        after: user.reward_point,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[CoinService] Error adding coins:", error);
    throw error;
  }
};

/**
 * Deduct coins from user's wallet (FIFO)
 * @param {Object} data - { userId, amount, description, reference }
 * @returns {Object} - Deduction result and updated balance
 */
export const deductCoins = async (data) => {
  const { userId, amount, description, reference } = data;

  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // Get user
    const user = await User.findById(userId).session(session);
    if (!user) {
      throw new Error("User not found");
    }

    const balanceBefore = user.reward_point || 0;

    // Check if user has enough coins
    if (balanceBefore < amount) {
      throw new Error(
        `Insufficient coins. Required: ${amount}, Available: ${balanceBefore}`,
      );
    }

    // Deduct coins using FIFO
    const deductionResult = await Coin.deductCoins(userId, amount);

    // Record wallet transaction
    const transaction = await WalletTransaction.create(
      [
        {
          userId,
          type: "purchase",
          amount: -amount, // Negative for debit
          balanceBefore,
          balanceAfter: balanceBefore - amount,
          description,
          reference: reference || {},
          status: "completed",
          metadata: {
            packetsUsed: deductionResult.packetsUsed,
          },
        },
      ],
      { session },
    );

    // Update user's reward_point balance
    user.reward_point = balanceBefore - amount;
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(
      `[CoinService] Deducted ${amount} coins from user ${user.email} | Balance: ${balanceBefore} → ${user.reward_point}`,
    );

    return {
      success: true,
      deducted: amount,
      packetsUsed: deductionResult.packetsUsed,
      transaction: transaction[0],
      balance: {
        before: balanceBefore,
        after: user.reward_point,
      },
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("[CoinService] Error deducting coins:", error);
    throw error;
  }
};

/**
 * Get user's coin balance and breakdown
 * @param {String} userId
 * @returns {Object} - Balance, packets, expiring soon, etc.
 */
export const getUserCoinBalance = async (userId) => {
  try {
    // Get total balance
    const balanceInfo = await Coin.getUserBalance(userId);

    // Get all active coin packets
    const activePackets = await Coin.find({
      userId,
      status: "active",
      remainingAmount: { $gt: 0 },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    })
      .sort({ expiresAt: 1, createdAt: 1 })
      .lean();

    // Group by source
    const groupedBySource = activePackets.reduce((acc, packet) => {
      if (!acc[packet.source]) {
        acc[packet.source] = { amount: 0, packets: 0 };
      }
      acc[packet.source].amount += packet.remainingAmount;
      acc[packet.source].packets += 1;
      return acc;
    }, {});

    // Get coins expiring soon (within 7 days)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const expiringSoon = await Coin.find({
      userId,
      status: "active",
      expiresAt: {
        $lte: futureDate,
        $gt: new Date(),
      },
    })
      .sort({ expiresAt: 1 })
      .lean();

    const expiringSoonTotal = expiringSoon.reduce(
      (sum, packet) => sum + packet.remainingAmount,
      0,
    );

    // Get never-expiring coins (from refunds)
    const neverExpiring = activePackets.filter((p) => !p.expiresAt);
    const neverExpiringTotal = neverExpiring.reduce(
      (sum, packet) => sum + packet.remainingAmount,
      0,
    );

    return {
      totalBalance: balanceInfo.balance,
      totalPackets: balanceInfo.packets,
      breakdown: {
        bySource: groupedBySource,
        neverExpiring: {
          amount: neverExpiringTotal,
          packets: neverExpiring.length,
        },
        expiringSoon: {
          amount: expiringSoonTotal,
          packets: expiringSoon.length,
          details: expiringSoon.map((p) => ({
            amount: p.remainingAmount,
            expiresAt: p.expiresAt,
            daysLeft: Math.ceil(
              (p.expiresAt - new Date()) / (1000 * 60 * 60 * 24),
            ),
            source: p.source,
            description: p.description,
          })),
        },
      },
      activePackets,
    };
  } catch (error) {
    console.error("[CoinService] Error getting balance:", error);
    throw error;
  }
};

/**
 * Get user's coin transaction history
 * @param {String} userId
 * @param {Object} options - { skip, limit, type, startDate, endDate }
 * @returns {Array} - Transaction history
 */
export const getCoinTransactionHistory = async (userId, options = {}) => {
  const { skip = 0, limit = 20, type, startDate, endDate } = options;

  try {
    const query = { userId };

    if (type) {
      query.type = type;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("reference.orderId", "orderNumber")
        .populate("reference.returnRequestId", "requestNumber")
        .lean(),
      WalletTransaction.countDocuments(query),
    ]);

    return {
      transactions,
      pagination: {
        total,
        skip,
        limit,
        page: Math.floor(skip / limit) + 1,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    console.error("[CoinService] Error getting transaction history:", error);
    throw error;
  }
};

/**
 * Get user's coin statistics
 * @param {String} userId
 * @returns {Object} - Stats (total earned, spent, etc.)
 */
export const getUserCoinStats = async (userId) => {
  try {
    const [walletStats, coinPackets] = await Promise.all([
      WalletTransaction.getUserStats(userId),
      Coin.find({ userId }).lean(),
    ]);

    // Calculate from coin packets
    const activeCoins = coinPackets.filter((p) => p.status === "active");
    const expiredCoins = coinPackets.filter((p) => p.status === "expired");
    const depletedCoins = coinPackets.filter((p) => p.status === "depleted");

    const totalExpired = expiredCoins.reduce(
      (sum, p) => sum + p.remainingAmount,
      0,
    );

    return {
      ...walletStats,
      totalExpired,
      packets: {
        active: activeCoins.length,
        expired: expiredCoins.length,
        depleted: depletedCoins.length,
        total: coinPackets.length,
      },
    };
  } catch (error) {
    console.error("[CoinService] Error getting stats:", error);
    throw error;
  }
};

/**
 * Expire old coins (called by cron job)
 * @returns {Object} - Expiration result
 */
export const expireOldCoins = async () => {
  try {
    const result = await Coin.expireOldCoins();

    // If coins were expired, sync user balances
    if (result.modifiedCount > 0) {
      await syncUserBalances();
    }

    console.log(`[CoinService] Expired ${result.modifiedCount} coin packets`);

    return {
      success: true,
      expiredCount: result.modifiedCount,
    };
  } catch (error) {
    console.error("[CoinService] Error expiring coins:", error);
    throw error;
  }
};

/**
 * Sync user balances with actual coin packets
 * (In case of any inconsistencies)
 */
export const syncUserBalances = async () => {
  try {
    const users = await User.find({}).lean();

    let syncedCount = 0;

    for (const user of users) {
      const balanceInfo = await Coin.getUserBalance(user._id);
      const actualBalance = balanceInfo.balance;

      if (user.reward_point !== actualBalance) {
        await User.findByIdAndUpdate(user._id, {
          reward_point: actualBalance,
        });
        console.log(
          `[CoinService] Synced balance for user ${user.email}: ${user.reward_point} → ${actualBalance}`,
        );
        syncedCount++;
      }
    }

    console.log(`[CoinService] Synced ${syncedCount} user balances`);

    return { success: true, syncedCount };
  } catch (error) {
    console.error("[CoinService] Error syncing balances:", error);
    throw error;
  }
};

/**
 * Send expiration notifications
 * @param {Number} days - Days before expiration to notify
 * @returns {Object} - Notification result
 */
export const sendExpirationNotifications = async (days = 3) => {
  try {
    const expiringSoon = await Coin.getExpiringSoon(days);

    let notificationsSent = 0;

    for (const coinPacket of expiringSoon) {
      // TODO: Implement actual notification sending (email, push, etc.)
      // For now, just mark as notified
      coinPacket.expirationNotificationSent = true;
      await coinPacket.save();

      console.log(
        `[CoinService] Notification sent to ${coinPacket.userId.email}: ${coinPacket.remainingAmount} coins expiring on ${coinPacket.expiresAt}`,
      );

      notificationsSent++;
    }

    console.log(
      `[CoinService] Sent ${notificationsSent} expiration notifications`,
    );

    return {
      success: true,
      notificationsSent,
    };
  } catch (error) {
    console.error("[CoinService] Error sending notifications:", error);
    throw error;
  }
};

export default {
  addCoins,
  deductCoins,
  getUserCoinBalance,
  getCoinTransactionHistory,
  getUserCoinStats,
  expireOldCoins,
  syncUserBalances,
  sendExpirationNotifications,
};
