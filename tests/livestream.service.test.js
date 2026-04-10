import { jest } from "@jest/globals";

const mockLiveSessionFindById = jest.fn();
const mockGetCachedViewerCount = jest.fn();
const mockGetViewerTokenService = jest.fn();
const mockGetActiveSessionByShopService = jest.fn();

jest.unstable_mockModule("../src/models/LiveSession.js", () => ({
  default: {
    findById: mockLiveSessionFindById,
    countDocuments: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/services/livestreamRedis.service.js", () => ({
  getCachedViewerCount: mockGetCachedViewerCount,
  getLikeCount: jest.fn(),
  getRecentChat: jest.fn(),
  incrementLikeCount: jest.fn(),
}));

jest.unstable_mockModule("../src/services/livestream.service.js", () => ({
  getViewerToken: mockGetViewerTokenService,
  getActiveSessionByShop: mockGetActiveSessionByShopService,
  createSession: jest.fn(),
  startSession: jest.fn(),
  endSession: jest.fn(),
  addSessionProducts: jest.fn(),
  removeSessionProduct: jest.fn(),
  addSessionVouchers: jest.fn(),
  removeSessionVoucher: jest.fn(),
  pinProduct: jest.fn(),
  unpinProduct: jest.fn(),
}));

const { getSession, getViewerToken, getActiveByShop } =
  await import("../src/controllers/livestream.controller.js");

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  return res;
};

describe("View Livestream - livestream controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockLiveSessionFindById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: "session-1",
          status: "live",
          shopId: { _id: "shop-1", fullName: "Shop A", avatar: "a.jpg" },
        }),
      }),
    });

    mockGetCachedViewerCount.mockResolvedValue(15);
    mockGetViewerTokenService.mockResolvedValue("jwt-token-abc");
    mockGetActiveSessionByShopService.mockResolvedValue({
      _id: "session-active",
      shopId: "shop-1",
      status: "live",
    });
  });

  it("UTCID01 - Happy path: xem session đang live và lấy viewerCount", async () => {
    // Arrange
    const req = { params: { sessionId: "session-1" } };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getSession(req, res, next);

    // Assert
    expect(mockLiveSessionFindById).toHaveBeenCalledWith("session-1");
    expect(mockGetCachedViewerCount).toHaveBeenCalledWith("session-1");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          _id: "session-1",
          viewerCount: 15,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID02 - Abnormal: thiếu sessionId (route-level not found)", async () => {
    // Arrange
    const routeErr = new Error("Route not found / Cannot GET");
    routeErr.statusCode = 404;
    mockLiveSessionFindById.mockImplementationOnce(() => {
      throw routeErr;
    });

    const req = { params: {} };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getSession(req, res, next);

    // Assert
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Route not found / Cannot GET",
        statusCode: 404,
      }),
    );
  });

  it("UTCID03 - Abnormal: sessionId không tồn tại", async () => {
    // Arrange
    mockLiveSessionFindById.mockReturnValueOnce({
      populate: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });

    const req = { params: { sessionId: "session-not-found" } };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getSession(req, res, next);

    // Assert
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Session not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID04 - Happy path: lấy viewer token thành công", async () => {
    // Arrange
    const req = {
      params: { sessionId: "session-1" },
      user: { _id: "user-1", fullName: "Buyer A" },
    };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getViewerToken(req, res, next);

    // Assert
    expect(mockGetViewerTokenService).toHaveBeenCalledWith(
      "session-1",
      "user-1",
      "Buyer A",
    );
    expect(res.json).toHaveBeenCalledWith({ token: "jwt-token-abc" });
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID05 - Boundary: lấy token khi session không live", async () => {
    // Arrange
    const err = new Error("Live session not available");
    err.statusCode = 500;
    mockGetViewerTokenService.mockRejectedValueOnce(err);

    const req = {
      params: { sessionId: "session-ended" },
      user: { _id: "user-1", fullName: "Buyer A" },
    };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getViewerToken(req, res, next);

    // Assert
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Live session not available",
        statusCode: 500,
      }),
    );
  });

  it("UTCID06 - Invalid: getActiveByShop thiếu shopId", async () => {
    // Arrange
    const req = { query: {} };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getActiveByShop(req, res, next);

    // Assert
    expect(mockGetActiveSessionByShopService).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "shopId required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID07 - Edge: shop hợp lệ nhưng không có phiên live", async () => {
    // Arrange
    mockGetActiveSessionByShopService.mockResolvedValueOnce(null);
    const req = { query: { shopId: "shop-empty" } };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getActiveByShop(req, res, next);

    // Assert
    expect(mockGetActiveSessionByShopService).toHaveBeenCalledWith(
      "shop-empty",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, max-age=30",
    );
    expect(res.json).toHaveBeenCalledWith(null);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID08 - Logic đặc biệt: shop có phiên live đang hoạt động", async () => {
    // Arrange
    const activeSession = {
      _id: "session-live-2",
      shopId: "shop-2",
      status: "live",
      startedAt: "2026-04-08T08:00:00.000Z",
    };
    mockGetActiveSessionByShopService.mockResolvedValueOnce(activeSession);

    const req = { query: { shopId: "shop-2" } };
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getActiveByShop(req, res, next);

    // Assert
    expect(mockGetActiveSessionByShopService).toHaveBeenCalledWith("shop-2");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, max-age=30",
    );
    expect(res.json).toHaveBeenCalledWith(activeSession);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
