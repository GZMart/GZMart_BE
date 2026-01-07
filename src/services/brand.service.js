import Brand from "../models/Brand.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

class BrandService {
  /**
   * Get all brands
   */
  async getBrands(filters = {}) {
    const query = { isActive: true };

    if (filters.isFeatured) {
      query.isFeatured = true;
    }

    const brands = await Brand.find(query).sort("order name").lean();

    return brands;
  }

  /**
   * Get top brands (featured with most products)
   */
  async getTopBrands(limit = 9) {
    const brands = await Brand.find({
      isActive: true,
      isFeatured: true,
    })
      .sort({ productCount: -1, order: 1 })
      .limit(limit)
      .select("name slug logo productCount")
      .lean();

    return brands;
  }

  /**
   * Get brand by ID or slug
   */
  async getBrandById(identifier) {
    let brand;

    // Check if identifier is ObjectId or slug
    if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
      brand = await Brand.findOne({
        _id: identifier,
        isActive: true,
      }).lean();
    } else {
      brand = await Brand.findOne({
        slug: identifier,
        isActive: true,
      }).lean();
    }

    if (!brand) {
      throw new ErrorResponse("Brand not found", 404);
    }

    return brand;
  }

  /**
   * Get products by brand
   */
  async getBrandProducts(brandSlug, options) {
    const { page = 1, limit = 20, sort = "-createdAt" } = options;
    const skip = (page - 1) * limit;

    const brand = await this.getBrandById(brandSlug);

    const query = {
      brand: brand.name, // Assuming Product stores brand as string
      isAvailable: true,
    };

    const [products, total] = await Promise.all([
      Product.find(query)
        .select(
          "name slug brand images rating reviews sold originalPrice status"
        )
        .populate("activeDeal", "discountPercent title endDate")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments(query),
    ]);

    return {
      brand,
      products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Update brand product count
   */
  async updateProductCount(brandName) {
    const count = await Product.countDocuments({
      brand: brandName,
      isAvailable: true,
    });

    await Brand.updateOne({ name: brandName }, { productCount: count });

    return count;
  }
}

export default new BrandService();
