import brandService from "../services/brand.service.js";

class BrandController {
  /**
   * Get all brands
   * GET /api/brands
   */
  async getBrands(req, res) {
    const { featured } = req.query;

    const filters = {};
    if (featured === "true") {
      filters.isFeatured = true;
    }

    const brands = await brandService.getBrands(filters);

    res.status(200).json({
      success: true,
      count: brands.length,
      data: brands,
    });
  }

  /**
   * Get top brands
   * GET /api/brands/top
   */
  async getTopBrands(req, res) {
    const { limit = 9 } = req.query;

    const brands = await brandService.getTopBrands(parseInt(limit));

    res.status(200).json({
      success: true,
      count: brands.length,
      data: brands,
    });
  }

  /**
   * Get brand by ID or slug
   * GET /api/brands/:id
   */
  async getBrandById(req, res) {
    const brand = await brandService.getBrandById(req.params.id);

    res.status(200).json({
      success: true,
      data: brand,
    });
  }

  /**
   * Get products by brand
   * GET /api/brands/:id/products
   */
  async getBrandProducts(req, res) {
    const { page, limit, sort } = req.query;

    const result = await brandService.getBrandProducts(req.params.id, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sort: sort || "-createdAt",
    });

    res.status(200).json({
      success: true,
      data: result.products,
      brand: result.brand,
      pagination: result.pagination,
    });
  }
}

const brandController = new BrandController();
export default brandController;
