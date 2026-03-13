import sellerApplicationService from "../services/sellerApplication.service.js";

// ── Buyer endpoints ──

export const createSellerApplication = async (req, res, next) => {
  try {
    const application = await sellerApplicationService.createApplicationForUser(
      req.user._id,
      req.body,
    );

    res.status(201).json({
      success: true,
      message: "Seller application submitted successfully",
      data: application,
    });
  } catch (error) {
    next(error);
  }
};

export const getMySellerApplications = async (req, res, next) => {
  try {
    const applications = await sellerApplicationService.getApplicationsByUser(
      req.user._id,
    );

    res.status(200).json({
      success: true,
      data: applications,
    });
  } catch (error) {
    next(error);
  }
};

// ── Admin endpoints ──

export const listSellerApplications = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const result = await sellerApplicationService.listApplications({
      status,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getSellerApplicationDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const application =
      await sellerApplicationService.getApplicationById(id);

    res.status(200).json({
      success: true,
      data: application,
    });
  } catch (error) {
    next(error);
  }
};

export const approveSellerApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;

    const application = await sellerApplicationService.approveApplication(
      id,
      req.user._id,
      reviewNote,
    );

    res.status(200).json({
      success: true,
      message: "Seller application approved successfully",
      data: application,
    });
  } catch (error) {
    next(error);
  }
};

export const rejectSellerApplication = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reviewNote } = req.body;

    const application = await sellerApplicationService.rejectApplication(
      id,
      req.user._id,
      reviewNote,
    );

    res.status(200).json({
      success: true,
      message: "Seller application rejected",
      data: application,
    });
  } catch (error) {
    next(error);
  }
};
