import mongoose from "mongoose";
import * as shopDecorationService from "../services/shopDecoration.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

const VALID_VERSIONS = ["desktop", "mobile"];
const VALID_MODULE_TYPES = [
  "banner_carousel", "banner_multi", "banner_single", "banner_hotspot",
  "flash_deals", "addon_deals", "combo_promos",
  "featured_products", "featured_categories", "best_selling", "new_products", "category_list",
  "text", "image_text", "shop_info",
  "discount", "suggested_for_you",
];

/** Validate that a module object has required fields and valid type */
function validateModule(module) {
  if (!module || typeof module !== "object") {
    throw new ErrorResponse("Each module must be a non-null object", 400);
  }
  if (!module.id || typeof module.id !== "string") {
    throw new ErrorResponse("Module must have a string 'id'", 400);
  }
  if (!module.type || !VALID_MODULE_TYPES.includes(module.type)) {
    throw new ErrorResponse(`Invalid module type: "${module.type}". Allowed: ${VALID_MODULE_TYPES.join(", ")}`, 400);
  }
  if (module.props !== undefined && typeof module.props !== "object") {
    throw new ErrorResponse("Module 'props' must be an object", 400);
  }
  return true;
}

/** GET /api/seller/shop-decoration — get full config for editor */
export const getDecoration = asyncHandler(async (req, res) => {
  const sellerId = req.user._id ?? req.user.id;
  const data = await shopDecorationService.getShopDecoration(sellerId);
  res.status(200).json({ success: true, data });
});

/** PUT /api/seller/shop-decoration/draft — save draft modules + widgets for a version */
export const saveDraft = asyncHandler(async (req, res) => {
  const sellerId = req.user._id ?? req.user.id;
  const { version = "desktop", modules = [], widgets } = req.body;

  if (!VALID_VERSIONS.includes(version)) {
    throw new ErrorResponse(`Invalid version: "${version}". Must be one of: ${VALID_VERSIONS.join(", ")}`, 400);
  }

  if (!Array.isArray(modules)) {
    throw new ErrorResponse("'modules' must be an array", 400);
  }

  // Validate each module
  for (const module of modules) {
    validateModule(module);
  }

  await shopDecorationService.saveDraft(sellerId, version, modules, widgets);
  res.status(200).json({ success: true, message: "Draft saved" });
});

/** POST /api/seller/shop-decoration/publish — publish draft to live */
export const publish = asyncHandler(async (req, res) => {
  const sellerId = req.user._id ?? req.user.id;
  const body = req.body || {};
  const version = body.version || "desktop";

  if (!VALID_VERSIONS.includes(version)) {
    throw new ErrorResponse(`Invalid version: "${version}". Must be one of: ${VALID_VERSIONS.join(", ")}`, 400);
  }

  try {
    await shopDecorationService.publishVersion(sellerId, version);
    res.status(200).json({ success: true, message: `Version "${version}" published successfully` });
  } catch (err) {
    console.error('[publish controller] Error:', err.message);
    console.error('[publish controller] Stack:', err.stack);
    throw err;
  }
});

/** PUT /api/seller/shop-decoration/active-version — set active storefront version */
export const setActiveVersion = asyncHandler(async (req, res) => {
  const sellerId = req.user._id ?? req.user.id;
  const { version } = req.body;

  if (!version) {
    throw new ErrorResponse("'version' is required", 400);
  }
  if (!VALID_VERSIONS.includes(version)) {
    throw new ErrorResponse(`Invalid version: "${version}". Must be one of: ${VALID_VERSIONS.join(", ")}`, 400);
  }

  await shopDecorationService.setActiveVersion(sellerId, version);
  res.status(200).json({ success: true, message: `Active version set to "${version}"` });
});

/** GET /api/seller/shop-decoration/counts — widget counts for editor */
export const getWidgetCounts = asyncHandler(async (req, res) => {
  const sellerId = req.user._id ?? req.user.id;
  const counts = await shopDecorationService.getShopWidgetCounts(sellerId);
  res.status(200).json({ success: true, data: counts });
});
