import Wishlist from "../models/Wishlist.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

class WishlistService {
  _normalizeVariantInput(variant = {}) {
    return {
      modelId: variant.modelId || null,
      color: variant.color || "Default",
      size: variant.size || "Default",
    };
  }

  _isSameVariant(item, target) {
    const itemModelId = item?.modelId ? item.modelId.toString() : null;
    const targetModelId = target?.modelId ? target.modelId.toString() : null;

    if (itemModelId || targetModelId) {
      return itemModelId === targetModelId;
    }

    return (
      (item?.color || "Default") === (target?.color || "Default") &&
      (item?.size || "Default") === (target?.size || "Default")
    );
  }

  /**
   * Get user's wishlists
   */
  async getUserWishlists(userId) {
    console.log("getUserWishlists called for userId:", userId);

    let wishlist = await Wishlist.findOne({ userId })
      .populate({
        path: "products",
        match: { status: "active" },
        select:
          "name slug images tiers models brand rating reviewCount sold status",
      })
      .populate({
        path: "wishlistItems.productId",
        match: { status: "active" },
        select:
          "name slug images tiers models brand rating reviewCount sold status",
      })
      .lean();

    console.log("Wishlist found:", wishlist);

    if (!wishlist) {
      wishlist = await Wishlist.create({
        userId,
        products: [],
        wishlistItems: [],
      });
      console.log("Created empty wishlist");
    }

    const rawVariantItems = (wishlist.wishlistItems || []).filter(
      (entry) => entry?.productId,
    );

    // Backward compatibility: if old docs only have products array, expose default variants.
    const effectiveItems =
      rawVariantItems.length > 0
        ? rawVariantItems
        : (wishlist.products || [])
            .filter((p) => p !== null)
            .map((product) => ({
              _id: null,
              productId: product,
              modelId: null,
              color: "Default",
              size: "Default",
            }));

    console.log("Valid wishlist items count:", effectiveItems.length);

    // Add price info from selected model if present, else fallback to active model.
    const productsWithPrice = effectiveItems.map((entry) => {
      const product = entry.productId;
      const models = product.models || [];
      const selectedModel = entry.modelId
        ? models.find((m) => m?._id?.toString() === entry.modelId.toString())
        : null;
      const activeModel =
        selectedModel || models.find((m) => m.isActive) || models[0] || {};

      return {
        ...product,
        wishlistItemId: entry._id || null,
        wishlistModelId: entry.modelId || null,
        wishlistColor: entry.color || "Default",
        wishlistSize: entry.size || "Default",
        price: activeModel.price || 0,
        originalPrice: activeModel.originalPrice || activeModel.price || 0,
        stock: models.reduce((sum, m) => sum + (m.stock || 0), 0),
      };
    });

    console.log("Returning products:", productsWithPrice.length);

    return {
      _id: wishlist._id,
      userId: wishlist.userId,
      products: productsWithPrice,
      count: productsWithPrice.length,
    };
  }

  /**
   * Add product to wishlists
   */
  async addToWishlists(userId, productId, variant = {}) {
    console.log("addToWishlists called:", { userId, productId, variant });
    const normalizedVariant = this._normalizeVariantInput(variant);

    // Check if product exists and is active
    const product = await Product.findOne({
      _id: productId,
      status: "active",
    });

    console.log("Product found:", product ? "Yes" : "No");

    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }

    if (normalizedVariant.modelId) {
      const modelExists = (product.models || []).some(
        (m) => m?._id?.toString() === normalizedVariant.modelId.toString(),
      );
      if (!modelExists) {
        throw new ErrorResponse("Selected variant is not available", 400);
      }
    }

    let wishlist = await Wishlist.findOne({ userId });
    console.log("Existing wishlist:", wishlist ? "Yes" : "No");

