import express from "express";
import {
  createCampaign,
  createBatchCampaign,
  getCampaigns,
  getCampaignDetail,
  getActiveCampaigns,
  addProductsToCampaign,
  getCampaignProducts,
  getCampaignProduct,
  updateCampaign,
  updateCampaignProduct,
  removeProductFromCampaign,
  deleteCampaign,
  pauseCampaign,
  stopCampaign,
  resumeCampaign,
  getCampaignStats,
  searchCampaignProducts,
  warnSellerAboutCampaign,
} from "../controllers/campaign.controller.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";
import { protect, optionalAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/campaigns/active:
 *   get:
 *     tags: [Campaigns]
 *     summary: Get active campaigns
 *     description: Get all currently active campaigns with countdown information
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
router.get("/active", asyncHandler(getActiveCampaigns));

/**
 * @swagger
 * /api/campaigns:
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
// Public but optionalAuth so: unauthenticated → all, seller → own only
router.get("/", optionalAuth, asyncHandler(getCampaigns));

router.post(
  "/",
  protect,
  requireRoles("seller"),
  asyncHandler(createCampaign),
);

// ============= SPECIFIC ROUTES BEFORE PARAMETERIZED ROUTES =============

router.post(
  "/batch",
  protect,
  requireRoles("seller"),
  asyncHandler(createBatchCampaign),
);

/**
 * Admin cảnh cáo seller về campaign (notification + email)
 */
router.post(
  "/:campaignId/warn",
  protect,
  requireRoles("admin"),
  asyncHandler(warnSellerAboutCampaign),
);

/**
 * @swagger
 * /api/campaigns/{flashSaleId}/stats:
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
  "/:campaignId/stats",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(getCampaignStats),
);

/**
 * @swagger
 * /api/campaigns/{flashSaleId}/search:
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
router.get("/:campaignId/search", asyncHandler(searchCampaignProducts));

// ============= PARAMETERIZED ROUTES =============

/**
 * @swagger
 * /api/campaigns/{campaignId}/pause:
 *   patch:
 *     tags: [Flash Sales]
 *     summary: Pause a campaign
 *     description: Pause an active or pending campaign (sets status to "paused")
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID
 *     responses:
 *       200:
 *         description: Campaign paused successfully
 *       400:
 *         description: Campaign cannot be paused
 *       404:
 *         description: Campaign not found
 */
router.patch(
  "/:campaignId/pause",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(pauseCampaign),
);

/**
 * @swagger
 * /api/campaigns/{campaignId}/stop:
 *   patch:
 *     tags: [Flash Sales]
 *     summary: Stop a campaign
 *     description: Stop/cancel an active or pending campaign (sets status to "cancelled")
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID
 *     responses:
 *       200:
 *         description: Campaign stopped successfully
 *       400:
 *         description: Campaign cannot be stopped
 *       404:
 *         description: Campaign not found
 */
router.patch(
  "/:campaignId/stop",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(stopCampaign),
);

/**
 * @swagger
 * /api/campaigns/{campaignId}/resume:
 *   patch:
 *     tags: [Flash Sales]
 *     summary: Resume a paused campaign
 *     description: Reactivate a paused campaign (sets status back to active/pending)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: campaignId
 *         required: true
 *         schema:
 *           type: string
 *         description: Campaign ID
 *     responses:
 *       200:
 *         description: Campaign resumed successfully
 *       400:
 *         description: Campaign cannot be resumed
 *       404:
 *         description: Campaign not found
 */
router.patch(
  "/:campaignId/resume",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(resumeCampaign),
);

/**
 * @swagger
 * /api/campaigns/{flashSaleId}:
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
router.get("/:campaignId", asyncHandler(getCampaignDetail));

/**
 * @swagger
 * /api/campaigns/{flashSaleId}:
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
  "/:campaignId",
  protect,
  requireRoles("seller"),
  asyncHandler(updateCampaign),
);

/**
 * @swagger
 * /api/campaigns/{flashSaleId}:
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
  "/:campaignId",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(deleteCampaign),
);

export default router;
