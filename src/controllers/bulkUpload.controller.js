import * as productService from "../services/product.service.js";
import { parseBulkUploadFile } from "../utils/csvParser.js";
import {
  buildSingleTemplate,
  buildVariantTemplate,
  buildMixedTemplate,
} from "../utils/bulkUploadCsvRows.js";
import { buildStyledExcelTemplateBuffer } from "../utils/bulkUploadExcelTemplate.js";
import { buildBulkPreviewItems } from "../services/bulkUploadAi.service.js";
import { resolveCategoryInput } from "../services/bulkUploadCategoryResolve.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Bulk upload products from CSV file
 * @route   POST /api/bulk-upload/products
 * @access  Private (Seller/Admin only)
 *
 * Expected form data:
 * - csvFile: CSV file (multipart/form-data)
 *
 * Response (207 Multi-Status):
 * {
 *   success: boolean,
 *   summary: { total, created, failed },
 *   data: { created: [], failed: [] }
 * }
 */
export const bulkUploadProducts = asyncHandler(async (req, res, next) => {
  return next(
    new ErrorResponse(
      "Luồng tạo hàng loạt đã đổi: dùng POST /api/bulk-upload/preview rồi POST /api/bulk-upload/confirm (gợi ý danh mục AI + xác nhận). File không còn cột danh mục.",
      400,
    ),
  );
});

/**
 * @desc    Get bulk upload template
 * @route   GET /api/bulk-upload/template?type=single|variant|mixed&format=xlsx|csv
 * @access  Private (Seller/Admin only)
 *
 * - format=xlsx (mặc định): Excel có header tô màu, viền, sheet hướng dẫn.
 * - format=csv: CSV thuần (không định dạng).
 */
export const downloadBulkUploadTemplate = asyncHandler(
  async (req, res, next) => {
    const { type = "single", format = "xlsx" } = req.query;

    if (!["single", "variant", "mixed"].includes(type)) {
      return next(
        new ErrorResponse("Template type must be single, variant, or mixed", 400),
      );
    }

    const fmt = String(format).toLowerCase();

    if (fmt === "xlsx" || fmt === "excel") {
      let buffer;
      try {
        buffer = await buildStyledExcelTemplateBuffer(type);
      } catch (err) {
        return next(
          new ErrorResponse(err?.message || "Không tạo được file mẫu Excel", 500),
        );
      }
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bulk-upload-template-${type}.xlsx"`,
      );
      return res.send(buffer);
    }

    if (fmt === "csv") {
      let template = "";
      if (type === "single") {
        template = buildSingleTemplate();
      } else if (type === "variant") {
        template = buildVariantTemplate();
      } else {
        template = buildMixedTemplate();
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="bulk-upload-template-${type}.csv"`,
      );
      return res.send(template);
    }

    return next(
      new ErrorResponse('Query "format" must be xlsx or csv', 400),
    );
  },
);

/**
 * Parse file + gợi ý danh mục (embedding). Không tạo sản phẩm — client hiển thị modal xác nhận.
 * POST /api/bulk-upload/preview
 */
export const previewBulkUpload = asyncHandler(async (req, res, next) => {
  const sellerId = req.user?._id;
  if (!sellerId) {
    return next(new ErrorResponse("User not authenticated", 401));
  }
  if (!req.file) {
    return next(new ErrorResponse("CSV file is required", 400));
  }

  const fileName = req.file.originalname?.toLowerCase() || "";
  const isCSV = fileName.endsWith(".csv");
  const isXLSX = fileName.endsWith(".xlsx") || fileName.endsWith(".xls");
  if (!isCSV && !isXLSX) {
    return next(
      new ErrorResponse("File must be CSV or Excel format (.csv, .xlsx, .xls)", 400),
    );
  }
  if (req.file.size > 5 * 1024 * 1024) {
    return next(new ErrorResponse("File size must not exceed 5MB", 413));
  }

  let products;
  try {
    products = parseBulkUploadFile(req.file.buffer, req.file.originalname);
    if (products.length === 0) {
      return next(new ErrorResponse("No valid products found in file", 400));
    }
  } catch (err) {
    return next(new ErrorResponse(err.message, 400));
  }

  const { items, categoriesMeta } = await buildBulkPreviewItems(products);

  res.status(200).json({
    success: true,
    data: {
      items,
      categoriesMeta,
      productCount: products.length,
    },
  });
});

/**
 * Tạo sản phẩm sau khi seller xác nhận (đã chỉnh danh mục nếu cần).
 * POST /api/bulk-upload/confirm  body: { items: [{ index, categoryId, product }] }
 */
export const confirmBulkUpload = asyncHandler(async (req, res, next) => {
  const sellerId = req.user?._id;
  if (!sellerId) {
    return next(new ErrorResponse("User not authenticated", 401));
  }

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return next(new ErrorResponse("items[] là bắt buộc", 400));
  }
  if (items.length > 150) {
    return next(new ErrorResponse("Tối đa 150 sản phẩm mỗi lần xác nhận", 400));
  }

  const created = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const row = items[i];
    const { product, categoryId } = row;
    const name = product?.name || `Product ${i + 1}`;

    if (!product || !categoryId) {
      failed.push({
        index: row.index ?? i,
        name,
        message: "Thiếu product hoặc categoryId",
      });
      continue;
    }

    let finalCategoryId;
    try {
      finalCategoryId = await resolveCategoryInput(categoryId);
    } catch (err) {
      failed.push({
        index: row.index ?? i,
        name,
        message: err.message || "Danh mục không hợp lệ",
      });
      continue;
    }

    const { sellerId: _sid, ...rest } = product;
    const trimmedName =
      typeof rest.name === "string" ? rest.name.trim() : rest.name;
    if (
      trimmedName === undefined ||
      trimmedName === null ||
      (typeof trimmedName === "string" && trimmedName.length === 0)
    ) {
      failed.push({
        index: row.index ?? i,
        name,
        message: "Tên sản phẩm không được để trống",
      });
      continue;
    }
    /** Luôn draft — file bulk không có ảnh; seller chỉnh trên drawer rồi mới publish (active). */
    const productData = {
      ...rest,
      name: trimmedName,
      categoryId: finalCategoryId,
      status: "draft",
    };

    try {
      const p = await productService.createProduct(productData, sellerId);
      const primarySku =
        p.models?.[0]?.sku?.toString?.() || p.models?.[0]?.sku || "";
      created.push({
        index: row.index ?? i,
        productId: p._id,
        name: p.name,
        sku: primarySku,
        status: p.status,
      });
    } catch (err) {
      failed.push({
        index: row.index ?? i,
        name,
        message: err.message || "Unknown error",
      });
    }
  }

  const allOk = failed.length === 0;
  res.status(207).json({
    success: allOk,
    summary: {
      total: items.length,
      created: created.length,
      failed: failed.length,
    },
    data: { created, failed },
  });
});
