import mongoose from "mongoose";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import {
  SellerWallet,
  SellerWalletTransaction,
} from "../models/SellerWallet.js";

const DEFAULT_ADMIN_RATE = 0.1;
const DEFAULT_SELLER_RATE = 0.9;

const toMoney = (value) => Math.max(0, Math.round(Number(value) || 0));

const getPlatformAdminUser = async (session = null) => {
  const adminUserId =
    process.env.ADMIN_TREASURY_USER_ID || process.env.ADMIN_USER_ID;
  if (adminUserId && mongoose.Types.ObjectId.isValid(adminUserId)) {
    const admin = await User.findById(adminUserId).session(session || null);
    if (admin && admin.role === "admin") {
      return admin;
    }
  }

  return User.findOne({ role: "admin" })
    .sort({ createdAt: 1 })
    .session(session || null);
};

const buildFinancialSnapshot = (order) => {
  const baseAmount = toMoney(
    order?.financialSnapshot?.baseAmount ??
      order?.payableBeforeCoin ??
      order?.totalPrice ??
      (order?.subtotal || 0) +
        (order?.shippingCost || 0) +
        (order?.giftBoxFee || 0) +
        (order?.tax || 0) -
        (order?.discountAmount ?? order?.discount ?? 0),
  );

  const adminRate = Number(
    order?.financialSnapshot?.adminRate ?? DEFAULT_ADMIN_RATE,
  );
  const sellerRate = Number(
    order?.financialSnapshot?.sellerRate ?? DEFAULT_SELLER_RATE,
  );
  const adminAmount = toMoney(
    order?.financialSnapshot?.adminAmount ?? baseAmount * adminRate,
  );
  const sellerAmount = Math.max(0, baseAmount - adminAmount);

  return {
    baseAmount,
    adminRate,
    sellerRate,
    adminAmount,
    sellerAmount,
    settlementStatus: order?.financialSnapshot?.settlementStatus || "pending",
    settledAt: order?.financialSnapshot?.settledAt || null,
    refundedAt: order?.financialSnapshot?.refundedAt || null,
    refundAmount: toMoney(order?.financialSnapshot?.refundAmount || 0),
    debtAmount: toMoney(order?.financialSnapshot?.debtAmount || 0),
    settlementBatchId: order?.financialSnapshot?.settlementBatchId || null,
    refundBatchId: order?.financialSnapshot?.refundBatchId || null,
    settlementNote: order?.financialSnapshot?.settlementNote || null,
  };
};

const creditSellerWallet = async ({ sellerId, amount, order, session }) => {
  const sellerWallet =
    (await SellerWallet.findOne({ sellerId }).session(session)) ||
    (await SellerWallet.create(
      [
        {
          sellerId,
          balance: 0,
          pendingBalance: 0,
          debtBalance: 0,
          totalEarning: 0,
          totalPayout: 0,
        },
      ],
      { session },
    ).then((docs) => docs[0]));

  const amountToCredit = toMoney(amount);
  const debtBalance = toMoney(sellerWallet.debtBalance || 0);
  const balanceBefore = toMoney(sellerWallet.balance || 0);

  let remainingCredit = amountToCredit;
  let nextDebtBalance = debtBalance;
  let nextBalance = balanceBefore;

  if (nextDebtBalance > 0) {
    const offset = Math.min(nextDebtBalance, remainingCredit);
    nextDebtBalance -= offset;
    remainingCredit -= offset;
  }

  if (remainingCredit > 0) {
    nextBalance += remainingCredit;
  }

  const transaction = await SellerWalletTransaction.create(
    [
      {
        sellerId,
        type: "order_payment",
        amount: amountToCredit,
        balanceBefore,
        balanceAfter: nextBalance,
        description: `Settlement for order ${order.orderNumber}`,
        status: "completed",
        reference: {
          orderId: order._id,
          orderNumber: order.orderNumber,
        },
        metadata: {
          settlementBaseAmount:
            order.financialSnapshot?.baseAmount || amountToCredit,
          debtOffsetApplied: debtBalance - nextDebtBalance,
          debtBalanceBefore: debtBalance,
          debtBalanceAfter: nextDebtBalance,
        },
      },
    ],
    { session },
  );

  sellerWallet.balance = nextBalance;
  sellerWallet.debtBalance = nextDebtBalance;
  sellerWallet.totalEarning = toMoney(
    (sellerWallet.totalEarning || 0) + amountToCredit,
  );
  await sellerWallet.save({ session });

  return {
    wallet: sellerWallet,
    transaction: transaction[0],
  };
};

const debitSellerWalletWithDebt = async ({
  sellerId,
  amount,
  order,
  returnRequest,
  session,
}) => {
  const sellerWallet =
    (await SellerWallet.findOne({ sellerId }).session(session)) ||
    (await SellerWallet.create(
      [
        {
          sellerId,
          balance: 0,
          pendingBalance: 0,
          debtBalance: 0,
          totalEarning: 0,
          totalPayout: 0,
        },
      ],
      { session },
    ).then((docs) => docs[0]));

  const amountToDebit = toMoney(amount);
  const balanceBefore = toMoney(sellerWallet.balance || 0);
  const debtBefore = toMoney(sellerWallet.debtBalance || 0);
  const availableBefore = Math.max(0, balanceBefore - debtBefore);

  let nextBalance = balanceBefore;
  let nextDebt = debtBefore;
  let debtCreated = 0;

  if (nextBalance >= amountToDebit) {
    nextBalance -= amountToDebit;
  } else {
    const shortage = amountToDebit - nextBalance;
    nextBalance = 0;
    nextDebt += shortage;
    debtCreated = shortage;
  }

  const transaction = await SellerWalletTransaction.create(
    [
      {
        sellerId,
        type: "order_refund",
        amount: -amountToDebit,
        balanceBefore,
        balanceAfter: nextBalance,
        description: `Refund reversal for order ${order.orderNumber}`,
        status: "completed",
        reference: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          returnRequestId: returnRequest?._id,
        },
        metadata: {
          refundAmount: amountToDebit,
          debtCreated,
          debtBalanceBefore: debtBefore,
          debtBalanceAfter: nextDebt,
          availableBefore,
        },
      },
    ],
    { session },
  );

  sellerWallet.balance = nextBalance;
  sellerWallet.debtBalance = nextDebt;
  await sellerWallet.save({ session });

  return {
    wallet: sellerWallet,
    transaction: transaction[0],
    debtCreated,
  };
};

