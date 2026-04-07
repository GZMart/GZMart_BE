import { jest } from "@jest/globals";
import mongoose from "mongoose";

const mockStartSession = jest.fn();

const mockDisputeReportCreate = jest.fn();
const mockDisputeReportFindById = jest.fn();
const mockDisputeReportFind = jest.fn();
const mockDisputeReportCountDocuments = jest.fn();
const mockDisputeReportFindByIdAndUpdate = jest.fn();

const mockDisputeEvidenceInsertMany = jest.fn();
const mockDisputeEvidenceFind = jest.fn();
const mockReportHistoryCreate = jest.fn();
const mockReportHistoryFind = jest.fn();

const mockOrderFindById = jest.fn();
const mockOrderItemFind = jest.fn();
const mockProductFindById = jest.fn();
const mockProductFindByIdAndUpdate = jest.fn();
const mockUserFind = jest.fn();

jest.unstable_mockModule("../src/models/DisputeReport.js", () => ({
  default: {
    create: mockDisputeReportCreate,
    findById: mockDisputeReportFindById,
    find: mockDisputeReportFind,
    countDocuments: mockDisputeReportCountDocuments,
    findByIdAndUpdate: mockDisputeReportFindByIdAndUpdate,
  },
}));

jest.unstable_mockModule("../src/models/DisputeEvidence.js", () => ({
  default: {
    insertMany: mockDisputeEvidenceInsertMany,
    find: mockDisputeEvidenceFind,
  },
}));

jest.unstable_mockModule("../src/models/ReportHistory.js", () => ({
  default: {
    create: mockReportHistoryCreate,
    find: mockReportHistoryFind,
  },
}));

jest.unstable_mockModule("../src/models/Order.js", () => ({
  default: {
    findById: mockOrderFindById,
  },
}));

jest.unstable_mockModule("../src/models/OrderItem.js", () => ({
  default: {
    find: mockOrderItemFind,
  },
}));

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: {
    findById: mockProductFindById,
    findByIdAndUpdate: mockProductFindByIdAndUpdate,
  },
}));

jest.unstable_mockModule("../src/models/User.js", () => ({
  default: {
    find: mockUserFind,
  },
}));

jest.spyOn(mongoose, "startSession").mockImplementation(mockStartSession);

const { ErrorResponse } = await import("../src/utils/errorResponse.js");
const disputeService =
  await import("../src/services/disputeResolution.service.js");

const BUYER_ID = "64f1a2b3c4d5e6f7a8b9c101";
const SELLER_ID = "64f1a2b3c4d5e6f7a8b9c102";
const ADMIN_ID = "64f1a2b3c4d5e6f7a8b9c103";
const PRODUCT_ID = "64f1a2b3c4d5e6f7a8b9c201";
const ORDER_ID = "64f1a2b3c4d5e6f7a8b9c202";
const REPORT_ID = "64f1a2b3c4d5e6f7a8b9c203";

const createSession = () => ({
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
});

const makeCountChain = (result) => ({
  session: jest.fn(() => Promise.resolve(result)),
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  catch: (reject) => Promise.resolve(result).catch(reject),
});

const makeChain = (result) => {
  const chain = {
    select: jest.fn(() => chain),
    session: jest.fn(() => Promise.resolve(result)),
    populate: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(result)),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    catch: (reject) => Promise.resolve(result).catch(reject),
  };

  return chain;
};

const makeReportDoc = (overrides = {}) => {
  const doc = {
    _id: REPORT_ID,
    reportNumber: "RPT-123456-ABCDEF",
    type: "product",
    status: "pending",
    title: "Product damaged",
    description: "Item arrived with broken screen",
    buyerId: BUYER_ID,
    sellerIds: [SELLER_ID],
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    resolutionNote: null,
    appealNote: null,
    sellerResponseNote: null,
    sellerResponseAt: null,
    investigatedAt: null,
    resolvedAt: null,
    appealedAt: null,
    hiddenProductTriggeredAt: null,
    refundReference: null,
    refundPayload: null,
    save: jest.fn().mockResolvedValue(null),
    toObject: jest.fn(function () {
      return { ...this };
    }),
    ...overrides,
  };

  return doc;
};

const makeUserDoc = (id, rewardPoint) => ({
  _id: id,
  email: `${id}@example.com`,
  fullName: `User ${id.slice(-4)}`,
  reward_point: rewardPoint,
  save: jest.fn().mockResolvedValue(null),
});

beforeEach(() => {
  jest.clearAllMocks();

  mockStartSession.mockResolvedValue(createSession());

  mockDisputeReportCreate.mockImplementation(async ([payload]) => [
    makeReportDoc(payload),
  ]);
  mockDisputeReportFindById.mockImplementation(() =>
    makeChain(makeReportDoc()),
  );
  mockDisputeReportFind.mockImplementation(() => makeChain([]));
  mockDisputeReportCountDocuments.mockImplementation(() => makeCountChain(0));
  mockDisputeReportFindByIdAndUpdate.mockResolvedValue(null);

  mockDisputeEvidenceInsertMany.mockResolvedValue([]);
  mockDisputeEvidenceFind.mockImplementation(() => makeChain([]));
  mockReportHistoryCreate.mockImplementation(async ([payload]) => [payload]);
  mockReportHistoryFind.mockImplementation(() => makeChain([]));

  mockOrderFindById.mockImplementation(() =>
    makeChain({
      _id: ORDER_ID,
      status: "pending",
      paymentStatus: "paid",
      totalPrice: 250000,
      save: jest.fn().mockResolvedValue(null),
    }),
  );
  mockOrderItemFind.mockImplementation(() =>
    makeChain([{ _id: "oi-1", productId: { sellerId: SELLER_ID } }]),
  );
  mockProductFindById.mockImplementation(() =>
    makeChain({ _id: PRODUCT_ID, sellerId: SELLER_ID }),
  );
  mockProductFindByIdAndUpdate.mockResolvedValue({
    _id: PRODUCT_ID,
    isHidden: true,
  });
  mockUserFind.mockImplementation(() =>
    makeChain([makeUserDoc(SELLER_ID, 80)]),
  );
});

