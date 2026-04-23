import multer from "multer";
import { ErrorResponse } from "../utils/errorResponse.js";

const storage = multer.memoryStorage();

/** Groq base64 image limit ~4MB; raw file ~3MB stays under cap after encoding. */
export const uploadCategorySuggestImage = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new ErrorResponse("Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP.", 400),
        false,
      );
    }
  },
});
