import Order from '../models/Order.js';
import OrderItem from '../models/OrderItem.js';
import Cart from '../models/Cart.js';
import CartItem from '../models/CartItem.js';
import Product from '../models/Product.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import User from '../models/User.js';
import { asyncHandler } from '../middlewares/async.middleware.js';
import { ErrorResponse } from '../utils/errorResponse.js';

// @desc    Get checkout info (user details)
// @route   GET /api/orders/checkout-info
// @access  Private
export const getCheckoutInfo = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ErrorResponse('User not found', 404));
  }

  res.status(200).json({
    success: true,
    data: {
      firstName: user.fullName ? user.fullName.split(' ')[0] : '',
      lastName: user.fullName ? user.fullName.split(' ').slice(1).join(' ') : '',
      email: user.email,
      phone: user.phone || '',
      address: user.address || '',
      state: user.provinceName || 'Melbourne', // Default or from DB
      country: 'Australia', // Hardcoded for now or add to User model if needed
    },
  });
});


// Helper: Calculate Shipping Fee
const calculateShippingFee = (subtotal, city = '') => {
  // Free shipping for orders > 500k
  if (subtotal >= 500000) return 0;
  
  // Example logic: HCM = 20k, others = 35k
  // In reality, this would call a shipping provider API
  if (city && (city.includes('Hồ Chí Minh') || city.includes('HCM'))) {
      return 20000;
  }
  return 35000;
};

// Helper: Generate Order Number
const generateOrderNumber = () => {
  return 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
};

// Helper to check stock (reused logic, kept simple)
const checkStock = async (productId, sku, qty) => {
    const latestTx = await InventoryTransaction.findOne({ productId, sku }).sort({ createdAt: -1 }).lean();
    
    // Fallback for dev: if no transaction exists, assume stock is 100
    if (!latestTx) {
        return { available: true, currentStock: 100 };
    }

    const currentStock = latestTx.stockAfter;
    return { available: currentStock >= qty, currentStock };
};

// @desc    Preview order calculations (Shipping, Total)
// @route   POST /api/orders/preview
// @access  Private
export const previewOrder = asyncHandler(async (req, res, next) => {
  const { city } = req.body;

  // 1. Get Cart
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
     return next(new ErrorResponse('Cart is empty', 400));
  }

  const cartItems = await CartItem.find({ cartId: cart._id }).populate('productId');
  if (cartItems.length === 0) {
    return next(new ErrorResponse('Cart is empty', 400));
  }

  // 2. Calculate Subtotal
  let subtotal = 0;
  for (const item of cartItems) {
      if (item.productId) {
          subtotal += item.price * item.quantity;
      }
  }

  // 3. Calculate Fees
  const shippingCost = calculateShippingFee(subtotal, city);
  const tax = 0;
  const discount = 0; // Future: Calculate based on coupon
  const total = subtotal + shippingCost + tax - discount;

  res.status(200).json({
    success: true,
    data: {
      subtotal,
      shippingCost,
      tax,
      discount,
      total,
      itemCount: cartItems.length
    }
  });
});

// @desc    Place new order
// @route   POST /api/orders
// @access  Private
export const createOrder = asyncHandler(async (req, res, next) => {
  const { shippingAddress, paymentMethod, notes, city } = req.body;

  if (!shippingAddress || !paymentMethod) {
    return next(new ErrorResponse('Please provide shipping address and payment method', 400));
  }

  // 1. Get Cart
  const cart = await Cart.findOne({ userId: req.user._id });
  if (!cart) {
     return next(new ErrorResponse('Cart is empty', 400));
  }

  const cartItems = await CartItem.find({ cartId: cart._id }).populate('productId');
  if (cartItems.length === 0) {
    return next(new ErrorResponse('Cart is empty', 400));
  }

  // 2. Validate Stock & Calculate Subtotal
  let subtotal = 0;
  const validItems = [];

  for (const item of cartItems) {
      if (!item.productId) continue; // Skip deleted products

      // Find model to get SKU
      const product = item.productId;
      // We need to re-find the model to get the SKU. 
      // Ideally CartItem should store SKU, but currently it stores color/size. 
      // Let's assume we find it again.
      const colorTierIndex = product.tiers.findIndex(t => t.name.toLowerCase() === 'color' || t.name.toLowerCase() === 'màu sắc');
      const sizeTierIndex = product.tiers.findIndex(t => t.name.toLowerCase() === 'size' || t.name.toLowerCase() === 'kích thước');
      
      const model = product.models.find(m => {
          const colorMatch = colorTierIndex === -1 || product.tiers[colorTierIndex].options[m.tierIndex[colorTierIndex]] === item.color;
          const sizeMatch = sizeTierIndex === -1 || product.tiers[sizeTierIndex].options[m.tierIndex[sizeTierIndex]] === item.size;
          return colorMatch && sizeMatch;
      });

      if (!model) {
          return next(new ErrorResponse(`Product variant ${product.name} (${item.color}, ${item.size}) is no longer available`, 400));
      }

      const { available, currentStock } = await checkStock(product._id, model.sku, item.quantity);
      if (!available) {
          return next(new ErrorResponse(`Insufficient stock for ${product.name}. Available: ${currentStock}`, 400));
      }

      subtotal += item.price * item.quantity;
      validItems.push({
          cartItem: item,
          model: model,
          product: product
      });
  }

  // 3. Calculate Totals
  const shippingCost = calculateShippingFee(subtotal, city || shippingAddress); 
  const tax = 0; // Simple for now
  const discount = 0; // Implement coupons later
  const totalPrice = subtotal + shippingCost + tax - discount;

  // 4. Create Order
  const order = await Order.create({
      userId: req.user._id,
      orderNumber: generateOrderNumber(),
      status: 'pending',
      totalPrice,
      subtotal,
      shippingAddress,
      shippingCost,
      paymentMethod,
      notes,
      isActive: true
  });

  // 5. Create Order Items & Deduct Inventory
  for (const { cartItem, model, product } of validItems) {
      // Create Order Item
      await OrderItem.create({
          orderId: order._id,
          productId: product._id,
          quantity: cartItem.quantity,
          price: cartItem.price,
          size: cartItem.size,
          color: cartItem.color,
          subtotal: cartItem.price * cartItem.quantity,
          originalPrice: model.price // or product.originalPrice
      });

      // Deduct Inventory
      // Requires fetching latest stock AGAIN to be safe (simple optimistic lock)
      const latestTx = await InventoryTransaction.findOne({ productId: product._id, sku: model.sku }).sort({ createdAt: -1 });
      const currentStock = latestTx ? latestTx.stockAfter : 0;
      
      await InventoryTransaction.create({
          productId: product._id,
          modelId: model._id,
          sku: model.sku,
          type: 'out',
          quantity: cartItem.quantity, // Sold quantity (positive number)
          stockBefore: currentStock,
          stockAfter: currentStock - cartItem.quantity,
          referenceType: 'order',
          referenceId: order._id,
          createdBy: req.user._id,
          note: `Order ${order.orderNumber}`
      });
  }

  // 6. Clear Cart
  await CartItem.deleteMany({ cartId: cart._id });
  cart.totalPrice = 0;
  await cart.save();

  res.status(201).json({
      success: true,
      data: order
  });
});

