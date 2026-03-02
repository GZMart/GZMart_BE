import express from "express";
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
} from "../controllers/flashsale.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { authorize } from "../middlewares/role.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/flash-sales/active:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Get active flash sales
 *     description: Get all currently active flash sales with countdown information
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                   description: Number of active flash sales
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       productId:
 *                         type: object
 *                       salePrice:
 *                         type: number
 *                       originalPrice:
 *                         type: number
 *                       discountPercent:
 *                         type: number
 *                       totalQuantity:
 *                         type: number
 *                       soldQuantity:
 *                         type: number
 *                       remainingQuantity:
 *                         type: number
 *                       timeRemaining:
 *                         type: number
 *                         description: Time remaining in milliseconds
 *                       status:
 *                         type: string
 */
router.get("/active", asyncHandler(getActiveFlashSales));

/**
 * @swagger
 * /api/flash-sales:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Get all flash sales
 *     description: Get paginated list of flash sales with optional filters
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, pending, expired, upcoming]
 *         description: Filter by status
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, newest-first, oldest-first, startDate, upcoming, active-first]
 *           default: createdAt
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       productId:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           sku:
 *                             type: string
 *                           images:
 *                             type: array
 *                             items:
 *                               type: string
 *                       campaignTitle:
 *                         type: string
 *                         example: "Flash Sale cuối tuần"
 *                       variantSku:
 *                         type: string
 *                         example: "SP001-RED-M"
 *                       salePrice:
 *                         type: number
 *                         example: 150000
 *                       originalPrice:
 *                         type: number
 *                         example: 200000
 *                       totalQuantity:
 *                         type: integer
 *                         example: 100
 *                       soldQuantity:
 *                         type: integer
 *                         example: 42
 *                       startAt:
 *                         type: string
 *                         format: date-time
 *                       endAt:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 *                         enum: [active, pending, expired, upcoming]
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 total:
 *                   type: integer
 *   post:
 *     tags: [Flash Sales]
 *     summary: Create flash sale
 *     description: Create a new flash sale for a product
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *               - salePrice
 *               - totalQuantity
 *               - startAt
 *               - endAt
 *             properties:
 *               productId:
 *                 type: string
 *                 description: Product ID to create flash sale for
 *               salePrice:
 *                 type: number
 *                 minimum: 1
 *                 description: Flash sale price (must be > 0)
 *               totalQuantity:
 *                 type: integer
 *                 minimum: 1
 *                 description: Total quantity available (must be >= 1)
 *               startAt:
 *                 type: string
 *                 format: date-time
 *                 description: Flash sale start time (must be in the future)
 *               endAt:
 *                 type: string
 *                 format: date-time
 *                 description: Flash sale end time (must be after startAt)
 *               variantSku:
 *                 type: string
 *                 description: SKU of specific variant on sale (optional)
 *               campaignTitle:
 *                 type: string
 *                 description: Campaign title (optional)
 *               purchaseLimitPerOrder:
 *                 type: integer
 *                 default: 1
 *                 description: Maximum quantity per order
 *               purchaseLimitPerUser:
 *                 type: integer
 *                 default: 1
 *                 description: Maximum total quantity per user
 *     responses:
 *       201:
 *         description: Flash sale created successfully
 *       400:
 *         description: Invalid input or product already has an active flash sale
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Product not found
 */
router.get("/", asyncHandler(getFlashSales));

router.post(
  "/",
  protect,
  authorize("seller", "admin"),
  asyncHandler(createFlashSale),
);

// ============= SPECIFIC ROUTES BEFORE PARAMETERIZED ROUTES =============

