import express from "express";
import {
  createVoucher,
  getVouchers,
  getVoucherById,
  updateVoucher,
  deleteVoucher,
  getApplicableVouchers,
  validateVoucherCode,
} from "../controllers/voucher.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.route("/").post(protect, createVoucher).get(protect, getVouchers);

// Buyer-facing routes (must be before /:id to avoid route conflicts)
router.get("/applicable", protect, getApplicableVouchers);
router.post("/validate-code", protect, validateVoucherCode);

router
  .route("/:id")
  .get(getVoucherById)
  .put(protect, updateVoucher)
  .delete(protect, deleteVoucher);

export default router;
