import multer from "multer";
import { ErrorResponse } from "../utils/errorResponse.js";

const storage = multer.memoryStorage();

export const uploadMemory = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ErrorResponse("Invalid file type. Only JPG, PNG, and WEBP are allowed.", 400), false);
    }
  }
});
