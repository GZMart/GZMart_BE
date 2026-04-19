import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import * as rmaService from "../services/rma.service.js";
import ReturnRequest from "../models/ReturnRequest.js";
import Order from "../models/Order.js";
import WalletTransaction from "../models/WalletTransaction.js";
import User from "../models/User.js";
import { escapeRegex, findUserIdsBySearch } from "../utils/adminSearch.util.js";

/**
 * @desc    Check if order is eligible for return/exchange
 * @route   GET /api/rma/eligibility/:orderId
 * @access  Private (Buyer)
 */
export const checkEligibility = asyncHandler(async (req, res, next) => {
  const { orderId } = req.params;

  const eligibility = await ReturnRequest.checkEligibility(orderId);

  res.status(200).json({
    success: true,
    data: eligibility,
  });
});

/**
 * @desc    Create a return/exchange request
 * @route   POST /api/rma/requests
 * @access  Private (Buyer)
 */
export const createReturnRequest = asyncHandler(async (req, res, next) => {
  const { orderId, type, reason, description, images, items } = req.body;

  // Validation
  if (!orderId || !reason || !description || !items || items.length === 0) {
    return next(
      new ErrorResponse(
        "Missing required fields: orderId, reason, description, items",
        400,
      ),
    );
  }

  if (type && !["undetermined", "refund", "exchange"].includes(type)) {
    return next(
      new ErrorResponse(
        "Invalid type. Must be 'undetermined', 'refund' or 'exchange'",
        400,
      ),
    );
  }

  // Check eligibility first
  const eligibility = await ReturnRequest.checkEligibility(orderId);
  if (!eligibility.isEligible) {
    return next(new ErrorResponse(eligibility.reason, 400));
  }

  // Create return request
  const returnRequest = await rmaService.createReturnRequest({
    orderId,
    userId: req.user._id,
    type: type || "undetermined",
    reason,
    description,
    images,
    items,
  });

  res.status(201).json({
    success: true,
    message: "Return request created successfully",
    data: returnRequest,
  });
});

/**
 * @desc    Get user's return requests
 * @route   GET /api/rma/requests
 * @access  Private (Buyer)
 */
export const getMyReturnRequests = asyncHandler(async (req, res, next) => {
  const { status, type, orderId, limit } = req.query;

  const returnRequests = await rmaService.getUserReturnRequests(req.user._id, {
    status,
    type,
    orderId,
    limit: parseInt(limit) || 50,
  });

  res.status(200).json({
    success: true,
    count: returnRequests.length,
    data: returnRequests,
  });
});

/**
 * @desc    Get single return request details
 * @route   GET /api/rma/requests/:id
 * @access  Private (Buyer/Seller)
 */
export const getReturnRequestById = asyncHandler(async (req, res, next) => {
  const returnRequest = await ReturnRequest.findById(req.params.id)
    .populate({
      path: "orderId",
      populate: {
        path: "userId",
        select: "fullName email phone address location",
      },
    })
    .populate("userId", "fullName email phone address location")
    .populate({
      path: "items.orderItemId",
      populate: {
        path: "productId",
        populate: {
          path: "sellerId",
          select: "fullName email phone address location",
        },
      },
    })
    .populate("sellerResponse.respondedBy", "fullName email");

  if (!returnRequest) {
    return next(new ErrorResponse("Return request not found", 404));
  }

  // Authorization: only owner or seller can view
  if (
    returnRequest.userId._id.toString() !== req.user._id.toString() &&
    req.user.role !== "seller" &&
    req.user.role !== "admin"
  ) {
    return next(
      new ErrorResponse("You don't have permission to view this request", 403),
    );
  }

  res.status(200).json({
    success: true,
    data: returnRequest,
  });
});

/**
 * @desc    Cancel return request (buyer only, before seller responds)
 * @route   PUT /api/rma/requests/:id/cancel
 * @access  Private (Buyer)
 */
export const cancelReturnRequest = asyncHandler(async (req, res, next) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);

  if (!returnRequest) {
    return next(new ErrorResponse("Return request not found", 404));
  }

  // Only owner can cancel
  if (returnRequest.userId.toString() !== req.user._id.toString()) {
    return next(
      new ErrorResponse(
        "You don't have permission to cancel this request",
        403,
      ),
    );
  }

  // Can only cancel if pending
  if (returnRequest.status !== "pending") {
    return next(
      new ErrorResponse(
        `Cannot cancel request with status: ${returnRequest.status}`,
        400,
      ),
    );
  }

  returnRequest.status = "cancelled";
  returnRequest.timeline.push({
    status: "cancelled",
    description: "Buyer cancelled the request",
    updatedAt: new Date(),
    updatedBy: req.user._id,
    role: "buyer",
  });

  await returnRequest.save();

  res.status(200).json({
    success: true,
    message: "Return request cancelled",
    data: returnRequest,
  });
});

