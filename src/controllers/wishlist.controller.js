import wishlistService from "../services/wishlist.service.js";

export const getUserWishlists = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const wishlists = await wishlistService.getUserWishlists(userId);

    res.status(200).json({
      success: true,
      message: "Wishlists retrieved successfully",
      data: wishlists,
    });
  } catch (error) {
    next(error);
  }
};

export const addToWishlists = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId, modelId, color, size } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    const result = await wishlistService.addToWishlists(userId, productId, {
      modelId,
      color,
      size,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const removeFromWishlists = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    const { modelId, color, size } = req.query;

    const result = await wishlistService.removeFromWishlists(
      userId,
      productId,
      {
        modelId,
        color,
        size,
      },
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const clearWishlists = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await wishlistService.clearWishlists(userId);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const checkInWishlists = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;
    const { modelId, color, size } = req.query;

    const isInWishlists = await wishlistService.isInWishlists(
      userId,
      productId,
      {
        modelId,
        color,
        size,
      },
    );

    res.status(200).json({
      success: true,
      data: { isInWishlists },
    });
  } catch (error) {
    next(error);
  }
};
