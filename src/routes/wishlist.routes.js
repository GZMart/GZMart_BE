import express from "express";
import * as wishlistController from "../controllers/wishlist.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * /api/wishlists:
 *   get:
 *     tags: [Wishlists]
 *     summary: Get user wishlists
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *   post:
 *     tags: [Wishlists]
 *     summary: Add to wishlists
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *   delete:
 *     tags: [Wishlists]
 *     summary: Clear all wishlists
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", asyncHandler(wishlistController.getUserWishlists));
router.post("/", asyncHandler(wishlistController.addToWishlists));
router.delete("/", asyncHandler(wishlistController.clearWishlists));

/**
 * @swagger
 * /api/wishlists/{productId}:
 *   delete:
 *     tags: [Wishlists]
 *     summary: Remove from wishlists
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.delete(
  "/:productId",
  asyncHandler(wishlistController.removeFromWishlists),
);

/**
 * @swagger
 * /api/wishlists/check/{productId}:
 *   get:
 *     tags: [Wishlists]
 *     summary: Check if in wishlists
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get(
  "/check/:productId",
  asyncHandler(wishlistController.checkInWishlists),
);

export default router;
