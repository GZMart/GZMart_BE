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

// =============================================================================
// LANDED COST ENGINE – Pure calculation (no DB writes)
// =============================================================================

/**
 * Tính Landed Cost cho từng SKU theo công thức Quảng Châu.
 * Hàm này là PURE – không ghi DB, dùng được cho cả Preview và completePurchaseOrder.
 *
 * @param {Array}  items        - Mảng item từ PO (hoặc payload raw)
 * @param {Object} importConfig - { exchangeRate, buyingServiceFeeRate, shippingRatePerKg, useVolumetricShipping }
 * @param {Object} fixedCosts   - { cnDomesticShippingCny, packagingCostVnd, vnDomesticShippingVnd }
 * @param {Number} taxAmount    - Thuế NK (VNĐ, nếu có)
 * @param {Number} otherCost    - Chi phí khác (VNĐ)
 * @returns {Object} { itemsWithLC, summary }
 */
export const computeLandedCost = (items, importConfig = {}, fixedCosts = {}, taxAmount = 0, otherCost = 0) => {
  const rate             = importConfig.exchangeRate          || 3500;
  const buyingFeeRate    = importConfig.buyingServiceFeeRate  || 0;
  const shippingRateKg   = importConfig.shippingRatePerKg     || 0;
  const useVolumetric    = importConfig.useVolumetricShipping !== false;

  // ─── Bước 1: Tính chargeable weight từng item ────────────────────────────
  const enriched = items.map((item) => {
    const unitPriceCny = item.unitPriceCny > 0 ? item.unitPriceCny : (item.unitPrice / rate);
    const priceVnd     = unitPriceCny * rate;
    const valueCnyLine = unitPriceCny * item.quantity; // giá trị Tệ của dòng
    const valueVndLine = priceVnd * item.quantity;     // giá trị VNĐ của dòng

    // Cân nặng thực → tính chargeable (theo đơn vị kg/unit)
    const volKg       = ((item.dimLength || 0) * (item.dimWidth || 0) * (item.dimHeight || 0)) / 6000;
    const chargePerUnit = useVolumetric ? Math.max(item.weightKg || 0, volKg) : (item.weightKg || 0);
    const chargeableWeightKg = chargePerUnit * item.quantity;

    return { ...item, unitPriceCny, priceVnd, valueCnyLine, valueVndLine, chargeableWeightKg };
  });

  // ─── Bước 2: Tổng hợp ────────────────────────────────────────────────────
  const totalValueCny      = enriched.reduce((s, i) => s + i.valueCnyLine, 0);
  const totalValueVnd      = enriched.reduce((s, i) => s + i.valueVndLine, 0);
  const totalChargeableKg  = enriched.reduce((s, i) => s + i.chargeableWeightKg, 0);

  // ─── Bước 3: Tính các pool chi phí ──────────────────────────────────────
  // Value-based pool (phân bổ theo tỷ lệ giá trị CNY)
  const buyingFeeVnd       = totalValueVnd * buyingFeeRate;
  const cnDomesticVnd      = (fixedCosts.cnDomesticShippingCny || 0) * rate;
  const packagingVnd       = fixedCosts.packagingCostVnd      || 0;
  const valueCostPool      = buyingFeeVnd + cnDomesticVnd + packagingVnd + taxAmount + (otherCost * 0.5);

  // Weight-based pool (phân bổ theo trọng lượng tính cước)
  const intlShippingVnd    = totalChargeableKg * shippingRateKg;
  const vnDomesticVnd      = fixedCosts.vnDomesticShippingVnd || 0;
  const weightCostPool     = intlShippingVnd + vnDomesticVnd + (otherCost * 0.5);

  // ─── Bước 4: Phân bổ và tính LC/unit mỗi SKU ────────────────────────────
  const itemsWithLC = enriched.map((item) => {
    // Value-based allocation (tỷ lệ giá trị Tệ)
    const valueRatio  = totalValueCny > 0 ? item.valueCnyLine / totalValueCny : 0;
    const valueAlloc  = valueCostPool * valueRatio;

    // Weight-based allocation (tỷ lệ chargeable weight)
    const weightRatio = totalChargeableKg > 0 ? item.chargeableWeightKg / totalChargeableKg : 0;
    const weightAlloc = weightCostPool * weightRatio;

    // Tổng chi phí phân bổ cho dòng này
    const totalAllocated = valueAlloc + weightAlloc;

    // LC/unit = (tiền hàng dòng + phí phân bổ dòng) / số lượng
    const landedCostUnit = item.quantity > 0
      ? (item.valueVndLine + totalAllocated) / item.quantity
      : item.priceVnd;

    return {
      ...item,
      chargeableWeightKg: Math.round(item.chargeableWeightKg * 1000) / 1000,
      landedCostUnit: Math.round(landedCostUnit),
      // breakdown (dùng cho preview)
      breakdown: {
        goodsValueVnd:   Math.round(item.valueVndLine),
        valueAllocVnd:   Math.round(valueAlloc),
        weightAllocVnd:  Math.round(weightAlloc),
        totalAllocVnd:   Math.round(totalAllocated),
        lcTotalVnd:      Math.round(item.valueVndLine + totalAllocated),
      },
    };
  });

  const totalLandedCost = itemsWithLC.reduce((s, i) => s + i.breakdown.lcTotalVnd, 0);

  return {
    itemsWithLC,
    summary: {
      exchangeRate:        rate,
      totalValueCny:       Math.round(totalValueCny * 100) / 100,
      totalValueVnd:       Math.round(totalValueVnd),
      totalChargeableKg:   Math.round(totalChargeableKg * 1000) / 1000,
      intlShippingVnd:     Math.round(intlShippingVnd),
      buyingFeeVnd:        Math.round(buyingFeeVnd),
      cnDomesticVnd:       Math.round(cnDomesticVnd),
      packagingVnd:        Math.round(packagingVnd),
      vnDomesticVnd:       Math.round(vnDomesticVnd),
      valueCostPool:       Math.round(valueCostPool),
      weightCostPool:      Math.round(weightCostPool),
      totalLandedCost:     Math.round(totalLandedCost),
    },
  };
};

