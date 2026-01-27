import Address from "../models/Address.js";
import User from "../models/User.js";
import { ErrorResponse } from "../middlewares/error.middleware.js";

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
    } = req.body;

    // Check if it's the first address
    const count = await Address.countDocuments({ userId });
    const shouldBeDefault = count === 0 ? true : isDefault || false;

    if (shouldBeDefault) {
      // If new one is default, unset previous defaults
      await Address.updateMany({ userId }, { isDefault: false });
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
