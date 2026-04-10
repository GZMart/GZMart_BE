import express from "express";
import {
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  previewCampaign,
  triggerCampaign,
} from "../controllers/voucherCampaign.controller.js";
import { protect, requireAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);
router.use(requireAdmin);

router.route("/").get(getCampaigns).post(createCampaign);
router.post("/:id/preview", previewCampaign);
router.post("/:id/trigger", triggerCampaign);
router
  .route("/:id")
  .get(getCampaignById)
  .put(updateCampaign)
  .delete(deleteCampaign);

export default router;