/**
 * Preview Landed Cost (không cần PO đã lưu)
 * Dùng cho FE real-time hoặc endpoint POST /api/purchase-orders/calculate
 *
 * @param {Object} poData - raw payload giống createPurchaseOrder
 * @returns {Object} { items với LC breakdown, summary }
 */
export const calculateLandedCostPreview = (poData) => {
  const { items = [], importConfig = {}, fixedCosts = {}, taxAmount = 0, otherCost = 0 } = poData;

  if (!items.length) {
    throw new ErrorResponse("Cần ít nhất 1 sản phẩm để tính Landed Cost", 400);
  }

  return computeLandedCost(items, importConfig, fixedCosts, taxAmount, otherCost);
};

/**
 * Complete Purchase Order
 * Handles the entire workflow when goods arrive at the warehouse:
 * 1. Validate PO status
 * 2. Calculate landed cost per unit (using computeLandedCost engine)
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
    // STEP 2: Calculate Landed Cost Per Unit (Guangzhou Engine)
    // ============================================================
    const { itemsWithLC, summary: lcSummary } = computeLandedCost(
      purchaseOrder.items.map((i) => i.toObject ? i.toObject() : { ...i }),
      purchaseOrder.importConfig || {},
      purchaseOrder.fixedCosts || {},
      purchaseOrder.taxAmount || 0,
      purchaseOrder.otherCost || 0,
    );

    // Build lookup map: SKU → computed LC data
    const lcMap = {};
    itemsWithLC.forEach((lc, idx) => {
      // Match by index (order preserved)
      const originalSku = purchaseOrder.items[idx]?.sku;
      if (originalSku) lcMap[originalSku + "_" + idx] = lc;
    });

    // ============================================================
    // STEP 3: Update Inventory & Cost Price for Each Item
    // ============================================================
    const inventoryTransactions = [];
    const updatedProducts = [];

    for (let idx = 0; idx < purchaseOrder.items.length; idx++) {
      const item = purchaseOrder.items[idx];
      const lcData = lcMap[item.sku + "_" + idx];
      const landedCostPerUnit = lcData ? lcData.landedCostUnit : item.unitPrice;

      // Write computed landed cost back to PO item (persisted on save)
      item.chargeableWeightKg = lcData ? lcData.chargeableWeightKg : 0;
      item.landedCostUnit     = landedCostPerUnit;

      // ============================================================
      // STEP 3: Update Inventory (only when item is linked to a listing)
      // ============================================================
      if (!item.productId || !item.modelId) {
        // Free-form import log — landed cost recorded but no inventory update
        continue;
      }

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

      // ============================================================
      // STEP 3.1: Update Inventory Item (Single Source of Truth for Stock)
      // ============================================================
      let inventoryItem = await InventoryItem.findOne({
        sku: item.sku,
        warehouseId: purchaseOrder.warehouseId,
      }).session(session);

      const stockBefore = inventoryItem ? inventoryItem.quantity : 0;
      const costPriceBefore = inventoryItem ? inventoryItem.costPrice : 0;

      if (!inventoryItem) {
        inventoryItem = await InventoryItem.create(
          [
            {
              productId: item.productId,
              modelId: item.modelId,
              sku: item.sku,
              quantity: item.quantity,
              costPrice: landedCostPerUnit,
              costSource: "po",
              costSourcePoId: purchaseOrder._id,
              warehouseId: purchaseOrder.warehouseId,
              lastRestockDate: new Date(),
            },
          ],
          { session },
        );
        inventoryItem = inventoryItem[0];
      } else {
        inventoryItem.addStock(item.quantity, landedCostPerUnit);
        inventoryItem.costSource = "po";
        inventoryItem.costSourcePoId = purchaseOrder._id;
        await inventoryItem.save({ session });
      }

      const stockAfter = inventoryItem.quantity;
      const costPriceAfter = inventoryItem.costPrice;

      // ============================================================
      // STEP 3.2: Sync Product.models (backward compatibility)
      // ============================================================
      model.stock = stockAfter;
      model.costPrice = costPriceAfter;
      model.costSource = "po";
      model.costSourcePoId = purchaseOrder._id;
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
        landedCostEngine: lcSummary,
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

    // Validate products/variants only when productId is provided (linked listing)
    for (const item of poData.items) {
      if (!item.productId) continue; // free-form import log — skip validation

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

      // Sync authoritative data from listing
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
export const getPurchaseOrderById = async (purchaseOrderId, user = null) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId)
    .populate("supplierId", "name contactPerson phone email")
    .populate("createdBy", "name email")
    .populate("completedBy", "name email");

  if (!purchaseOrder) {
    throw new ErrorResponse("Purchase Order not found", 404);
  }

  // Sellers can only view their own purchase orders
  if (user && user.role === "seller" && purchaseOrder.createdBy._id.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to access this purchase order", 403);
  }

  return purchaseOrder;
};

/**
 * Get all Purchase Orders with filters
 * @param {Object} filters - Filter criteria
 * @returns {Array} List of purchase orders
 */
