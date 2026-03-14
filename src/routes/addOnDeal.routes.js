import express from "express";
import { protect, authorize } from "../middlewares/auth.middleware.js";
import {
  createAddOn,
  getAddOns,
  getAddOnById,
  updateAddOn,
  deleteAddOn,
} from "../controllers/addOnDeal.controller.js";

const router = express.Router();

router.use(protect);
router.use(authorize("seller"));

router.post("/", createAddOn);
router.get("/", getAddOns);
router.get("/:id", getAddOnById);
router.put("/:id", updateAddOn);
router.delete("/:id", deleteAddOn);

export default router;