describe("Dispute Resolution Flow", () => {
  test("buyer creates report with evidence and product auto-hides after threshold", async () => {
    mockDisputeReportCountDocuments.mockImplementation(() => makeCountChain(6));

    const report = await disputeService.createBuyerReport(BUYER_ID, {
      type: "product",
      title: "Fake item",
      description: "Received counterfeit product",
      category: "fraud",
      productId: PRODUCT_ID,
      evidenceUrls: [
        "https://cdn.example.com/evidence-1.jpg",
        "https://cdn.example.com/evidence-2.jpg",
      ],
    });

    expect(mockDisputeReportCreate).toHaveBeenCalledTimes(1);
    expect(mockDisputeEvidenceInsertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          reportId: REPORT_ID,
          uploadedBy: BUYER_ID,
          uploadedByRole: "buyer",
        }),
      ]),
      expect.objectContaining({}),
    );
    expect(mockProductFindByIdAndUpdate).toHaveBeenCalledWith(
      PRODUCT_ID,
      expect.objectContaining({ $set: { isHidden: true } }),
      expect.objectContaining({ new: true }),
    );
    expect(mockDisputeReportFindByIdAndUpdate).toHaveBeenCalledWith(
      REPORT_ID,
      expect.objectContaining({
        $set: { hiddenProductTriggeredAt: expect.any(Date) },
      }),
      expect.objectContaining({}),
    );
    expect(report).toMatchObject({
      buyerId: BUYER_ID,
      sellerIds: [SELLER_ID],
      productId: PRODUCT_ID,
    });
  });

  test("seller submits counter-report and admin approves complaint with refund simulation", async () => {
    const reportDoc = makeReportDoc();
    mockDisputeReportFindById.mockImplementation(() => makeChain(reportDoc));
    mockDisputeReportCountDocuments.mockResolvedValue(2);

    const counterReport = await disputeService.submitSellerCounterReport(
      REPORT_ID,
      SELLER_ID,
      {
        counterNote: "Buyer used product incorrectly",
        evidenceUrls: ["https://cdn.example.com/seller-proof.pdf"],
      },
    );

    expect(reportDoc.status).toBe("investigating");
    expect(reportDoc.sellerResponseNote).toContain(
      "Buyer used product incorrectly",
    );
    expect(mockDisputeEvidenceInsertMany).toHaveBeenCalled();
    expect(counterReport.status).toBe("investigating");

    mockDisputeReportFindById.mockImplementation(() => makeChain(reportDoc));
    mockUserFind.mockImplementation(() =>
      makeChain([makeUserDoc(SELLER_ID, 80)]),
    );

    const resolved = await disputeService.acceptComplaint(REPORT_ID, ADMIN_ID, {
      refundReason: "Defective product confirmed",
      resolutionNote: "Refund approved after review",
    });

    expect(reportDoc.status).toBe("resolved_refunded");
    expect(reportDoc.refundReference).toMatch(/^RF-/);
    expect(reportDoc.resolutionNote).toContain("Refund approved");
    expect(resolved.status).toBe("resolved_refunded");
    expect(mockProductFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(mockUserFind).toHaveBeenCalled();
  });

  test("buyer can appeal a resolved report and admin can list filtered reports", async () => {
    const reportDoc = makeReportDoc({ status: "resolved_rejected" });
    mockDisputeReportFindById.mockImplementation(() => makeChain(reportDoc));

    const appealed = await disputeService.appealReport(REPORT_ID, BUYER_ID, {
      appealNote: "New evidence available",
    });

    expect(reportDoc.status).toBe("appealed");
    expect(reportDoc.appealNote).toContain("New evidence available");
    expect(appealed.status).toBe("appealed");

    const reportList = [
      { _id: REPORT_ID, status: "appealed", type: "product" },
    ];
    mockDisputeReportFind.mockImplementation(() => makeChain(reportList));
    mockDisputeReportCountDocuments.mockImplementation(() => makeCountChain(1));

    const adminReports = await disputeService.getAdminReports({
      status: "appealed",
      type: "product",
      page: 1,
      limit: 20,
    });

    expect(adminReports.reports).toHaveLength(1);
    expect(adminReports.reports[0].status).toBe("appealed");
    expect(mockDisputeReportFind).toHaveBeenCalled();
  });

  test("invalid admin transition is rejected by the state machine", async () => {
    const reportDoc = makeReportDoc({ status: "resolved_refunded" });
    mockDisputeReportFindById.mockImplementation(() => makeChain(reportDoc));

    await expect(
      disputeService.updateReportStatus(REPORT_ID, ADMIN_ID, {
        status: "pending",
        note: "Invalid rollback",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Invalid report status transition"),
    });
  });

  test("seller cannot access unrelated report", async () => {
    const reportDoc = makeReportDoc({
      sellerIds: [{ _id: "different-seller" }],
    });
    mockDisputeReportFindById.mockImplementation(() => makeChain(reportDoc));

    await expect(
      disputeService.getReportForSeller(REPORT_ID, SELLER_ID),
    ).rejects.toBeInstanceOf(ErrorResponse);
  });
});
