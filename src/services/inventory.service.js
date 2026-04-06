import InventoryTransaction from "../models/InventoryTransaction.js";
import InventoryItem from "../models/InventoryItem.js";
import Product from "../models/Product.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import mongoose from "mongoose";
import { ErrorResponse } from "../utils/errorResponse.js";
import { normalizeSku, skuMatch } from "../utils/skuUtils.js";

/**
 * Stock In - Add inventory
 */
export const stockIn = async (transactionData, userId) => {
  const { productId, modelId, sku, quantity, costPrice, note, warehouseId } =
    transactionData;

  if (quantity <= 0) {
    throw new ErrorResponse("Quantity must be greater than 0", 400);
  }

  // Validate product and model exist
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const model = product.models.id(modelId);
  if (!model) {
    throw new ErrorResponse("Product model not found", 404);
  }

  if (!skuMatch(model.sku, sku)) {
    throw new ErrorResponse("SKU does not match model", 400);
  }

  // Start DB transaction for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find or create inventory item
    let inventoryItem = await InventoryItem.findOne({
      sku: normalizeSku(sku),
      warehouseId,
    }).session(session);

    if (!inventoryItem) {
      // Seed costPrice from Product.models so the first record isn't hardcoded 0
      inventoryItem = await InventoryItem.create(
        [
          {
            productId,
            modelId,
            sku: normalizeSku(sku),
            quantity: 0,
            costPrice: model.costPrice || 0,
            warehouseId,
          },
        ],
        { session },
      );
      inventoryItem = inventoryItem[0];
    }

    const stockBefore = inventoryItem.quantity;

    // Update stock with weighted average cost
    // Use provided costPrice, fall back to model's existing costPrice
    inventoryItem.addStock(quantity, costPrice || model.costPrice || 0);
    await inventoryItem.save({ session });

    const stockAfter = inventoryItem.quantity;

    // Sync stock back to Product.models for backward compatibility (optional)
    model.stock = stockAfter;
    model.costPrice = inventoryItem.costPrice;

    // Calculate total stock and update product status
    const allInventoryItems = await InventoryItem.find({ productId }).session(
      session,
    );
    const totalStock = allInventoryItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    product.status = totalStock > 0 ? "active" : "out_of_stock";

    await product.save({ session });

    // Create transaction record
    const transaction = await InventoryTransaction.create(
      [
        {
          productId,
          modelId,
          sku: normalizeSku(sku),
          type: "in",
          quantity,
          stockBefore,
          stockAfter,
          costPrice: inventoryItem.costPrice,
          note,
          warehouseId,
          referenceType: "manual",
          createdBy: userId,
          status: "completed",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    return transaction[0];
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Stock Out - Remove inventory
 */
export const stockOut = async (transactionData, userId) => {
  const { productId, modelId, sku, quantity, note, warehouseId } =
    transactionData;

  if (quantity <= 0) {
    throw new ErrorResponse("Quantity must be greater than 0", 400);
  }

  // Validate product and model exist
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const model = product.models.id(modelId);
  if (!model) {
    throw new ErrorResponse("Product model not found", 404);
  }

  if (!skuMatch(model.sku, sku)) {
    throw new ErrorResponse("SKU does not match model", 400);
  }

  // Start DB transaction for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find inventory item
    const inventoryItem = await InventoryItem.findOne({
      sku: normalizeSku(sku),
      warehouseId,
    }).session(session);

    if (!inventoryItem) {
      throw new ErrorResponse("Inventory item not found", 404);
    }

    const stockBefore = inventoryItem.quantity;

    // Reduce stock (will throw error if insufficient)
    inventoryItem.reduceStock(quantity);
    await inventoryItem.save({ session });

    const stockAfter = inventoryItem.quantity;

    // Sync stock back to Product.models for backward compatibility (optional)
    model.stock = stockAfter;

    // Calculate total stock and update product status
    const allInventoryItems = await InventoryItem.find({ productId }).session(
      session,
    );
    const totalStock = allInventoryItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    product.status = totalStock > 0 ? "active" : "out_of_stock";

    await product.save({ session });

    // Create transaction record
    const transaction = await InventoryTransaction.create(
      [
        {
          productId,
          modelId,
          sku: normalizeSku(sku),
          type: "out",
          quantity: -quantity, // Negative for stock out
          stockBefore,
          stockAfter,
          costPrice: inventoryItem.costPrice || 0,
          note,
          warehouseId,
          referenceType: "manual",
          createdBy: userId,
          status: "completed",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    return transaction[0];
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Adjust stock - Direct adjustment
 * Optionally updates costPrice if provided.
 */
export const adjustStock = async (transactionData, userId) => {
  const { productId, modelId, sku, newStock, costPrice, note, warehouseId } =
    transactionData;

  if (newStock < 0) {
    throw new ErrorResponse("Stock cannot be negative", 400);
  }

  // Validate product and model exist
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const model = product.models.id(modelId);
  if (!model) {
    throw new ErrorResponse("Product model not found", 404);
  }

  if (!skuMatch(model.sku, sku)) {
    throw new ErrorResponse("SKU does not match model", 400);
  }

  // Start DB transaction for atomicity
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Find or create inventory item
    let inventoryItem = await InventoryItem.findOne({
      sku: normalizeSku(sku),
      warehouseId,
    }).session(session);

    if (!inventoryItem) {
      inventoryItem = await InventoryItem.create(
        [
          {
            productId,
            modelId,
            sku: normalizeSku(sku),
            quantity: 0,
            costPrice: model.costPrice || 0,
            warehouseId,
          },
        ],
        { session },
      );
      inventoryItem = inventoryItem[0];
    }

    const stockBefore = inventoryItem.quantity;
    const stockAfter = newStock;
    const quantity = stockAfter - stockBefore;

    // Set new stock
    inventoryItem.setStock(stockAfter);

    // Update cost price if explicitly provided
    const costPriceBefore = inventoryItem.costPrice;
    if (
      costPrice !== undefined &&
      costPrice !== null &&
      Number(costPrice) >= 0
    ) {
      inventoryItem.costPrice = Number(costPrice);
      inventoryItem.costSource = "manual";
      inventoryItem.costSourcePoId = null;
    }

    await inventoryItem.save({ session });

    // Sync stock and costPrice back to Product.models
    model.stock = stockAfter;
    if (
      costPrice !== undefined &&
      costPrice !== null &&
      Number(costPrice) >= 0
    ) {
      model.costPrice = Number(costPrice);
      model.costSource = "manual";
      model.costSourcePoId = null;
    }

    // Calculate total stock and update product status
    const allInventoryItems = await InventoryItem.find({ productId }).session(
      session,
    );
    const totalStock = allInventoryItems.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    product.status = totalStock > 0 ? "active" : "out_of_stock";

    await product.save({ session });

    const effectiveCostPrice = inventoryItem.costPrice || 0;
    const noteText =
      note ||
      [
        `Stock adjusted from ${stockBefore} to ${stockAfter}`,
        costPrice !== undefined && Number(costPrice) !== costPriceBefore
          ? `Cost price updated from ${costPriceBefore} to ${costPrice}`
          : null,
      ]
        .filter(Boolean)
        .join("; ");

    // Create transaction record
    const transaction = await InventoryTransaction.create(
      [
        {
          productId,
          modelId,
          sku: normalizeSku(sku),
          type: "adjust",
          quantity,
          stockBefore,
          stockAfter,
          costPrice: effectiveCostPrice,
          note: noteText,
          warehouseId,
          referenceType: "adjustment",
          createdBy: userId,
          status: "completed",
        },
      ],
      { session },
    );

    await session.commitTransaction();

    return transaction[0];
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Get inventory transactions with filters
 */
export const getTransactions = async (filters = {}, options = {}) => {
  const {
    productId,
    sku,
    type,
    startDate,
    endDate,
    createdBy,
    page = 1,
    limit = 50,
  } = options;

  const query = {};

  if (productId) query.productId = productId;
  if (sku) query.sku = normalizeSku(sku);
  if (type) query.type = type;
  if (createdBy) query.createdBy = createdBy;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const skip = (page - 1) * limit;

  const [transactions, total] = await Promise.all([
    InventoryTransaction.find(query)
      .populate("productId", "name slug")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InventoryTransaction.countDocuments(query),
  ]);

  return {
    transactions,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

/**
 * Get transaction by ID
 */
export const getTransactionById = async (transactionId) => {
  const transaction = await InventoryTransaction.findById(transactionId)
    .populate("productId", "name slug images")
    .populate("createdBy", "name email");

  if (!transaction) {
    throw new ErrorResponse("Transaction not found", 404);
  }

  return transaction;
};

/**
 * Get inventory summary for a product
 */
export const getProductInventorySummary = async (productId) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const transactions = await InventoryTransaction.find({ productId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const totalIn = transactions
    .filter((t) => t.quantity > 0)
    .reduce((sum, t) => sum + t.quantity, 0);

  const totalOut = transactions
    .filter((t) => t.quantity < 0)
    .reduce((sum, t) => sum + Math.abs(t.quantity), 0);

  // Get inventory items for all models
  const inventoryItems = await InventoryItem.find({ productId }).lean();

  const currentStock = inventoryItems.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  const modelsSummary = await Promise.all(
    product.models.map(async (model) => {
      const inventoryItem = inventoryItems.find(
        (item) => skuMatch(item.sku, model.sku),
      );

      return {
        modelId: model._id,
        sku: model.sku,
        currentStock: inventoryItem?.quantity || 0,
        availableStock: inventoryItem?.availableQuantity || 0,
        reservedStock: inventoryItem?.reservedQuantity || 0,
        price: model.price,
        costPrice: inventoryItem?.costPrice || model.costPrice || 0,
        stockValue:
          (inventoryItem?.quantity || 0) * (inventoryItem?.costPrice || 0),
        stockStatus: inventoryItem?.stockStatus || "out_of_stock",
        tierIndex: model.tierIndex,
      };
    }),
  );

  const totalStockValue = modelsSummary.reduce(
    (sum, m) => sum + m.stockValue,
    0,
  );

  return {
    productId,
    productName: product.name,
    totalIn,
    totalOut,
    currentStock,
    totalStockValue,
    models: modelsSummary,
    recentTransactions: transactions.slice(0, 10),
  };
};

/**
 * Get inventory statistics
 */
export const getInventoryStats = async (filters = {}) => {
  const { startDate, endDate, productId } = filters;

  const matchStage = { status: "completed" };
  if (productId) matchStage.productId = productId;
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      matchStage.createdAt.$lte = end;
    }
  }

  const stats = await InventoryTransaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
        totalQuantity: { $sum: "$quantity" },
        totalValue: { $sum: "$totalCost" },
      },
    },
  ]);

  const totalTransactions =
    await InventoryTransaction.countDocuments(matchStage);

  return {
    totalTransactions,
    byType: stats,
    period: {
      startDate: startDate || null,
      endDate: endDate || null,
    },
  };
};

/**
 * Bulk stock update
 */
export const bulkStockUpdate = async (updates, userId) => {
  const results = [];
  const errors = [];

  for (const update of updates) {
    try {
      const { productId, modelId, sku, quantity, type = "adjust" } = update;

      let transaction;
      if (type === "in") {
        transaction = await stockIn(
          { productId, modelId, sku, quantity, costPrice: update.costPrice },
          userId,
        );
      } else if (type === "out") {
        transaction = await stockOut(
          { productId, modelId, sku, quantity },
          userId,
        );
      } else {
        transaction = await adjustStock(
          { productId, modelId, sku, newStock: quantity },
          userId,
        );
      }

      results.push(transaction);
    } catch (error) {
      errors.push({
        sku: update.sku,
        error: error.message,
      });
    }
  }

  return { results, errors };
};

/**
 * Get inventory item by SKU
 */
export const getInventoryItemBySKU = async (sku, warehouseId = null) => {
  const inventoryItem = await InventoryItem.findOne({
    sku: normalizeSku(sku),
    warehouseId,
  })
    .populate("productId", "name slug images")
    .lean();

  if (!inventoryItem) {
    throw new ErrorResponse("Inventory item not found", 404);
  }

  return inventoryItem;
};

/**
 * Get all inventory items with filters
 */
export const getInventoryItems = async (filters = {}, options = {}) => {
  const {
    productId,
    warehouseId,
    status,
    lowStock,
    page = 1,
    limit = 50,
  } = options;

  const query = {};

  if (productId) query.productId = productId;
  if (warehouseId) query.warehouseId = warehouseId;
  if (status) query.status = status;

  // Filter for low stock items
  if (lowStock === true || lowStock === "true") {
    query.$expr = { $lte: ["$quantity", "$lowStockThreshold"] };
  }

  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    InventoryItem.find(query)
      .populate("productId", "name slug images")
      .sort({ quantity: 1 }) // Show low stock first
      .skip(skip)
      .limit(limit)
      .lean(),
    InventoryItem.countDocuments(query),
  ]);

  return {
    items,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
  };
};

/**
 * Reserve stock for order (when order is created but not paid)
 */
export const reserveStock = async (sku, quantity, warehouseId = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const inventoryItem = await InventoryItem.findOne({
      sku: normalizeSku(sku),
      warehouseId,
    }).session(session);

    if (!inventoryItem) {
      throw new ErrorResponse("Inventory item not found", 404);
    }

    if (inventoryItem.availableQuantity < quantity) {
      throw new ErrorResponse(
        `Insufficient available stock. Available: ${inventoryItem.availableQuantity}, Requested: ${quantity}`,
        400,
      );
    }

    inventoryItem.reservedQuantity += quantity;
    await inventoryItem.save({ session });

    await session.commitTransaction();

    return inventoryItem;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Release reserved stock (when order is cancelled)
 */
export const releaseReservedStock = async (
  sku,
  quantity,
  warehouseId = null,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const inventoryItem = await InventoryItem.findOne({
      sku: normalizeSku(sku),
      warehouseId,
    }).session(session);

    if (!inventoryItem) {
      throw new ErrorResponse("Inventory item not found", 404);
    }

    inventoryItem.reservedQuantity = Math.max(
      0,
      inventoryItem.reservedQuantity - quantity,
    );
    await inventoryItem.save({ session });

    await session.commitTransaction();

    return inventoryItem;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Confirm stock (convert reserved to actual stock reduction - when order is paid)
 */
export const confirmStock = async (
  sku,
  quantity,
  userId,
  orderId,
  warehouseId = null,
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const inventoryItem = await InventoryItem.findOne({
      sku: normalizeSku(sku),
      warehouseId,
    }).session(session);

    if (!inventoryItem) {
      throw new ErrorResponse("Inventory item not found", 404);
    }

    const stockBefore = inventoryItem.quantity;

    // Reduce both reserved and actual quantity
    inventoryItem.reservedQuantity = Math.max(
      0,
      inventoryItem.reservedQuantity - quantity,
    );
    inventoryItem.quantity = Math.max(0, inventoryItem.quantity - quantity);

    await inventoryItem.save({ session });

    const stockAfter = inventoryItem.quantity;

    // Create transaction record
    const transaction = await InventoryTransaction.create(
      [
        {
          productId: inventoryItem.productId,
          modelId: inventoryItem.modelId,
          sku: normalizeSku(sku),
          type: "out",
          quantity: -quantity,
          stockBefore,
          stockAfter,
          costPrice: inventoryItem.costPrice || 0,
          note: `Stock reduced for order ${orderId}`,
          warehouseId,
          referenceType: "order",
          referenceId: orderId,
          createdBy: userId,
          status: "completed",
        },
      ],
      { session },
    );

    // Sync to Product model
    const product = await Product.findById(inventoryItem.productId).session(
      session,
    );
    if (product) {
      const model = product.models.id(inventoryItem.modelId);
      if (model) {
        model.stock = stockAfter;
        await product.save({ session });
      }
    }

    await session.commitTransaction();

    return { inventoryItem, transaction: transaction[0] };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Get lot-by-lot stock breakdown for a SKU using FIFO.
 * Returns each "in" transaction as a lot with its remaining quantity
 * after applying all "out"/"adjust" transactions chronologically.
 */
export const getLotBreakdownBySku = async (sku, warehouseId = null) => {
  const normalizedSku = normalizeSku(sku);

  const inventoryItem = await InventoryItem.findOne({
    sku: normalizedSku,
    warehouseId: warehouseId || null,
  }).lean();

  if (!inventoryItem) {
    throw new ErrorResponse(`Inventory item not found for SKU: ${normalizedSku}`, 404);
  }

  const query = { sku: normalizedSku };
  if (warehouseId) query.warehouseId = warehouseId;

  const transactions = await InventoryTransaction.find(query)
    .sort({ createdAt: 1 })
    .lean();

  const inLots = transactions.filter(
    (t) => t.type === "in" || (t.type === "return" && t.quantity > 0),
  );
  const outflows = transactions.filter(
    (t) => t.quantity < 0 || t.type === "out",
  );

  // Get current selling price for the SKU
  const product = await Product.findById(inventoryItem.productId).lean();
  const model = product?.models?.find((m) => m._id.toString() === inventoryItem.modelId.toString());
  const currentSellingPrice = model?.price || product?.originalPrice || 0;

  // Build mutable lot list
  const lots = inLots.map((t) => ({
    _txId: t._id.toString(),
    lotDate: t.createdAt,
    originalQty: Math.abs(t.quantity),
    remainingQty: Math.abs(t.quantity),
    costPrice: t.costPrice ?? 0,
    referenceType: t.referenceType,
    referenceId: t.referenceId,
    note: t.note || null,
  }));

  // FIFO: consume total outflows from oldest lot first
  let toConsume = outflows.reduce((sum, t) => sum + Math.abs(t.quantity), 0);
  for (const lot of lots) {
    if (toConsume <= 0) break;
    const consumed = Math.min(lot.remainingQty, toConsume);
    lot.remainingQty -= consumed;
    toConsume -= consumed;
  }

  // Keep only lots with remaining stock
  const activeLots = lots.filter((l) => l.remainingQty > 0);

  // Batch-fetch PO codes for PO-referenced lots (note: POs are saved as 'order' in InventoryTransaction)
  const poIds = [
    ...new Set(
      activeLots
        .filter((l) => l.referenceType === "order" && l.referenceId)
        .map((l) => l.referenceId.toString()),
    ),
  ];

  const poMap = {};
  if (poIds.length > 0) {
    const orders = await PurchaseOrder.find({ _id: { $in: poIds } })
      .select("_id code supplierId")
      .populate("supplierId", "name")
      .lean();
    orders.forEach((po) => {
      poMap[po._id.toString()] = {
        code: po.code,
        supplierName: po.supplierId?.name || null,
      };
    });
  }

  const result = activeLots.map((lot, idx) => {
    const poInfo = lot.referenceId
      ? poMap[lot.referenceId.toString()] || null
      : null;
    return {
      lotIndex: idx + 1,
      txId: lot._txId,
      lotDate: lot.lotDate,
      originalQty: lot.originalQty,
      remainingQty: lot.remainingQty,
      costPrice: lot.costPrice,
      referenceType: lot.referenceType,
      poId: lot.referenceId || null,
      poCode: poInfo?.code || null,
      supplierName: poInfo?.supplierName || null,
      sellingPrice: currentSellingPrice,
      note: lot.note,
    };
  });

  return {
    sku: normalizedSku,
    totalRemaining: result.reduce((s, l) => s + l.remainingQty, 0),
    lots: result,
  };
};

