import express from "express";
import {
  createVoucher,
  getVouchers,
  getVoucherById,
  updateVoucher,
  deleteVoucher,
} from "../controllers/voucher.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.route("/").post(protect, createVoucher).get(protect, getVouchers);

router
  .route("/:id")
  .get(getVoucherById)
  .put(protect, updateVoucher)
  .delete(protect, deleteVoucher);

export default router;
