import homeService from "../services/home.service.js";

export const getBanners = async (req, res, next) => {
  try {
    const banners = await homeService.getBanners();

    res.status(200).json({
      success: true,
      message: "Banners retrieved successfully",
      data: banners,
    });
  } catch (error) {
    next(error);
  }
};

export const getHomeSections = async (req, res, next) => {
  try {
    const sections = await homeService.getHomeSections();

    res.status(200).json({
      success: true,
      message: "Home sections retrieved successfully",
      data: sections,
    });
  } catch (error) {
    next(error);
  }
};

export const getDealsOfTheDay = async (req, res, next) => {
  try {
    const result = await homeService.getDealsOfTheDay();

    res.status(200).json({
      success: true,
      message: "Deals of the day retrieved successfully",
      data: result.deals,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const incrementBannerClick = async (req, res, next) => {
  try {
    const { bannerId } = req.params;

    await homeService.incrementBannerClick(bannerId);

    res.status(200).json({
      success: true,
      message: "Banner click recorded successfully",
    });
  } catch (error) {
    next(error);
  }
};
