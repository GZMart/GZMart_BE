import Cart from "../models/Cart.js";
import CartItem from "../models/CartItem.js";
import Product from "../models/Product.js";
import InventoryItem from "../models/InventoryItem.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import * as campaignService from "../services/campaign.service.js";
import { getShopProgramPriceForVariant } from "../services/product.service.js";
import { isPreOrderProduct } from "../utils/preOrderSla.js";

// Helper to check stock via InventoryItem (source of truth) with fallback to model.stock
const checkStockAvailability = async (
  productId,
  modelId,
  sku,
  requestedQty,
  modelStock = 0,
  productDoc = null,
) => {
  if (productDoc && isPreOrderProduct(productDoc)) {
    const inventoryItem = await InventoryItem.findOne({
      productId,
      sku,
    }).lean();
    const currentStock = inventoryItem ? inventoryItem.quantity : modelStock;
    return { available: true, currentStock };
  }
  const inventoryItem = await InventoryItem.findOne({ productId, sku }).lean();
  const currentStock = inventoryItem ? inventoryItem.quantity : modelStock;
  return { available: currentStock >= requestedQty, currentStock };
};

// Helper to find specific model based on size and color
const findProductModel = (product, color, size) => {
  if (!product.models || product.models.length === 0) return null;

  if (!product.tiers || product.tiers.length === 0) {
    return product.models.find((m) => m.isActive) || product.models[0];
  }

  // Identify tier indices
  const colorTierIndex = product.tiers.findIndex(
    (t) =>
      t.name.toLowerCase() === "color" || t.name.toLowerCase() === "màu sắc",
  );
  const sizeTierIndex = product.tiers.findIndex(
    (t) =>
      t.name.toLowerCase() === "size" || t.name.toLowerCase() === "kích thước",
  );

  if (!product.models) return null;

  return product.models.find((model) => {
    const colorMatch =
      colorTierIndex === -1 ||
      product.tiers[colorTierIndex].options[model.tierIndex[colorTierIndex]] ===
        color;
    const sizeMatch =
      sizeTierIndex === -1 ||
      product.tiers[sizeTierIndex].options[model.tierIndex[sizeTierIndex]] ===
        size;
    return colorMatch && sizeMatch;
  });
};

