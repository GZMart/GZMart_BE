import mongoose from "mongoose";
import DisputeReport from "../models/DisputeReport.js";
import DisputeEvidence from "../models/DisputeEvidence.js";
import ReportHistory from "../models/ReportHistory.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Product from "../models/Product.js";
import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";

const REPORT_STATUSES = {
  PENDING: "pending",
  WAITING_FOR_SELLER: "waiting_for_seller",
  INVESTIGATING: "investigating",
  RESOLVED_REFUNDED: "resolved_refunded",
  RESOLVED_REJECTED: "resolved_rejected",
  APPEALED: "appealed",
};

const REPORT_TYPES = {
  ORDER: "order",
  PRODUCT: "product",
  SELLER: "seller",
  SYSTEM_BUG: "system_bug",
};

const REPORT_CATEGORIES_BY_TYPE = {
  [REPORT_TYPES.PRODUCT]: [
    "counterfeit",
    "wrong_description",
    "quality_issue",
    "damaged_item",
    "prohibited_item",
  ],
  [REPORT_TYPES.ORDER]: [
    "missing_item",
    "wrong_item",
    "delivery_delay",
    "order_not_received",
    "refund_problem",
  ],
  [REPORT_TYPES.SELLER]: [
    "abusive_behavior",
    "fraud_suspected",
    "spam_scam",
    "policy_violation",
    "unresponsive_support",
  ],
  [REPORT_TYPES.SYSTEM_BUG]: [
    "checkout_bug",
    "ui_display_bug",
    "performance_issue",
    "notification_bug",
    "other_system_bug",
  ],
};

const ALLOWED_TRANSITIONS = {
  [REPORT_STATUSES.PENDING]: [
    REPORT_STATUSES.WAITING_FOR_SELLER,
    REPORT_STATUSES.INVESTIGATING,
  ],
  [REPORT_STATUSES.WAITING_FOR_SELLER]: [
    REPORT_STATUSES.INVESTIGATING,
    REPORT_STATUSES.RESOLVED_REJECTED,
    REPORT_STATUSES.RESOLVED_REFUNDED,
  ],
  [REPORT_STATUSES.INVESTIGATING]: [
    REPORT_STATUSES.RESOLVED_REFUNDED,
    REPORT_STATUSES.RESOLVED_REJECTED,
    REPORT_STATUSES.WAITING_FOR_SELLER,
  ],
  [REPORT_STATUSES.RESOLVED_REFUNDED]: [REPORT_STATUSES.APPEALED],
  [REPORT_STATUSES.RESOLVED_REJECTED]: [REPORT_STATUSES.APPEALED],
  [REPORT_STATUSES.APPEALED]: [
    REPORT_STATUSES.INVESTIGATING,
    REPORT_STATUSES.RESOLVED_REFUNDED,
    REPORT_STATUSES.RESOLVED_REJECTED,
  ],
};

const SELLER_REPUTATION_PENALTY_POINTS = 10;

const normalizeArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [value];
    } catch {
      return [value];
    }
  }
  return [value];
};