export const getPurchaseOrders = async (filters = {}, user = null) => {
  const {
    status,
    supplierId,
    startDate,
    endDate,
    search,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = filters;

  const query = {};

  // Sellers can only see their own purchase orders
  if (user && user.role === "seller") {
    query.createdBy = user._id;
  }

  if (status) {
    query.status = status;
  }

  if (supplierId) {
    query.supplierId = supplierId;
  }

  if (search && search.trim()) {
    query.code = { $regex: search.trim(), $options: "i" };
  }

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) {
      query.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      // include full day: set to end of day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const skip = (page - 1) * limit;
  const sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };

  // Base query without status filter — used for accurate status counts
  const baseQuery = { ...query };
  delete baseQuery.status;

  const [purchaseOrders, total, pendingCount, completedCount, cancelledCount, draftCount] = await Promise.all([
    PurchaseOrder.find(query)
      .populate("supplierId", "name")
      .populate("createdBy", "name")
      .sort(sort)
      .skip(skip)
      .limit(limit),
    PurchaseOrder.countDocuments(query),
    PurchaseOrder.countDocuments({ ...baseQuery, status: "Pending" }),
    PurchaseOrder.countDocuments({ ...baseQuery, status: "Completed" }),
    PurchaseOrder.countDocuments({ ...baseQuery, status: "Cancelled" }),
    PurchaseOrder.countDocuments({ ...baseQuery, status: "Draft" }),
  ]);

  const totalAll = pendingCount + completedCount + cancelledCount + draftCount;

  return {
    purchaseOrders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      statusCounts: {
        total: totalAll,
        Pending: pendingCount,
        Completed: completedCount,
        Cancelled: cancelledCount,
        Draft: draftCount,
      },
    },
  };
};

