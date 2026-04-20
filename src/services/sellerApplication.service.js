import SellerApplication from "../models/SellerApplication.js";
import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { ROLES } from "../middlewares/role.middleware.js";
import { runAiScreeningForApplication } from "./sellerApplicationAi.service.js";

class SellerApplicationService {
  async createApplicationForUser(userId, profileData = {}) {
    const user = await User.findById(userId);

    if (!user) {
      throw new ErrorResponse("User not found", 404);
    }

    if (user.role === ROLES.SELLER || user.role === ROLES.ADMIN) {
      throw new ErrorResponse("Only buyers can create seller applications", 400);
    }

    const existingPending = await SellerApplication.findOne({
      user: userId,
      status: "pending",
    });

    if (existingPending) {
      throw new ErrorResponse("You already have a pending seller application", 400);
    }

    const allowedFields = [
      "phone", "address", "provinceCode", "provinceName",
      "wardCode", "wardName", "taxId", "citizenId",
    ];

    for (const field of allowedFields) {
      if (profileData[field] !== undefined) {
        user[field] = profileData[field];
      }
    }

    await user.save();

    const application = await SellerApplication.create({
      user: userId,
      status: "pending",
    });

    setImmediate(() => {
      runAiScreeningForApplication(application._id).catch((err) => {
        console.error("[SellerApplication AI]", err);
      });
    });

    return application;
  }

  async getApplicationsByUser(userId) {
    return SellerApplication.find({ user: userId }).sort({ createdAt: -1 });
  }

  async getApplicationById(applicationId) {
    const application = await SellerApplication.findById(applicationId)
      .populate("user", "-password")
      .populate("adminReviewer", "-password");

    if (!application) {
      throw new ErrorResponse("Seller application not found", 404);
    }

    return application;
  }

  async listApplications({ status, page = 1, limit = 10 }) {
    const query = {};

    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [applications, total] = await Promise.all([
      SellerApplication.find(query)
        .populate("user", "-password")
        .populate("adminReviewer", "-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      SellerApplication.countDocuments(query),
    ]);

    return {
      applications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        limit,
      },
    };
  }

  async approveApplication(applicationId, adminId, reviewNote) {
    const application = await SellerApplication.findById(applicationId);

    if (!application) {
      throw new ErrorResponse("Seller application not found", 404);
    }

    if (application.status !== "pending") {
      throw new ErrorResponse("Only pending applications can be approved", 400);
    }

    const user = await User.findById(application.user);

    if (!user) {
      throw new ErrorResponse("User not found for this application", 404);
    }

    if (user.role === ROLES.BUYER) {
      user.role = ROLES.SELLER;
      await user.save();
    }

    application.status = "approved";
    application.adminReviewer = adminId;
    if (reviewNote) {
      application.reviewNote = reviewNote;
    }

    await application.save();

    return application;
  }

  async rejectApplication(applicationId, adminId, reviewNote) {
    const application = await SellerApplication.findById(applicationId);

    if (!application) {
      throw new ErrorResponse("Seller application not found", 404);
    }

    if (application.status !== "pending") {
      throw new ErrorResponse("Only pending applications can be rejected", 400);
    }

    application.status = "rejected";
    application.adminReviewer = adminId;
    if (reviewNote) {
      application.reviewNote = reviewNote;
    }

    await application.save();

    return application;
  }
}

export default new SellerApplicationService();