/**
 * @desc    Update return shipping info (buyer ships items back)
 * @route   PUT /api/rma/requests/:id/shipping
 * @access  Private (Buyer)
 */
export const updateReturnShipping = asyncHandler(async (req, res, next) => {
  const { trackingNumber, shippingProvider, estimatedReturnDate, notes } =
    req.body;

  if (!trackingNumber) {
    return next(new ErrorResponse("Tracking number is required", 400));
  }

  const returnRequest = await rmaService.updateReturnShipping(
    req.params.id,
    req.user._id,
    {
      trackingNumber,
      shippingProvider,
      estimatedReturnDate,
      notes,
    },
  );

  res.status(200).json({
    success: true,
    message: "Shipping info updated. Items marked as returned.",
    data: returnRequest,
  });
});

/**
 * @desc    Buyer confirms faulty-item handover after first-leg delivery
 * @route   PUT /api/rma/requests/:id/confirm-handover
 * @access  Private (Buyer)
 */
export const confirmBuyerHandover = asyncHandler(async (req, res, next) => {
  const { notes } = req.body;

  const returnRequest = await rmaService.confirmBuyerHandover(
    req.params.id,
    req.user._id,
    notes,
  );

  res.status(200).json({
    success: true,
    message: "Handover confirmed. Return logistics has moved to the next step.",
    data: returnRequest,
  });
});

// ==================== SELLER ENDPOINTS ====================

/**
 * @desc    Get all return requests for seller
 * @route   GET /api/rma/seller/requests
 * @access  Private (Seller)
 */
export const getSellerReturnRequests = asyncHandler(async (req, res, next) => {
  const { status, type, limit } = req.query;

  const returnRequests = await rmaService.getSellerReturnRequests(
    req.user._id,
    {
      status,
      type,
      limit: parseInt(limit) || 50,
    },
  );

  res.status(200).json({
    success: true,
    count: returnRequests.length,
    data: returnRequests,
  });
});

/**
 * @desc    Approve/Reject return request
 * @route   PUT /api/rma/seller/requests/:id/respond
 * @access  Private (Seller)
 */
export const respondToReturnRequest = asyncHandler(async (req, res, next) => {
  const { decision, notes, resolution } = req.body;

  if (!decision || !["approve", "reject"].includes(decision)) {
    return next(
      new ErrorResponse("Invalid decision. Must be 'approve' or 'reject'", 400),
    );
  }

  if (
    decision === "approve" &&
    (!resolution || !["refund", "exchange"].includes(resolution))
  ) {
    return next(
      new ErrorResponse(
        "When approving, resolution must be 'refund' or 'exchange'",
        400,
      ),
    );
  }

  const returnRequest = await rmaService.respondToReturnRequest(
    req.params.id,
    decision,
    resolution,
    req.user._id,
    notes,
  );

  res.status(200).json({
    success: true,
    message: `Return request ${decision}d successfully`,
    data: returnRequest,
  });
});

/**
 * @desc    Get latest return request by order for current buyer
 * @route   GET /api/rma/requests/order/:orderId
 * @access  Private (Buyer)
 */
export const getOrderReturnRequest = asyncHandler(async (req, res, next) => {
  const { orderId } = req.params;

  const returnRequest = await rmaService.getOrderReturnRequestForBuyer(
    req.user._id,
    orderId,
  );

  if (!returnRequest) {
    return next(
      new ErrorResponse("No return request found for this order", 404),
    );
  }

  res.status(200).json({
    success: true,
    data: returnRequest,
  });
});

/**
 * @desc    Confirm receiving returned items
 * @route   PUT /api/rma/seller/requests/:id/confirm-received
 * @access  Private (Seller/Admin)
 */
export const confirmItemsReceived = asyncHandler(async (req, res, next) => {
  const { notes } = req.body;

  const result = await rmaService.confirmItemsReceived(
    req.params.id,
    req.user._id,
    notes,
  );

  const isAutoCompleted = Boolean(result?.autoRefund || result?.autoExchange);

  res.status(200).json({
    success: true,
    message: isAutoCompleted
      ? "Items received confirmed. Request has been auto-completed."
      : "Items received confirmed. Status changed to processing.",
    data: result,
  });
});

/**
 * @desc    Process refund (add coins to user wallet)
 * @route   POST /api/rma/seller/requests/:id/process-refund
 * @access  Private (Seller/Admin)
 */
export const processRefund = asyncHandler(async (req, res, next) => {
  const result = await rmaService.processRefund(req.params.id);

  res.status(200).json({
    success: true,
    message: `Refund processed successfully. ${result.coinsAdded} coins added to user wallet`,
    data: result,
  });
});

/**
 * @desc    Process exchange (create new order)
 * @route   POST /api/rma/seller/requests/:id/process-exchange
 * @access  Private (Seller/Admin)
 */
