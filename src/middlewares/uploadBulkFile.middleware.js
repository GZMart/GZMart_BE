import multer from "multer";
import { ErrorResponse } from "../utils/errorResponse.js";

const storage = multer.memoryStorage();

export const uploadBulkFile = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const fileName = file.originalname?.toLowerCase() || "";
    const mimeType = file.mimetype?.toLowerCase() || "";

    // Accept CSV and Excel files
    const allowedMimeTypes = [
      "text/csv",
      "text/plain",
      "application/vnd.ms-excel", // .xls
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    ];

    const allowedExtensions = [".csv", ".xls", ".xlsx"];
    const hasValidExtension = allowedExtensions.some((ext) =>
      fileName.endsWith(ext),
    );

    if (hasValidExtension || allowedMimeTypes.includes(mimeType)) {
      cb(null, true);
    } else {
      cb(
        new ErrorResponse(
          "Invalid file type. Only CSV and Excel files (.csv, .xls, .xlsx) are allowed.",
          400,
        ),
        false,
      );
    }
  },
});

export default uploadBulkFile;
