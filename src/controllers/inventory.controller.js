import * as inventoryService from "../services/inventory.service.js";
import * as demandForecastService from "../services/demandForecast.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Stock In - Add inventory
 * @route   POST /api/inventory/stock-in
 * @access  Private (Admin, Seller)
 */
export const stockIn = asyncHandler(async (req, res, next) => {
  const userId = req.user?._id || "695dd45041f5e32466527d93"; // Temporary

  const { productId, modelId, sku, quantity, costPrice, note, warehouseId } =
    req.body;

  if (!productId || !modelId || !sku || !quantity) {
    throw new ErrorResponse(
      "Please provide productId, modelId, sku, and quantity",
      400
    );
  }

  const transaction = await inventoryService.stockIn(
    { productId, modelId, sku, quantity, costPrice, note, warehouseId },
    userId
  );

  res.status(201).json({
    success: true,
    message: `Stock increased by ${quantity}`,
    data: transaction,
  });
});

/**
 * @desc    Stock Out - Remove inventory
 * @route   POST /api/inventory/stock-out
 * @access  Private (Admin, Seller)
 */
export const stockOut = asyncHandler(async (req, res, next) => {
  const userId = req.user?._id || "695dd45041f5e32466527d93"; // Temporary

  const { productId, modelId, sku, quantity, note, warehouseId } = req.body;

  if (!productId || !modelId || !sku || !quantity) {
    throw new ErrorResponse(
      "Please provide productId, modelId, sku, and quantity",
      400
    );
  }

  const transaction = await inventoryService.stockOut(
    { productId, modelId, sku, quantity, note, warehouseId },
    userId
  );

  res.status(201).json({
    success: true,
    message: `Stock decreased by ${quantity}`,
    data: transaction,
  });
});

/**
 * @desc    Adjust stock - Direct adjustment
 * @route   POST /api/inventory/adjust
 * @access  Private (Admin, Seller)
 */
export const adjustStock = asyncHandler(async (req, res, next) => {
  const userId = req.user?._id || "695dd45041f5e32466527d93"; // Temporary

  const { productId, modelId, sku, newStock, costPrice, note, warehouseId } = req.body;

  if (!productId || !modelId || !sku || newStock === undefined) {
    throw new ErrorResponse(
      "Please provide productId, modelId, sku, and newStock",
      400
    );
  }

  const transaction = await inventoryService.adjustStock(
    { productId, modelId, sku, newStock, costPrice, note, warehouseId },
    userId
  );

  const msgs = [`Stock adjusted to ${newStock}`];
  if (costPrice !== undefined) msgs.push(`cost price updated to ${costPrice}`);

  res.status(201).json({
    success: true,
    message: msgs.join(", "),
    data: transaction,
  });
});

/**
 * @desc    Get inventory transactions
 * @route   GET /api/inventory/transactions
 * @access  Private (Admin, Seller)
 */
export const getTransactions = asyncHandler(async (req, res, next) => {
  const { productId, sku, type, startDate, endDate, createdBy, page, limit } =
    req.query;

  const options = {
    productId,
    sku,
    type,
    startDate,
    endDate,
    createdBy,
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 50,
  };

  const result = await inventoryService.getTransactions({}, options);

  res.status(200).json({
    success: true,
    count: result.transactions.length,
    pagination: result.pagination,
    data: result.transactions,
  });
});

/**
 * @desc    Get transaction by ID
 * @route   GET /api/inventory/transactions/:id
 * @access  Private (Admin, Seller)
 */
export const getTransaction = asyncHandler(async (req, res, next) => {
  const transaction = await inventoryService.getTransactionById(req.params.id);

  res.status(200).json({
    success: true,
    data: transaction,
  });
});

/**
 * @desc    Get product inventory summary
 * @route   GET /api/inventory/summary/:productId
 * @access  Private (Admin, Seller)
 */
