import ShopProgram from "../models/ShopProgram.js";
import ShopProgramProduct from "../models/ShopProgramProduct.js";
import Product from "../models/Product.js";
import mongoose from "mongoose";

/**
 * Shop Program Service
 * Business logic for shop program management
 */
class ShopProgramService {
  /**
   * Create a new shop program
   */
  async createProgram(sellerId, data) {
    const program = new ShopProgram({
      sellerId,
      name: data.name,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      status: "upcoming",
    });

    await program.save();
    return program;
  }

  /**
   * Get all programs for a seller
   */
  async getSellerPrograms(sellerId, filters = {}) {
    const query = { sellerId };

    if (filters.status) {
      query.status = filters.status;
    }

    // Sync statuses before querying
    await ShopProgram.syncAllStatuses();

    const programs = await ShopProgram.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return programs;
  }

  /**
   * Get a single program with products
   */
  async getProgramById(programId, sellerId) {
    const program = await ShopProgram.findOne({
      _id: programId,
      sellerId,
    }).lean();

    if (!program) {
      return null;
    }

    const products = await ShopProgramProduct.find({ programId })
      .populate("productId", "name images price models totalStock")
      .lean();

    return { ...program, products };
  }

  /**
   * Update a program (only draft/upcoming)
   */
  async updateProgram(programId, sellerId, data) {
    const program = await ShopProgram.findOne({ _id: programId, sellerId });

    if (!program) {
      throw new Error("Program not found");
    }

    if (program.status === "ended") {
      throw new Error("Cannot edit ended programs");
    }

    if (data.name) program.name = data.name;

    // Only allow changing start date if program hasn't started
    if (data.startDate) {
      if (program.status === "active") {
        // Ignored or throw error? Better to ignore or keep original if active
        // Or throw specific error: "Cannot change start date of active program"
        // For now, let's keep original startDate if active
      } else {
        program.startDate = new Date(data.startDate);
      }
    }

    if (data.endDate) program.endDate = new Date(data.endDate);

    await program.save();
    return program;
  }

  /**
   * Delete a program and its products
   */
  async deleteProgram(programId, sellerId) {
    const program = await ShopProgram.findOne({ _id: programId, sellerId });

    if (!program) {
      throw new Error("Program not found");
    }

    if (program.status === "active") {
      throw new Error("Cannot delete active programs");
    }

    // Delete all program products first
    await ShopProgramProduct.deleteMany({ programId });

    // Delete the program
    await ShopProgram.deleteOne({ _id: programId });

    return { deleted: true };
  }

  /**
   * Cancel a program
   */
  async cancelProgram(programId, sellerId) {
    const program = await ShopProgram.findOne({ _id: programId, sellerId });

    if (!program) {
      throw new Error("Program not found");
    }

    if (program.status === "ended") {
      throw new Error("Cannot cancel ended programs");
    }

    program.status = "cancelled";
    await program.save();

    // Also cancel all products
    await ShopProgramProduct.updateMany({ programId }, { status: "cancelled" });

    return program;
  }

  /**
   * Add products to a program
   */
  async addProducts(programId, sellerId, productIds) {
    const program = await ShopProgram.findOne({ _id: programId, sellerId });

    if (!program) {
      throw new Error("Program not found");
    }

    if (program.status === "ended" || program.status === "cancelled") {
      throw new Error("Cannot add products to ended or cancelled programs");
    }

    const results = {
      added: [],
      skipped: [],
      errors: [],
    };

    for (const productId of productIds) {
      try {
        // Check if product exists and belongs to seller
        const product = await Product.findOne({
          _id: productId,
          sellerId: sellerId,
        }).lean();

        if (!product) {
          results.errors.push({ productId, error: "Product not found" });
          continue;
        }

        // Check for overlap
        const overlap = await ShopProgramProduct.checkOverlap(
          productId,
          program.startDate,
          program.endDate,
          programId,
        );

        if (overlap) {
          results.errors.push({
            productId,
            error: "Product already in overlapping program",
          });
          continue;
        }

        // Check if already in this program
        const existing = await ShopProgramProduct.findOne({
          programId,
          productId,
        });

        if (existing) {
          results.skipped.push(productId);
          continue;
        }

        // Create program product with variants
        // Note: enabled=false to bypass salePrice validation on initial add
        // User will configure prices and enable variants in the form
        const variants = (product.models || []).map((model, idx) => ({
          variantId: `${productId}-${idx}`,
          variantName: model.name || `Variant ${idx + 1}`,
          originalPrice: model.price || product.price,
          salePrice: model.price || product.price, // Will be configured by user
          discount: 0,
          discountType: "fixed",
          promoQty: model.stock || 0,
          soldQty: 0,
          orderLimit: null,
          enabled: false, // Start disabled, user enables after configuring
        }));

        // If no variants, create a default one
        if (variants.length === 0) {
          variants.push({
            variantId: `${productId}-0`,
            variantName: "Default",
            originalPrice: product.price,
            salePrice: product.price,
            discount: 0,
            discountType: "fixed",
            promoQty: product.totalStock || 0,
            soldQty: 0,
            orderLimit: null,
            enabled: false,
          });
        }

        const programProduct = new ShopProgramProduct({
          programId,
          productId,
          sellerId,
          productName: product.name,
          productImage: product.images?.[0] || "",
          variants,
          status: program.status === "draft" ? "upcoming" : program.status,
        });

        await programProduct.save();
        results.added.push(productId);
      } catch (error) {
        results.errors.push({ productId, error: error.message });
      }
    }

    // Update program stats
    const stats = await ShopProgramProduct.aggregate([
      { $match: { programId: program._id } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalVariants: { $sum: { $size: "$variants" } },
        },
      },
    ]);

