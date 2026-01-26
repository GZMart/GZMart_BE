import express from "express";
import upload from "../middlewares/upload.middleware.js";
import {
  uploadSingle,
  uploadMultiple,
  uploadProduct,
} from "../controllers/upload.controller.js";

const router = express.Router();

/**
 * @route   POST /api/upload/single
 * @desc    Upload single image
 * @access  Public (for testing)
 * @body    FormData with 'image' field
 */
router.post("/single", upload.single("image"), uploadSingle);

/**
 * @route   POST /api/upload/multiple
 * @desc    Upload multiple images
 * @access  Public (for testing)
 * @body    FormData with 'images' field (max 10 files)
 */
router.post("/multiple", upload.array("images", 10), uploadMultiple);

/**
 * @route   POST /api/upload/product
 * @desc    Upload product images (thumbnail + gallery)
 * @access  Public (for testing)
 * @body    FormData with 'thumbnail' (1 file) and 'gallery' (max 5 files)
 */
router.post(
  "/product",
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "gallery", maxCount: 5 },
  ]),
  uploadProduct
);

export default router;
