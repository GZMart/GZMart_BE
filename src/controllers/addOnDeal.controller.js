import addOnDealService from "../services/addOnDeal.service.js";

export const createAddOn = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const addOn = await addOnDealService.createAddOn(sellerId, req.body);
    res.status(201).json({ success: true, data: addOn });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getAddOns = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const result = await addOnDealService.getAddOns(sellerId, req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getAddOnById = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const addOn = await addOnDealService.getAddOnById(req.params.id, sellerId);
    if (!addOn) {
      return res
        .status(404)
        .json({ success: false, message: "Promotion not found" });
    }
    res.json({ success: true, data: addOn });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateAddOn = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const addOn = await addOnDealService.updateAddOn(
      req.params.id,
      sellerId,
      req.body,
    );
    res.json({ success: true, data: addOn });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteAddOn = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    await addOnDealService.deleteAddOn(req.params.id, sellerId);
    res.json({ success: true, message: "Promotion deleted successfully" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
