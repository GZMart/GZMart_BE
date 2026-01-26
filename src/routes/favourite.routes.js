import express from "express";
import * as favouriteController from "../controllers/favourite.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// GET /api/favourites - Get user's favourites
router.get("/", asyncHandler(favouriteController.getUserFavourites));

// POST /api/favourites - Add to favourites
router.post("/", asyncHandler(favouriteController.addToFavourites));

// DELETE /api/favourites/:productId - Remove from favourites
router.delete(
  "/:productId",
  asyncHandler(favouriteController.removeFromFavourites),
);

// DELETE /api/favourites - Clear all favourites
router.delete("/", asyncHandler(favouriteController.clearFavourites));

// GET /api/favourites/check/:productId - Check if in favourites
router.get(
  "/check/:productId",
  asyncHandler(favouriteController.checkInFavourites),
);

export default router;
