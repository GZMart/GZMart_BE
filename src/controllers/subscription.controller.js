import { asyncHandler } from "../middlewares/async.middleware.js";
import paymentService from "../services/payment.service.js";
import * as subscriptionService from "../services/subscription.service.js";

export const createSubscriptionCheckout = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const returnPath = req.body?.returnPath;
  const result = await paymentService.createSubscriptionLink(userId, {
    redirectAfterSuccess: returnPath || "/buyer/vip",
  });
  res.status(200).json({ success: true, data: result });
});

export const getMySubscription = asyncHandler(async (req, res) => {
  const sub = await subscriptionService.getMySubscription(req.user._id);
  res.status(200).json({ success: true, data: sub || null });
});
