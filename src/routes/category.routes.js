import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as categoryController from "../controllers/category.controller.js";

const router = express.Router();

// Public routes
router.get("/", asyncHandler(categoryController.getCategories));
router.get("/top", asyncHandler(categoryController.getTopCategories));
router.get("/featured", asyncHandler(categoryController.getFeaturedCategories));
router.get(
  "/with-counts",
  asyncHandler(categoryController.getCategoriesWithCounts)
);
router.get("/:id", asyncHandler(categoryController.getCategoryDetail));
router.get(
  "/:id/products",
  asyncHandler(categoryController.getCategoryProducts)
);

export default router;
