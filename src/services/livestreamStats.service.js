import mongoose from "mongoose";
import LiveSession from "../models/LiveSession.js";
import Order from "../models/Order.js";
import OrderItem from "../models/OrderItem.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * Revenue & units for orders attributed to a live session.
 * Excludes cancelled orders. Uses order.totalPrice (buyer-paid total incl. shipping where applicable).
 */
export async function getSessionStats(sessionId, sellerId) {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw new ErrorResponse("Invalid session id", 400);
  }

  const session = await LiveSession.findById(sessionId).lean();
  if (!session) {
    throw new ErrorResponse("Session not found", 404);
  }
  if (String(session.shopId) !== String(sellerId)) {
    throw new ErrorResponse("Forbidden", 403);
  }

  const sessionOid = new mongoose.Types.ObjectId(sessionId);

  const [orderAgg] = await Order.aggregate([
    {
      $match: {
        liveSessionId: sessionOid,
        status: { $ne: "cancelled" },
      },
    },
    {
      $group: {
        _id: null,
        revenue: { $sum: "$totalPrice" },
        orderCount: { $sum: 1 },
        orderIds: { $push: "$_id" },
      },
    },
  ]);

  const revenue = orderAgg?.revenue ?? 0;
  const orderCount = orderAgg?.orderCount ?? 0;
  const orderIds = orderAgg?.orderIds ?? [];

  let products = [];
  let totalUnitsSold = 0;

  if (orderIds.length > 0) {
    const rows = await OrderItem.aggregate([
      { $match: { orderId: { $in: orderIds } } },
      {
        $group: {
          _id: "$productId",
          quantity: { $sum: "$quantity" },
          lineSubtotal: { $sum: "$subtotal" },
        },
      },
      {
        $lookup: {
          from: Product.collection.collectionName,
          localField: "_id",
          foreignField: "_id",
          as: "p",
        },
      },
      { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          name: { $ifNull: ["$p.name", "Unknown product"] },
          quantity: 1,
          lineSubtotal: 1,
        },
      },
      { $sort: { lineSubtotal: -1 } },
    ]);

    products = rows.map((r) => ({
      productId: r.productId,
      name: r.name,
      quantity: r.quantity,
      lineSubtotal: r.lineSubtotal,
    }));
    totalUnitsSold = products.reduce((s, r) => s + (r.quantity || 0), 0);
  }

  let durationSeconds = null;
  if (session.startedAt) {
    const end = session.endedAt || new Date();
    durationSeconds = Math.max(
      0,
      Math.floor((end.getTime() - new Date(session.startedAt).getTime()) / 1000),
    );
  }

  return {
    sessionId: session._id.toString(),
    title: session.title,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSeconds,
    revenue,
    orderCount,
    totalUnitsSold,
    products,
  };
}

function sessionDurationSeconds(startedAt, endedAt) {
  if (!startedAt) {
    return null;
  }
  const end = endedAt || new Date();
  return Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(startedAt).getTime()) / 1000),
  );
}

/**
 * Paginated ended live sessions for a seller with revenue / order / unit totals.
 */
export async function listEndedSessionsHistory(sellerId, { page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, parseInt(String(page), 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const filter = { shopId: sellerId, status: "ended" };

  const [total, sessions] = await Promise.all([
    LiveSession.countDocuments(filter),
    LiveSession.find(filter)
      .sort({ endedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .select("title startedAt endedAt status")
      .lean(),
  ]);

  if (sessions.length === 0) {
    return {
      total,
      page: safePage,
      limit: safeLimit,
      sessions: [],
    };
  }

  const sessionIds = sessions.map((s) => s._id);

  const [revenueAgg, unitsAgg] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          liveSessionId: { $in: sessionIds },
          status: { $ne: "cancelled" },
        },
      },
      {
        $group: {
          _id: "$liveSessionId",
          revenue: { $sum: "$totalPrice" },
          orderCount: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          liveSessionId: { $in: sessionIds },
          status: { $ne: "cancelled" },
        },
      },
      {
        $lookup: {
          from: OrderItem.collection.collectionName,
          localField: "_id",
          foreignField: "orderId",
          as: "lines",
        },
      },
      { $unwind: { path: "$lines", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: "$liveSessionId",
          totalUnitsSold: { $sum: "$lines.quantity" },
        },
      },
    ]),
  ]);

  const revenueBySession = new Map(
    revenueAgg.map((r) => [String(r._id), { revenue: r.revenue, orderCount: r.orderCount }]),
  );
  const unitsBySession = new Map(unitsAgg.map((u) => [String(u._id), u.totalUnitsSold]));

  const rows = sessions.map((s) => {
    const key = String(s._id);
    const rev = revenueBySession.get(key);
    return {
      sessionId: key,
      title: s.title,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: sessionDurationSeconds(s.startedAt, s.endedAt),
      revenue: rev?.revenue ?? 0,
      orderCount: rev?.orderCount ?? 0,
      totalUnitsSold: unitsBySession.get(key) ?? 0,
    };
  });

  return {
    total,
    page: safePage,
    limit: safeLimit,
    sessions: rows,
  };
}
