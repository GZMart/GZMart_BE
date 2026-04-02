import Address from "../models/Address.js";
import User from "../models/User.js";
import { ErrorResponse } from "../middlewares/error.middleware.js";
import geocodingService from "../services/geocoding.service.js";

// Helper to sync default address to User table
const syncDefaultAddressToUser = async (userId, addressData) => {
  const updateData = {
    address: addressData.details, // Mapping 'details' to 'address' in User
    phone: addressData.phone,
    provinceCode: addressData.provinceCode,
    provinceName: addressData.provinceName,
    wardCode: addressData.wardCode,
    wardName: addressData.wardName,
    // Add district if User model supports it later, currently mapping partial matching fields
  };

  // Sync GPS location if available
  if (
    addressData.location &&
    addressData.location.lat &&
    addressData.location.lng
  ) {
    updateData.location = {
      lat: addressData.location.lat,
      lng: addressData.location.lng,
      address: addressData.details || "", // Use address details as formatted address
    };
  }

  await User.findByIdAndUpdate(userId, updateData);
};

export const createAddress = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      receiverName,
      phone,
      provinceCode,
      provinceName,
      districtCode,
      districtName,
      wardCode,
      wardName,
      street,
      details,
      isDefault,
      location, // GPS coordinates
    } = req.body;

    // Check if it's the first address
    const count = await Address.countDocuments({ userId });
    const shouldBeDefault = count === 0 ? true : isDefault || false;

    if (shouldBeDefault) {
      // If new one is default, unset previous defaults
      await Address.updateMany({ userId }, { isDefault: false });
    }

    // Auto-geocode if location not provided. Also capture formattedAddress for normalization.
    let finalLocation = location;
    let formattedAddress = null;
    if (
      !location ||
      !location.lat ||
      !location.lng ||
      !geocodingService.isValidCoordinates(location?.lat, location?.lng)
    ) {
      let geocoded = await geocodingService.geocodeAddress({
        street,
        details,
        wardName,
        districtName,
        provinceName,
      });

      if (geocoded) {
        finalLocation = {
          lat: geocoded.lat,
          lng: geocoded.lng,
        };
        formattedAddress = geocoded.formattedAddress || null;
        console.log(
          `[Address] Auto-geocoded address: ${formattedAddress} -> (${geocoded.lat}, ${geocoded.lng})`,
        );
      } else {
        console.warn(
          "[Address] Geocoding failed. Address saved without GPS coordinates.",
        );
      }
    }

    // If we didn't get formattedAddress from geocode, try reverse geocoding from coords
    if (
      !formattedAddress &&
      finalLocation &&
      finalLocation.lat &&
      finalLocation.lng
    ) {
      const rev = await geocodingService.reverseGeocode(
        finalLocation.lat,
        finalLocation.lng,
      );
      if (rev && rev.formattedAddress) formattedAddress = rev.formattedAddress;
    }

    const newAddress = await Address.create({
      userId,
      receiverName,
      phone,
      provinceCode,
      provinceName,
      districtCode,
      districtName,
      wardCode,
      wardName,
      street,
      details,
      isDefault: shouldBeDefault,
      location: finalLocation, // Include GPS location (original or geocoded)
      formattedAddress: formattedAddress,
    });

    if (shouldBeDefault) {
      await syncDefaultAddressToUser(userId, newAddress);
    }

    res.status(201).json({
      success: true,
      data: newAddress,
    });
  } catch (error) {
    next(error);
  }
};

