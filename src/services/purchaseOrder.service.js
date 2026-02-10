import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Product from "../models/Product.js";
import InventoryItem from "../models/InventoryItem.js";
import InventoryTransaction from "../models/InventoryTransaction.js";
import Supplier from "../models/Supplier.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * ===================================================================
 * PURCHASE ORDER SERVICE
 * Handles supplier management and purchase order operations
 * ===================================================================
 */

/**
 * Complete Purchase Order
 * Handles the entire workflow when goods arrive at the warehouse:
 * 1. Validate PO status
 * 2. Calculate landed cost per unit
 * 3. Update inventory stock and cost price using Weighted Moving Average
 * 4. Log inventory transactions
 * 5. Update PO status to Completed
 *
 * @param {String} purchaseOrderId - The ID of the purchase order to complete
 * @param {String} userId - The ID of the user completing the PO
 * @returns {Object} The completed purchase order
 */
export const completePurchaseOrder = async (purchaseOrderId, userId) => {
  // Validate input
  if (!purchaseOrderId) {
    throw new ErrorResponse("Purchase Order ID is required", 400);
  }

  if (!userId) {
    throw new ErrorResponse("User ID is required", 400);
  }

  // Start a MongoDB session for ACID transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ============================================================
    // STEP 1: Fetch and Validate Purchase Order
    // ============================================================
    const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId)
      .populate("supplierId", "name")
      .session(session);

    if (!purchaseOrder) {
      throw new ErrorResponse("Purchase Order not found", 404);
    }

    // Validate PO status - can only complete Pending orders
    if (purchaseOrder.status !== "Pending") {
      throw new ErrorResponse(
        `Cannot complete Purchase Order with status: ${purchaseOrder.status}. Only 'Pending' orders can be completed.`,
        400,
      );
    }

    // Validate items exist
    if (!purchaseOrder.items || purchaseOrder.items.length === 0) {
      throw new ErrorResponse("Purchase Order has no items to process", 400);
    }

    // ============================================================
    // STEP 2: Calculate Landed Cost Per Unit
    // ============================================================
    // Total Import Quantity = Sum of all item quantities
    const totalImportQuantity = purchaseOrder.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );

    // Edge case: Prevent division by zero
    if (totalImportQuantity === 0) {
      throw new ErrorResponse("Total import quantity cannot be zero", 400);
    }

    // Additional costs to be allocated across all items
    const additionalCosts =
      (purchaseOrder.shippingCost || 0) +
      (purchaseOrder.taxAmount || 0) +
      (purchaseOrder.otherCost || 0);

    // Allocated Cost Per Unit = (shipping + tax + other costs) / Total Import Quantity
    const allocatedCostPerUnit = additionalCosts / totalImportQuantity;

    // ============================================================
    // STEP 3: Update Inventory & Cost Price for Each Item
    // ============================================================
    const inventoryTransactions = [];
    const updatedProducts = [];

    for (const item of purchaseOrder.items) {
      // Fetch the product
      const product = await Product.findById(item.productId).session(session);

      if (!product) {
        throw new ErrorResponse(
          `Product not found: ${item.productName} (ID: ${item.productId})`,
          404,
        );
      }

      // Find the specific model/variant
      const model = product.models.id(item.modelId);

      if (!model) {
        throw new ErrorResponse(
          `Product variant not found for SKU: ${item.sku} in product: ${item.productName}`,
          404,
        );
      }

      // Verify SKU matches
      if (model.sku !== item.sku) {
        throw new ErrorResponse(
          `SKU mismatch for product: ${item.productName}. Expected: ${item.sku}, Found: ${model.sku}`,
          400,
        );
      }

      // Calculate Landed Cost Per Unit for this item
      // Formula: Landed Cost Unit = Item Unit Price + Allocated Cost Per Unit
      const landedCostPerUnit = item.unitPrice + allocatedCostPerUnit;

      // ============================================================
      // STEP 3.1: Update Inventory Item (Single Source of Truth for Stock)
      // ============================================================
      // Find or create inventory item
      let inventoryItem = await InventoryItem.findOne({
        sku: item.sku,
        warehouseId: purchaseOrder.warehouseId,
      }).session(session);

      const stockBefore = inventoryItem ? inventoryItem.quantity : 0;
      const costPriceBefore = inventoryItem ? inventoryItem.costPrice : 0;

      if (!inventoryItem) {
        // Create new inventory item with the imported stock
        inventoryItem = await InventoryItem.create(
          [
            {
              productId: item.productId,
              modelId: item.modelId,
              sku: item.sku,
              quantity: item.quantity, // Start from imported quantity
              costPrice: landedCostPerUnit, // Use landed cost for new items
              warehouseId: purchaseOrder.warehouseId,
              lastRestockDate: new Date(),
            },
          ],
          { session },
        );
        inventoryItem = inventoryItem[0];
      } else {
        // Update existing inventory item using weighted average method
        inventoryItem.addStock(item.quantity, landedCostPerUnit);
        await inventoryItem.save({ session });
      }

      // Get final values from InventoryItem (single source of truth)
      const stockAfter = inventoryItem.quantity;
      const costPriceAfter = inventoryItem.costPrice;

      // ============================================================
      // STEP 3.2: Sync Product.models with InventoryItem (for backward compatibility)
      // ============================================================
      // Sync with InventoryItem (for backward compatibility with existing code)
      model.stock = stockAfter;
      model.costPrice = costPriceAfter;

      // Save the product
      await product.save({ session });
      updatedProducts.push({
        productId: product._id,
        productName: product.name,
        sku: model.sku,
        stockBefore,
        stockAfter,
        costPriceBefore,
        costPriceAfter,
      });

      // ============================================================
      // STEP 4: Create Inventory Transaction Log
      // ============================================================
      const transaction = await InventoryTransaction.create(
        [
          {
            productId: item.productId,
            modelId: item.modelId,
            sku: item.sku,
            type: "in",
            quantity: item.quantity,
            stockBefore,
            stockAfter,
            costPrice: costPriceAfter,
            totalCost: item.quantity * landedCostPerUnit,
            note: `Purchase Order Import - ${purchaseOrder.code}`,
            referenceType: "order",
            referenceId: purchaseOrder._id,
            warehouseId: purchaseOrder.warehouseId,
            createdBy: userId,
            status: "completed",
          },
        ],
        { session },
      );

      inventoryTransactions.push(transaction[0]);
    }

    // ============================================================
    // STEP 5: Update Purchase Order Status
    // ============================================================
    purchaseOrder.status = "Completed";
    purchaseOrder.receivedDate = new Date();
    purchaseOrder.completedBy = userId;
    await purchaseOrder.save({ session });

    // Commit the transaction
    await session.commitTransaction();

    // Return success response
    return {
      success: true,
      message: "Purchase Order completed successfully",
      purchaseOrder: {
        id: purchaseOrder._id,
        code: purchaseOrder.code,
        supplier: purchaseOrder.supplierId?.name,
        status: purchaseOrder.status,
        totalAmount: purchaseOrder.totalAmount,
        finalAmount: purchaseOrder.finalAmount,
        receivedDate: purchaseOrder.receivedDate,
        itemCount: purchaseOrder.items.length,
      },
      summary: {
        totalItemsProcessed: purchaseOrder.items.length,
        totalQuantityReceived: purchaseOrder.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        totalCost: purchaseOrder.finalAmount,
        allocatedCostPerUnit: Math.round(allocatedCostPerUnit * 100) / 100,
      },
      updatedProducts,
      inventoryTransactions: inventoryTransactions.map((t) => ({
        id: t._id,
        sku: t.sku,
        quantity: t.quantity,
        stockAfter: t.stockAfter,
        costPrice: t.costPrice,
      })),
    };
  } catch (error) {
    // Abort transaction on any error
    await session.abortTransaction();
    console.error("Error completing purchase order:", error);

    // Re-throw ErrorResponse as is, wrap other errors
    if (error instanceof ErrorResponse) {
      throw error;
    }

    throw new ErrorResponse(
      `Failed to complete purchase order: ${error.message}`,
      500,
    );
  } finally {
    // End session
    session.endSession();
  }
};

