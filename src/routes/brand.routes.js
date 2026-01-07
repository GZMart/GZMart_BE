import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import brandController from "../controllers/brand.controller.js";

const router = express.Router();

// Public routes
router.get("/", asyncHandler(brandController.getBrands.bind(brandController)));
router.get(
  "/top",
  asyncHandler(brandController.getTopBrands.bind(brandController))
);
router.get(
  "/:id",
  asyncHandler(brandController.getBrandById.bind(brandController))
);
router.get(
  "/:id/products",
  asyncHandler(brandController.getBrandProducts.bind(brandController))
);

export default router;
