import {
  SellerWallet,
  SellerWalletTransaction,
} from "../models/SellerWallet.js";
import Coin from "../models/Coin.js";
import SellerBankAccount from "../models/SellerBankAccount.js";
import TopupRequest from "../models/TopupRequest.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import {
  getSellerBalance,
  getSellerWalletTransactions,
} from "../services/dashboard.service.js";
import User from "../models/User.js";
import paymentService from "../services/payment.service.js";
import {
  payOsPayout,
  isPayOsPayoutConfigured,
} from "../config/payos.config.js";

const BANK_CODE_TO_BIN = {
  VCB: "970436",
  TCB: "970407",
  MBB: "970422",
  ACB: "970416",
  VPB: "970432",
  CTG: "970415",
  BID: "970418",
  TPB: "970423",
};

const COMPLETED_PAYOUT_APPROVAL_STATES = new Set(["COMPLETED"]);
const SUCCEEDED_PAYOUT_APPROVAL_STATES = new Set(["SUCCEEDED", "COMPLETED"]);
const FAILED_PAYOUT_APPROVAL_STATES = new Set([
  "FAILED",
  "REJECTED",
  "CANCELLED",
]);

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const mapPayOsPayoutError = (err) => {
  if (err instanceof ErrorResponse) {
    return err;
  }

  const rawMessage = String(err?.message || "");
  const payOsCode = String(err?.code || "");
  const statusCode = Number(err?.status || err?.statusCode || 0) || null;

  // 1. Lỗi Xác thực (API Key, Signature) - Thường là 401
  const isInvalidApiKey =
    payOsCode === "601" ||
    statusCode === 401 ||
    rawMessage.includes("code: 601") ||
    /api key|clientid|checksum|xác thực|signature/i.test(rawMessage);

  // 2. Lỗi Quyền truy cập (Phân quyền) - Thường là 403. ĐÃ BỎ TỪ KHÓA "payout"
  const isNoPermission =
    statusCode === 403 ||
    /forbidden|không có quyền|chưa được kích hoạt/i.test(rawMessage);

  // 3. Lỗi Nghiệp vụ (Data/Logic) - Thường là 400
  const isBusinessError =
    /số dư không đủ|tài khoản đích|tài khoản nhận|hạn mức|không hợp lệ|hệ thống ngân hàng/i.test(
      rawMessage,
    );

  // Trả về ErrorResponse với HTTP Status code tương ứng
  if (isInvalidApiKey) {
    return new ErrorResponse(
      "Hệ thống thanh toán từ chối xác thực. Vui lòng liên hệ Admin.",
      502,
    );
  }

  // if (isNoPermission) {
  //   return new ErrorResponse(
  //     "Tài khoản hệ thống hiện không có quyền Chi hộ. Vui lòng liên hệ Admin.",
  //     502,
  //   );
  // }

  if (isBusinessError) {
    // Lỗi người dùng/logic -> Trả 400 để Frontend hiển thị trực tiếp cho Seller
    return new ErrorResponse(
      rawMessage ||
        "Thông tin rút tiền không hợp lệ hoặc số dư ví PayOS không đủ.",
      400,
    );
  }

  return new ErrorResponse(
    `Lỗi khi xử lý rút tiền: ${rawMessage || "Unknown error"}`,
    502,
  );
};

/**
 * @desc    Lấy thông tin ví seller
 * @route   GET /api/finance/wallet
 * @access  Private (Seller)
 */
export const getWalletInfo = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const data = await getSellerBalance(sellerId);

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * @desc    Lấy lịch sử giao dịch ví của seller
 * @route   GET /api/finance/transactions
 * @access  Private (Seller)
 * @query   limit, skip, type, search
 */
