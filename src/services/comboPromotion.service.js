import ComboPromotion from "../models/ComboPromotion.js";
import Product from "../models/Product.js";

class ComboPromotionService {
  /**
   * Create a new combo
   */
  async createCombo(sellerId, data) {
    const combo = new ComboPromotion({
      sellerId,
      name: data.name,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      comboType: data.comboType,
      tiers: data.tiers,
      orderLimit: data.orderLimit,
      products: data.products || [], // Array of product IDs
    });

    await combo.save();
    return combo;
  }

  /**
   * Get combos for seller
   */
  async getCombos(sellerId, filters = {}) {
    const query = { sellerId };

    // Simple sync status check (could be optimized to bulk update like ShopProgram)
    const now = new Date();
    await ComboPromotion.updateMany(
      { sellerId, status: "upcoming", startDate: { $lte: now } },
      { status: "active" },
    );
    await ComboPromotion.updateMany(
      {
        sellerId,
        status: { $in: ["active", "upcoming"] },
        endDate: { $lte: now },
      },
      { status: "ended" },
    );

    if (filters.status) {
      query.status = filters.status;
    }

    return await ComboPromotion.find(query)
      .sort({ createdAt: -1 })
      .populate("products", "name images originalPrice models") // Include models for totalStock virtual
      .lean();
  }

  /**
   * Get single combo
   */
  async getComboById(comboId, sellerId) {
    const combo = await ComboPromotion.findOne({ _id: comboId, sellerId })
      .populate("products", "name images originalPrice models")
      .lean();
    return combo;
  }

  /**
   * Update combo
   */
  async updateCombo(comboId, sellerId, data) {
    const combo = await ComboPromotion.findOne({ _id: comboId, sellerId });
    if (!combo) throw new Error("Combo not found");

    if (combo.status === "ended") throw new Error("Cannot edit ended combo");

    // Allow updating fields
    if (data.name) combo.name = data.name;
    if (data.startDate && combo.status !== "active")
      combo.startDate = new Date(data.startDate);
    if (data.endDate) combo.endDate = new Date(data.endDate);
    if (data.comboType) combo.comboType = data.comboType;
    if (data.tiers) combo.tiers = data.tiers;
    if (data.orderLimit !== undefined) combo.orderLimit = data.orderLimit;
    if (data.products) combo.products = data.products;

    await combo.save();
    return combo;
  }

  /**
   * Delete combo
   */
  async deleteCombo(comboId, sellerId) {
    const combo = await ComboPromotion.findOne({ _id: comboId, sellerId });
    if (!combo) throw new Error("Combo not found");
    if (combo.status === "active")
      throw new Error("Cannot delete active combo");

    await ComboPromotion.deleteOne({ _id: comboId });
    return true;
  }
}

export default new ComboPromotionService();
