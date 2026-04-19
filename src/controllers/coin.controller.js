import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import coinService from "../services/coin.service.js";
import User from "../models/User.js";

/**
 * @desc    Get user's coin balance and breakdown
 * @route   GET /api/coins/balance
 * @access  Private
 */
export const getCoinBalance = asyncHandler(async (req, res, next) => {
  const balanceData = await coinService.getUserCoinBalance(req.user._id);

  res.status(200).json({
    success: true,
    data: balanceData,
  });
});

/**
 * @desc    Get user's coin transaction history
 * @route   GET /api/coins/transactions
 * @access  Private
 */
export const getCoinTransactions = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, type, startDate, endDate } = req.query;

  const skip = (page - 1) * limit;

  const result = await coinService.getCoinTransactionHistory(req.user._id, {
    skip,
    limit: parseInt(limit),
    type,
    startDate,
    endDate,
  });

  res.status(200).json({
    success: true,
    ...result,
  });
});

/**
 * @desc    Get user's coin statistics
 * @route   GET /api/coins/stats
 * @access  Private
 */
export const getCoinStats = asyncHandler(async (req, res, next) => {
  const stats = await coinService.getUserCoinStats(req.user._id);

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Get expiring coins alert
 * @route   GET /api/coins/expiring
 * @access  Private
 */
export const getExpiringCoins = asyncHandler(async (req, res, next) => {
  const { days = 7 } = req.query;

  const balanceData = await coinService.getUserCoinBalance(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      expiringSoon: balanceData.breakdown.expiringSoon,
    },
  });
});

// ==================== ADMIN ENDPOINTS ====================

/**
 * @desc    Grant coins to user (Admin only)
 * @route   POST /api/coins/admin/grant
 * @access  Private/Admin
 */
export const grantCoins = asyncHandler(async (req, res, next) => {
  const {
    userId: bodyUserId,
    userEmail,
    amount,
    description,
    source = "admin_grant",
  } = req.body;

  let userId = bodyUserId;
  if (!userId && userEmail) {
    const email = String(userEmail).trim().toLowerCase();
    const user = await User.findOne({ email }).select("_id");
    if (!user) {
      return next(new ErrorResponse("Không tìm thấy user với email này", 404));
    }
    userId = user._id;
  }

  if (!userId || !amount || !description) {
    return next(
      new ErrorResponse(
        "Cần có email người nhận (userEmail) hoặc userId, amount, description",
        400,
      ),
    );
  }

  if (amount <= 0) {
    return next(new ErrorResponse("Amount must be positive", 400));
  }

  const result = await coinService.addCoins({
    userId,
    source,
    amount,
    description,
    metadata: {
      grantedBy: req.user._id,
      grantedByEmail: req.user.email,
    },
  });

  res.status(200).json({
    success: true,
    message: `Successfully granted ${amount} coins to user`,
    data: result,
  });
});

/**
 * @desc    Manually expire coins (Admin only)
 * @route   POST /api/coins/admin/expire
 * @access  Private/Admin
 */
export const manualExpireCoins = asyncHandler(async (req, res, next) => {
  const result = await coinService.expireOldCoins();

  res.status(200).json({
    success: true,
    message: `Expired ${result.expiredCount} coin packets`,
    data: result,
  });
});

/**
 * @desc    Sync all user balances (Admin only)
 * @route   POST /api/coins/admin/sync
 * @access  Private/Admin
 */
export const syncBalances = asyncHandler(async (req, res, next) => {
  const result = await coinService.syncUserBalances();

  res.status(200).json({
    success: true,
    message: `Synced ${result.syncedCount} user balances`,
    data: result,
  });
});

/**
 * @desc    Send expiration notifications (Admin only)
 * @route   POST /api/coins/admin/notify-expiring
 * @access  Private/Admin
 */
export const notifyExpiringCoins = asyncHandler(async (req, res, next) => {
  const { days = 3 } = req.body;

  const result = await coinService.sendExpirationNotifications(days);

  res.status(200).json({
    success: true,
    message: `Sent ${result.notificationsSent} expiration notifications`,
    data: result,
  });
});

export default {
  getCoinBalance,
  getCoinTransactions,
  getCoinStats,
  getExpiringCoins,
  grantCoins,
  manualExpireCoins,
  syncBalances,
  notifyExpiringCoins,
};