export const processExchange = asyncHandler(async (req, res, next) => {
  const result = await rmaService.processExchange(req.params.id);

  res.status(200).json({
    success: true,
    message: `Exchange processed successfully. New order created: ${result.newOrder.orderNumber}`,
    data: result,
  });
});

// ==================== WALLET ENDPOINTS ====================

/**
 * @desc    Get user's wallet balance and transaction history
 * @route   GET /api/rma/wallet
 * @access  Private (Buyer)
 */
export const getWalletInfo = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).select(
    "reward_point email fullName",
  );

  const transactions = await WalletTransaction.find({
    userId: req.user._id,
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .limit(50);

  const stats = await WalletTransaction.getUserStats(req.user._id);

  res.status(200).json({
    success: true,
    data: {
      balance: user.reward_point || 0,
      user: {
        fullName: user.fullName,
        email: user.email,
      },
      transactions,
      stats,
    },
  });
});

/**
 * @desc    Get wallet transaction details
 * @route   GET /api/rma/wallet/transactions/:id
 * @access  Private (Buyer)
 */
export const getTransactionById = asyncHandler(async (req, res, next) => {
  const transaction = await WalletTransaction.findById(req.params.id)
    .populate("reference.orderId", "orderNumber totalPrice")
    .populate("reference.returnRequestId", "requestNumber type");

  if (!transaction) {
    return next(new ErrorResponse("Transaction not found", 404));
  }

  // Authorization: only owner can view
  if (transaction.userId.toString() !== req.user._id.toString()) {
    return next(
      new ErrorResponse(
        "You don't have permission to view this transaction",
        403,
      ),
    );
  }

  res.status(200).json({
    success: true,
    data: transaction,
  });
});

// ==================== ADMIN ENDPOINTS ====================

/**
 * @desc    Get all return requests (Admin)
 * @route   GET /api/rma/admin/requests
 * @access  Private (Admin)
 */
export const getAllReturnRequests = asyncHandler(async (req, res, next) => {
  const {
    status,
    type,
    page = 1,
    limit = 20,
    search,
    dateFrom,
    dateTo,
  } = req.query;

  const and = [{ isActive: true }];

  if (status) {
    and.push({ status });
  }
  if (type) {
    and.push({ type });
  }
  if (dateFrom || dateTo) {
    const range = {};
    if (dateFrom) {
      range.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      range.$lte = end;
    }
    and.push({ createdAt: range });
  }

  const q = String(search || "").trim();
  if (q.length >= 2) {
    const or = [
      { requestNumber: { $regex: escapeRegex(q), $options: "i" } },
    ];
    const orderMatches = await Order.find({
      orderNumber: { $regex: escapeRegex(q), $options: "i" },
    })
      .select("_id")
      .limit(80)
      .lean();
    if (orderMatches.length) {
      or.push({ orderId: { $in: orderMatches.map((o) => o._id) } });
    }
    const buyerIds = await findUserIdsBySearch(q);
    if (buyerIds !== null && buyerIds.length > 0) {
      or.push({ userId: { $in: buyerIds } });
    }
    and.push({ $or: or });
  }

  const query = and.length === 1 ? and[0] : { $and: and };

  const returnRequests = await ReturnRequest.find(query)
    .populate("orderId", "orderNumber totalPrice")
    .populate("userId", "fullName email phone")
    .populate("items.orderItemId")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await ReturnRequest.countDocuments(query);

  res.status(200).json({
    success: true,
    count: returnRequests.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: returnRequests,
  });
});

/**
 * @desc    Manually process refund or exchange (Admin override)
 * @route   POST /api/rma/admin/requests/:id/process
 * @access  Private (Admin)
 */
export const adminProcessRequest = asyncHandler(async (req, res, next) => {
  const { action } = req.body; // 'refund' or 'exchange'

  if (!action || !["refund", "exchange"].includes(action)) {
    return next(
      new ErrorResponse("Invalid action. Must be 'refund' or 'exchange'", 400),
    );
  }

  let result;
  if (action === "refund") {
    result = await rmaService.processRefund(req.params.id);
  } else {
    result = await rmaService.processExchange(req.params.id);
  }

  res.status(200).json({
    success: true,
    message: `${action} processed successfully by admin`,
    data: result,
  });
});

export default {
  // Buyer endpoints
  checkEligibility,
  createReturnRequest,
  getMyReturnRequests,
  getOrderReturnRequest,
  getReturnRequestById,
  cancelReturnRequest,
  getWalletInfo,
  getTransactionById,

  // Seller endpoints
  getSellerReturnRequests,
  respondToReturnRequest,
  processRefund,
  processExchange,

  // Admin endpoints
  getAllReturnRequests,
  adminProcessRequest,
};
