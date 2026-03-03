import Favourite from "../models/Favourite.js";
import Product from "../models/Product.js";
import { ErrorResponse } from "../utils/errorResponse.js";

class FavouriteService {
  /**
   * Get user's favourites
   */
  async getUserFavourites(userId) {
    console.log("getUserFavourites called for userId:", userId);

    let favourite = await Favourite.findOne({ userId })
      .populate({
        path: "products",
        match: { status: "active" },
        select: "name slug images models brand rating reviewCount sold",
      })
      .lean();

    console.log("Favourite found:", favourite);

    if (!favourite) {
      favourite = await Favourite.create({ userId, products: [] });
      console.log("Created empty favourite");
    }

    // Filter out null products (deleted/inactive)
    const validProducts = (favourite.products || []).filter((p) => p !== null);
    console.log("Valid products count:", validProducts.length);

    // Add price info from models
    const productsWithPrice = validProducts.map((product) => {
      const models = product.models || [];
      const activeModel = models.find((m) => m.isActive) || models[0] || {};

      return {
        ...product,
        price: activeModel.price || 0,
        originalPrice: activeModel.originalPrice || activeModel.price || 0,
        stock: models.reduce((sum, m) => sum + (m.stock || 0), 0),
      };
    });

    console.log("Returning products:", productsWithPrice.length);

    return {
      _id: favourite._id,
      userId: favourite.userId,
      products: productsWithPrice,
      count: productsWithPrice.length,
    };
  }

  /**
   * Add product to favourites
   */
  async addToFavourites(userId, productId) {
    console.log("addToFavourites called:", { userId, productId });

    // Check if product exists and is active
    const product = await Product.findOne({
      _id: productId,
      status: "active",
    });

    console.log("Product found:", product ? "Yes" : "No");

    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }

    let favourite = await Favourite.findOne({ userId });
    console.log("Existing favourite:", favourite ? "Yes" : "No");

    if (!favourite) {
      favourite = await Favourite.create({
        userId,
        products: [productId],
      });
      // Increment product's wishlistCount
      await Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: 1 } });

      console.log("Created new favourite:", favourite);
      return {
        message: "Product added to favourites successfully",
        alreadyExists: false,
      };
    } else {
      // Check if already in favourites
      const alreadyExists = favourite.products.some(
        (id) => id.toString() === productId.toString(),
      );
      console.log("Already exists:", alreadyExists);

      if (alreadyExists) {
        return {
          message: "Product is already in favourites",
          alreadyExists: true,
        };
      }

      favourite.products.push(productId);
      await favourite.save();
      
      // Increment product's wishlistCount
      await Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: 1 } });
      
      console.log("Updated favourite:", favourite);
      return {
        message: "Product added to favourites successfully",
        alreadyExists: false,
      };
    }
  }

  /**
   * Remove product from favourites
   */
  async removeFromFavourites(userId, productId) {
    const favourite = await Favourite.findOne({ userId });

    if (!favourite) {
      throw new ErrorResponse("Favourites not found", 404);
    }

    const productIndex = favourite.products.findIndex(
      (id) => id.toString() === productId,
    );

    if (productIndex === -1) {
      throw new ErrorResponse("Product not in favourites", 404);
    }

    favourite.products.splice(productIndex, 1);
    await favourite.save();

    // Decrement product's wishlistCount
    await Product.findByIdAndUpdate(productId, { $inc: { wishlistCount: -1 } });

    return { message: "Product removed from favourites successfully" };
  }

  /**
   * Clear all favourites
   */
  async clearFavourites(userId) {
    const favourite = await Favourite.findOne({ userId });

    if (!favourite) {
      throw new ErrorResponse("Favourites not found", 404);
    }

    favourite.products = [];
    await favourite.save();

    return { message: "Favourites cleared successfully" };
  }

  /**
   * Check if product is in favourites
   */
  async isInFavourites(userId, productId) {
    console.log("isInFavourites called:", { userId, productId });

    const favourite = await Favourite.findOne({ userId });
    console.log("Favourite document:", favourite);

    if (!favourite) {
      console.log("No favourite document found");
      return false;
    }

    const exists = favourite.products.some(
      (id) => id.toString() === productId.toString(),
    );
    console.log("Product exists in favourites:", exists);

    return exists;
  }
}

export default new FavouriteService();