export const getTransactions = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const { limit = 10, skip = 0, type, search } = req.query;
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const skipNum = Math.max(0, parseInt(skip, 10) || 0);

  // Map FE type filter sang DB type
  const typeMap = {
    deposit: "deposit",
    withdraw: "payout",
    convert_rp: "reward_point_withdrawal",
    earning: "order_payment",
    refund: "order_refund",
  };
  const dbType = typeMap[type] || type;

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

  const includeTopupDeposits = !type || type === "deposit";

  // Nếu không cần include topup thì giữ nguyên logic cũ
  if (!includeTopupDeposits) {
    const result = await getSellerWalletTransactions(
      sellerId,
      limitNum,
      skipNum,
      { type: dbType, search },
    );

    const transformedTransactions = (result.transactions || []).map((t) => ({
      ...t,
      type: dbToFeTypeMap[t.type] || t.type,
    }));

    return res.status(200).json({
      success: true,
      data: {
        data: transformedTransactions,
        total: result.total || 0,
      },
    });
  }

  const windowSize = skipNum + limitNum;

  const result = await getSellerWalletTransactions(sellerId, windowSize, 0, {
    type: dbType,
    search,
  });

  const transformedTransactions = (result.transactions || []).map((t) => ({
    ...t,
    type: dbToFeTypeMap[t.type] || t.type,
  }));

  const topupQuery = { userId: sellerId };
  if (search) {
    topupQuery.orderCode = { $regex: String(search), $options: "i" };
  }

  const [topups, topupTotal] = await Promise.all([
    TopupRequest.find(topupQuery)
      .sort({ createdAt: -1 })
      .limit(windowSize)
      .lean(),
    TopupRequest.countDocuments(topupQuery),
  ]);

  const mappedTopups = topups.map((topup) => {
    const statusMap = {
      pending: "pending",
      completed: "completed",
      failed: "rejected",
    };
    return {
      _id: `topup_${topup._id}`,
      transactionId: `TOPUP-${topup.orderCode}`,
      type: "deposit",
      status: statusMap[topup.status] || "pending",
      amount: Math.round(toNumber(topup.amount)),
      balanceAfter: null,
      description: `Nạp ${Math.round(toNumber(topup.coinAmount)).toLocaleString()} coin qua PayOS`,
      metadata: {
        orderCode: topup.orderCode,
        coinAmount: Math.round(toNumber(topup.coinAmount)),
        source: "payos_topup",
      },
      createdAt: topup.createdAt,
      updatedAt: topup.updatedAt,
    };
  });

  const merged = [...transformedTransactions, ...mappedTopups].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const paged = merged.slice(skipNum, skipNum + limitNum);

  res.status(200).json({
    success: true,
    data: {
      data: paged,
      total: (result.total || 0) + topupTotal,
    },
  });
});

/**
 * @desc    Lấy thống kê nhanh giao dịch tài chính
 * @route   GET /api/finance/quick-stats
 * @access  Private (Seller)
 */
export const getQuickStats = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    walletPendingApprovals,
    topupPendingApprovals,
    walletApprovedToday,
    topupApprovedToday,
    walletTransactionTotal,
    topupTotal,
  ] = await Promise.all([
    SellerWalletTransaction.countDocuments({ sellerId, status: "pending" }),
    TopupRequest.countDocuments({ userId: sellerId, status: "pending" }),
    SellerWalletTransaction.countDocuments({
      sellerId,
      status: "completed",
      createdAt: { $gte: startOfToday },
    }),
    TopupRequest.countDocuments({
      userId: sellerId,
      status: "completed",
      createdAt: { $gte: startOfToday },
    }),
    SellerWalletTransaction.countDocuments({ sellerId }),
    TopupRequest.countDocuments({ userId: sellerId }),
  ]);

  const pendingApprovals = walletPendingApprovals + topupPendingApprovals;
  const approvedToday = walletApprovedToday + topupApprovedToday;
  const totalTransactions = walletTransactionTotal + topupTotal;

  res.status(200).json({
    success: true,
    data: {
      pendingApprovals,
      approvedToday,
      totalTransactions,
    },
  });
});

/**
 * @desc    Tạo link PayOS để nạp token (reward_point) cho seller
 * @route   POST /api/finance/deposit/topup-link
 * @access  Private (Seller)
 */
export const createDepositTopupLink = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const amount = toNumber(req.body?.amount);

  if (!amount || amount < 10000) {
    throw new ErrorResponse("Số tiền nạp tối thiểu là 10,000 VND", 400);
  }

  const coinAmount = Math.round(amount);
  const result = await paymentService.createTopupLink(
    sellerId,
    amount,
    coinAmount,
    {
      returnPath: "/seller/finance",
    },
  );

  res.status(200).json({
    success: true,
    message: "Tạo link nạp token thành công",
    data: result,
  });
});

/**
 * @desc    Lấy danh sách tài khoản ngân hàng seller
 * @route   GET /api/finance/bank-accounts
 * @access  Private (Seller)
 */