// @desc    Get current user's cart
// @route   GET /api/cart
// @access  Private
export const getCart = asyncHandler(async (req, res, next) => {
  let cart = await Cart.findOne({ userId: req.user._id });

  if (!cart) {
    // Create empty cart if not exists
    cart = await Cart.create({ userId: req.user._id, totalPrice: 0 });
  }

  // Populate items
  await cart.populate({
    path: "items",
    populate: {
      path: "productId",
      select: "name slug tiers models images preOrderDays",
    },
  });

  const cartItems = cart.items || [];
  const enrichedItems = [];
  let total = 0;

  // Check realtime stock for each item
  for (const item of cartItems) {
    const product = item.productId;
    if (!product) continue; // Skip if product deleted

    let model = null;
    if (item.modelId) {
      model = product.models?.find((m) => String(m._id) === String(item.modelId));
    }
    if (!model) {
      model = findProductModel(product, item.color, item.size);
    }
    let stockInfo = { available: false, currentStock: 0 };

    if (model) {
      stockInfo = await checkStockAvailability(
        product._id,
        model._id,
        model.sku,
        item.quantity,
        model.stock,
        product,
      );
    }

    total += item.price * item.quantity;

    const preOrder = isPreOrderProduct(product);
    enrichedItems.push({
      ...item.toObject(),
      productId: {
        _id: product._id,
        name: product.name,
        slug: product.slug,
        images: product.images, // Top level images
        preOrderDays: product.preOrderDays ?? 0,
        // Remove tiers, models, etc from response
      },
      stockAvailable: stockInfo.currentStock,
      isAvailable: stockInfo.available,
      exceedsStock: preOrder ? false : item.quantity > stockInfo.currentStock,
    });
  }

  // Update total price if different (optional, strictly speaking we update on modify)
  if (Math.abs(cart.totalPrice - total) > 0.01) {
    cart.totalPrice = total;
    await cart.save();
  }

  res.status(200).json({
    success: true,
    data: {
      _id: cart._id,
      userId: cart.userId,
      totalPrice: total,
      items: enrichedItems,
    },
  });
});

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
export const addToCart = asyncHandler(async (req, res, next) => {
  let { productId, quantity, color, size } = req.body;

  if (!productId || !quantity) {
    return next(
      new ErrorResponse("Please provide productId and quantity", 400),
    );
  }

  const product = await Product.findById(productId);
  if (!product) {
    return next(new ErrorResponse("Product not found", 404));
  }

  const hasTiers = Array.isArray(product.tiers) && product.tiers.length > 0;

  // If product has tiers, be forgiving: try to derive color/size from provided modelId
  // or fallback to the first active model instead of rejecting the request.
  if (hasTiers && (!color || !size)) {
    try {
      const modelId =
        req.body.modelId || req.body.model || req.body.model_id || null;
      let resolvedModel = null;

      if (modelId) {
        resolvedModel = product.models.find(
          (m) => String(m._id) === String(modelId),
        );
      }

      // If no explicit modelId or not found, pick the first active model as best-effort
      if (!resolvedModel) {
        resolvedModel =
          (product.models || []).find((m) => m.isActive) || product.models[0];
      }

      if (resolvedModel) {
        // Derive color/size from model.tierIndex + product.tiers
        const tierIdx = Array.isArray(resolvedModel.tierIndex)
          ? resolvedModel.tierIndex
          : [];
        const tiers = Array.isArray(product.tiers) ? product.tiers : [];
        let derivedColor = null;
        let derivedSize = null;

        tiers.forEach((tier, idx) => {
          const name = String(tier?.name || "").toLowerCase();
          const optIdx = tierIdx[idx];
          if (optIdx == null || optIdx < 0) return;
          const value = tier.options?.[optIdx];
          if (!value) return;
          if (
            name.includes("color") ||
            name.includes("màu") ||
            name.includes("mau")
          ) {
            derivedColor = derivedColor || value;
          } else if (
            name.includes("size") ||
            name.includes("kích") ||
            name.includes("kich")
          ) {
            derivedSize = derivedSize || value;
          }
        });

        color = color || derivedColor || "Default";
        size = size || derivedSize || "Default";
      } else {
        // As a last resort, set sensible defaults so request is not blocked
        color = color || "Default";
        size = size || "Default";
      }
    } catch (err) {
      // Non-fatal: ensure defaults
      color = color || "Default";
      size = size || "Default";
    }
  }

  if (!hasTiers) {
    color = color || "Default";
    size = size || "Default";
  }

  // Find specific variant (model) and its index
  const model = findProductModel(product, color, size);
  const modelIndex = product.models.findIndex(
    (m) => m._id.toString() === model?._id.toString(),
  );
  if (!model || modelIndex === -1) {
    return next(
      new ErrorResponse("Selected variant (color/size) not available", 400),
    );
  }

  // Find or create cart
  let cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
    cart = await Cart.create({ userId: req.user._id });
  }

  // Check if item exists in cart
  const query = { cartId: cart._id, productId };
  if (model._id) {
    query.modelId = model._id;
  } else {
    query.color = color;
    query.size = size;
  }
  const existingItem = await CartItem.findOne(query);

  const newQuantity = existingItem
    ? existingItem.quantity + quantity
    : quantity;

  // Realtime Stock Check
  const { available, currentStock } = await checkStockAvailability(
    productId,
    model._id,
    model.sku,
    newQuantity,
    model.stock,
    product,
  );

  if (!available) {
    return next(
      new ErrorResponse(
        `Insufficient stock. Available: ${currentStock}, Requested: ${newQuantity}`,
        400,
      ),
    );
  }

  // Determine best price: Flash Sale > Shop Program > Original
  let cartPrice = model.price;
  const flashSaleInfo = await campaignService.getCampaignPrice(
    productId,
    model.price,
  );
  if (flashSaleInfo.isFlashSale) {
    cartPrice = flashSaleInfo.price;
  } else {
    const spInfo = await getShopProgramPriceForVariant(
      productId,
      modelIndex,
      model.price,
    );
    if (spInfo.isShopProgram) {
      cartPrice = spInfo.price;
    }
  }

  if (existingItem) {
    existingItem.quantity = newQuantity;
    existingItem.price = cartPrice;
    existingItem.image = model.image || product.images[0];
    if (!existingItem.modelId) existingItem.modelId = model._id;
    await existingItem.save();
  } else {
    await CartItem.create({
      cartId: cart._id,
      productId,
      modelId: model._id,
      quantity,
      size,
      color,
      price: cartPrice,
      image: model.image || product.images[0],
    });
  }

  // Recalculate Total
  const allItems = await CartItem.find({ cartId: cart._id });
  cart.totalPrice = allItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  await cart.save();

  res.status(200).json({
    success: true,
    message: "Item added to cart",
    cartTotal: cart.totalPrice,
  });
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/:itemId
// @access  Private
export const updateCartItem = asyncHandler(async (req, res, next) => {
  const { quantity } = req.body;
  const { itemId } = req.params;

  if (!quantity || quantity < 1) {
    return next(new ErrorResponse("Quantity must be at least 1", 400));
  }

  const item = await CartItem.findById(itemId).populate("productId");
  if (!item) {
    return next(new ErrorResponse("Cart item not found", 404));
  }

  // Verify ownership via cart
  const cart = await Cart.findOne({ _id: item.cartId, userId: req.user._id });
  if (!cart) {
    return next(new ErrorResponse("Not authorized", 401));
  }

  const product = item.productId;
  const model = findProductModel(product, item.color, item.size);

  if (!model) {
    return next(new ErrorResponse("Product variant info unavailable", 400));
  }

  // Realtime check
  const { available, currentStock } = await checkStockAvailability(
    product._id,
    model._id,
    model.sku,
    quantity,
    model.stock,
    product,
  );

  if (!available) {
    return next(
      new ErrorResponse(
        `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
        400,
      ),
    );
  }

  item.quantity = quantity;
  await item.save();

  // Recalculate Total
  const allItems = await CartItem.find({ cartId: cart._id });
  cart.totalPrice = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  await cart.save();

  res.status(200).json({
    success: true,
    data: item,
    cartTotal: cart.totalPrice,
  });
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
// @access  Private
export const removeFromCart = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;

  const item = await CartItem.findById(itemId);
  if (!item) {
    return next(new ErrorResponse("Cart item not found", 404));
  }

  const cart = await Cart.findOne({ _id: item.cartId, userId: req.user._id });
  if (!cart) {
    return next(new ErrorResponse("Not authorized", 401));
  }

  await item.deleteOne();

  // Recalculate Total
  const allItems = await CartItem.find({ cartId: cart._id });
  cart.totalPrice = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  await cart.save();

  res.status(200).json({
    success: true,
    message: "Item removed from cart",
    cartTotal: cart.totalPrice,
  });
});
