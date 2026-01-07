import Deal from "../models/Deal.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

class DealService {
  /**
   * Get active deals by type
   */
  async getDealsByType(type, options = {}) {
    const { limit = 20, page = 1 } = options;
    const now = new Date();

    const query = {
      type,
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    };

    // Filter out deals that reached quantity limit
    const deals = await Deal.find(query)
      .populate({
        path: "productId",
        match: { isAvailable: true },
        populate: {
          path: "categoryId",
          select: "name slug",
        },
      })
      .sort("-priority -createdAt")
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Filter out deals with null products (inactive products)
    const activeDeals = deals.filter((deal) => deal.productId !== null);

    // Check quantity limits
    const validDeals = activeDeals.filter((deal) => {
      if (!deal.quantityLimit) return true;
      return deal.soldCount < deal.quantityLimit;
    });

    // Enrich with price info
    const enrichedDeals = await Promise.all(
      validDeals.map(async (deal) => {
        // Models are embedded in product document
        const models = deal.productId.models || [];

        if (models.length > 0) {
          const prices = models.map((m) => m.price);
          deal.productId.minPrice = Math.min(...prices);
          deal.productId.maxPrice = Math.max(...prices);
          deal.productId.totalStock = models.reduce(
            (sum, m) => sum + m.stock,
            0
          );

          // Calculate discounted price
          deal.discountedMinPrice =
            deal.productId.minPrice * (1 - deal.discountPercent / 100);
          deal.discountedMaxPrice =
            deal.productId.maxPrice * (1 - deal.discountPercent / 100);
        }

        return deal;
      })
    );

    const total = await Deal.countDocuments(query);

    return {
      deals: enrichedDeals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Get flash sales
   */
  async getFlashSales(options = {}) {
    return await this.getDealsByType("flash", options);
  }

  /**
   * Get daily deals
   */
  async getDailyDeals(options = {}) {
    return await this.getDealsByType("daily", options);
  }

  /**
   * Get weekend deals
   */
  async getWeekendDeals(options = {}) {
    return await this.getDealsByType("weekend", options);
  }

  /**
   * Get deal by product ID
   */
  async getActiveDealByProduct(productId) {
    const now = new Date();

    const deal = await Deal.findOne({
      productId,
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).lean();

    if (!deal) {
      return null;
    }

    // Check quantity limit
    if (deal.quantityLimit && deal.soldCount >= deal.quantityLimit) {
      return null;
    }

    return deal;
  }

  /**
   * Get all active deals
   */
  async getAllActiveDeals(options = {}) {
    const { limit = 20, page = 1 } = options;
    const now = new Date();

    const query = {
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    };

    const deals = await Deal.find(query)
      .populate({
        path: "productId",
        match: { isAvailable: true },
        populate: {
          path: "categoryId",
          select: "name slug",
        },
      })
      .sort("-priority -createdAt")
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // Filter and enrich
    const activeDeals = deals.filter((deal) => {
      if (!deal.productId) return false;
      if (deal.quantityLimit && deal.soldCount >= deal.quantityLimit)
        return false;
      return true;
    });

    const enrichedDeals = await Promise.all(
      activeDeals.map(async (deal) => {
        // Models are embedded in product document
        const models = deal.productId.models || [];

        if (models.length > 0) {
          const prices = models.map((m) => m.price);
          deal.productId.minPrice = Math.min(...prices);
          deal.productId.maxPrice = Math.max(...prices);
          deal.productId.totalStock = models.reduce(
            (sum, m) => sum + m.stock,
            0
          );

          deal.discountedMinPrice =
            deal.productId.minPrice * (1 - deal.discountPercent / 100);
          deal.discountedMaxPrice =
            deal.productId.maxPrice * (1 - deal.discountPercent / 100);
        }

        return deal;
      })
    );

    const total = await Deal.countDocuments(query);

    return {
      deals: enrichedDeals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Update deal status (cron job can call this)
   */
  async updateDealStatuses() {
    const now = new Date();

    // Expire deals that passed end date
    await Deal.updateMany(
      {
        status: "active",
        endDate: { $lt: now },
      },
      {
        $set: { status: "expired" },
      }
    );

    // Activate deals that reached start date
    await Deal.updateMany(
      {
        status: "pending",
        startDate: { $lte: now },
        endDate: { $gte: now },
      },
      {
        $set: { status: "active" },
      }
    );

    // Expire deals that reached quantity limit
    const deals = await Deal.find({
      status: "active",
      quantityLimit: { $ne: null },
    });

    for (const deal of deals) {
      if (deal.soldCount >= deal.quantityLimit) {
        deal.status = "expired";
        await deal.save();
      }
    }
  }
}

export default new DealService();
