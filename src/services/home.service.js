import Banner from "../models/Banner.js";
import Deal from "../models/Deal.js";
import Category from "../models/Category.js";
import Product from "../models/Product.js";
import dealService from "./deal.service.js";

class HomeService {
  /**
   * Get all active banners
   */
  async getBanners() {
    const now = new Date();

    const banners = await Banner.find({
      isActive: true,
      $or: [
        { startDate: null, endDate: null },
        { startDate: { $lte: now }, endDate: { $gte: now } },
        { startDate: { $lte: now }, endDate: null },
        { startDate: null, endDate: { $gte: now } },
      ],
    })
      .sort("order")
      .lean();

    return banners;
  }

  /**
   * Get homepage sections (banners, deals, categories, featured products)
   */
  async getHomeSections() {
    // Get banners
    const banners = await this.getBanners();

    // Get featured categories
    const categories = await Category.find({
      isActive: true,
      isFeatured: true,
    })
      .sort("order")
      .limit(8)
      .lean();

    // Get categories with product counts
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        const productCount = await Product.countDocuments({
          categoryId: category._id,
          isAvailable: true,
        });
        return { ...category, productCount };
      })
    );

    // Get flash sales
    const flashSales = await dealService.getFlashSales({ limit: 10 });

    // Get featured products
    const featuredProducts = await Product.find({
      isAvailable: true,
      isFeatured: true,
    })
      .populate("categoryId", "name slug")
      .sort("-rating")
      .limit(10)
      .lean();

    // Enrich featured products
    const enrichedFeaturedProducts = await this._enrichProducts(
      featuredProducts
    );

    // Get trending products
    const trendingProducts = await Product.find({
      isAvailable: true,
      isTrending: true,
    })
      .populate("categoryId", "name slug")
      .sort("-sold")
      .limit(10)
      .lean();

    const enrichedTrendingProducts = await this._enrichProducts(
      trendingProducts
    );

    // Get new arrivals
    const newArrivals = await Product.find({ isAvailable: true })
      .populate("categoryId", "name slug")
      .sort("-createdAt")
      .limit(10)
      .lean();

    const enrichedNewArrivals = await this._enrichProducts(newArrivals);

    return {
      banners,
      categories: categoriesWithCounts,
      flashSales: flashSales.deals || [],
      featuredProducts: enrichedFeaturedProducts,
      trendingProducts: enrichedTrendingProducts,
      newArrivals: enrichedNewArrivals,
    };
  }

  /**
   * Get deals of the day
   */
  async getDealsOfTheDay() {
    return await dealService.getDailyDeals({ limit: 20 });
  }

  /**
   * Helper: Enrich products with price and deals
   */
  async _enrichProducts(products) {
    const now = new Date();

    return await Promise.all(
      products.map(async (product) => {
        // Models are embedded in product document
        const models = product.models || [];

        if (models.length > 0) {
          const prices = models.map((m) => m.price);
          product.minPrice = Math.min(...prices);
          product.maxPrice = Math.max(...prices);
          product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
        }

        // Get active deal
        const activeDeal = await Deal.findOne({
          productId: product._id,
          status: "active",
          startDate: { $lte: now },
          endDate: { $gte: now },
        }).lean();

        if (activeDeal) {
          product.activeDeal = activeDeal;

          if (product.minPrice) {
            product.discountedMinPrice =
              product.minPrice * (1 - activeDeal.discountPercent / 100);
            product.discountedMaxPrice =
              product.maxPrice * (1 - activeDeal.discountPercent / 100);
          }
        }

        return product;
      })
    );
  }

  /**
   * Increment banner click count
   */
  async incrementBannerClick(bannerId) {
    await Banner.findByIdAndUpdate(bannerId, {
      $inc: { clickCount: 1 },
    });
  }
}

export default new HomeService();
