import express from "express";
import { convertToRewardPoints, getTransactions } from "../controllers/finance.controller.js";
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
 * @route   POST /api/finance/convert-rp
 * @desc    Chuyển số dư ví seller thành Reward Point cho buyer
 * @access  Private (Seller)
 * @body    { amount, targetUserId }
 */
router.post("/convert-rp", asyncHandler(convertToRewardPoints));

export default router;
