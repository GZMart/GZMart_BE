import express from "express";
import { asyncHandler } from "../middlewares/async.middleware.js";
import * as homeController from "../controllers/home.controller.js";

const router = express.Router();

/**
 * @swagger
 * /api/home/banners:
 *   get:
 *     tags: [Home]
 *     summary: Get banners
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/banners", asyncHandler(homeController.getBanners));

/**
 * @swagger
 * /api/home/sections:
 *   get:
 *     tags: [Home]
 *     summary: Get home sections
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/sections", asyncHandler(homeController.getHomeSections));

/**
 * @swagger
 * /api/home/deals-of-the-day:
 *   get:
 *     tags: [Home]
 *     summary: Get deals of the day
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/deals-of-the-day", asyncHandler(homeController.getDealsOfTheDay));

/**
 * @swagger
 * /api/home/banners/{bannerId}/click:
 *   post:
 *     tags: [Home]
 *     summary: Increment banner click
 *     parameters:
 *       - in: path
 *         name: bannerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post(
  "/banners/:bannerId/click",
  asyncHandler(homeController.incrementBannerClick),
);

export default router;
