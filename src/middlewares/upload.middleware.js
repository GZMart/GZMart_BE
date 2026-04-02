import multer from "multer";
import { ErrorResponse } from "../utils/errorResponse.js";
import { storage } from "../config/cloudinary.js";

// File filter
const fileFilter = (req, file, cb) => {
  // Allowed file types (Gồm cả Ảnh, Video và Document)
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/webm",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    return cb(
      new ErrorResponse(
        "Invalid file type. Only images, videos (MP4/MOV), PDF, and Word documents are allowed.",
        400,
      ),
      false,
    );
  }
};

// Configure upload
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // Giới hạn cứng 10MB cho mọi file
  },
});

export default upload;