export const getBankAccounts = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const accounts = await SellerBankAccount.find({ sellerId })
    .sort({ updatedAt: -1 })
    .lean();

  res.status(200).json({
    success: true,
    data: accounts,
  });
});

/**
 * @desc    Lưu/cập nhật tài khoản ngân hàng seller
 * @route   POST /api/finance/bank-accounts
 * @access  Private (Seller)
 */
export const saveBankAccount = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const { bankCode, accountNumber, accountName } = req.body || {};

  if (!bankCode || !accountNumber || !accountName) {
    throw new ErrorResponse(
      "Vui lòng cung cấp đầy đủ thông tin tài khoản ngân hàng",
      400,
    );
  }

  const normalizedBankCode = String(bankCode).trim().toUpperCase();

  const updated = await SellerBankAccount.findOneAndUpdate(
    { sellerId },
    {
      sellerId,
      bankCode: normalizedBankCode,
      bankName: normalizedBankCode,
      accountNumber: String(accountNumber).trim(),
      accountName: String(accountName).trim(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  res.status(200).json({
    success: true,
    data: updated,
  });
});

/**
 * @desc    Rút tiền seller về tài khoản qua PayOS payout
 * @route   POST /api/finance/withdraw/payos
 * @access  Private (Seller)
 */
export const createPayOsWithdraw = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const { bankCode, accountNumber, accountName } = req.body || {};
  const amount = toNumber(req.body?.amount);

  if (!amount || amount < 2000) {
    throw new ErrorResponse("Số tiền rút tối thiểu là 2,000 VND", 400);
  }

  if (!bankCode || !accountNumber || !accountName) {
    throw new ErrorResponse(
      "Vui lòng cung cấp đầy đủ thông tin tài khoản nhận",
      400,
    );
  }

  if (!isPayOsPayoutConfigured() || !payOsPayout?.payouts) {
    throw new ErrorResponse("PayOS payout chưa được cấu hình", 503);
  }

  const balanceInfo = await getSellerBalance(sellerId);
  const availableBalance = Math.max(0, toNumber(balanceInfo?.availableBalance));

  if (amount > availableBalance) {
    throw new ErrorResponse(
      `Số dư khả dụng không đủ. Khả dụng: ${availableBalance.toLocaleString()} VND`,
      400,
    );
  }

  const normalizedBankCode = String(bankCode).trim().toUpperCase();
  const toBin = /^\d{6,}$/.test(normalizedBankCode)
    ? normalizedBankCode
    : BANK_CODE_TO_BIN[normalizedBankCode];

  if (!toBin) {
    throw new ErrorResponse(
      "Mã ngân hàng không hợp lệ hoặc chưa được hỗ trợ",
      400,
    );
  }

  const referenceId = `SELLER-WD-${sellerId.toString().slice(-6)}-${Date.now()}`;

  let payout;
  try {
    payout = await payOsPayout.payouts.create(
      {
        referenceId,
        amount: Math.round(amount),
        description: `Rut tien seller ${sellerId.toString().slice(-6)}`,
        toBin,
        toAccountNumber: String(accountNumber).trim(),
        category: ["seller_withdraw"],
      },
      referenceId,
    );
  } catch (err) {
    throw mapPayOsPayoutError(err);
  }

  const approvalState = String(payout?.approvalState || "");
  const txStatus = COMPLETED_PAYOUT_APPROVAL_STATES.has(approvalState)
    ? "completed"
    : "pending";
  const balanceBefore = availableBalance;
  const balanceAfter = Math.max(0, availableBalance - amount);

  const tx = await SellerWalletTransaction.create({
    sellerId,
    type: "payout",
    amount: -Math.round(amount),
    balanceBefore,
    balanceAfter,
    description: `Rút tiền qua PayOS về ${normalizedBankCode}-${String(accountNumber).slice(-4)}`,
    status: txStatus,
    // reference.payoutId in schema is ObjectId, while PayOS payout id is string (e.g. batch_xxx).
    // Keep provider payout id in metadata to avoid cast validation errors.
    reference: {},
    metadata: {
      provider: "payos",
      payoutId: payout?.id || null,
      referenceId,
      approvalState,
      toBin,
      toAccountNumber: String(accountNumber).trim(),
      toAccountName: String(accountName).trim(),
    },
  });

  await SellerWallet.updateOne(
    { sellerId },
    {
      $setOnInsert: {
        sellerId,
      },
      $inc: {
        totalPayout: Math.round(amount),
      },
    },
    { upsert: true },
  );

  res.status(200).json({
    success: true,
    message: "Tạo yêu cầu rút tiền qua PayOS thành công",
    data: {
      transactionId: tx._id,
      status: tx.status,
      payoutId: payout?.id || null,
      payoutState: approvalState || null,
      amount: Math.round(amount),
      balanceAfter,
    },
  });
});

