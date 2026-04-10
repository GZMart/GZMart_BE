import { jest } from "@jest/globals";

// Mock service layer so controller tests stay isolated from DB/service internals.
const mockGetProductById = jest.fn();

jest.unstable_mockModule("../src/services/product.service.js", () => ({
  getProductById: mockGetProductById,
}));

const { getProduct } = await import("../src/controllers/product.controller.js");

const createMockReq = (id) => ({ params: { id } });

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const createHttpError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

describe("View Product Detail - getProduct controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetProductById.mockResolvedValue({
      _id: "64f1a2b3c4d5e6f7a8b9c011",
      name: "IPhone 15",
      status: "active",
      isHidden: false,
      sellerId: {
        _id: "64f1a2b3c4d5e6f7a8b9c001",
        fullName: "Seller A",
        rating: 4.9,
        chatResponseRate: 98,
      },
    });
  });

  it("UTCID01 - Happy path: product ID hợp lệ, status active, có shopStats", async () => {
    // Arrange
    const req = createMockReq("64f1a2b3c4d5e6f7a8b9c011");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledTimes(1);
    expect(mockGetProductById).toHaveBeenCalledWith("64f1a2b3c4d5e6f7a8b9c011");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.any(Object),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID02 - Abnormal: thiếu param id (route-level not found)", async () => {
    // Arrange
    const routeError = createHttpError("Route not found / Cannot GET", 404);
    mockGetProductById.mockRejectedValueOnce(routeError);
    const req = createMockReq(undefined);
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith(undefined);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Route not found / Cannot GET",
        statusCode: 404,
      }),
    );
  });

  it("UTCID03 - Abnormal: id sai format ObjectId", async () => {
    // Arrange
    const castError = createHttpError("Cast to ObjectId failed", 400);
    mockGetProductById.mockRejectedValueOnce(castError);
    const req = createMockReq("abc123");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith("abc123");
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Cast to ObjectId failed",
        statusCode: 400,
      }),
    );
  });

  it("UTCID04 - Abnormal: id đúng format nhưng không tồn tại", async () => {
    // Arrange
    const notFoundError = createHttpError("Product not found", 404);
    mockGetProductById.mockRejectedValueOnce(notFoundError);
    const req = createMockReq("64f1a2b3c4d5e6f7a8b9c099");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith("64f1a2b3c4d5e6f7a8b9c099");
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Product not found",
        statusCode: 404,
      }),
    );
  });

  it("UTCID05 - Boundary: product status out_of_stock vẫn visible", async () => {
    // Arrange
    mockGetProductById.mockResolvedValueOnce({
      _id: "64f1a2b3c4d5e6f7a8b9c055",
      name: "Boundary Product",
      status: "out_of_stock",
      isHidden: false,
      sellerId: { _id: "64f1a2b3c4d5e6f7a8b9c001", rating: 4.7 },
    });
    const req = createMockReq("64f1a2b3c4d5e6f7a8b9c055");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith("64f1a2b3c4d5e6f7a8b9c055");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: "out_of_stock" }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID06 - Abnormal: product status draft không visible", async () => {
    // Arrange
    const notFoundError = createHttpError("Product not found", 404);
    mockGetProductById.mockRejectedValueOnce(notFoundError);
    const req = createMockReq("64f1a2b3c4d5e6f7a8b9c066");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith("64f1a2b3c4d5e6f7a8b9c066");
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Product not found",
        statusCode: 404,
      }),
    );
  });

  it("UTCID07 - Abnormal: product isHidden=true", async () => {
    // Arrange
    const notFoundError = createHttpError("Product not found", 404);
    mockGetProductById.mockRejectedValueOnce(notFoundError);
    const req = createMockReq("64f1a2b3c4d5e6f7a8b9c077");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith("64f1a2b3c4d5e6f7a8b9c077");
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Product not found",
        statusCode: 404,
      }),
    );
  });

  it("UTCID08 - Edge: product hợp lệ nhưng seller không có shopStats (fallback)", async () => {
    // Arrange
    mockGetProductById.mockResolvedValueOnce({
      _id: "64f1a2b3c4d5e6f7a8b9c088",
      name: "Fallback Seller Product",
      status: "active",
      isHidden: false,
      sellerId: {
        _id: "64f1a2b3c4d5e6f7a8b9c002",
        fullName: "Seller No Stats",
        rating: 0,
        chatResponseRate: 100,
      },
    });
    const req = createMockReq("64f1a2b3c4d5e6f7a8b9c088");
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProduct(req, res, next);

    // Assert
    expect(mockGetProductById).toHaveBeenCalledWith("64f1a2b3c4d5e6f7a8b9c088");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          sellerId: expect.objectContaining({
            rating: 0,
            chatResponseRate: 100,
          }),
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
