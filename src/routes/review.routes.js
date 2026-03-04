import express from "express";
import * as reviewController from "../controllers/review.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/reviews:
 *   post:
 *     tags: [Reviews]
 *     summary: Create a review for a product
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
 *               - rating
 *               - content
 *             properties:
 *               productId:
 *                 type: string
 *                 description: Product ID
 *               rating:
 *                 type: number
 *                 description: Star rating (1-5)
 *                 minimum: 1
 *                 maximum: 5
 *               title:
 *                 type: string
 *                 description: Review title (optional)
 *               content:
 *                 type: string
 *                 description: Review content (min 10 characters)
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of image URLs (max 5)
 *               orderId:
 *                 type: string
 *                 description: Order ID (optional, for verified purchase)
 *     responses:
 *       201:
 *         description: Review created successfully
 *       400:
 *         description: Validation error or duplicate review
 *       404:
 *         description: Product not found
 */
router.post("/", protect, asyncHandler(reviewController.createReview));

/**
 * @swagger
 * /api/reviews/product/{productId}:
 *   get:
 *     tags: [Reviews]
 *     summary: Get reviews for a product
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 10
 *       - in: query
 *         name: rating
 *         schema:
 *           type: number
 *           description: Filter by rating (1-5)
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [recent, helpful, rating_high, rating_low]
 *           default: recent
 *     responses:
 *       200:
 *         description: Reviews retrieved successfully
 *       404:
 *         description: Product not found
 */
router.get(
  "/product/:productId",
  asyncHandler(reviewController.getProductReviews),
);

/**
 * @swagger
 * /api/reviews/user:
 *   get:
 *     tags: [Reviews]
 *     summary: Get user's reviews
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: number
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: number
 *           default: 10
 *     responses:
 *       200:
 *         description: User reviews retrieved successfully
 */
router.get("/user", protect, asyncHandler(reviewController.getUserReviews));

/**
 * @swagger
 * /api/reviews/stats/{productId}:
 *   get:
 *     tags: [Reviews]
 *     summary: Get review statistics for a product
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review statistics retrieved successfully
 *       404:
 *         description: Product not found
 */
router.get(
  "/stats/:productId",
  asyncHandler(reviewController.getProductReviewStats),
);

/**
 * @swagger
 * /api/reviews/{reviewId}:
 *   get:
 *     tags: [Reviews]
 *     summary: Get a single review
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review retrieved successfully
 *       404:
 *         description: Review not found
 *   put:
 *     tags: [Reviews]
 *     summary: Update a review
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *                 description: Star rating (1-5)
 *               title:
 *                 type: string
 *                 description: Review title
 *               content:
 *                 type: string
 *                 description: Review content
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Review updated successfully
 *       403:
 *         description: Not authorized to update this review
 *       404:
 *         description: Review not found
 *   delete:
 *     tags: [Reviews]
 *     summary: Delete a review
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review deleted successfully
 *       403:
 *         description: Not authorized to delete this review
 *       404:
 *         description: Review not found
 */
router.get("/:reviewId", asyncHandler(reviewController.getReview));
router.put("/:reviewId", protect, asyncHandler(reviewController.updateReview));
router.delete(
  "/:reviewId",
  protect,
  asyncHandler(reviewController.deleteReview),
);

/**
 * @swagger
 * /api/reviews/{reviewId}/helpful:
 *   post:
 *     tags: [Reviews]
 *     summary: Mark review as helpful
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review marked as helpful
 *       404:
 *         description: Review not found
 */
router.post(
  "/:reviewId/helpful",
  asyncHandler(reviewController.markHelpful),
);

/**
 * @swagger
 * /api/reviews/{reviewId}/unhelpful:
 *   post:
 *     tags: [Reviews]
 *     summary: Mark review as unhelpful
 *     parameters:
 *       - in: path
 *         name: reviewId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Review marked as unhelpful
 *       404:
 *         description: Review not found
 */
router.post(
  "/:reviewId/unhelpful",
  asyncHandler(reviewController.markUnhelpful),
);

export default router;
