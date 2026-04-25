import express from "express";
import {
  createVoucher,
  getVouchers,
  getVoucherById,
  updateVoucher,
  deleteVoucher,
  getApplicableVouchers,
  validateVoucherCode,
  getShopVouchers,
  getShopVouchersWithEligibility,
  saveVoucher,
  unsaveVoucher,
  getSavedVoucherIds,
  getSavedVouchers,
} from "../controllers/voucher.controller.js";
import { protect } from "../middlewares/auth.middleware.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.route("/").post(protect, createVoucher).get(protect, getVouchers);

// Buyer-facing routes (must be before /:id to avoid route conflicts)
router.get("/applicable", protect, getApplicableVouchers);
router.get("/saved/ids", protect, getSavedVoucherIds);
router.get("/saved", protect, getSavedVouchers);
router.post("/validate-code", protect, validateVoucherCode);
router.get("/shop/:shopId/eligible", protect, getShopVouchersWithEligibility);
router.get("/shop/:shopId", optionalAuth, getShopVouchers);

router
  .route("/:id/save")
  .post(protect, saveVoucher)
  .delete(protect, unsaveVoucher);

router
  .route("/:id")
  .get(getVoucherById)
  .put(protect, updateVoucher)
  .delete(protect, deleteVoucher);

export default router;
