import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * @desc    Upload single image
 * @route   POST /api/upload/single
 * @access  Public (for testing)
 */
export const uploadSingle = asyncHandler(async (req, res, next) => {
  console.log("🔵 [Upload Controller] Received upload request:", {
    hasFile: !!req.file,
    fieldname: req.file?.fieldname,
    originalname: req.file?.originalname,
    mimetype: req.file?.mimetype,
    size: req.file?.size,
    timestamp: new Date().toISOString(),
  });

  if (!req.file) {
    console.error("❌ [Upload Controller] No file in request");
    return next(new ErrorResponse("Please upload a file", 400));
  }

  console.log("✅ [Upload Controller] File uploaded successfully:", {
    filename: req.file.filename,
    url: req.file.path,
    cloudinaryUrl: req.file.path,
  });

  res.status(200).json({
    success: true,
    message: "File uploaded successfully",
    data: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: req.file.path, // Cloudinary URL
    },
  });
});

/**
 * @desc    Upload multiple images
 * @route   POST /api/upload/multiple
 * @access  Public (for testing)
 */
export const uploadMultiple = asyncHandler(async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    return next(new ErrorResponse("Please upload at least one file", 400));
  }

  const uploadedFiles = req.files.map((file) => ({
    filename: file.filename,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    url: file.path, // Cloudinary URL
  }));

  res.status(200).json({
    success: true,
    message: `${req.files.length} files uploaded successfully`,
    count: req.files.length,
    data: uploadedFiles,
  });
});

/**
 * @desc    Upload product images (thumbnail + gallery)
 * @route   POST /api/upload/product
 * @access  Public (for testing)
 */
export const uploadProduct = asyncHandler(async (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return next(new ErrorResponse("Please upload files", 400));
  }

  const result = {};

  // Process thumbnail
  if (req.files.thumbnail && req.files.thumbnail.length > 0) {
    result.thumbnail = {
      filename: req.files.thumbnail[0].filename,
      originalname: req.files.thumbnail[0].originalname,
      url: req.files.thumbnail[0].path,
    };
  }

  // Process gallery
  if (req.files.gallery && req.files.gallery.length > 0) {
    result.gallery = req.files.gallery.map((file) => ({
      filename: file.filename,
      originalname: file.originalname,
      url: file.path,
    }));
  }

  res.status(200).json({
    success: true,
    message: "Product images uploaded successfully",
    data: result,
  });
});