    if (!wishlist) {
      wishlist = await Wishlist.create({
        userId,
        products: [productId],
        wishlistItems: [
          {
            productId,
            modelId: normalizedVariant.modelId,
            color: normalizedVariant.color,
            size: normalizedVariant.size,
          },
        ],
      });
      // Increment product's wishlistCount
      await Product.findByIdAndUpdate(productId, {
        $inc: { wishlistCount: 1 },
      });

      console.log("Created new wishlist:", wishlist);
      return {
        message: "Product added to wishlists successfully",
        alreadyExists: false,
      };
    } else {
      const wishlistItems = wishlist.wishlistItems || [];
      const alreadyExists = wishlistItems.some(
        (item) =>
          item.productId?.toString() === productId.toString() &&
          this._isSameVariant(item, normalizedVariant),
      );
      console.log("Already exists:", alreadyExists);

      if (alreadyExists) {
        return {
          message: "Product is already in wishlists",
          alreadyExists: true,
        };
      }

      wishlist.wishlistItems.push({
        productId,
        modelId: normalizedVariant.modelId,
        color: normalizedVariant.color,
        size: normalizedVariant.size,
      });

      // Keep legacy products array in sync for product-level counters and compatibility.
      const productExists = (wishlist.products || []).some(
        (id) => id.toString() === productId.toString(),
      );
      if (!productExists) {
        wishlist.products.push(productId);
      }

      await wishlist.save();

      // Increment only when first variant of this product is added by this user.
      if (!productExists) {
        await Product.findByIdAndUpdate(productId, {
          $inc: { wishlistCount: 1 },
        });
      }

      console.log("Updated wishlist:", wishlist);
      return {
        message: "Product added to wishlists successfully",
        alreadyExists: false,
      };
    }
  }

  /**
   * Remove product from wishlists
   */
  async removeFromWishlists(userId, productId, variant = {}) {
    const normalizedVariant = this._normalizeVariantInput(variant);
    const wishlist = await Wishlist.findOne({ userId });

    if (!wishlist) {
      throw new ErrorResponse("Wishlists not found", 404);
    }

    const wishlistItems = wishlist.wishlistItems || [];
    let removed = false;

    if (wishlistItems.length > 0) {
      const before = wishlistItems.length;
      if (variant.modelId || variant.color || variant.size) {
        wishlist.wishlistItems = wishlistItems.filter(
          (item) =>
            !(
              item.productId?.toString() === productId.toString() &&
              this._isSameVariant(item, normalizedVariant)
            ),
        );
      } else {
        // Legacy/product-level remove: remove all variants for the product.
        wishlist.wishlistItems = wishlistItems.filter(
          (item) => item.productId?.toString() !== productId.toString(),
        );
      }
      removed = wishlist.wishlistItems.length < before;
    }

    // Backward compatibility path for old docs with only products array.
    if (!removed) {
      const productIndex = (wishlist.products || []).findIndex(
        (id) => id.toString() === productId.toString(),
      );
      if (productIndex !== -1) {
        wishlist.products.splice(productIndex, 1);
        removed = true;
      }
    }

    if (!removed) {
      throw new ErrorResponse("Product not in wishlists", 404);
    }

    // Keep legacy products array in sync with remaining variant items.
    const stillHasVariant = (wishlist.wishlistItems || []).some(
      (item) => item.productId?.toString() === productId.toString(),
    );
    if (!stillHasVariant) {
      wishlist.products = (wishlist.products || []).filter(
        (id) => id.toString() !== productId.toString(),
      );
      await Product.findByIdAndUpdate(productId, {
        $inc: { wishlistCount: -1 },
      });
    }

    await wishlist.save();

    return { message: "Product removed from wishlists successfully" };
  }

  /**
   * Clear all wishlists
   */
  async clearWishlists(userId) {
    const wishlist = await Wishlist.findOne({ userId });

    if (!wishlist) {
      throw new ErrorResponse("Wishlists not found", 404);
    }

    wishlist.products = [];
    wishlist.wishlistItems = [];
    await wishlist.save();

    return { message: "Wishlists cleared successfully" };
  }

  /**
   * Check if product is in wishlists
   */
  async isInWishlists(userId, productId, variant = {}) {
    console.log("isInWishlists called:", { userId, productId, variant });
    const normalizedVariant = this._normalizeVariantInput(variant);

    const wishlist = await Wishlist.findOne({ userId });
    console.log("Wishlist document:", wishlist);

    if (!wishlist) {
      console.log("No wishlist document found");
      return false;
    }

    const hasVariantInput = !!(
      variant.modelId ||
      (variant.color && variant.color !== "Default") ||
      (variant.size && variant.size !== "Default")
    );

    if (hasVariantInput) {
      // For explicit variant checks, do not fallback to legacy product-level array.
      // This prevents S/M variants from sharing one boolean state.
      if ((wishlist.wishlistItems || []).length === 0) {
        console.log(
          "No variant-level wishlistItems found; explicit variant check -> false",
        );
        return false;
      }

      const variantExists = wishlist.wishlistItems.some(
        (item) =>
          item.productId?.toString() === productId.toString() &&
          this._isSameVariant(item, normalizedVariant),
      );
      console.log("Variant exists in wishlists:", variantExists);
      return variantExists;
    }

    const exists = wishlist.products.some(
      (id) => id.toString() === productId.toString(),
    );
    console.log("Product exists in wishlists:", exists);

    return exists;
  }
}

export default new WishlistService();