/**
 * @swagger
 * /api/flash-sales/{flashSaleId}/stats:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Get flash sale statistics
 *     description: Get detailed statistics for a flash sale including pricing, quantities, and time remaining
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashSaleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Flash sale ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     salePrice:
 *                       type: number
 *                       example: 150000
 *                     originalPrice:
 *                       type: number
 *                       example: 200000
 *                     discountPercent:
 *                       type: number
 *                       format: float
 *                       example: 25.00
 *                       description: Discount percentage with 2 decimal places
 *                     discountAmount:
 *                       type: number
 *                       example: 50000
 *                     soldQuantity:
 *                       type: integer
 *                       example: 42
 *                     totalQuantity:
 *                       type: integer
 *                       example: 100
 *                     remainingQuantity:
 *                       type: integer
 *                       example: 58
 *                     soldPercentage:
 *                       type: number
 *                       format: float
 *                       example: 42.00
 *                       description: Sold percentage with 2 decimal places
 *                     startAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2026-02-24T10:00:00.000Z"
 *                     endAt:
 *                       type: string
 *                       format: date-time
 *                       example: "2026-02-24T22:00:00.000Z"
 *                     timeRemaining:
 *                       type: integer
 *                       example: 43200000
 *                       description: Time remaining in milliseconds
 *                     campaignTitle:
 *                       type: string
 *                       example: "Flash Sale cuối tuần"
 *                     variantSku:
 *                       type: string
 *                       example: "SP001-RED-M"
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Flash sale not found
 */
router.get(
  "/:flashSaleId/stats",
  protect,
  authorize("seller", "admin"),
  asyncHandler(getFlashSaleStats),
);

/**
 * @swagger
 * /api/flash-sales/{flashSaleId}/search:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Search flash sale products
 *     description: Search for products within a specific flash sale
 *     parameters:
 *       - in: path
 *         name: flashSaleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Flash sale ID
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search keyword
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Search query required
 *       404:
 *         description: Flash sale not found
 */
router.get("/:flashSaleId/search", asyncHandler(searchFlashSaleProducts));

// ============= PARAMETERIZED ROUTES =============

/**
 * @swagger
 * /api/flash-sales/{flashSaleId}:
 *   get:
 *     tags: [Flash Sales]
 *     summary: Get flash sale detail
 *     description: Get detailed information about a specific flash sale including product details
 *     parameters:
 *       - in: path
 *         name: flashSaleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Flash sale ID
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     productId:
 *                       type: object
 *                     salePrice:
 *                       type: number
 *                     originalPrice:
 *                       type: number
 *                     discountPercent:
 *                       type: number
 *                     totalQuantity:
 *                       type: number
 *                     soldQuantity:
 *                       type: number
 *                     remainingQuantity:
 *                       type: number
 *                     startAt:
 *                       type: string
 *                       format: date-time
 *                     endAt:
 *                       type: string
 *                       format: date-time
 *                     status:
 *                       type: string
 *       404:
 *         description: Flash sale not found
 */
router.get("/:flashSaleId", asyncHandler(getFlashSaleDetail));

/**
 * @swagger
 * /api/flash-sales/{flashSaleId}:
 *   put:
 *     tags: [Flash Sales]
 *     summary: Update flash sale
 *     description: Update flash sale details (price, quantity, dates, limits)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashSaleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Flash sale ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               salePrice:
 *                 type: number
 *                 description: Updated flash sale price
 *               totalQuantity:
 *                 type: number
 *                 description: Updated total quantity
 *               startAt:
 *                 type: string
 *                 format: date-time
 *                 description: Updated start date
 *               endAt:
 *                 type: string
 *                 format: date-time
 *                 description: Updated end date
 *               variantSku:
 *                 type: string
 *                 description: Updated variant SKU
 *               campaignTitle:
 *                 type: string
 *                 description: Updated campaign title
 *               purchaseLimitPerOrder:
 *                 type: integer
 *                 description: Updated limit per order
 *               purchaseLimitPerUser:
 *                 type: integer
 *                 description: Updated limit per user
 *     responses:
 *       200:
 *         description: Flash sale updated successfully
 *       400:
 *         description: Invalid input data
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Flash sale not found
 */
router.put(
  "/:flashSaleId",
  protect,
  authorize("seller", "admin"),
  asyncHandler(updateFlashSale),
);

/**
 * @swagger
 * /api/flash-sales/{flashSaleId}:
 *   delete:
 *     tags: [Flash Sales]
 *     summary: Delete flash sale
 *     description: Permanently delete a flash sale
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: flashSaleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Flash sale ID
 *     responses:
 *       200:
 *         description: Flash sale deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Flash sale not found
 */
router.delete(
  "/:flashSaleId",
  protect,
  authorize("seller", "admin"),
  asyncHandler(deleteFlashSale),
);

export default router;
