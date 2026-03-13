import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import {
  getCurrentRate,
  getRateHistory,
  setManualRate,
  refreshExchangeRate,
} from "../services/exchangeRate.service.js";

/**
 * @desc    Get current active CNY→VND exchange rate
 * @route   GET /api/exchange-rate
 * @access  Public
 */
export const getExchangeRate = asyncHandler(async (req, res) => {
  const record = await getCurrentRate();

  if (!record) {
    return res.status(200).json({
      success: true,
      data: {
        rate: 3500,
        source: "default",
        apiSource: null,
        isActive: true,
        fetchedAt: null,
        note: "No rate record found — using system default 3500",
      },
    });
  }

  res.status(200).json({
    success: true,
    data: {
      _id: record._id,
      baseCurrency: record.baseCurrency,
      targetCurrency: record.targetCurrency,
      rate: record.rate,
      source: record.source,
      apiSource: record.apiSource,
      isActive: record.isActive,
      fetchedAt: record.createdAt,
      updatedBy: record.updatedBy,
      note: record.note,
    },
  });
});

/**
 * @desc    Manually override the exchange rate
 * @route   PUT /api/exchange-rate
 * @access  Private (Admin / Manager)
 */
export const updateExchangeRate = asyncHandler(async (req, res) => {
  const { rate, note } = req.body;

  if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) {
    throw new ErrorResponse("Please provide a valid positive exchange rate", 400);
  }

  const record = await setManualRate(Number(rate), req.user._id, note || null);

  res.status(200).json({
    success: true,
    message: `Exchange rate manually set to ${record.rate} VND/CNY`,
    data: record,
  });
});

/**
 * @desc    Force-trigger an immediate API sync (ignores cron schedule)
 * @route   POST /api/exchange-rate/sync
 * @access  Private (Admin / Manager)
 */
export const triggerSync = asyncHandler(async (req, res) => {
  const record = await refreshExchangeRate();

  if (!record) {
    throw new ErrorResponse(
      "All external exchange rate API sources are currently unavailable. " +
        "The previous rate remains active.",
      502
    );
  }

  res.status(200).json({
    success: true,
    message: `Synced successfully: 1 CNY = ${record.rate} VND`,
    data: record,
  });
});

/**
 * @desc    Get exchange rate history (paginated)
 * @route   GET /api/exchange-rate/history
 * @access  Private (Admin / Manager)
 */
export const getExchangeRateHistory = asyncHandler(async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;

  const result = await getRateHistory(page, limit);

  res.status(200).json({
    success: true,
    count: result.records.length,
    pagination: {
      total: result.total,
      page: result.page,
      pages: result.pages,
    },
    data: result.records,
  });
});
