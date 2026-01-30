import AddOnDeal from "../models/AddOnDeal.js";

class AddOnDealService {
  /**
   * Create a new add-on deal
   */
  async createAddOn(sellerId, data) {
    const addOn = new AddOnDeal({
      sellerId,
      name: data.name,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      purchaseLimit: data.purchaseLimit,
      mainProducts: data.mainProducts || [],
      subProducts: data.subProducts || [],
    });

    await addOn.save();
    return addOn;
  }

  /**
   * Get add-on deals for seller or public
   */
  async getAddOns(sellerId, filters = {}) {
    const query = { sellerId };

    // Sync status
    const now = new Date();
    await AddOnDeal.updateMany(
      { sellerId, status: "upcoming", startDate: { $lte: now } },
      { status: "active" },
    );
    await AddOnDeal.updateMany(
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

    // Populate simply for list view
    return await AddOnDeal.find(query)
      .sort({ createdAt: -1 })
      .populate("mainProducts", "name images originalPrice models")
      .populate("subProducts.productId", "name images originalPrice totalStock")
      .lean();
  }

  /**
   * Get single add-on deal
   */
  async getAddOnById(id, sellerId) {
    const addOn = await AddOnDeal.findOne({ _id: id, sellerId })
      .populate("mainProducts", "name images originalPrice models")
      .populate("subProducts.productId", "name images originalPrice totalStock")
      .lean();
    return addOn;
  }

  /**
   * Update add-on deal
   */
  async updateAddOn(id, sellerId, data) {
    const addOn = await AddOnDeal.findOne({ _id: id, sellerId });
    if (!addOn) throw new Error("Add-on Deal not found");

    if (addOn.status === "ended")
      throw new Error("Cannot edit ended promotion");

    if (data.name) addOn.name = data.name;
    if (data.startDate && addOn.status !== "active")
      addOn.startDate = new Date(data.startDate);
    if (data.endDate) addOn.endDate = new Date(data.endDate);
    if (data.purchaseLimit !== undefined)
      addOn.purchaseLimit = data.purchaseLimit;
    if (data.mainProducts) addOn.mainProducts = data.mainProducts;
    if (data.subProducts) addOn.subProducts = data.subProducts;

    await addOn.save();
    return addOn;
  }

  /**
   * Delete add-on deal
   */
  async deleteAddOn(id, sellerId) {
    const addOn = await AddOnDeal.findOne({ _id: id, sellerId });
    if (!addOn) throw new Error("Add-on Deal not found");
    if (addOn.status === "active")
      throw new Error("Cannot delete active promotion");

    await AddOnDeal.deleteOne({ _id: id });
    return true;
  }
}

export default new AddOnDealService();