/**
 * Create a new Purchase Order
 * @param {Object} poData - Purchase order data
 * @param {String} userId - User creating the PO
 * @returns {Object} Created purchase order
 */
export const createPurchaseOrder = async (poData, userId) => {
  try {
    // Generate unique PO code if not provided
    if (!poData.code) {
      poData.code = await PurchaseOrder.generateCode();
    }

    // Validate supplier exists
    const supplier = await Supplier.findById(poData.supplierId);
    if (!supplier) {
      throw new ErrorResponse("Supplier not found", 404);
    }

    if (supplier.status !== "Active") {
      throw new ErrorResponse("Supplier is not active", 400);
    }

    // Validate all products and variants exist
    for (const item of poData.items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new ErrorResponse(`Product not found: ${item.productName}`, 404);
      }

      const model = product.models.id(item.modelId);
      if (!model) {
        throw new ErrorResponse(
          `Product variant not found for SKU: ${item.sku}`,
          404,
        );
      }

      // Populate product details
      item.productName = product.name;
      item.sku = model.sku;
    }

    // Create purchase order
    poData.createdBy = userId;
    const purchaseOrder = await PurchaseOrder.create(poData);

    return purchaseOrder;
  } catch (error) {
    if (error instanceof ErrorResponse) {
      throw error;
    }
    throw new ErrorResponse(
      `Failed to create purchase order: ${error.message}`,
      500,
    );
  }
};

