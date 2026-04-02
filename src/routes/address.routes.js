import express from "express";
import { protect } from "../middlewares/auth.middleware.js";
import * as addressController from "../controllers/address.controller.js";

const router = express.Router();

router.use(protect); // All address routes require login

router
  .route("/")
  .post(addressController.createAddress)
  .get(addressController.getAddresses);

// Geocoding endpoints
router.post("/geocode", addressController.geocodeAddress);
router.post("/geocode-string", addressController.geocodeAddressString);
router.post("/reverse-geocode", addressController.reverseGeocodeAddress);
router.post("/calculate-distance", addressController.calculateDistance);

router
  .route("/:id")
  .put(addressController.updateAddress)
  .delete(addressController.deleteAddress);

router.put("/:id/default", addressController.setDefaultAddress);

export default router;
