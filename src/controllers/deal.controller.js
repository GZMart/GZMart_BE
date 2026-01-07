import dealService from "../services/deal.service.js";

export const getFlashSales = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await dealService.getFlashSales({
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      message: "Flash sales retrieved successfully",
      data: result.deals,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getDailyDeals = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await dealService.getDailyDeals({
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      message: "Daily deals retrieved successfully",
      data: result.deals,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getWeekendDeals = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await dealService.getWeekendDeals({
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      message: "Weekend deals retrieved successfully",
      data: result.deals,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllActiveDeals = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await dealService.getAllActiveDeals({
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      message: "Active deals retrieved successfully",
      data: result.deals,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getActiveDealByProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const deal = await dealService.getActiveDealByProduct(productId);

    res.status(200).json({
      success: true,
      message: deal
        ? "Active deal retrieved successfully"
        : "No active deal found",
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};
