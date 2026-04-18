import express from "express";
import {
  convertToRewardPoints,
  createDepositTopupLink,
  createPayOsWithdraw,
  estimatePayOsWithdrawCredit,
  getPayOsPayoutInfo,
  getBankAccounts,
  getQuickStats,
  getTransactions,
  getWalletInfo,
  saveBankAccount,
} from "../controllers/finance.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

// Protect all finance routes (Seller only)
router.use(protect);
router.use(authorize("seller"));

/**
 * @route   GET /api/finance/transactions
 * @desc    Lấy lịch sử giao dịch ví seller
 * @access  Private (Seller)
 * @query   limit, skip, type, search
 */
router.get("/transactions", asyncHandler(getTransactions));

/**
 * @route   GET /api/finance/wallet
 * @desc    Lấy thông tin ví seller
 * @access  Private (Seller)
 */
router.get("/wallet", asyncHandler(getWalletInfo));

/**
 * @route   GET /api/finance/quick-stats
 * @desc    Lấy thống kê nhanh giao dịch tài chính
 * @access  Private (Seller)
 */
router.get("/quick-stats", asyncHandler(getQuickStats));

/**
 * @route   POST /api/finance/deposit/topup-link
 * @desc    Tạo link PayOS để nạp token
 * @access  Private (Seller)
 */
router.post("/deposit/topup-link", asyncHandler(createDepositTopupLink));

/**
 * @route   POST /api/finance/withdraw/payos
 * @desc    Tạo payout rút tiền qua PayOS
 * @access  Private (Seller)
 */
router.post("/withdraw/payos", asyncHandler(createPayOsWithdraw));

/**
 * @route   POST /api/finance/withdraw/payos/estimate
 * @desc    Ước tính phí payout trước khi rút
 * @access  Private (Seller)
 */
router.post(
  "/withdraw/payos/estimate",
  asyncHandler(estimatePayOsWithdrawCredit),
);

/**
 * @route   GET /api/finance/withdraw/payos/:payoutId
 * @desc    Lấy thông tin trạng thái payout từ PayOS
 * @access  Private (Seller)
 */
router.get("/withdraw/payos/:payoutId", asyncHandler(getPayOsPayoutInfo));

/**
 * @route   GET /api/finance/bank-accounts
 * @desc    Lấy tài khoản ngân hàng của seller
 * @access  Private (Seller)
 */
router.get("/bank-accounts", asyncHandler(getBankAccounts));

/**
 * @route   POST /api/finance/bank-accounts
 * @desc    Lưu/cập nhật tài khoản ngân hàng của seller
 * @access  Private (Seller)
 */
router.post("/bank-accounts", asyncHandler(saveBankAccount));

/**
 * @route   POST /api/finance/convert-rp
 * @desc    Chuyển số dư ví seller thành Reward Point cho buyer
 * @access  Private (Seller)
 * @body    { amount, targetUserId }
 */
router.post("/convert-rp", asyncHandler(convertToRewardPoints));

export default router;