/**
 * @desc    Ước tính chi phí payout PayOS cho lệnh rút tiền
 * @route   POST /api/finance/withdraw/payos/estimate
 * @access  Private (Seller)
 */
export const estimatePayOsWithdrawCredit = asyncHandler(async (req, res) => {
  const { bankCode, accountNumber } = req.body || {};
  const amount = toNumber(req.body?.amount);

  if (!amount || amount < 2000) {
    throw new ErrorResponse("Số tiền rút tối thiểu là 2,000 VND", 400);
  }

  if (!bankCode || !accountNumber) {
    throw new ErrorResponse(
      "Vui lòng cung cấp mã ngân hàng và số tài khoản nhận",
      400,
    );
  }

  if (!isPayOsPayoutConfigured() || !payOsPayout?.payouts) {
    throw new ErrorResponse("PayOS payout chưa được cấu hình", 503);
  }

  const normalizedBankCode = String(bankCode).trim().toUpperCase();
  const toBin = /^\d{6,}$/.test(normalizedBankCode)
    ? normalizedBankCode
    : BANK_CODE_TO_BIN[normalizedBankCode];

  if (!toBin) {
    throw new ErrorResponse(
      "Mã ngân hàng không hợp lệ hoặc chưa được hỗ trợ",
      400,
    );
  }

  const now = Date.now();
  const referenceId = `SELLER-WD-EST-${now}`;
  const payoutItemRef = `SELLER-WD-EST-ITEM-${now}`;

  let estimateResp;
  try {
    estimateResp = await payOsPayout.payouts.estimateCredit({
      referenceId,
      category: ["seller_withdraw"],
      validateDestination: true,
      payouts: [
        {
          referenceId: payoutItemRef,
          amount: Math.round(amount),
          description: "Uoc tinh phi rut tien seller",
          toBin,
          toAccountNumber: String(accountNumber).trim(),
        },
      ],
    });
  } catch (err) {
    throw mapPayOsPayoutError(err);
  }

  const estimateCredit = Math.max(
    0,
    Math.round(toNumber(estimateResp?.estimateCredit)),
  );
  const netAmount = Math.max(0, Math.round(amount) - estimateCredit);

  res.status(200).json({
    success: true,
    data: {
      amount: Math.round(amount),
      estimateCredit,
      netAmount,
      toBin,
    },
  });
});

/**
 * @desc    Lấy thông tin payout PayOS theo payoutId
 * @route   GET /api/finance/withdraw/payos/:payoutId
 * @access  Private (Seller)
 */