// @desc    Get my orders
// @route   GET /api/orders
// @access  Private
export const getMyOrders = asyncHandler(async (req, res, next) => {
    const orders = await Order.find({ userId: req.user._id })
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        count: orders.length,
        data: orders
    });
});

// @desc    Get single order
// @route   GET /api/orders/:id
// @access  Private
export const getOrderById = asyncHandler(async (req, res, next) => {
    console.log(`[DEBUG] getOrderById called for ID: ${req.params.id}`);
    
    // Check if ID is valid ObjectId
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
        console.log(`[DEBUG] Invalid Order ID format`);
        return next(new ErrorResponse('Invalid Order ID', 400));
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
        console.log(`[DEBUG] Order not found`);
        return next(new ErrorResponse('Order not found', 404));
    }

    console.log(`[DEBUG] Order found: ${order._id}, User: ${order.userId}`);
    console.log(`[DEBUG] Req User: ${req.user?._id}, Role: ${req.user?.role}`);

    // Verify owner
    if (order.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        console.log(`[DEBUG] Authorization failed`);
        return next(new ErrorResponse('Not authorized', 401));
    }

    try {
        const items = await OrderItem.find({ orderId: order._id }).populate('productId', 'name slug images');
        console.log(`[DEBUG] Items found: ${items.length}`);
        
        res.status(200).json({
            success: true,
            data: {
                ...order.toObject(),
                items
            }
        });
    } catch (err) {
        console.error('[DEBUG] Error finding/populating items:', err);
        throw err;
    }
});


// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private
export const cancelOrder = asyncHandler(async (req, res, next) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        return next(new ErrorResponse('Order not found', 404));
    }

    if (order.userId.toString() !== req.user._id.toString()) {
        return next(new ErrorResponse('Not authorized', 401));
    }

    if (order.status !== 'pending') {
        return next(new ErrorResponse('Order cannot be cancelled in current status', 400));
    }

    order.status = 'cancelled';
    order.cancelledAt = Date.now();
    order.cancellationReason = req.body.reason || 'User cancelled';
    await order.save();

    // Re-stock Inventory
    const items = await OrderItem.find({ orderId: order._id }).populate('productId');
    
    for (const item of items) {
         const product = item.productId;
         // Find model again (simplified)
         // Note: In a real app we might store SKU/ModelId in OrderItem to avoid re-finding
         // but here we iterate product models.
         const colorTierIndex = product.tiers.findIndex(t => t.name.toLowerCase().includes('color') || t.name.toLowerCase().includes('màu'));
         const sizeTierIndex = product.tiers.findIndex(t => t.name.toLowerCase().includes('size') || t.name.toLowerCase().includes('kích'));
         
         const model = product.models.find(m => {
            const colorMatch = colorTierIndex === -1 || product.tiers[colorTierIndex].options[m.tierIndex[colorTierIndex]] === item.color;
            const sizeMatch = sizeTierIndex === -1 || product.tiers[sizeTierIndex].options[m.tierIndex[sizeTierIndex]] === item.size;
            return colorMatch && sizeMatch;
        });

        if (model) {
            const latestTx = await InventoryTransaction.findOne({ productId: product._id, sku: model.sku }).sort({ createdAt: -1 });
            const currentStock = latestTx ? latestTx.stockAfter : 0;

            await InventoryTransaction.create({
                productId: product._id,
                modelId: model._id,
                sku: model.sku,
                type: 'in', // Return means IN
                quantity: item.quantity,
                stockBefore: currentStock,
                stockAfter: currentStock + item.quantity,
                referenceType: 'return',
                referenceId: order._id,
                createdBy: req.user._id,
                note: `Order Cancelled ${order.orderNumber}`
            });
        }
    }

    res.status(200).json({
        success: true,
        data: order
    });
});
