import shopProgramService from "../services/shopProgram.service.js";

/**
 * Shop Program Controller
 * Handles HTTP requests for shop program management
 */

// ==================== PROGRAM CRUD ====================

/**
 * Create a new shop program
 * POST /api/seller/shop-programs
 */
export const createProgram = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { name, startDate, endDate } = req.body;

    if (!name || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Name, start date, and end date are required",
      });
    }

    const program = await shopProgramService.createProgram(sellerId, {
      name,
      startDate,
      endDate,
    });

    res.status(201).json({
      success: true,
      message: "Program created successfully",
      data: program,
    });
  } catch (error) {
    console.error("createProgram error:", error);
    console.error("createProgram error stack:", error.stack);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get all programs for seller
 * GET /api/seller/shop-programs
 */
export const getPrograms = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { status } = req.query;

    const programs = await shopProgramService.getSellerPrograms(sellerId, {
      status,
    });

    res.json({
      success: true,
      data: programs,
      count: programs.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Get a single program with products
 * GET /api/seller/shop-programs/:id
 */
export const getProgram = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;

    const program = await shopProgramService.getProgramById(id, sellerId);

    if (!program) {
      return res.status(404).json({
        success: false,
        message: "Program not found",
      });
    }

    res.json({
      success: true,
      data: program,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Update a program
 * PUT /api/seller/shop-programs/:id
 */
export const updateProgram = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const { name, startDate, endDate } = req.body;

    const program = await shopProgramService.updateProgram(id, sellerId, {
      name,
      startDate,
      endDate,
    });

    res.json({
      success: true,
      message: "Program updated successfully",
      data: program,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Delete a program
 * DELETE /api/seller/shop-programs/:id
 */
export const deleteProgram = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;

    await shopProgramService.deleteProgram(id, sellerId);

    res.json({
      success: true,
      message: "Program deleted successfully",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Cancel a program
 * POST /api/seller/shop-programs/:id/cancel
 */
export const cancelProgram = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;

    const program = await shopProgramService.cancelProgram(id, sellerId);

    res.json({
      success: true,
      message: "Program cancelled successfully",
      data: program,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== PROGRAM PRODUCTS ====================

/**
 * Add products to program
 * POST /api/seller/shop-programs/:id/products
 */
export const addProducts = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "productIds array is required",
      });
    }

    const results = await shopProgramService.addProducts(
      id,
      sellerId,
      productIds,
    );

    res.json({
      success: true,
      message: `Added ${results.added.length} products`,
      data: results,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Update product variants in program
 * PUT /api/seller/shop-programs/:id/products/:productId
 */
export const updateProductVariants = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id, productId } = req.params;
    const { variants } = req.body;

    if (!variants || !Array.isArray(variants)) {
      return res.status(400).json({
        success: false,
        message: "variants array is required",
      });
    }

    const programProduct = await shopProgramService.updateProductVariants(
      id,
      sellerId,
      productId,
      variants,
    );

    res.json({
      success: true,
      message: "Product variants updated successfully",
      data: programProduct,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Remove product from program
 * DELETE /api/seller/shop-programs/:id/products/:productId
 */
export const removeProduct = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id, productId } = req.params;

    await shopProgramService.removeProduct(id, sellerId, productId);

    res.json({
      success: true,
      message: "Product removed from program",
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

// ==================== BATCH OPERATIONS ====================

/**
 * Batch update variants
 * PUT /api/seller/shop-programs/:id/products/batch
 */
export const batchUpdateVariants = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const { variantIds, settings } = req.body;

    if (!variantIds || !Array.isArray(variantIds) || variantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "variantIds array is required",
      });
    }

    if (!settings) {
      return res.status(400).json({
        success: false,
        message: "settings object is required",
      });
    }

    const result = await shopProgramService.batchUpdateVariants(
      id,
      sellerId,
      variantIds,
      settings,
    );

    res.json({
      success: true,
      message: `Updated ${result.updatedCount} variants`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Batch remove products
 * DELETE /api/seller/shop-programs/:id/products/batch
 */
export const batchRemoveProducts = async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { id } = req.params;
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "productIds array is required",
      });
    }

    const result = await shopProgramService.batchRemoveProducts(
      id,
      sellerId,
      productIds,
    );

    res.json({
      success: true,
      message: `Removed ${result.deletedCount} products`,
      data: result,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};
