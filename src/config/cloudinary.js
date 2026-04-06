import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import logger from "../utils/logger.js";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  timeout: 300000, // 5 minutes timeout for uploads
  secure: true,
});

// Log Cloudinary configuration status
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
  logger.info("Cloudinary configured successfully", {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  });
} else {
  logger.warn(
    "Cloudinary configuration incomplete - check environment variables",
  );
}

// Configure storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // 1. Phân loại Video và Ảnh
    const isVideo = file.mimetype.startsWith("video/");

    // 2. Xử lý cho Video (Không dùng transformation để tránh lỗi)
    if (isVideo) {
      return {
        folder: "gzmart/videos",
        resource_type: "video",
        allowed_formats: ["mp4", "mov", "avi", "webm"],
        use_filename: true,
        unique_filename: true,
        overwrite: true,
      };
    }

    // 3. Xử lý cho Ảnh (Tùy theo fieldname)
    if (file.fieldname === "profileImage") {
      return {
        folder: "gzmart/banners",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [
          { width: 1920, height: 600, crop: "limit", quality: "auto:best" },
        ],
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: true,
        secure: true,
      };
    }

    if (file.fieldname === "image") {
      return {
        folder: "gzmart/shop-banners",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
        transformation: [
          { width: 1920, height: 800, crop: "limit", quality: "auto:best" },
        ],
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: true,
        secure: true,
      };
    }

    // Default: avatar and other image uploads
    return {
      folder: "gzmart/images",
      allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
      transformation: [{ width: 500, height: 500, crop: "limit" }],
      resource_type: "image",
      use_filename: true,
      unique_filename: true,
      overwrite: true,
      secure: true,
    };
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix);
  },
});

// Configure storage for delivery proof images
const deliveryProofStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "gzmart/delivery-proofs",
    allowed_formats: ["jpg", "jpeg", "png", "gif"],
    transformation: [{ width: 1200, height: 1200, crop: "limit" }],
    resource_type: "image",
    use_filename: true,
    unique_filename: true,
    overwrite: false,
    secure: true,
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "proof-" + uniqueSuffix);
  },
});

// Middleware to log upload results
const handleUpload = (req, res, next) => {
  if (req.file) {
    if (req.file.path && !req.file.path.startsWith("https://")) {
      req.file.path = req.file.path.replace("http://", "https://");
    }
    logger.info("File upload result:", {
      originalname: req.file.originalname,
      path: req.file.path,
    });
  }

  if (req.files) {
    Object.keys(req.files).forEach((fieldName) => {
      const files = req.files[fieldName];
      files.forEach((file) => {
        if (file.path && !file.path.startsWith("https://")) {
          file.path = file.path.replace("http://", "https://");
        }
        logger.info("File upload result:", {
          fieldName,
          originalname: file.originalname,
          path: file.path,
        });
      });
    });
  }

  if (!req.file && !req.files) {
    logger.info("No file uploaded");
  }

  next();
};

export { cloudinary, storage, deliveryProofStorage, handleUpload };
