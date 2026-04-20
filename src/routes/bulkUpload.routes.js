import express from "express";
import {
  bulkUploadProducts,
  downloadBulkUploadTemplate,
  previewBulkUpload,
  confirmBulkUpload,
} from "../controllers/bulkUpload.controller.js";
import uploadBulkFile from "../middlewares/uploadBulkFile.middleware.js";
import { protect } from "../middlewares/auth.middleware.js";
import { requireRoles } from "../middlewares/role.middleware.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/bulk-upload/template:
 *   get:
 *     tags: [Bulk Upload]
 *     summary: Download CSV template for bulk upload
 *     description: Returns a CSV template file that can be filled in and uploaded
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [single, variant, mixed]
 *         description: Template type - single (simple products), variant (products with tiers), or mixed (both)
 *         default: single
 *     responses:
 *       200:
 *         description: CSV template file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/template",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(downloadBulkUploadTemplate),
);

/**
 * @swagger
 * /api/bulk-upload/products:
 *   post:
 *     tags: [Bulk Upload]
 *     summary: Bulk upload products from CSV file
 *     description: |
 *       Upload multiple products at once from a CSV file.
 *       Supports both single products (no variants) and variant products (with tiers like Size, Color, etc).
 *
 *       **Response Status Codes:**
 *       - 207 Multi-Status: Used for partial success (some products created, some failed)
 *       - 400: CSV parsing error or no valid products found
 *       - 401: Unauthorized
 *       - 413: File size exceeds 5MB limit
 *
 *       **CSV Format Requirements:**
 *
 *       **Single Products:**
 *       ```
 *       productType,name,categoryId,sku,price,stock
 *       single,Product Name,507f1f77bcf86cd799439011,SKU-001,99000,150
 *       ```
 *
 *       **Variant Products:**
 *       ```
 *       productType,name,categoryId,tier1_name,tier1_options,tier2_name,tier2_options
 *       variant,T-Shirt,507f1f77bcf86cd799439011,Size,S;M;L,Color,Red;Blue
 *
 *       modelSku,modelPrice,modelStock,tierValue1,tierValue2
 *       TSH-S-RED,99000,50,S,Red
 *       TSH-M-BLUE,109000,60,M,Blue
 *       ```
 *
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - csvFile
 *             properties:
 *               csvFile:
 *                 type: string
 *                 format: binary
 *                 description: CSV or Excel file (.csv, .xlsx, .xls) with product data
 *     responses:
 *       207:
 *         description: Multi-status response with mixed success/failures
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   description: True only if all products succeeded
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     created:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     created:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           index:
 *                             type: integer
 *                           productId:
 *                             type: string
 *                           name:
 *                             type: string
 *                           sku:
 *                             type: string
 *                           status:
 *                             type: string
 *                     failed:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           index:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           productType:
 *                             type: string
 *                           modelCount:
 *                             type: integer
 *                           message:
 *                             type: string
 *       400:
 *         description: CSV parsing error or validation error
 *       401:
 *         description: Unauthorized
 *       413:
 *         description: File size exceeds 5MB
 */
router.post(
  "/products",
  protect,
  requireRoles("seller", "admin"),
  uploadBulkFile.single("csvFile"),
  asyncHandler(bulkUploadProducts),
);

router.post(
  "/preview",
  protect,
  requireRoles("seller", "admin"),
  uploadBulkFile.single("csvFile"),
  asyncHandler(previewBulkUpload),
);

router.post(
  "/confirm",
  protect,
  requireRoles("seller", "admin"),
  asyncHandler(confirmBulkUpload),
);

export default router;
