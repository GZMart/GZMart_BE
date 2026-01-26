import favouriteService from "../services/favourite.service.js";

export const getUserFavourites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const favourites = await favouriteService.getUserFavourites(userId);

    res.status(200).json({
      success: true,
      message: "Favourites retrieved successfully",
      data: favourites,
    });
  } catch (error) {
    next(error);
  }
};

export const addToFavourites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: "Product ID is required",
      });
    }

    const result = await favouriteService.addToFavourites(userId, productId);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const removeFromFavourites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const result = await favouriteService.removeFromFavourites(
      userId,
      productId,
    );

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const clearFavourites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await favouriteService.clearFavourites(userId);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const checkInFavourites = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { productId } = req.params;

    const isInFavourites = await favouriteService.isInFavourites(
      userId,
      productId,
    );

    res.status(200).json({
      success: true,
      data: { isInFavourites },
    });
  } catch (error) {
    next(error);
  }
};
