import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import * as addressController from "../controllers/address.controller.js";

const router = express.Router();

router.use(protect); // All address routes require login

router
  .route("/")
  .post(addressController.createAddress)
  .get(addressController.getAddresses);

router
  .route("/:id")
  .put(addressController.updateAddress)
  .delete(addressController.deleteAddress);

router.put("/:id/default", addressController.setDefaultAddress);

export default router;