/**
 * Get Purchase Order by ID
 * @param {String} purchaseOrderId - PO ID
 * @returns {Object} Purchase order
 */
export const getPurchaseOrderById = async (purchaseOrderId) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId)
    .populate("supplierId", "name contactPerson phone email")
    .populate("createdBy", "name email")
    .populate("completedBy", "name email");

  if (!purchaseOrder) {
    throw new ErrorResponse("Purchase Order not found", 404);
  }

  return purchaseOrder;
};

/**
 * Get all Purchase Orders with filters
 * @param {Object} filters - Filter criteria
 * @returns {Array} List of purchase orders
 */
export const getPurchaseOrders = async (filters = {}) => {
  const {
    status,
    supplierId,
    startDate,
    endDate,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filters;

  const query = {};

  if (status) {
    query.status = status;
  }

  if (supplierId) {
    query.supplierId = supplierId;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      query.createdAt.$lte = new Date(endDate);
    }
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

  const [purchaseOrders, total] = await Promise.all([
    PurchaseOrder.find(query)
      .populate("supplierId", "name")
      .populate("createdBy", "name")
      .sort(sort)
      .skip(skip)
      .limit(limit),
    PurchaseOrder.countDocuments(query),
  ]);

  return {
    purchaseOrders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Update Purchase Order (only for Draft/Pending status)
 * @param {String} purchaseOrderId - PO ID
 * @param {Object} updateData - Data to update
 * @returns {Object} Updated purchase order
 */
export const updatePurchaseOrder = async (purchaseOrderId, updateData) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ErrorResponse("Purchase Order not found", 404);
  }

  // Can only update Draft or Pending orders
  if (!["Draft", "Pending"].includes(purchaseOrder.status)) {
    throw new ErrorResponse(
      `Cannot update Purchase Order with status: ${purchaseOrder.status}`,
      400,
    );
  }

  // Update fields
  Object.keys(updateData).forEach((key) => {
    if (key !== "_id" && key !== "code" && key !== "createdBy") {
      purchaseOrder[key] = updateData[key];
    }
  });

  await purchaseOrder.save();

  return purchaseOrder;
};

/**
 * Cancel Purchase Order
 * @param {String} purchaseOrderId - PO ID
 * @returns {Object} Cancelled purchase order
 */
export const cancelPurchaseOrder = async (purchaseOrderId) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ErrorResponse("Purchase Order not found", 404);
  }

  if (purchaseOrder.status === "Completed") {
    throw new ErrorResponse("Cannot cancel a completed Purchase Order", 400);
  }

  if (purchaseOrder.status === "Cancelled") {
    throw new ErrorResponse("Purchase Order is already cancelled", 400);
  }

  purchaseOrder.status = "Cancelled";
  await purchaseOrder.save();

  return purchaseOrder;
};

/**
 * ===================================================================
 * SUPPLIER SERVICE FUNCTIONS
 * ===================================================================
 */

/**
 * Create a new Supplier
 * @param {Object} supplierData - Supplier data
 * @param {String} userId - User creating the supplier
 * @returns {Object} Created supplier
 */
export const createSupplier = async (supplierData, userId) => {
  try {
    supplierData.createdBy = userId;
    const supplier = await Supplier.create(supplierData);
    return supplier;
  } catch (error) {
    if (error.code === 11000) {
      throw new ErrorResponse("Supplier with this name already exists", 400);
    }
    throw new ErrorResponse(`Failed to create supplier: ${error.message}`, 500);
  }
};

/**
 * Get all Suppliers with filters
 * @param {Object} filters - Filter criteria
 * @returns {Array} List of suppliers
 */
