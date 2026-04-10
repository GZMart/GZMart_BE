import { asyncHandler } from "../middlewares/async.middleware.js";
import * as disputeService from "../services/disputeResolution.service.js";

const parseArrayQuery = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const createReport = asyncHandler(async (req, res) => {
  const report = await disputeService.createBuyerReport(req.user._id, {
    ...req.body,
    evidenceUrls: parseArrayQuery(req.body.evidenceUrls),
  });

  res.status(201).json({
    success: true,
    message: "Report created successfully",
    data: report,
  });
});

export const getMyReports = asyncHandler(async (req, res) => {
  const result = await disputeService.getBuyerReports(req.user._id, {
    status: req.query.status,
    type: req.query.type,
    page: parseNumber(req.query.page) || 1,
    limit: parseNumber(req.query.limit) || 20,
  });

  res.status(200).json({
    success: true,
    count: result.reports.length,
    pagination: result.pagination,
    data: result.reports,
  });
});

export const getReportDetail = asyncHandler(async (req, res) => {
  const report = await disputeService.getReportForBuyer(
    req.params.id,
    req.user._id,
  );

  res.status(200).json({
    success: true,
    data: report,
  });
});

export const getSellerReports = asyncHandler(async (req, res) => {
  const result = await disputeService.getSellerReports(req.user._id, {
    status: req.query.status,
    type: req.query.type,
    page: parseNumber(req.query.page) || 1,
    limit: parseNumber(req.query.limit) || 20,
  });

  res.status(200).json({
    success: true,
    count: result.reports.length,
    pagination: result.pagination,
    data: result.reports,
  });
});

export const getSellerReportDetail = asyncHandler(async (req, res) => {
  const report = await disputeService.getReportForSeller(
    req.params.id,
    req.user._id,
  );

  res.status(200).json({
    success: true,
    data: report,
  });
});

export const getAdminReportDetail = asyncHandler(async (req, res) => {
  const report = await disputeService.getReportForAdmin(req.params.id);

  res.status(200).json({
    success: true,
    data: report,
  });
});

export const submitCounterReport = asyncHandler(async (req, res) => {
  const report = await disputeService.submitSellerCounterReport(
    req.params.id,
    req.user._id,
    {
      counterNote: req.body.counterNote,
      note: req.body.note,
      evidenceUrls: parseArrayQuery(req.body.evidenceUrls),
    },
  );

  res.status(200).json({
    success: true,
    message: "Counter-report submitted successfully",
    data: report,
  });
});

export const getAdminReports = asyncHandler(async (req, res) => {
  const result = await disputeService.getAdminReports({
    status: req.query.status,
    type: req.query.type,
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
    page: parseNumber(req.query.page) || 1,
    limit: parseNumber(req.query.limit) || 20,
  });

  res.status(200).json({
    success: true,
    count: result.reports.length,
    pagination: result.pagination,
    data: result.reports,
  });
});

export const updateReportStatus = asyncHandler(async (req, res) => {
  const report = await disputeService.updateReportStatus(
    req.params.id,
    req.user._id,
    {
      status: req.body.status,
      newStatus: req.body.newStatus,
      note: req.body.note,
      resolutionNote: req.body.resolutionNote,
      appealNote: req.body.appealNote,
    },
  );

  res.status(200).json({
    success: true,
    message: "Report status updated successfully",
    data: report,
  });
});

export const acceptComplaint = asyncHandler(async (req, res) => {
  const report = await disputeService.acceptComplaint(
    req.params.id,
    req.user._id,
    {
      note: req.body.note,
      resolutionNote: req.body.resolutionNote,
      refundReason: req.body.refundReason,
    },
  );

  res.status(200).json({
    success: true,
    message: "Complaint accepted and refund simulated successfully",
    data: report,
  });
});

export const appealReport = asyncHandler(async (req, res) => {
  const report = await disputeService.appealReport(
    req.params.id,
    req.user._id,
    {
      appealNote: req.body.appealNote,
      note: req.body.note,
    },
  );

  res.status(200).json({
    success: true,
    message: "Report appealed successfully",
    data: report,
  });
});