const adjustAdminWallet = async ({ amount, order, returnRequest, session }) => {
  const adminUser = await getPlatformAdminUser(session);
  if (!adminUser) {
    throw new Error("Platform admin user not found");
  }

  const amountToApply = toMoney(amount);
  const balanceBefore = toMoney(adminUser.reward_point || 0);
  const balanceAfter = balanceBefore + amountToApply;

  if (balanceAfter < 0) {
    throw new Error(
      `Admin wallet balance is insufficient for adjustment. Current: ${balanceBefore}, Required: ${Math.abs(amountToApply)}`,
    );
  }

  const transaction = await WalletTransaction.create(
    [
      {
        userId: adminUser._id,
        type: "admin_adjustment",
        amount: amountToApply,
        balanceBefore,
        balanceAfter,
        description:
          amountToApply >= 0
            ? `Platform commission for order ${order.orderNumber}`
            : `Platform refund reversal for order ${order.orderNumber}`,
        reference: {
          orderId: order._id,
          returnRequestId: returnRequest?._id,
          adminId: adminUser._id,
        },
        status: "completed",
        metadata: {
          source: amountToApply >= 0 ? "order_settlement" : "order_refund",
          orderNumber: order.orderNumber,
          checkoutGroupId: order.checkoutGroupId || null,
          returnRequestNumber: returnRequest?.requestNumber || null,
        },
      },
    ],
    { session },
  );

  adminUser.reward_point = balanceAfter;
  await adminUser.save({ session });

  return {
    adminUser,
    transaction: transaction[0],
  };
};

export const computeOrderFinancialSnapshot = (order) =>
  buildFinancialSnapshot(order);

export const applyOrderSettlement = async ({ orderId, session }) => {
  const order = await Order.findById(orderId).session(session);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  if (order.status !== "completed") {
    throw new Error(`Order ${order.orderNumber} is not completed yet`);
  }

  const snapshot = buildFinancialSnapshot(order);
  if (snapshot.settlementStatus === "settled" || snapshot.settledAt) {
    return {
      order,
      snapshot,
      alreadyProcessed: true,
    };
  }

  const sellerId = order.sellerId;
  if (!sellerId) {
    throw new Error(`SellerId missing on order ${order.orderNumber}`);
  }

  const sellerResult = await creditSellerWallet({
    sellerId,
    amount: snapshot.sellerAmount,
    order,
    session,
  });

  const adminResult = await adjustAdminWallet({
    amount: snapshot.adminAmount,
    order,
    session,
  });

  order.financialSnapshot = {
    ...snapshot,
    settlementStatus: "settled",
    settledAt: new Date(),
    refundAmount: snapshot.refundAmount || 0,
    debtAmount: toMoney(sellerResult.wallet.debtBalance || 0),
    settlementBatchId:
      snapshot.settlementBatchId || `SET-${order._id.toString()}`,
  };
  await order.save({ session });

  return {
    order,
    snapshot: order.financialSnapshot,
    sellerTransaction: sellerResult.transaction,
    adminTransaction: adminResult.transaction,
  };
};

export const applyOrderRefund = async ({
  orderId,
  refundAmount,
  returnRequest,
  session,
}) => {
  const order = await Order.findById(orderId).session(session);
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  const snapshot = buildFinancialSnapshot(order);
  const refundBase = toMoney(refundAmount || snapshot.baseAmount);
  if (refundBase <= 0) {
    throw new Error(
      `Refund amount must be greater than 0 for order ${order.orderNumber}`,
    );
  }

  const ratio =
    snapshot.baseAmount > 0 ? Math.min(1, refundBase / snapshot.baseAmount) : 1;
  const sellerDebit = toMoney(snapshot.sellerAmount * ratio);
  const adminDebit = refundBase - sellerDebit;

  const sellerResult = await debitSellerWalletWithDebt({
    sellerId: order.sellerId,
    amount: sellerDebit,
    order,
    returnRequest,
    session,
  });

  const adminResult = await adjustAdminWallet({
    amount: -adminDebit,
    order,
    returnRequest,
    session,
  });

  order.financialSnapshot = {
    ...snapshot,
    settlementStatus: "refunded",
    refundedAt: new Date(),
    refundAmount: refundBase,
    debtAmount: toMoney(sellerResult.wallet.debtBalance || 0),
    refundBatchId:
      snapshot.refundBatchId || `RFD-${order._id.toString()}-${Date.now()}`,
  };
  order.status = "refunded";
  order.paymentStatus = "refunded";
  order.refundedAt = new Date();
  order.refundReason = returnRequest?.reason || order.refundReason || "refund";
  order.refundAmount = refundBase;
  await order.save({ session });

  return {
    order,
    snapshot: order.financialSnapshot,
    sellerTransaction: sellerResult.transaction,
    adminTransaction: adminResult.transaction,
    debtCreated: sellerResult.debtCreated,
  };
};

export default {
  computeOrderFinancialSnapshot,
  applyOrderSettlement,
  applyOrderRefund,
};
