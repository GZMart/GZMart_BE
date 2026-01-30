import express from "express";
import {
  createSystemVoucher,
  getSystemVouchers,
  getSystemVoucherById,
  updateSystemVoucher,
  deleteSystemVoucher,
} from "../controllers/systemVoucher.controller.js";
import { protect, requireAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);
router.use(requireAdmin);

router.route("/").post(createSystemVoucher).get(getSystemVouchers);

router
  .route("/:id")
  .get(getSystemVoucherById)
  .put(updateSystemVoucher)
  .delete(deleteSystemVoucher);

export default router;
