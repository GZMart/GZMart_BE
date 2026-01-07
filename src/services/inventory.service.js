import InventoryTransaction from "../models/InventoryTransaction.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * Stock In - Add inventory
 */
export const stockIn = async (transactionData, userId) => {
  const { productId, modelId, sku, quantity, costPrice, note, warehouseId } =
    transactionData;

  if (quantity <= 0) {
    throw new ErrorResponse("Quantity must be greater than 0", 400);
  }

  // Find product and model
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const model = product.models.id(modelId);
  if (!model) {
    throw new ErrorResponse("Product model not found", 404);
  }

  if (model.sku !== sku.toUpperCase()) {
    throw new ErrorResponse("SKU does not match model", 400);
  }

  const stockBefore = model.stock;
  const stockAfter = stockBefore + quantity;

  // Update product stock
  model.stock = stockAfter;
  if (costPrice !== undefined && costPrice !== null) {
    model.costPrice = costPrice;
  }
  await product.save();

  // Create transaction record
  const transaction = await InventoryTransaction.create({
    productId,
    modelId,
    sku: sku.toUpperCase(),
    type: "in",
    quantity,
    stockBefore,
    stockAfter,
    costPrice,
    note,
    warehouseId,
    referenceType: "manual",
    createdBy: userId,
    status: "completed",
  });

  return transaction;
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

  // Find product and model
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const model = product.models.id(modelId);
  if (!model) {
    throw new ErrorResponse("Product model not found", 404);
  }

  if (model.sku !== sku.toUpperCase()) {
    throw new ErrorResponse("SKU does not match model", 400);
  }

  const stockBefore = model.stock;
  const stockAfter = stockBefore - quantity;

  if (stockAfter < 0) {
    throw new ErrorResponse(
      `Insufficient stock. Available: ${stockBefore}, Requested: ${quantity}`,
      400
    );
  }

  // Update product stock
  model.stock = stockAfter;
  await product.save();

  // Create transaction record
  const transaction = await InventoryTransaction.create({
    productId,
    modelId,
    sku: sku.toUpperCase(),
    type: "out",
    quantity: -quantity, // Negative for stock out
    stockBefore,
    stockAfter,
    costPrice: model.costPrice || 0,
    note,
    warehouseId,
    referenceType: "manual",
    createdBy: userId,
    status: "completed",
  });

  return transaction;
};

/**
 * Adjust stock - Direct adjustment
 */
export const adjustStock = async (transactionData, userId) => {
  const { productId, modelId, sku, newStock, note, warehouseId } =
    transactionData;

  if (newStock < 0) {
    throw new ErrorResponse("Stock cannot be negative", 400);
  }

  // Find product and model
  const product = await Product.findById(productId);
  if (!product) {
    throw new ErrorResponse("Product not found", 404);
  }

  const model = product.models.id(modelId);
  if (!model) {
    throw new ErrorResponse("Product model not found", 404);
  }

  if (model.sku !== sku.toUpperCase()) {
    throw new ErrorResponse("SKU does not match model", 400);
  }

  const stockBefore = model.stock;
  const stockAfter = newStock;
  const quantity = stockAfter - stockBefore;

  // Update product stock
  model.stock = stockAfter;
  await product.save();

  // Create transaction record
  const transaction = await InventoryTransaction.create({
    productId,
    modelId,
    sku: sku.toUpperCase(),
    type: "adjust",
    quantity,
    stockBefore,
    stockAfter,
    costPrice: model.costPrice || 0,
    note: note || `Stock adjusted from ${stockBefore} to ${stockAfter}`,
    warehouseId,
    referenceType: "adjustment",
    createdBy: userId,
    status: "completed",
  });

  return transaction;
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
  if (sku) query.sku = sku.toUpperCase();
  if (type) query.type = type;
  if (createdBy) query.createdBy = createdBy;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
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

  const currentStock = product.models.reduce((sum, m) => sum + m.stock, 0);

  const modelsSummary = product.models.map((model) => ({
    modelId: model._id,
    sku: model.sku,
    currentStock: model.stock,
    price: model.price,
    costPrice: model.costPrice || 0,
    stockValue: model.stock * (model.costPrice || 0),
    tierIndex: model.tierIndex,
  }));

  return {
    productId,
    productName: product.name,
    totalIn,
    totalOut,
    currentStock,
    totalStockValue: modelsSummary.reduce((sum, m) => sum + m.stockValue, 0),
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
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
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

  const totalTransactions = await InventoryTransaction.countDocuments(
    matchStage
  );

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
          userId
        );
      } else if (type === "out") {
        transaction = await stockOut(
          { productId, modelId, sku, quantity },
          userId
        );
      } else {
        transaction = await adjustStock(
          { productId, modelId, sku, newStock: quantity },
          userId
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