export const getPayOsPayoutInfo = asyncHandler(async (req, res) => {
  const sellerId = req.user._id;
  const payoutId = String(req.params?.payoutId || "").trim();

  if (!payoutId) {
    throw new ErrorResponse("Thiếu payoutId", 400);
  }

  if (!isPayOsPayoutConfigured() || !payOsPayout?.payouts) {
    throw new ErrorResponse("PayOS payout chưa được cấu hình", 503);
  }

  const tx = await SellerWalletTransaction.findOne({
    sellerId,
    type: "payout",
    "metadata.payoutId": payoutId,
  });

  if (!tx) {
    throw new ErrorResponse("Không tìm thấy giao dịch payout tương ứng", 404);
  }

  let payout;
  try {
    payout = await payOsPayout.payouts.get(payoutId);
  } catch (err) {
    throw mapPayOsPayoutError(err);
  }

  const approvalState = String(payout?.approvalState || "").toUpperCase();

  let nextTxStatus = "pending";
  if (SUCCEEDED_PAYOUT_APPROVAL_STATES.has(approvalState)) {
    nextTxStatus = "completed";
  } else if (FAILED_PAYOUT_APPROVAL_STATES.has(approvalState)) {
    nextTxStatus = "failed";
  }

  if (tx.status !== nextTxStatus) {
    tx.status = nextTxStatus;
    tx.metadata = {
      ...(tx.metadata || {}),
      approvalState,
      payoutFetchedAt: new Date().toISOString(),
    };
    await tx.save();
  }

  res.status(200).json({
    success: true,
    data: {
      payout,
      txStatus: nextTxStatus,
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
  const amount = Math.round(toNumber(req.body?.amount));
  const sellerId = req.user._id;

  // Validate
  if (!amount || amount <= 0) {
    throw new ErrorResponse("Số tiền chuyển đổi phải lớn hơn 0", 400);
  }
  if (amount < 10000) {
    throw new ErrorResponse("Số tiền chuyển đổi tối thiểu là 10,000 VND", 400);
  }

  // Tỷ lệ: 1 VND = 1 RP
  const rewardPointAmount = amount;

  const session = await SellerWallet.startSession();
  try {
    session.startTransaction();

    // Tìm hoặc tạo ví
    let wallet = await SellerWallet.findOne({ sellerId }).session(session);
    if (!wallet) {
      wallet = await SellerWallet.create(
        [{ sellerId, balance: 0, pendingBalance: 0, totalConvertedToRP: 0 }],
        { session },
      );
      wallet = wallet[0];
    }

    const walletBalance = Math.max(0, toNumber(wallet.balance));
    const pendingBalance = Math.max(0, toNumber(wallet.pendingBalance));
    const availableBalance = Math.max(0, walletBalance - pendingBalance);

    // Kiểm tra đủ số dư trong cùng transaction
    if (availableBalance < amount) {
      throw new ErrorResponse(
        `Số dư khả dụng không đủ. Khả dụng: ${availableBalance.toLocaleString()} VND, Yêu cầu: ${amount.toLocaleString()} VND`,
        400,
      );
    }

    const balanceBefore = availableBalance;
    const balanceAfter = Math.max(0, availableBalance - amount);

    // Update có điều kiện để chống race condition concurrent requests
    const updateResult = await SellerWallet.updateOne(
      {
        _id: wallet._id,
        sellerId,
        pendingBalance,
        balance: { $gte: amount + pendingBalance },
      },
      {
        $inc: {
          balance: -amount,
          totalConvertedToRP: amount,
        },
      },
      { session },
    );

    if (!updateResult?.matchedCount) {
      throw new ErrorResponse(
        "Số dư đã thay đổi do thao tác đồng thời. Vui lòng tải lại và thử lại.",
        409,
      );
    }

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
      { session },
    );

    // Cộng coin vào ví user + tạo coin packet KHÔNG hết hạn trong cùng transaction
    const sellerUser = await User.findById(sellerId).session(session);
    if (!sellerUser) {
      throw new ErrorResponse("Không tìm thấy người dùng", 404);
    }

    const userCoinBefore = Math.max(0, toNumber(sellerUser.reward_point));
    const userCoinAfter = userCoinBefore + rewardPointAmount;

    const coinWalletTx = await WalletTransaction.create(
      [
        {
          userId: sellerId,
          type: "seller_convert",
          amount: rewardPointAmount,
          balanceBefore: userCoinBefore,
          balanceAfter: userCoinAfter,
          description: `Nhận ${rewardPointAmount.toLocaleString()} coin từ chuyển đổi số dư seller`,
          status: "completed",
          metadata: {
            source: "seller_convert",
            vndAmount: amount,
          },
        },
      ],
      { session },
    );

    await Coin.create(
      [
        {
          userId: sellerId,
          source: "seller_convert",
          originalAmount: rewardPointAmount,
          remainingAmount: rewardPointAmount,
          expiresAt: null,
          description: `Convert ${amount.toLocaleString()} VND sang ${rewardPointAmount.toLocaleString()} coin`,
          sourceTransaction: {
            transactionId: coinWalletTx[0]._id,
          },
          metadata: {
            source: "seller_convert",
            vndAmount: amount,
          },
        },
      ],
      { session },
    );

    sellerUser.reward_point = userCoinAfter;
    await sellerUser.save({ session });

    await session.commitTransaction();

    console.log(
      `[Finance] Convert to RP: Seller ${sellerId} | ` +
        `-${amount.toLocaleString()} VND | +${rewardPointAmount.toLocaleString()} RP | ` +
        `Balance: ${balanceBefore} → ${balanceAfter}`,
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
