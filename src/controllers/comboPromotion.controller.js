import comboPromotionService from "../services/comboPromotion.service.js";

export const createCombo = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const combo = await comboPromotionService.createCombo(sellerId, req.body);
    res.status(201).json({ success: true, data: combo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getCombos = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { status } = req.query;
    const combos = await comboPromotionService.getCombos(sellerId, { status });
    res.json({ success: true, data: combos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCombo = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const combo = await comboPromotionService.getComboById(id, sellerId);
    if (!combo)
      return res
        .status(404)
        .json({ success: false, message: "Combo not found" });
    res.json({ success: true, data: combo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCombo = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const combo = await comboPromotionService.updateCombo(
      id,
      sellerId,
      req.body,
    );
    res.json({ success: true, data: combo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteCombo = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    await comboPromotionService.deleteCombo(id, sellerId);
    res.json({ success: true, message: "Combo deleted successfully" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
