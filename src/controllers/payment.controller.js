import paymentService from "../services/payment.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * @desc    Tạo link thanh toán PayOS cho đơn hàng
 * @route   POST /api/payments/create-link
 * @access  Private
 */
export const createPaymentLink = asyncHandler(async (req, res, next) => {
  const { orderId } = req.body;
  const userId = req.user._id;

  if (!orderId) {
    return next(new ErrorResponse("Vui lòng cung cấp mã đơn hàng", 400));
  }

  const result = await paymentService.createPaymentLink(orderId, userId);

  res.status(200).json({
    success: true,
    message: "Tạo link thanh toán thành công",
    data: result,
  });
});

/**
 * @desc    Nhận và xử lý webhook từ PayOS
 * @route   POST /api/payments/webhook
 * @access  Public
 */
export const handlePayOsWebhook = asyncHandler(async (req, res, next) => {
  console.log("[PayOS Webhook] Received request");
  console.log("[PayOS Webhook] Body:", JSON.stringify(req.body, null, 2));

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(200).json({
      success: true,
      message: "Webhook validation ping received.",
    });
  }

  try {
    const result = await paymentService.processWebhook(req.body);

    if (result.processed) {
      console.log(`[PayOS Webhook] Payment successful: ${result.orderNumber}`);
    } else {
      console.log(`[PayOS Webhook] ${result.reason}`);
    }

    return res.status(200).json({
      success: true,
      message: "Webhook processed successfully",
      data: result,
    });
  } catch (error) {
    console.error("[PayOS Webhook] Error:", error.message);

    if (
      error.message.includes("Data not integrity") ||
      error.name === "WebhookError" ||
      error.message.includes("Invalid webhook signature")
    ) {
      console.warn("[PayOS Webhook] Invalid signature - test request");
    }

    return res.status(200).json({
      success: false,
      message: "Webhook verification failed",
      error: error.message,
    });
  }
});

/**
 * @desc    Kiểm tra trạng thái thanh toán của đơn hàng
 * @route   GET /api/payments/status/:orderCode
 * @access  Private
 */
export const getPaymentStatus = asyncHandler(async (req, res, next) => {
  const { orderCode } = req.params;
  const userId = req.user._id;

  if (!orderCode) {
    return next(new ErrorResponse("Vui lòng cung cấp mã đơn hàng", 400));
  }

  const result = await paymentService.getPaymentStatus(orderCode, userId);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Hủy đơn hàng đang chờ thanh toán
 * @route   PUT /api/payments/cancel/:orderCode
 * @access  Private
 */
export const cancelPayment = asyncHandler(async (req, res, next) => {
  const { orderCode } = req.params;
  const userId = req.user._id;

  if (!orderCode) {
    return next(new ErrorResponse("Vui lòng cung cấp mã đơn hàng", 400));
  }

  const result = await paymentService.cancelPayment(orderCode, userId);

  res.status(200).json({
    success: true,
    message: "Đơn hàng đã được hủy thành công",
    data: result,
  });
});

/**
 * @desc    Kiểm tra trạng thái giao dịch từ PayOS
 * @route   GET /api/payments/check/:orderCode
 * @access  Private
 */
export const checkPaymentFromPayOS = asyncHandler(async (req, res, next) => {
  console.log("[Payment Controller] checkPaymentFromPayOS - Request received");
  const { orderCode } = req.params;
  const userId = req.user._id;
  console.log("[Payment Controller] OrderCode:", orderCode);
  console.log("[Payment Controller] UserId:", userId);

  if (!orderCode) {
    console.error("[Payment Controller] Missing orderCode");
    return next(new ErrorResponse("Vui lòng cung cấp mã đơn hàng", 400));
  }

  console.log(
    "[Payment Controller] Calling paymentService.checkPayOsStatus...",
  );
  const result = await paymentService.checkPayOsStatus(orderCode, userId);
  console.log("[Payment Controller] Result:", result);

  res.status(200).json({
    success: true,
    data: result,
  });
});