export const getSuppliers = async (filters = {}) => {
  const {
    status,
    search,
    page = 1,
    limit = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters;

  const query = {};

  if (status) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { contactPerson: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

  const [suppliers, total] = await Promise.all([
    Supplier.find(query).sort(sort).skip(skip).limit(limit),
    Supplier.countDocuments(query),
  ]);

  return {
    suppliers,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get Supplier by ID
 * @param {String} supplierId - Supplier ID
 * @returns {Object} Supplier
 */
export const getSupplierById = async (supplierId) => {
  const supplier = await Supplier.findById(supplierId);

  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  return supplier;
};

/**
 * Update Supplier
 * @param {String} supplierId - Supplier ID
 * @param {Object} updateData - Data to update
 * @returns {Object} Updated supplier
 */
export const updateSupplier = async (supplierId, updateData) => {
  const supplier = await Supplier.findById(supplierId);

  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  Object.keys(updateData).forEach((key) => {
    if (key !== "_id" && key !== "createdBy") {
      supplier[key] = updateData[key];
    }
  });

  await supplier.save();

  return supplier;
};

/**
 * Delete Supplier (soft delete by setting status to Inactive)
 * @param {String} supplierId - Supplier ID
 * @returns {Object} Deleted supplier
 */
export const deleteSupplier = async (supplierId) => {
  const supplier = await Supplier.findById(supplierId);

  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  // Check if supplier has active purchase orders
  const activePOs = await PurchaseOrder.countDocuments({
    supplierId,
    status: { $in: ["Pending", "Draft"] },
  });

  if (activePOs > 0) {
    throw new ErrorResponse(
      "Cannot delete supplier with active purchase orders",
      400,
    );
  }

  supplier.status = "Inactive";
  await supplier.save();

  return supplier;
};

/**
 * ===================================================================
 * INVENTORY MANAGEMENT HELPER FUNCTIONS
 *
 * NOTE: Core inventory operations (stockOut, adjustStock, returnStock)
 * are already implemented in inventory.service.js
 *
 * To reduce stock when creating orders, import and use:
 * import { stockOut } from './inventory.service.js'
 *
 * Example usage in Order Service:
 * const result = await stockOut({
 *   productId, modelId, sku, quantity,
 *   note: `Sale - Order ${orderId}`,
 *   warehouseId
 * }, userId);
 * const cogs = result.costPrice * quantity; // For profit calculation
 * ===================================================================
 */

/**
 * Get Low Stock Items
 * Returns products that are below their threshold
 *
 * @param {String} warehouseId - Warehouse ID (optional)
 * @param {Number} limit - Max results
 * @returns {Array} Low stock items
 */
export const getLowStockItems = async (warehouseId = null, limit = 50) => {
  const query = {
    status: "active",
    // Use MongoDB $expr to compare two fields in same document
    $expr: { $lte: ["$quantity", "$lowStockThreshold"] },
  };

  if (warehouseId) {
    query.warehouseId = warehouseId;
  }

  // Find items where quantity <= lowStockThreshold
  const lowStockItems = await InventoryItem.find(query)
    .populate("productId", "name images")
    .sort({ quantity: 1 }) // Sort by lowest stock first
    .limit(limit);

  return lowStockItems.map((item) => ({
    _id: item._id,
    sku: item.sku,
    productName: item.productId?.name,
    currentStock: item.quantity,
    threshold: item.lowStockThreshold,
    stockStatus: item.stockStatus,
    costPrice: item.costPrice,
    warehouseId: item.warehouseId,
  }));
};

/**
 * Get Inventory Valuation
 * Calculate total value of all inventory
 *
 * @param {String} warehouseId - Warehouse ID (optional)
 * @returns {Object} Valuation summary
 */
export const getInventoryValuation = async (warehouseId = null) => {
  const query = {
    status: "active",
  };

  if (warehouseId) {
    query.warehouseId = warehouseId;
  }

  const items = await InventoryItem.find(query);

  const valuation = items.reduce(
    (acc, item) => {
      const itemValue = item.quantity * item.costPrice;
      acc.totalValue += itemValue;
      acc.totalItems += 1;
      acc.totalUnits += item.quantity;
      return acc;
    },
    { totalValue: 0, totalItems: 0, totalUnits: 0 },
  );

  return {
    ...valuation,
    averageCostPerItem:
      valuation.totalItems > 0
        ? valuation.totalValue / valuation.totalItems
        : 0,
  };
};

/**
 * ===================================================================
 * SUPPLIER ANALYTICS SERVICE
 * ===================================================================
 */

/**
 * Get Supplier Purchase History
 * Retrieve detailed purchase order history for a specific supplier
 * with analytics and metrics
 *
 * @param {String} supplierId - The ID of the supplier
 * @param {Object} filters - Optional filters (startDate, endDate, status)
 * @returns {Object} Purchase history and analytics
 */
export const getSupplierPurchaseHistory = async (supplierId, filters = {}) => {
  // Validate supplier exists
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  const { startDate, endDate, status, page = 1, limit = 20 } = filters;
  const skip = (page - 1) * limit;

  // Build query
  const query = { supplierId };

  if (status) {
    query.status = status;
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  // Get purchase orders with pagination
  const purchaseOrders = await PurchaseOrder.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "code items totalAmount shippingCost taxAmount otherCost finalAmount status createdAt receivedDate",
    );

  const totalOrders = await PurchaseOrder.countDocuments(query);

  // Calculate analytics
  const completedOrders = await PurchaseOrder.find({
    supplierId,
    status: "Completed",
  });

  const analytics = {
    totalPurchaseOrders: completedOrders.length,
    totalSpent: completedOrders.reduce((sum, po) => sum + po.finalAmount, 0),
    averageOrderValue:
      completedOrders.length > 0
        ? completedOrders.reduce((sum, po) => sum + po.finalAmount, 0) /
          completedOrders.length
        : 0,
    totalItemsOrdered: completedOrders.reduce(
      (sum, po) =>
        sum + po.items.reduce((itemSum, item) => itemSum + item.quantity, 0),
      0,
    ),
    lastPurchaseDate:
      completedOrders.length > 0
        ? completedOrders[0].receivedDate || completedOrders[0].createdAt
        : null,
  };

  return {
    supplier: {
      _id: supplier._id,
      name: supplier.name,
      contactPerson: supplier.contactPerson,
      phone: supplier.phone,
      email: supplier.email,
      reliabilityScore: supplier.reliabilityScore,
      status: supplier.status,
    },
    analytics,
    purchaseOrders,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders,
      limit,
    },
  };
};

/**
 * ===================================================================
 * PROFIT & LOSS REPORTING SERVICE
 * ===================================================================
 */

/**
 * Calculate Profit & Loss Report
 * Generates comprehensive P&L report for a given period
 * Includes revenue, COGS, gross profit, expenses, and net profit
 *
 * @param {Date} startDate - Start date for the report
 * @param {Date} endDate - End date for the report
 * @returns {Object} P&L report with detailed breakdown
 */
export const getProfitLossReport = async (startDate, endDate) => {
  if (!startDate || !endDate) {
    throw new ErrorResponse("Start date and end date are required", 400);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    throw new ErrorResponse("Start date must be before end date", 400);
  }

  // Note: This is a simplified P&L calculation
  // In production, you would need to integrate with Order model
  // that tracks COGS, platform fees, vouchers, etc.

  // Get completed purchase orders (this represents inventory purchases)
  const purchaseOrders = await PurchaseOrder.find({
    status: "Completed",
    receivedDate: { $gte: start, $lte: end },
  });

  // Calculate total inventory purchases (this becomes COGS over time)
  const totalInventoryPurchases = purchaseOrders.reduce(
    (sum, po) => sum + po.finalAmount,
    0,
  );

  // Get inventory transactions for the period
  const inventoryTransactions = await InventoryTransaction.find({
    createdAt: { $gte: start, $lte: end },
  });

  // Calculate COGS from "out" transactions
  const totalCOGS = inventoryTransactions
    .filter((t) => t.type === "out")
    .reduce((sum, t) => sum + Math.abs(t.quantity) * t.costPrice, 0);

  // Note: Revenue calculation requires Order model integration
  // This is a placeholder structure
  const report = {
    period: {
      startDate: start,
      endDate: end,
      days: Math.ceil((end - start) / (1000 * 60 * 60 * 24)),
    },
    inventory: {
      totalPurchases: totalInventoryPurchases,
      purchaseOrders: purchaseOrders.length,
    },
    costOfGoodsSold: totalCOGS,
    // Placeholder for revenue - needs Order model integration
    revenue: {
      totalRevenue: 0,
      totalOrders: 0,
      note: "Revenue tracking requires Order model integration with costOfGoodsSold field",
    },
    // Gross Profit = Revenue - COGS
    grossProfit: 0 - totalCOGS, // Will be positive when revenue is integrated
    // Operating Expenses (placeholder)
    expenses: {
      platformFees: 0,
      voucherCosts: 0,
      shippingSubsidies: 0,
      otherExpenses: 0,
      total: 0,
      note: "Expense tracking requires integration with order and payment systems",
    },
    // Net Profit = Gross Profit - Operating Expenses
    netProfit: 0 - totalCOGS,
    // Metrics
    metrics: {
      grossProfitMargin: 0, // (Gross Profit / Revenue) * 100
      netProfitMargin: 0, // (Net Profit / Revenue) * 100
    },
  };

  return report;
};
