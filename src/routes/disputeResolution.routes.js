import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import {
  requireBuyer,
  requireSeller,
  requireAdmin,
} from "../middlewares/role.middleware.js";
import {
  acceptComplaint,
  appealReport,
  createReport,
  getAdminReportDetail,
  getAdminReports,
  getMyReports,
  getReportDetail,
  getSellerReportDetail,
  getSellerReports,
  submitCounterReport,
  updateReportStatus,
} from "../controllers/disputeResolution.controller.js";

const router = express.Router();

router.use(protect);

router.post("/reports", requireBuyer, createReport);
router.get("/reports/my", requireBuyer, getMyReports);
router.get("/reports/:id", requireBuyer, getReportDetail);
router.post("/reports/:id/appeal", requireBuyer, appealReport);

router.get("/seller/reports", requireSeller, getSellerReports);
router.get("/seller/reports/:id", requireSeller, getSellerReportDetail);
router.post("/seller/reports/:id/counter", requireSeller, submitCounterReport);

router.get("/admin/reports", requireAdmin, getAdminReports);
router.get("/admin/reports/:id", requireAdmin, getAdminReportDetail);
router.patch("/admin/reports/:id/status", requireAdmin, updateReportStatus);
router.post("/admin/reports/:id/accept", requireAdmin, acceptComplaint);

export default router;
