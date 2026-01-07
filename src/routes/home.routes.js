import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as homeController from "../controllers/home.controller.js";

const router = express.Router();

// Public routes
router.get("/banners", asyncHandler(homeController.getBanners));
router.get("/sections", asyncHandler(homeController.getHomeSections));
router.get("/deals-of-the-day", asyncHandler(homeController.getDealsOfTheDay));
router.post(
  "/banners/:bannerId/click",
  asyncHandler(homeController.incrementBannerClick)
);

export default router;
