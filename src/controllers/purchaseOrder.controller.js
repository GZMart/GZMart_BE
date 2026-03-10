import * as purchaseOrderService from "../services/purchaseOrder.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * ===================================================================
 * PURCHASE ORDER CONTROLLERS
 * ===================================================================
 */

/**
 * @desc    Preview Landed Cost calculation without saving a PO
 * @route   POST /api/purchase-orders/calculate
 * @access  Private (Admin/Manager)
 */
export const calculateLandedCost = asyncHandler(async (req, res) => {
  const result = purchaseOrderService.calculateLandedCostPreview(req.body);

  const responseItems = result.itemsWithLC.map((item) => ({
    sku:                item.sku || "",
    productName:       item.productName || "",
    quantity:          item.quantity,
    unitPriceCny:      item.unitPriceCny,
    priceVnd:          Math.round(item.priceVnd),
    chargeableWeightKg: item.chargeableWeightKg,
    landedCostUnit:    item.landedCostUnit,
    breakdown:         item.breakdown,
  }));

  res.status(200).json({
    success: true,
    data: {
      items:   responseItems,
      summary: result.summary,
    },
  });
});

/**
 * @desc    Create new purchase order
 * @route   POST /api/purchase-orders
 * @access  Private (Admin/Manager)
 */
export const createPurchaseOrder = asyncHandler(async (req, res) => {
  const purchaseOrder = await purchaseOrderService.createPurchaseOrder(
    req.body,
    req.user._id,
  );

  res.status(201).json({
    success: true,
    message: "Purchase Order created successfully",
    data: purchaseOrder,
  });
});

/**
 * @desc    Get all purchase orders with filters
 * @route   GET /api/purchase-orders
 * @access  Private (Admin/Manager)
 */
export const getPurchaseOrders = asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    supplierId: req.query.supplierId,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    sortBy: req.query.sortBy || "createdAt",
    sortOrder: req.query.sortOrder || "desc",
  };

  const result = await purchaseOrderService.getPurchaseOrders(filters, req.user);

  res.status(200).json({
    success: true,
    data: result.purchaseOrders,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get purchase order by ID
 * @route   GET /api/purchase-orders/:id
 * @access  Private (Admin/Manager)
 */
export const getPurchaseOrderById = asyncHandler(async (req, res) => {
  const purchaseOrder = await purchaseOrderService.getPurchaseOrderById(
    req.params.id,
    req.user,
  );

  res.status(200).json({
    success: true,
    data: purchaseOrder,
  });
});

/**
 * @desc    Update purchase order
 * @route   PUT /api/purchase-orders/:id
 * @access  Private (Admin/Manager)
 */
export const updatePurchaseOrder = asyncHandler(async (req, res) => {
  const purchaseOrder = await purchaseOrderService.updatePurchaseOrder(
    req.params.id,
    req.body,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: "Purchase Order updated successfully",
    data: purchaseOrder,
  });
});

/**
 * @desc    Complete purchase order (Goods received)
 * @route   POST /api/purchase-orders/:id/complete
 * @access  Private (Admin/Manager)
 */
export const completePurchaseOrder = asyncHandler(async (req, res) => {
  const result = await purchaseOrderService.completePurchaseOrder(
    req.params.id,
    req.user._id,
  );

  res.status(200).json({
    success: true,
    message: result.message,
    data: {
      purchaseOrder: result.purchaseOrder,
      summary: result.summary,
      updatedProducts: result.updatedProducts,
      inventoryTransactions: result.inventoryTransactions,
    },
  });
});

/**
 * @desc    Cancel purchase order
 * @route   POST /api/purchase-orders/:id/cancel
 * @access  Private (Admin/Manager)
 */
export const cancelPurchaseOrder = asyncHandler(async (req, res) => {
  const purchaseOrder = await purchaseOrderService.cancelPurchaseOrder(
    req.params.id,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: "Purchase Order cancelled successfully",
    data: purchaseOrder,
  });
});

/**
 * ===================================================================
 * SUPPLIER CONTROLLERS
 * ===================================================================
 */