    if (stats.length > 0) {
      program.totalProducts = stats[0].totalProducts;
      program.totalVariants = stats[0].totalVariants;
      await program.save();
    }

    return results;
  }

  /**
   * Update a product's variants in a program
   */
  async updateProductVariants(programId, sellerId, productId, variants) {
    const programProduct = await ShopProgramProduct.findOne({
      programId,
      productId,
      sellerId,
    });

    if (!programProduct) {
      throw new Error("Product not found in program");
    }

    // Validate and update variants
    for (const update of variants) {
      const variant = programProduct.variants.find(
        (v) => v.variantId === update.variantId,
      );
      if (variant) {
        if (update.salePrice !== undefined)
          variant.salePrice = update.salePrice;
        if (update.discount !== undefined) variant.discount = update.discount;
        if (update.discountType !== undefined)
          variant.discountType = update.discountType;
        if (update.promoQty !== undefined) variant.promoQty = update.promoQty;
        if (update.orderLimit !== undefined)
          variant.orderLimit = update.orderLimit;
        if (update.enabled !== undefined) variant.enabled = update.enabled;
      }
    }

    await programProduct.save();
    return programProduct;
  }

  /**
   * Remove a product from a program
   */
  async removeProduct(programId, sellerId, productId) {
    const result = await ShopProgramProduct.deleteOne({
      programId,
      productId,
      sellerId,
    });

    if (result.deletedCount === 0) {
      throw new Error("Product not found in program");
    }

    // Update program stats
    const program = await ShopProgram.findById(programId);
    if (program) {
      const stats = await ShopProgramProduct.aggregate([
        { $match: { programId: program._id } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalVariants: { $sum: { $size: "$variants" } },
          },
        },
      ]);

      program.totalProducts = stats[0]?.totalProducts || 0;
      program.totalVariants = stats[0]?.totalVariants || 0;
      await program.save();
    }

    return { deleted: true };
  }

  /**
   * Batch update variants (apply to multiple variants at once)
   */
  async batchUpdateVariants(programId, sellerId, variantIds, settings) {
    const programProducts = await ShopProgramProduct.find({
      programId,
      sellerId,
    });

    let updatedCount = 0;

    for (const product of programProducts) {
      let modified = false;
      for (const variant of product.variants) {
        if (variantIds.includes(variant.variantId)) {
          if (settings.discount !== undefined) {
            variant.discount = settings.discount;
          }
          if (settings.discountType !== undefined) {
            variant.discountType = settings.discountType;
            // Recalculate sale price based on discount
            if (settings.discountType === "percent") {
              variant.salePrice = Math.round(
                variant.originalPrice * (1 - settings.discount / 100),
              );
            } else {
              variant.salePrice = variant.originalPrice - settings.discount;
            }
          }
          if (settings.promoQty !== undefined) {
            variant.promoQty = settings.promoQty;
          }
          if (settings.orderLimit !== undefined) {
            variant.orderLimit = settings.orderLimit;
          }
          if (settings.enabled !== undefined) {
            variant.enabled = settings.enabled;
          }
          modified = true;
          updatedCount++;
        }
      }
      if (modified) {
        await product.save();
      }
    }

    return { updatedCount };
  }

  /**
   * Batch remove products from program
   */
  async batchRemoveProducts(programId, sellerId, productIds) {
    const result = await ShopProgramProduct.deleteMany({
      programId,
      sellerId,
      productId: { $in: productIds },
    });

    // Update program stats
    const program = await ShopProgram.findById(programId);
    if (program) {
      const stats = await ShopProgramProduct.aggregate([
        { $match: { programId: program._id } },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            totalVariants: { $sum: { $size: "$variants" } },
          },
        },
      ]);

      program.totalProducts = stats[0]?.totalProducts || 0;
      program.totalVariants = stats[0]?.totalVariants || 0;
      await program.save();
    }

    return { deletedCount: result.deletedCount };
  }

  /**
   * Delete program
   */
  async deleteProgram(programId, sellerId) {
    const program = await ShopProgram.findOne({ _id: programId, sellerId });
    if (!program) {
      throw new Error("Program not found");
    }

    // Delete all products
    await ShopProgramProduct.deleteMany({ programId });

    // Delete program
    await ShopProgram.deleteOne({ _id: programId });

    return { success: true };
  }
}

export default new ShopProgramService();
