import { SellerWallet, SellerWalletTransaction } from "../models/SellerWallet.js";
import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { getSellerBalance, getSellerWalletTransactions } from "../services/dashboard.service.js";

/**
 * @desc    Lấy lịch sử giao dịch ví của seller
 * @route   GET /api/finance/transactions
 * @access  Private (Seller)
 * @query   limit, skip, type, search
 */
export const getTransactions = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const { limit = 10, skip = 0, type, search } = req.query;

  // Map FE type filter sang DB type
  const typeMap = {
    deposit: "deposit",
    withdraw: "payout",
    convert_rp: "reward_point_withdrawal",
    earning: "order_payment",
    refund: "order_refund",
  };
  const dbType = typeMap[type] || type;

  const result = await getSellerWalletTransactions(
    sellerId,
    parseInt(limit),
    parseInt(skip),
    { type: dbType, search }
  );

  // Map DB type sang FE type để FE hiển thị đúng
  const dbToFeTypeMap = {
    deposit: "deposit",
    payout: "withdraw",
    reward_point_withdrawal: "convert_rp",
    order_payment: "earning",
    order_refund: "refund",
    admin_adjustment: "deposit",
    platform_fee: "refund",
    pending_release: "deposit",
  };
  const transformedTransactions = (result.transactions || []).map((t) => ({
    ...t,
    type: dbToFeTypeMap[t.type] || t.type,
  }));

  res.status(200).json({
    success: true,
    data: {
      data: transformedTransactions,
      total: result.total || 0,
    },
  });
});

/**
 * @desc    Chuyển số dư ví thành Reward Point cho chính seller
 * @route   POST /api/finance/convert-rp
 * @access  Private (Seller)
 * @body    { amount }
 */
export const convertToRewardPoints = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const sellerId = req.user._id;

  // Validate
  if (!amount || amount <= 0) {
    throw new ErrorResponse("Số tiền chuyển đổi phải lớn hơn 0", 400);
  }
  if (amount < 10000) {
    throw new ErrorResponse("Số tiền chuyển đổi tối thiểu là 10,000 VND", 400);
  }

  // Tỷ lệ: 1 VND = 1 RP
  const rewardPointAmount = Math.floor(amount);

  // Lấy số dư từ service
  const balanceInfo = await getSellerBalance(sellerId);
  const availableBalance = balanceInfo.availableBalance || 0;

  // Kiểm tra đủ số dư
  if (availableBalance < amount) {
    throw new ErrorResponse(
      `Số dư khả dụng không đủ. Khả dụng: ${availableBalance.toLocaleString()} VND, Yêu cầu: ${amount.toLocaleString()} VND`,
      400
    );
  }

  const session = await SellerWallet.startSession();
  try {
    session.startTransaction();

    // Tìm hoặc tạo ví
    let wallet = await SellerWallet.findOne({ sellerId }).session(session);
    if (!wallet) {
      wallet = await SellerWallet.create(
        [{ sellerId, balance: 0, pendingBalance: 0, totalConvertedToRP: 0 }],
        { session }
      );
      wallet = wallet[0];
    }

    // Tính balance mới
    const balanceBefore = wallet.balance || 0;
    const balanceAfter = balanceBefore - amount;
    const newTotalConverted = (wallet.totalConvertedToRP || 0) + amount;

    // Cập nhật balance trong ví
    wallet.balance = balanceAfter;
    wallet.totalConvertedToRP = newTotalConverted;
    await wallet.save({ session });

    // Ghi transaction lịch sử
    const transaction = await SellerWalletTransaction.create(
      [
        {
          sellerId,
          type: "reward_point_withdrawal",
          amount: -amount,
          balanceBefore,
          balanceAfter,
          description: `Chuyển ${amount.toLocaleString()} VND → ${rewardPointAmount.toLocaleString()} RP`,
          status: "completed",
          reference: {},
          metadata: {
            rewardPointAmount,
          },
        },
      ],
      { session }
    );

    // Cộng RP cho chính seller
    await User.updateOne(
      { _id: sellerId },
      { $inc: { reward_point: rewardPointAmount } },
      { session }
    );

    await session.commitTransaction();

    console.log(
      `[Finance] Convert to RP: Seller ${sellerId} | ` +
        `-${amount.toLocaleString()} VND | +${rewardPointAmount.toLocaleString()} RP | ` +
        `Balance: ${balanceBefore} → ${balanceAfter}`
    );

    res.status(200).json({
      success: true,
      data: {
        transactionId: transaction[0]._id,
        amount,
        rewardPoints: rewardPointAmount,
        balanceAfter,
        balanceBefore,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});
