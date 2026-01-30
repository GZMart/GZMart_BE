import express from "express";
import * as comboController from "../controllers/comboPromotion.controller.js";
import { protect, authorize } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);
router.use(authorize("seller"));

router.post("/", comboController.createCombo);
router.get("/", comboController.getCombos);
router.get("/:id", comboController.getCombo);
router.put("/:id", comboController.updateCombo);
router.delete("/:id", comboController.deleteCombo);

export default router;