const generateReportNumber = () => {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RPT-${Date.now()}-${suffix}`;
};

const validateCategoryForType = (type, category) => {
  const categoryValue = String(category || "").trim();
  const allowed = REPORT_CATEGORIES_BY_TYPE[type] || [];

  if (!categoryValue) {
    throw new ErrorResponse("category is required", 400);
  }

  if (!allowed.includes(categoryValue)) {
    throw new ErrorResponse(`Invalid category for report type ${type}`, 400);
  }

  return categoryValue;
};

const ensureTransitionAllowed = (currentStatus, nextStatus) => {
  if (currentStatus === nextStatus) {
    return;
  }

  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new ErrorResponse(
      `Invalid report status transition from ${currentStatus} to ${nextStatus}`,
      400,
    );
  }
};

const createHistory = async (payload, session) => {
  const [history] = await ReportHistory.create([payload], { session });
  return history;
};

const simulateRefund = async ({ report, order, adminId, reason }) => {
  const reference = `RF-${report.reportNumber}-${Date.now()}`;

  return {
    success: true,
    reference,
    processedAt: new Date(),
    processedBy: adminId,
    reason,
    orderId: order?._id || null,
  };
};

const resolveReportSellerIds = async ({
  type,
  productId,
  orderId,
  sellerId,
}) => {
  if (type === REPORT_TYPES.PRODUCT) {
    const product = await Product.findById(productId).select("sellerId");
    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }
    return [product.sellerId].filter(Boolean);
  }

  if (type === REPORT_TYPES.ORDER) {
    const orderItems = await OrderItem.find({ orderId })
      .populate("productId", "sellerId")
      .lean();

    const sellerIds = new Set();
    orderItems.forEach((item) => {
      const sellerIdFromItem = item.productId?.sellerId;
      if (sellerIdFromItem) {
        sellerIds.add(sellerIdFromItem.toString());
      }
    });

    return [...sellerIds];
  }

  if (type === REPORT_TYPES.SELLER) {
    if (!sellerId) {
      throw new ErrorResponse("sellerId is required for seller reports", 400);
    }

    const seller = await User.findById(sellerId).select("_id role");
    if (!seller) {
      throw new ErrorResponse("Seller not found", 404);
    }

    if (seller.role !== "seller") {
      throw new ErrorResponse("Target user is not a seller", 400);
    }

    return [seller._id.toString()];
  }

  return [];
};

const createEvidenceRecords = async (
  reportId,
  uploadedBy,
  uploadedByRole,
  evidenceUrls,
  session,
  source = uploadedByRole,
) => {
  const urls = normalizeArray(evidenceUrls);
  if (urls.length === 0) {
    return [];
  }

  const documents = urls.map((fileUrl) => ({
    reportId,
    uploadedBy,
    uploadedByRole,
    fileUrl,
    source,
  }));

  return await DisputeEvidence.insertMany(documents, { session });
};

const loadReportWithRelations = async (reportId) => {
  const report = await DisputeReport.findById(reportId)
    .populate("buyerId", "fullName email avatar role reward_point")
    .populate("sellerIds", "fullName email avatar role reward_point")
    .populate("assignedAdminId", "fullName email avatar role")
    .populate("assignedSellerId", "fullName email avatar role")
    .populate("orderId")
    .populate("productId");

  if (!report) {
    throw new ErrorResponse("Report not found", 404);
  }

  const [evidences, histories] = await Promise.all([
    DisputeEvidence.find({ reportId }).sort({ createdAt: 1 }).lean(),
    ReportHistory.find({ reportId })
      .populate("actorId", "fullName email avatar role")
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  return {
    ...report.toObject(),
    evidences,
    histories,
  };
};

const getProductReportCount = async (productId, session = null) => {
  const query = {
    productId,
    status: { $in: [REPORT_STATUSES.PENDING, REPORT_STATUSES.INVESTIGATING] },
  };

  const countQuery = DisputeReport.countDocuments(query);
  return session ? await countQuery.session(session) : await countQuery;
};

const hideProductIfNeeded = async ({
  productId,
  reportId,
  actorId,
  session,
}) => {
  if (!productId) {
    return null;
  }

  const unresolvedCount = await getProductReportCount(productId, session);
  if (unresolvedCount <= 5) {
    return null;
  }

  const product = await Product.findByIdAndUpdate(
    productId,
    {
      $set: {
        isHidden: true,
      },
    },
    { new: true, session },
  );

  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  await createHistory(
    {
      reportId,
      action: "product_hidden",
      actorId,
      actorRole: "buyer",
      note: "Auto-hidden because unresolved reports exceeded threshold",
      metadata: {
        productId: product._id,
        unresolvedCount,
      },
    },
    session,
  );

  await DisputeReport.findByIdAndUpdate(
    reportId,
    {
      $set: {
        hiddenProductTriggeredAt: new Date(),
      },
    },
    { session },
  );

  return product;
};

export const createBuyerReport = async (buyerId, payload) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const {
      type,
      title,
      description,
      category,
      orderId,
      productId,
      sellerId,
      evidenceUrls,
      priority,
    } = payload;

    if (!Object.values(REPORT_TYPES).includes(type)) {
      throw new ErrorResponse("Invalid report type", 400);
    }

    if (!title || !description) {
      throw new ErrorResponse("Title and description are required", 400);
    }

    if (type === REPORT_TYPES.ORDER && !orderId) {
      throw new ErrorResponse("orderId is required for order reports", 400);
    }

    if (type === REPORT_TYPES.PRODUCT && !productId) {
      throw new ErrorResponse("productId is required for product reports", 400);
    }

    if (type === REPORT_TYPES.SELLER && !sellerId) {
      throw new ErrorResponse("sellerId is required for seller reports", 400);
    }

    const normalizedCategory = validateCategoryForType(type, category);

    const [order, product] = await Promise.all([
      orderId ? Order.findById(orderId).session(session) : null,
      productId ? Product.findById(productId).session(session) : null,
    ]);

    if (orderId && !order) {
      throw new ErrorResponse("Order not found", 404);
    }

    if (productId && !product) {
      throw new ErrorResponse("Product not found", 404);
    }

    const sellerIds = await resolveReportSellerIds({
      type,
      productId,
      orderId,
      sellerId,
    });

    const orderItemIds =
      type === REPORT_TYPES.ORDER
        ? (
            await OrderItem.find({ orderId }).select("_id").session(session)
          ).map((item) => item._id)
        : [];

    const [report] = await DisputeReport.create(
      [
        {
          reportNumber: generateReportNumber(),
          type,
          status: REPORT_STATUSES.PENDING,
          priority: priority || "normal",
          title,
          description,
          category: normalizedCategory,
          buyerId,
          sellerIds,
          orderId: orderId || null,
          productId: productId || null,
          orderItemIds,
          createdByRole: "buyer",
        },
      ],
      { session },
    );

    await createEvidenceRecords(
      report._id,
      buyerId,
      "buyer",
      evidenceUrls,
      session,
      "buyer",
    );

    await createHistory(
      {
        reportId: report._id,
        action: "created",
        actorId: buyerId,
        actorRole: "buyer",
        note: "Buyer created a dispute report",
        metadata: {
          type,
          title,
          category: normalizedCategory,
          sellerIds,
        },
      },
      session,
    );

    await hideProductIfNeeded({
      productId: type === REPORT_TYPES.PRODUCT ? productId : null,
      reportId: report._id,
      actorId: buyerId,
      session,
    });

    await session.commitTransaction();

    return await loadReportWithRelations(report._id);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const getBuyerReports = async (buyerId, filters = {}) => {
  const { status, type, page = 1, limit = 20 } = filters;
  const query = { buyerId };

  if (status) query.status = status;
  if (type) query.type = type;

  const skip = (page - 1) * limit;

  const [reports, total] = await Promise.all([
    DisputeReport.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("productId", "name slug images isHidden")
      .populate("orderId", "orderNumber status totalPrice paymentStatus")
      .populate("sellerIds", "fullName email avatar role")
      .lean(),
    DisputeReport.countDocuments(query),
  ]);

  return {
    reports,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

export const getReportForBuyer = async (reportId, buyerId) => {
  const report = await loadReportWithRelations(reportId);

  if (report.buyerId._id.toString() !== buyerId.toString()) {
    throw new ErrorResponse(
      "You don't have permission to view this report",
      403,
    );
  }

  return report;
};

export const getSellerReports = async (sellerId, filters = {}) => {
  const { status, type, page = 1, limit = 20 } = filters;
  const skip = (page - 1) * limit;

  const query = {
    sellerIds: sellerId,
  };

  if (status) query.status = status;
  if (type) query.type = type;

  const [reports, total] = await Promise.all([
    DisputeReport.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("buyerId", "fullName email avatar role")
      .populate("productId", "name slug images isHidden sellerId")
      .populate("orderId", "orderNumber status totalPrice paymentStatus")
      .lean(),
    DisputeReport.countDocuments(query),
  ]);

  return {
    reports,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

export const getReportForSeller = async (reportId, sellerId) => {
  const report = await loadReportWithRelations(reportId);

  const isSellerRelated = report.sellerIds.some(
    (seller) => seller._id.toString() === sellerId.toString(),
  );

  if (!isSellerRelated) {
    throw new ErrorResponse(
      "You don't have permission to view this report",
      403,
    );
  }

  return report;
};

export const getReportForAdmin = async (reportId) => {
  return await loadReportWithRelations(reportId);
};

export const submitSellerCounterReport = async (
  reportId,
  sellerId,
  payload,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const report = await DisputeReport.findById(reportId).session(session);
    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    const sellerRelated = report.sellerIds.some(
      (id) => id.toString() === sellerId.toString(),
    );

    if (!sellerRelated) {
      throw new ErrorResponse(
        "You don't have permission to respond to this report",
        403,
      );
    }

    if (
      ![REPORT_STATUSES.PENDING, REPORT_STATUSES.WAITING_FOR_SELLER].includes(
        report.status,
      )
    ) {
      throw new ErrorResponse(
        `Cannot counter-report while report is ${report.status}`,
        400,
      );
    }

    const evidenceUrls = normalizeArray(payload.evidenceUrls);
    const counterNote = payload.counterNote || payload.note || "";

    report.status = REPORT_STATUSES.INVESTIGATING;
    report.sellerResponseNote = counterNote;
    report.sellerResponseAt = new Date();
    report.assignedSellerId = sellerId;
    await report.save({ session });

    await createEvidenceRecords(
      report._id,
      sellerId,
      "seller",
      evidenceUrls,
      session,
      "seller",
    );

    await createHistory(
      {
        reportId: report._id,
        action: "counter_report_submitted",
        fromStatus: REPORT_STATUSES.PENDING,
        toStatus: REPORT_STATUSES.INVESTIGATING,
        actorId: sellerId,
        actorRole: "seller",
        note: counterNote || "Seller submitted a counter-report",
        metadata: {
          evidenceCount: evidenceUrls.length,
        },
      },
      session,
    );

    await session.commitTransaction();

    return await loadReportWithRelations(report._id);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const getAdminReports = async (filters = {}) => {
  const { status, type, fromDate, toDate, page = 1, limit = 20 } = filters;

  const query = {};

  if (status) query.status = status;
  if (type) query.type = type;
  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) query.createdAt.$lte = new Date(toDate);
  }

  const skip = (page - 1) * limit;

  const [reports, total] = await Promise.all([
    DisputeReport.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("buyerId", "fullName email avatar role")
      .populate("sellerIds", "fullName email avatar role reward_point")
      .populate("productId", "name slug images isHidden sellerId")
      .populate("orderId", "orderNumber status totalPrice paymentStatus")
      .lean(),
    DisputeReport.countDocuments(query),
  ]);

  return {
    reports,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

export const updateReportStatus = async (reportId, adminId, payload) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const report = await DisputeReport.findById(reportId).session(session);
    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    const nextStatus = payload.status || payload.newStatus;
    if (!nextStatus) {
      throw new ErrorResponse("Next status is required", 400);
    }

    ensureTransitionAllowed(report.status, nextStatus);

    const beforeStatus = report.status;
    report.status = nextStatus;
    report.assignedAdminId = adminId;

    if (payload.note) {
      report.investigationSummary = payload.note;
    }

    if (nextStatus === REPORT_STATUSES.INVESTIGATING) {
      report.investigatedAt = new Date();
    }

    if (
      nextStatus === REPORT_STATUSES.RESOLVED_REFUNDED ||
      nextStatus === REPORT_STATUSES.RESOLVED_REJECTED
    ) {
      report.resolvedAt = new Date();
      report.resolutionNote =
        payload.resolutionNote || payload.note || report.resolutionNote;
    }

    if (nextStatus === REPORT_STATUSES.APPEALED) {
      report.appealedAt = new Date();
      report.appealNote =
        payload.appealNote || payload.note || report.appealNote;
    }

    await report.save({ session });

    await createHistory(
      {
        reportId: report._id,
        action: "status_changed",
        fromStatus: beforeStatus,
        toStatus: nextStatus,
        actorId: adminId,
        actorRole: "admin",
        note: payload.note || payload.resolutionNote || "Report status updated",
        metadata: {
          status: nextStatus,
        },
      },
      session,
    );

    await session.commitTransaction();

    return await loadReportWithRelations(report._id);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const acceptComplaint = async (reportId, adminId, payload = {}) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const report = await DisputeReport.findById(reportId).session(session);
    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    const sellerIds = report.sellerIds.map((id) => id.toString());
    if (sellerIds.length === 0) {
      throw new ErrorResponse("No seller found for this report", 400);
    }

    const order = report.orderId
      ? await Order.findById(report.orderId).session(session)
      : null;

    const refundResult = await simulateRefund({
      report,
      order,
      adminId,
      reason: payload.refundReason || report.description,
    });

    report.status = REPORT_STATUSES.RESOLVED_REFUNDED;
    report.assignedAdminId = adminId;
    report.resolvedAt = new Date();
    report.resolutionNote =
      payload.resolutionNote || payload.note || "Complaint accepted";
    report.refundReference = refundResult.reference;
    report.refundPayload = refundResult;
    await report.save({ session });

    if (order) {
      order.status = "refunded";
      order.paymentStatus = "refunded";
      order.refundedAt = new Date();
      order.refundReason = payload.refundReason || report.description;
      order.refundAmount = order.totalPrice;
      order.refundTransactionNo = refundResult.reference;
      await order.save({ session });
    }

    const affectedSellers = await User.find({
      _id: { $in: sellerIds },
    }).session(session);
    const sellerUpdates = affectedSellers.map(async (seller) => {
      const beforePoints = seller.reward_point || 0;
      const afterPoints = Math.max(
        0,
        beforePoints - SELLER_REPUTATION_PENALTY_POINTS,
      );

      seller.reward_point = afterPoints;
      await seller.save({ session });

      await createHistory(
        {
          reportId: report._id,
          action: "refund_triggered",
          fromStatus: REPORT_STATUSES.INVESTIGATING,
          toStatus: REPORT_STATUSES.RESOLVED_REFUNDED,
          actorId: adminId,
          actorRole: "admin",
          note: `Refund simulated and seller reputation reduced by ${SELLER_REPUTATION_PENALTY_POINTS} points`,
          metadata: {
            sellerId: seller._id,
            reputationBefore: beforePoints,
            reputationAfter: afterPoints,
            penaltyPoints: SELLER_REPUTATION_PENALTY_POINTS,
            refundReference: refundResult.reference,
          },
        },
        session,
      );
    });

    await Promise.all(sellerUpdates);

    await createHistory(
      {
        reportId: report._id,
        action: "status_changed",
        fromStatus: REPORT_STATUSES.INVESTIGATING,
        toStatus: REPORT_STATUSES.RESOLVED_REFUNDED,
        actorId: adminId,
        actorRole: "admin",
        note: payload.resolutionNote || "Buyer complaint accepted",
        metadata: {
          refundReference: refundResult.reference,
        },
      },
      session,
    );

    await session.commitTransaction();

    return await loadReportWithRelations(report._id);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const appealReport = async (reportId, buyerId, payload = {}) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const report = await DisputeReport.findById(reportId).session(session);
    if (!report) {
      throw new ErrorResponse("Report not found", 404);
    }

    if (report.buyerId.toString() !== buyerId.toString()) {
      throw new ErrorResponse(
        "You don't have permission to appeal this report",
        403,
      );
    }

    if (
      ![
        REPORT_STATUSES.RESOLVED_REFUNDED,
        REPORT_STATUSES.RESOLVED_REJECTED,
      ].includes(report.status)
    ) {
      throw new ErrorResponse("Only resolved reports can be appealed", 400);
    }

    const beforeStatus = report.status;
    report.status = REPORT_STATUSES.APPEALED;
    report.appealNote = payload.appealNote || payload.note || report.appealNote;
    report.appealedAt = new Date();
    await report.save({ session });

    await createHistory(
      {
        reportId: report._id,
        action: "appealed",
        fromStatus: beforeStatus,
        toStatus: REPORT_STATUSES.APPEALED,
        actorId: buyerId,
        actorRole: "buyer",
        note: payload.appealNote || "Buyer appealed the resolution",
        metadata: {},
      },
      session,
    );

    await session.commitTransaction();

    return await loadReportWithRelations(report._id);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};
