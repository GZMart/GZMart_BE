import mongoose from "mongoose";

const disputeReportSchema = new mongoose.Schema(
  {
    reportNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["order", "product"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "waiting_for_seller",
        "investigating",
        "resolved_refunded",
        "resolved_rejected",
        "appealed",
      ],
      default: "pending",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    title: {
      type: String,
      required: [true, "Report title is required"],
      trim: true,
      maxlength: [200, "Report title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      required: [true, "Report description is required"],
      trim: true,
      maxlength: [5000, "Report description cannot exceed 5000 characters"],
    },
    category: {
      type: String,
      trim: true,
      default: "general",
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sellerIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",
      default: [],
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      default: null,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
      index: true,
    },
    orderItemIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "OrderItem",
      default: [],
    },
    createdByRole: {
      type: String,
      enum: ["buyer", "seller", "admin"],
      default: "buyer",
    },
    assignedAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedSellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    investigationSummary: {
      type: String,
      trim: true,
      maxlength: [5000, "Investigation summary cannot exceed 5000 characters"],
    },
    resolutionNote: {
      type: String,
      trim: true,
      maxlength: [5000, "Resolution note cannot exceed 5000 characters"],
    },
    appealNote: {
      type: String,
      trim: true,
      maxlength: [5000, "Appeal note cannot exceed 5000 characters"],
    },
    sellerResponseNote: {
      type: String,
      trim: true,
      maxlength: [5000, "Seller response note cannot exceed 5000 characters"],
    },
    sellerResponseAt: {
      type: Date,
      default: null,
    },
    investigatedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    appealedAt: {
      type: Date,
      default: null,
    },
    hiddenProductTriggeredAt: {
      type: Date,
      default: null,
    },
    refundReference: {
      type: String,
      default: null,
    },
    refundPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    adminMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

disputeReportSchema.index({ buyerId: 1, createdAt: -1 });
disputeReportSchema.index({ sellerIds: 1, createdAt: -1 });
disputeReportSchema.index({ status: 1, type: 1, createdAt: -1 });
disputeReportSchema.index({ orderId: 1 });
disputeReportSchema.index({ productId: 1 });

export default mongoose.model("DisputeReport", disputeReportSchema);