/**
 * Update Purchase Order (only for Draft/Pending status)
 * @param {String} purchaseOrderId - PO ID
 * @param {Object} updateData - Data to update
 * @returns {Object} Updated purchase order
 */
export const updatePurchaseOrder = async (purchaseOrderId, updateData, user = null) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ErrorResponse("Purchase Order not found", 404);
  }

  // Sellers can only update their own purchase orders
  if (user && user.role === "seller" && purchaseOrder.createdBy.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to update this purchase order", 403);
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
export const cancelPurchaseOrder = async (purchaseOrderId, user = null) => {
  const purchaseOrder = await PurchaseOrder.findById(purchaseOrderId);

  if (!purchaseOrder) {
    throw new ErrorResponse("Purchase Order not found", 404);
  }

  // Sellers can only cancel their own purchase orders
  if (user && user.role === "seller" && purchaseOrder.createdBy.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to cancel this purchase order", 403);
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
 * @param {Object} user - The requesting user (used to scope seller access)
 * @returns {Array} List of suppliers
 */
export const getSuppliers = async (filters = {}, user = null) => {
  const {
    status,
    search,
    page = 1,
    limit = 20,
    sortBy = "name",
    sortOrder = "asc",
  } = filters;

  const query = {};

  // Sellers can only see their own suppliers
  if (user && user.role === "seller") {
    query.createdBy = user._id;
  }

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
 * @param {Object} user - The requesting user
 * @returns {Object} Supplier
 */
export const getSupplierById = async (supplierId, user = null) => {
  const supplier = await Supplier.findById(supplierId);

  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  // Sellers can only view their own suppliers
  if (user && user.role === "seller" && supplier.createdBy.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to access this supplier", 403);
  }

  return supplier;
};

/**
 * Update Supplier
 * @param {String} supplierId - Supplier ID
 * @param {Object} updateData - Data to update
 * @param {Object} user - The requesting user
 * @returns {Object} Updated supplier
 */
export const updateSupplier = async (supplierId, updateData, user = null) => {
  const supplier = await Supplier.findById(supplierId);

  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  // Sellers can only update their own suppliers
  if (user && user.role === "seller" && supplier.createdBy.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to update this supplier", 403);
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
 * @param {Object} user - The requesting user
 * @returns {Object} Deleted supplier
 */
export const deleteSupplier = async (supplierId, user = null) => {
  const supplier = await Supplier.findById(supplierId);

  if (!supplier) {
    throw new ErrorResponse("Supplier not found", 404);
  }

  // Sellers can only delete their own suppliers
  if (user && user.role === "seller" && supplier.createdBy.toString() !== user._id.toString()) {
    throw new ErrorResponse("Not authorized to delete this supplier", 403);
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
 * @param {String} sellerId - Filter to only this seller's products (optional)
 * @returns {Array} Low stock items
 */
export const getLowStockItems = async (warehouseId = null, limit = 50, sellerId = null) => {
  const query = {
    status: "active",
    // Use MongoDB $expr to compare two fields in same document
    $expr: { $lte: ["$quantity", "$lowStockThreshold"] },
  };

  if (warehouseId) {
    query.warehouseId = warehouseId;
  }

  // Filter by seller: look up productIds that belong to this seller
  if (sellerId) {
    const sellerProductIds = await Product.find({ sellerId }, "_id").lean();
    query.productId = { $in: sellerProductIds.map((p) => p._id) };
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
export const getInventoryValuation = async (warehouseId = null, sellerId = null) => {
  const query = {
    status: "active",
  };

  if (warehouseId) {
    query.warehouseId = warehouseId;
  }

  // Filter by seller's own products only
  if (sellerId) {
    const sellerProductIds = await Product.find({ sellerId }, "_id").lean();
    query.productId = { $in: sellerProductIds.map((p) => p._id) };
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