/**
 * @desc    Create new supplier
 * @route   POST /api/suppliers
 * @access  Private (Admin/Manager)
 */
export const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await purchaseOrderService.createSupplier(
    req.body,
    req.user._id,
  );

  res.status(201).json({
    success: true,
    message: "Supplier created successfully",
    data: supplier,
  });
});

/**
 * @desc    Get all suppliers with filters
 * @route   GET /api/suppliers
 * @access  Private (Admin/Manager)
 */
export const getSuppliers = asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    search: req.query.search,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    sortBy: req.query.sortBy || "name",
    sortOrder: req.query.sortOrder || "asc",
  };

  const result = await purchaseOrderService.getSuppliers(filters, req.user);

  res.status(200).json({
    success: true,
    data: result.suppliers,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get supplier by ID
 * @route   GET /api/suppliers/:id
 * @access  Private (Admin/Manager)
 */
export const getSupplierById = asyncHandler(async (req, res) => {
  const supplier = await purchaseOrderService.getSupplierById(req.params.id, req.user);

  res.status(200).json({
    success: true,
    data: supplier,
  });
});

/**
 * @desc    Update supplier
 * @route   PUT /api/suppliers/:id
 * @access  Private (Admin/Manager)
 */
export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await purchaseOrderService.updateSupplier(
    req.params.id,
    req.body,
    req.user,
  );

  res.status(200).json({
    success: true,
    message: "Supplier updated successfully",
    data: supplier,
  });
});

/**
 * @desc    Delete supplier (soft delete)
 * @route   DELETE /api/suppliers/:id
 * @access  Private (Admin/Manager)
 */
export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await purchaseOrderService.deleteSupplier(req.params.id, req.user);

  res.status(200).json({
    success: true,
    message: "Supplier deleted successfully",
    data: supplier,
  });
});

/**
 * ===================================================================
 * INVENTORY MANAGEMENT CONTROLLERS
 * ===================================================================
 */

/**
 * @desc    Get low stock items
 * @route   GET /api/inventory/low-stock
 * @access  Private (Admin/Manager)
 */
export const getLowStockItems = asyncHandler(async (req, res) => {
  const warehouseId = req.query.warehouseId || null;
  const limit = parseInt(req.query.limit) || 50;

  const lowStockItems = await purchaseOrderService.getLowStockItems(
    warehouseId,
    limit,
  );

  res.status(200).json({
    success: true,
    count: lowStockItems.length,
    data: lowStockItems,
  });
});

/**
 * @desc    Get inventory valuation
 * @route   GET /api/inventory/valuation
 * @access  Private (Admin/Manager)
 */
export const getInventoryValuation = asyncHandler(async (req, res) => {
  const warehouseId = req.query.warehouseId || null;

  const valuation =
    await purchaseOrderService.getInventoryValuation(warehouseId);

  res.status(200).json({
    success: true,
    data: valuation,
  });
});

/**
 * ===================================================================
 * SUPPLIER ANALYTICS CONTROLLERS
 * ===================================================================
 */

/**
 * @desc    Get supplier purchase history with analytics
 * @route   GET /api/suppliers/:id/purchase-history
 * @access  Private (Admin/Manager)
 */
export const getSupplierPurchaseHistory = asyncHandler(async (req, res) => {
  const supplierId = req.params.id;
  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    status: req.query.status,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
  };

  const result = await purchaseOrderService.getSupplierPurchaseHistory(
    supplierId,
    filters,
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * ===================================================================
 * PROFIT & LOSS REPORTING CONTROLLERS
 * ===================================================================
 */

/**
 * @desc    Get Profit & Loss report for a period
 * @route   GET /api/reports/profit-loss
 * @access  Private (Admin only)
 */
export const getProfitLossReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    throw new ErrorResponse("Start date and end date are required", 400);
  }

  const report = await purchaseOrderService.getProfitLossReport(
    startDate,
    endDate,
  );

  res.status(200).json({
    success: true,
    data: report,
  });
});
