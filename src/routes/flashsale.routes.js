import express from 'express';
import {
  createFlashSale,
  getFlashSales,
  getFlashSaleDetail,
  getActiveFlashSales,
  addProductsToFlashSale,
  getFlashSaleProducts,
  getFlashSaleProduct,
  updateFlashSale,
  updateFlashSaleProduct,
  removeProductFromFlashSale,
  deleteFlashSale,
  getFlashSaleStats,
  searchFlashSaleProducts,
} from '../controllers/flashsale.controller.js';
import { asyncHandler } from '../middlewares/async.middleware.js';
import { authorize } from '../middlewares/role.middleware.js';
import { protect } from '../middlewares/auth.middleware.js';

const router = express.Router();

// ============= PUBLIC ROUTES (No Auth) =============

/**
 * @route   GET /api/flash-sales/active
 * @desc    Get active flash sales (with countdown) - for client homepage
 * @access  Public
 */
router.get('/active', asyncHandler(getActiveFlashSales));

/**
 * @route   GET /api/flash-sales
 * @desc    Get all flash sales with filters
 * @access  Public
 */
router.get('/', asyncHandler(getFlashSales));

// ============= PRIVATE ROUTES (Seller, Admin) =============

/**
 * @route   POST /api/flash-sales
 * @desc    Create new flash sale for a product
 * @access  Private (Seller, Admin)
 */
router.post('/', protect, authorize('seller', 'admin'), asyncHandler(createFlashSale));

// ============= SPECIFIC ROUTES BEFORE PARAMETERIZED ROUTES =============

/**
 * @route   GET /api/flash-sales/:flashSaleId/stats
 * @desc    Get flash sale statistics (views, sold, revenue, discount)
 * @access  Private (Seller, Admin)
 */
router.get('/:flashSaleId/stats', protect, authorize('seller', 'admin'), asyncHandler(getFlashSaleStats));

/**
 * @route   GET /api/flash-sales/:flashSaleId/search
 * @desc    Search in flash sale
 * @access  Public
 */
router.get('/:flashSaleId/search', asyncHandler(searchFlashSaleProducts));

// ============= PARAMETERIZED ROUTES =============

/**
 * @route   GET /api/flash-sales/:flashSaleId
 * @desc    Get flash sale detail
 * @access  Public
 */
router.get('/:flashSaleId', asyncHandler(getFlashSaleDetail));

/**
 * @route   PUT /api/flash-sales/:flashSaleId
 * @desc    Update flash sale
 * @access  Private (Seller, Admin)
 */
router.put('/:flashSaleId', protect, authorize('seller', 'admin'), asyncHandler(updateFlashSale));

/**
 * @route   DELETE /api/flash-sales/:flashSaleId
 * @desc    Delete flash sale
 * @access  Private (Seller, Admin)
 */
router.delete('/:flashSaleId', protect, authorize('seller', 'admin'), asyncHandler(deleteFlashSale));

export default router;