export const getAddresses = async (req, res, next) => {
  try {
    const addresses = await Address.find({ userId: req.user._id }).sort({
      isDefault: -1,
      createdAt: -1,
    });
    res.status(200).json({
      success: true,
      data: addresses,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;
    const updateData = req.body;

    let address = await Address.findOne({ _id: id, userId });
    if (!address) {
      throw new ErrorResponse("Address not found", 404);
    }

    // specific check: if setting isDefault=true
    if (updateData.isDefault === true) {
      await Address.updateMany({ userId }, { isDefault: false });
    }

    // Auto-geocode if address components changed but no location provided
    const addressChanged =
      updateData.street ||
      updateData.details ||
      updateData.wardName ||
      updateData.districtName ||
      updateData.provinceName;

    if (
      addressChanged &&
      (!updateData.location ||
        !updateData.location.lat ||
        !updateData.location.lng)
    ) {
      const geocoded = await geocodingService.geocodeAddress({
        street: updateData.street || address.street,
        details: updateData.details || address.details,
        wardName: updateData.wardName || address.wardName,
        districtName: updateData.districtName || address.districtName,
        provinceName: updateData.provinceName || address.provinceName,
      });

      if (geocoded) {
        updateData.location = {
          lat: geocoded.lat,
          lng: geocoded.lng,
        };
        updateData.formattedAddress =
          geocoded.formattedAddress || updateData.formattedAddress || null;
        console.log(
          `[Address] Auto-geocoded updated address: (${geocoded.lat}, ${geocoded.lng})`,
        );
      }
    }

    // If formattedAddress still missing but we have coordinates, try reverse geocoding
    if (
      !updateData.formattedAddress &&
      updateData.location &&
      updateData.location.lat &&
      updateData.location.lng
    ) {
      const rev = await geocodingService.reverseGeocode(
        updateData.location.lat,
        updateData.location.lng,
      );
      if (rev && rev.formattedAddress)
        updateData.formattedAddress = rev.formattedAddress;
    }

    address = await Address.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (address.isDefault) {
      await syncDefaultAddressToUser(userId, address);
    }

    res.status(200).json({
      success: true,
      data: address,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const address = await Address.findOne({ _id: id, userId });
    if (!address) {
      throw new ErrorResponse("Address not found", 404);
    }

    if (address.isDefault) {
      // Optional: Prevent deleting default or force user to switch default first.
      // For now, allow delete but warn or just leave User table as is (last known state)
      // Or better: Checking if there are other addresses to promote?
      // Simplicity: Just delete. The User table will keep the stale data until they pick a new default.
    }

    await Address.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Address deleted",
    });
  } catch (error) {
    next(error);
  }
};

export const setDefaultAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const address = await Address.findOne({ _id: id, userId });
    if (!address) {
      throw new ErrorResponse("Address not found", 404);
    }

    // Unset all others
    await Address.updateMany({ userId }, { isDefault: false });

    // Set this one
    address.isDefault = true;
    await address.save();

    // Sync
    await syncDefaultAddressToUser(userId, address);

    res.status(200).json({
      success: true,
      data: address,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Geocode an address to GPS coordinates
 * POST /api/addresses/geocode
 * Body: { street, details, wardName, districtName, provinceName }
 */
export const geocodeAddress = async (req, res, next) => {
  try {
    const { street, details, wardName, districtName, provinceName } = req.body;

    if (!provinceName) {
      throw new ErrorResponse("Province name is required for geocoding", 400);
    }

    const result = await geocodingService.geocodeAddress({
      street,
      details,
      wardName,
      districtName,
      provinceName,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        message:
          "Unable to geocode address. Please check API key configuration or address format.",
      });
    }

    res.status(200).json({
      success: true,
      data: {
        location: {
          lat: result.lat,
          lng: result.lng,
        },
        formattedAddress: result.formattedAddress,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Geocode a raw address string
 * POST /api/addresses/geocode-string
 * Body: { address: string }
 */
export const geocodeAddressString = async (req, res, next) => {
  try {
    const { address } = req.body;
    if (!address || typeof address !== "string") {
      throw new ErrorResponse("Address string is required", 400);
    }

    const result = await geocodingService.geocodeAddressString(address);
    if (!result) {
      return res
        .status(404)
        .json({ success: false, message: "Unable to geocode address string" });
    }

    res.status(200).json({
      success: true,
      data: {
        location: { lat: result.lat, lng: result.lng },
        formattedAddress: result.formattedAddress,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reverse geocode GPS coordinates to address
 * POST /api/addresses/reverse-geocode
 * Body: { lat, lng }
 */
export const reverseGeocodeAddress = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      throw new ErrorResponse(
        "Latitude and longitude are required for reverse geocoding",
        400,
      );
    }

    if (!geocodingService.isValidCoordinates(lat, lng)) {
      throw new ErrorResponse("Invalid GPS coordinates", 400);
    }

    const result = await geocodingService.reverseGeocode(lat, lng);

    if (!result) {
      return res.status(404).json({
        success: false,
        message:
          "Unable to reverse geocode coordinates. Please check API key configuration.",
      });
    }

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate distance between two addresses
 * POST /api/addresses/calculate-distance
 * Body: { address1Id, address2Id } or { lat1, lng1, lat2, lng2 }
 */
export const calculateDistance = async (req, res, next) => {
  try {
    const { address1Id, address2Id, lat1, lng1, lat2, lng2 } = req.body;

    let point1, point2;

    // Option 1: Use address IDs
    if (address1Id && address2Id) {
      const addr1 = await Address.findById(address1Id);
      const addr2 = await Address.findById(address2Id);

      if (!addr1 || !addr2) {
        throw new ErrorResponse("One or both addresses not found", 404);
      }

      if (!addr1.location?.lat || !addr2.location?.lat) {
        throw new ErrorResponse(
          "One or both addresses do not have GPS coordinates",
          400,
        );
      }

      point1 = { lat: addr1.location.lat, lng: addr1.location.lng };
      point2 = { lat: addr2.location.lat, lng: addr2.location.lng };
    }
    // Option 2: Use coordinates directly
    else if (lat1 && lng1 && lat2 && lng2) {
      if (
        !geocodingService.isValidCoordinates(lat1, lng1) ||
        !geocodingService.isValidCoordinates(lat2, lng2)
      ) {
        throw new ErrorResponse("Invalid GPS coordinates", 400);
      }

      point1 = { lat: lat1, lng: lng1 };
      point2 = { lat: lat2, lng: lng2 };
    } else {
      throw new ErrorResponse(
        "Please provide either address IDs or coordinates",
        400,
      );
    }

    const distance = geocodingService.calculateDistance(
      point1.lat,
      point1.lng,
      point2.lat,
      point2.lng,
    );

    res.status(200).json({
      success: true,
      data: {
        distance: distance, // in kilometers
        unit: "km",
        from: point1,
        to: point2,
      },
    });
  } catch (error) {
    next(error);
  }
};
