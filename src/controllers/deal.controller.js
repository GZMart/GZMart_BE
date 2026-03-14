import dealService from "../services/deal.service.js";

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

export const getFlashSales = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await dealService.getFlashSales({
      page: parseInt(page),
      limit: parseInt(limit),
    });
    res.status(200).json({
      success: true,
      message: "Flash sale deals retrieved successfully",
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

export const getActiveDealByProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const deal = await dealService.getActiveDealByProduct(productId);
    res.status(200).json({
      success: true,
      message: deal ? "Active deal retrieved successfully" : "No active deal found",
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/deals/:dealId
 * Returns a single deal with full product populate — used by DealDetailsPage.
 */
export const getDealById = async (req, res, next) => {
  try {
    const { dealId } = req.params;
    const deal = await dealService.getDealById(dealId);
    res.status(200).json({
      success: true,
      message: "Deal retrieved successfully",
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/deals/my-deals  (requires auth)
 * Returns buyer's pending and approved deals.
 */
export const getMyDeals = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const result = await dealService.getMyDeals(userId);
    res.status(200).json({
      success: true,
      message: "My deals retrieved successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};
