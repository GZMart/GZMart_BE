import { jest } from "@jest/globals";

// Mock service layer to keep controller unit tests isolated from DB/service internals.
const mockGetProductsAdvanced = jest.fn();

jest.unstable_mockModule("../src/services/product.service.js", () => ({
  getProductsAdvanced: mockGetProductsAdvanced,
}));

const { getProductsAdvanced } =
  await import("../src/controllers/product.controller.js");

const createMockReq = (query = {}) => ({ query });

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Filter & Sort Product - getProductsAdvanced controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetProductsAdvanced.mockResolvedValue({
      products: [{ _id: "p1", name: "Sample product" }],
      pagination: { total: 1, page: 1, pages: 1, limit: 20 },
    });
  });

  it("UTCID01 - Happy path: không filter, default params", async () => {
    // Arrange
    const req = createMockReq({});
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledTimes(1);
    expect(mockGetProductsAdvanced).toHaveBeenCalledWith({
      sortBy: "isFeatured",
      sortOrder: "desc",
      page: 1,
      limit: 20,
      categoryId: undefined,
      categorySlug: undefined,
      brands: [],
      colors: [],
      sizes: [],
      minPrice: undefined,
      maxPrice: undefined,
      minRating: undefined,
      inStock: false,
      locations: [],
      minDiscount: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID02 - Abnormal: categoryId không tồn tại -> 0 products", async () => {
    // Arrange
    mockGetProductsAdvanced.mockResolvedValueOnce({
      products: [],
      pagination: { total: 0, page: 1, pages: 0, limit: 20 },
    });
    const req = createMockReq({ categoryId: "67ffffffffffffffffffffff" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryId: "67ffffffffffffffffffffff",
        sortBy: "isFeatured",
        sortOrder: "desc",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
        data: [],
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID03 - Abnormal: categorySlug không tồn tại -> 0 products", async () => {
    // Arrange
    mockGetProductsAdvanced.mockResolvedValueOnce({
      products: [],
      pagination: { total: 0, page: 1, pages: 0, limit: 20 },
    });
    const req = createMockReq({ category: "slug-khong-ton-tai" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        categorySlug: "slug-khong-ton-tai",
        categoryId: undefined,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
        data: [],
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID04 - Abnormal: minPrice > maxPrice -> 0 products", async () => {
    // Arrange
    mockGetProductsAdvanced.mockResolvedValueOnce({
      products: [],
      pagination: { total: 0, page: 1, pages: 0, limit: 20 },
    });
    const req = createMockReq({ minPrice: "5000", maxPrice: "100" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        minPrice: 5000,
        maxPrice: 100,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
        data: [],
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID05 - Boundary: page=1, limit=1, minPrice=0", async () => {
    // Arrange
    const req = createMockReq({ page: "1", limit: "1", minPrice: "0" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledTimes(1);
    const calledOptions = mockGetProductsAdvanced.mock.calls[0][0];
    expect(calledOptions.page).toBe(1);
    expect(calledOptions.limit).toBe(1);
    expect(calledOptions.minPrice).toBe(0);
    expect(calledOptions.sortBy).toBe("isFeatured");
    expect(calledOptions.sortOrder).toBe("desc");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID06 - Abnormal: minRating='abc', inStock='invalid'", async () => {
    // Arrange
    const req = createMockReq({ minRating: "abc", inStock: "invalid" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledTimes(1);
    const calledOptions = mockGetProductsAdvanced.mock.calls[0][0];
    expect(Number.isNaN(calledOptions.minRating)).toBe(true);
    expect(calledOptions.inStock).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID07 - Edge: đầy đủ tất cả filters + sortBy=price, sortOrder=asc", async () => {
    // Arrange
    const req = createMockReq({
      categoryId: "64f1a2b3c4d5e6f7a8b9c001",
      brand: "Apple",
      color: "Black",
      size: "M",
      minPrice: "100",
      maxPrice: "2000",
      minRating: "4.5",
      inStock: "true",
      location: "hanoi",
      sortBy: "price",
      sortOrder: "asc",
      page: "2",
      limit: "10",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledWith({
      sortBy: "price",
      sortOrder: "asc",
      page: 2,
      limit: 10,
      categoryId: "64f1a2b3c4d5e6f7a8b9c001",
      categorySlug: undefined,
      brands: ["Apple"],
      colors: ["Black"],
      sizes: ["M"],
      minPrice: 100,
      maxPrice: 2000,
      minRating: 4.5,
      inStock: true,
      locations: ["hanoi"],
      minDiscount: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID08 - Abnormal: location không khớp seller nào -> empty", async () => {
    // Arrange
    mockGetProductsAdvanced.mockResolvedValueOnce({
      products: [],
      pagination: { total: 0, page: 1, pages: 0, limit: 20 },
    });
    const req = createMockReq({ location: "no-seller-match-location" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getProductsAdvanced(req, res, next);

    // Assert
    expect(mockGetProductsAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        locations: ["no-seller-match-location"],
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Products retrieved successfully",
        data: [],
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
