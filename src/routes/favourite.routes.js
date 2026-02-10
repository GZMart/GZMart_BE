import express from "express";
import * as favouriteController from "../controllers/favourite.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * /api/favourites:
 *   get:
 *     tags: [Favourites]
 *     summary: Get user favourites
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *   post:
 *     tags: [Favourites]
 *     summary: Add to favourites
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *   delete:
 *     tags: [Favourites]
 *     summary: Clear all favourites
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/", asyncHandler(favouriteController.getUserFavourites));
router.post("/", asyncHandler(favouriteController.addToFavourites));
router.delete("/", asyncHandler(favouriteController.clearFavourites));

/**
 * @swagger
 * /api/favourites/{productId}:
 *   delete:
 *     tags: [Favourites]
 *     summary: Remove from favourites
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
  asyncHandler(favouriteController.removeFromFavourites),
);

/**
 * @swagger
 * /api/favourites/check/{productId}:
 *   get:
 *     tags: [Favourites]
 *     summary: Check if in favourites
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
  asyncHandler(favouriteController.checkInFavourites),
);

export default router;
