import Cart from '../models/Cart.js';
import CartItem from '../models/CartItem.js';
import Product from '../models/Product.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import { asyncHandler } from '../middlewares/async.middleware.js';
import { ErrorResponse } from '../utils/errorResponse.js';

// Helper to check stock via InventoryTransaction
const checkStockAvailability = async (productId, modelId, sku, requestedQty) => {
  const latestTransaction = await InventoryTransaction.findOne({
    productId,
    // modelId, // Removing modelId from query to rely on SKU which is unique per product
    sku,
  })
    .sort({ createdAt: -1 })
    .lean();

  const currentStock = latestTransaction ? latestTransaction.stockAfter : 0;
  return { available: currentStock >= requestedQty, currentStock };
};

// Helper to find specific model based on size and color
const findProductModel = (product, color, size) => {
  if (!product.tiers || product.tiers.length === 0) return null;

  // Identify tier indices
  const colorTierIndex = product.tiers.findIndex((t) => t.name.toLowerCase() === 'color' || t.name.toLowerCase() === 'màu sắc');
  const sizeTierIndex = product.tiers.findIndex((t) => t.name.toLowerCase() === 'size' || t.name.toLowerCase() === 'kích thước');

  if (!product.models) return null;

  return product.models.find((model) => {
    const colorMatch =
      colorTierIndex === -1 ||
      product.tiers[colorTierIndex].options[model.tierIndex[colorTierIndex]] === color;
    const sizeMatch =
      sizeTierIndex === -1 ||
      product.tiers[sizeTierIndex].options[model.tierIndex[sizeTierIndex]] === size;
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
    path: 'items',
    populate: { path: 'productId', select: 'name slug tiers models' },
  });

  const cartItems = cart.items || [];
  const enrichedItems = [];
  let total = 0;

  // Check realtime stock for each item
  for (const item of cartItems) {
    const product = item.productId;
    if (!product) continue; // Skip if product deleted

    const model = findProductModel(product, item.color, item.size);
    let stockInfo = { available: false, currentStock: 0 };

    if (model) {
      stockInfo = await checkStockAvailability(product._id, model._id, model.sku, item.quantity);
    }
    
    total += item.price * item.quantity;

    enrichedItems.push({
      ...item.toObject(),
      productId: {
          _id: product._id,
          name: product.name,
          slug: product.slug,
          images: product.images, // Top level images
          // Remove tiers, models, etc from response
      },
      stockAvailable: stockInfo.currentStock,
      isAvailable: stockInfo.available,
      exceedsStock: item.quantity > stockInfo.currentStock
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
  const { productId, quantity, color, size } = req.body;

  if (!productId || !quantity || !color || !size) {
    return next(new ErrorResponse('Please provide productId, quantity, color, and size', 400));
  }

  const product = await Product.findById(productId);
  if (!product) {
    return next(new ErrorResponse('Product not found', 404));
  }

  // Find specific variant (model)
  const model = findProductModel(product, color, size);
  if (!model) {
    return next(new ErrorResponse('Selected variant (color/size) not available', 400));
  }

  // Find or create cart
  let cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
    cart = await Cart.create({ userId: req.user._id });
  }

  // Check if item exists in cart
  const existingItem = await CartItem.findOne({
    cartId: cart._id,
    productId,
    color,
    size,
  });

  const newQuantity = existingItem ? existingItem.quantity + quantity : quantity;

  // Realtime Stock Check
  const { available, currentStock } = await checkStockAvailability(
    productId,
    model._id,
    model.sku,
    newQuantity
  );

  if (!available) {
    return next(
      new ErrorResponse(
        `Insufficient stock. Available: ${currentStock}, Requested: ${newQuantity}`,
        400
      )
    );
  }

  if (existingItem) {
    existingItem.quantity = newQuantity;
    // Update price in case product price changed? Usually we keep cart price unless re-fetched, 
    // but for e-commerce, it's safer to update to current price.
    existingItem.price = model.price; 
    existingItem.image = model.image || product.images[0];
    await existingItem.save();
  } else {
    await CartItem.create({
      cartId: cart._id,
      productId,
      quantity,
      size,
      color,
      price: model.price,
      image: model.image || product.images[0],
    });
  }

  // Recalculate Total
  const allItems = await CartItem.find({ cartId: cart._id });
  cart.totalPrice = allItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  await cart.save();

  res.status(200).json({
    success: true,
    message: 'Item added to cart',
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
    return next(new ErrorResponse('Quantity must be at least 1', 400));
  }

  const item = await CartItem.findById(itemId).populate('productId');
  if (!item) {
    return next(new ErrorResponse('Cart item not found', 404));
  }
  
  // Verify ownership via cart
  const cart = await Cart.findOne({ _id: item.cartId, userId: req.user._id });
  if (!cart) {
    return next(new ErrorResponse('Not authorized', 401));
  }

  const product = item.productId;
  const model = findProductModel(product, item.color, item.size);

  if (!model) {
     return next(new ErrorResponse('Product variant info unavailable', 400));
  }

  // Realtime check
  const { available, currentStock } = await checkStockAvailability(
    product._id,
    model._id,
    model.sku,
    quantity
  );

  if (!available) {
    return next(
      new ErrorResponse(
        `Insufficient stock. Available: ${currentStock}, Requested: ${quantity}`,
        400
      )
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
    return next(new ErrorResponse('Cart item not found', 404));
  }

  const cart = await Cart.findOne({ _id: item.cartId, userId: req.user._id });
  if (!cart) {
    return next(new ErrorResponse('Not authorized', 401));
  }

  await item.deleteOne();

  // Recalculate Total
  const allItems = await CartItem.find({ cartId: cart._id });
  cart.totalPrice = allItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  await cart.save();

  res.status(200).json({
    success: true,
    message: 'Item removed from cart',
    cartTotal: cart.totalPrice,
  });
});