export const getProductInventorySummary = asyncHandler(
  async (req, res, next) => {
    const summary = await inventoryService.getProductInventorySummary(
      req.params.productId
    );

    res.status(200).json({
      success: true,
      data: summary,
    });
  }
);

/**
 * @desc    Get inventory statistics
 * @route   GET /api/inventory/stats
 * @access  Private (Admin, Seller)
 */
export const getInventoryStats = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, productId } = req.query;

  const filters = { startDate, endDate, productId };

  const stats = await inventoryService.getInventoryStats(filters);

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Bulk stock update
 * @route   POST /api/inventory/bulk-update
 * @access  Private (Admin, Seller)
 */
export const bulkStockUpdate = asyncHandler(async (req, res, next) => {
  const userId = req.user?._id || "695dd45041f5e32466527d93"; // Temporary
  const { updates } = req.body;

  if (!updates || !Array.isArray(updates) || updates.length === 0) {
    return next(new ErrorResponse("Please provide updates array", 400));
  }

  const result = await inventoryService.bulkStockUpdate(updates, userId);

  res.status(200).json({
    success: true,
    message: `${result.results.length} items updated successfully`,
    data: {
      successful: result.results.length,
      failed: result.errors.length,
      results: result.results,
      errors: result.errors,
    },
  });
});

/**
 * @desc    Get lot-by-lot stock breakdown for a SKU (FIFO)
 * @route   GET /api/inventory/lots/:sku
 * @access  Private (Admin, Seller)
 */
export const getLotBreakdown = asyncHandler(async (req, res, next) => {
  const { sku } = req.params;
  const { warehouseId } = req.query;

  if (!sku) {
    throw new ErrorResponse("Please provide a SKU", 400);
  }

  const data = await inventoryService.getLotBreakdownBySku(sku, warehouseId || null);

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * @desc    Get demand forecast and restock alerts for seller
 * @route   GET /api/inventory/demand-forecast
 * @access  Private (Seller only)
 */
export const getDemandForecast = asyncHandler(async (req, res, next) => {
  const sellerId = req.user?._id;
  const { days = 90, trendDays = 30, bypassCache = false } = req.query;

  if (!sellerId) {
    throw new ErrorResponse("Authentication required", 401);
  }

  const data = await demandForecastService.getDemandForecast(
    sellerId.toString(),
    { 
      days: parseInt(days) || 90, 
      trendDays: parseInt(trendDays) || 30,
      bypassCache: bypassCache === 'true' || bypassCache === true,
    },
  );

  res.status(200).json({
    success: true,
    data,
  });
});

/**
 * @desc    Get detailed demand analysis for a single product
 * @route   GET /api/inventory/demand-forecast/:productId/details
 * @access  Private (Seller only)
 */
export const getProductDemandDetails = asyncHandler(async (req, res, next) => {
  const sellerId = req.user?._id;
  const { productId } = req.params;
  const { days = 30 } = req.query;

  if (!sellerId) throw new ErrorResponse("Authentication required", 401);

  const data = await demandForecastService.getProductDemandDetails(
    sellerId.toString(),
    productId,
    { days: parseInt(days) || 30 },
  );

  res.status(200).json({ success: true, data });
});

/**
 * @desc    Get detailed product performance with weekly breakdown
 * @route   GET /api/inventory/product-performance/:productId
 * @access  Private (Seller only)
 */
export const getProductPerformance = asyncHandler(async (req, res, next) => {
  const sellerId = req.user?._id;
  const { productId } = req.params;
  const { weeks = 12 } = req.query;

  if (!sellerId) {
    throw new ErrorResponse("Authentication required", 401);
  }

  if (!productId) {
    throw new ErrorResponse("Please provide productId", 400);
  }

  const data = await demandForecastService.getProductPerformance(
    sellerId.toString(),
    productId,
    parseInt(weeks) || 12,
  );

  res.status(200).json({
    success: true,
    data,
  });
});

