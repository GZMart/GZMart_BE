/**
 * Feature Test: Campaign Setup
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers all 23 test-cases defined in the Feature Test document
 * (feature-test-campaign-setup.html).
 *
 * Function A – POST /api/campaigns          (createCampaign)
 * Function B – POST /api/campaigns/batch    (createBatchCampaign)
 * Function C – GET  /api/campaigns[/:id]    (getCampaigns, getCampaignDetail, getActiveCampaigns)
 * Function D – PUT  /api/campaigns/:id      (updateCampaign)
 * Function E – DELETE /api/campaigns/:id     (deleteCampaign)
 */

import { jest } from "@jest/globals";

// ─── Mock stubs ───────────────────────────────────────────────────────────────
const mockDealCreate = jest.fn();
const mockDealFind = jest.fn();
const mockDealFindOne = jest.fn();
const mockDealFindOneAndDelete = jest.fn();
const mockDealCountDocuments = jest.fn();
const mockProductFindById = jest.fn();

jest.unstable_mockModule("../src/models/Deal.js", () => ({
  default: {
    create: mockDealCreate,
    find: mockDealFind,
    findOne: mockDealFindOne,
    findOneAndDelete: mockDealFindOneAndDelete,
    countDocuments: mockDealCountDocuments,
    aggregate: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: { findById: mockProductFindById },
}));

// ─── Dynamic imports (must come after mock registration) ─────────────────────
const {
  createCampaign,
  createBatchCampaign,
  getCampaigns,
  getCampaignDetail,
  getActiveCampaigns,
  updateCampaign,
  deleteCampaign,
} = await import("../src/services/campaign.service.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PRODUCT_ID = "64f1a2b3c4d5e6f7a8b9c001";
const FLASH_SALE_ID = "64f1a2b3c4d5e6f7a8b9c099";
const SELLER_ID = "64f1a2b3c4d5e6f7a8b9c002";

const future = (ms) => new Date(Date.now() + ms);
const past = (ms) => new Date(Date.now() - ms);

const mockProduct = {
  _id: PRODUCT_ID,
  name: "Test Product",
  sku: "SKU-001",
  originalPrice: 200_000,
  sellerId: SELLER_ID,
};

/**
 * Build a mock Deal document (pending by default).
 * Includes a `.save()` stub so updateCampaign tests work.
 */
const buildMockDeal = (overrides = {}) => {
  const deal = {
    _id: FLASH_SALE_ID,
    productId: {
      _id: PRODUCT_ID,
      originalPrice: 200_000,
      toJSON() {
        return { _id: this._id, originalPrice: this.originalPrice };
      },
    },
    title: null,
    variantSku: null,
    type: "flash_sale",
    dealPrice: 100_000,
    quantityLimit: 50,
    soldCount: 0,
    status: "pending",
    startDate: future(3_600_000), // 1 h
    endDate: future(86_400_000), // 24 h
    createdAt: new Date(),
    save: jest.fn().mockResolvedValue(true),
    deleteOne: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  return deal;
};

/** Helper to make Deal.find() support fluent chaining (.populate().sort().skip().limit().lean()) */
const makeChainableFindMock = (docs) => {
  const chain = {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(docs),
    lean: jest.fn().mockResolvedValue(docs),
  };
  return chain;
};

/** Valid payload for createCampaign */
const validPayload = () => ({
  productId: PRODUCT_ID,
  salePrice: 100_000,
  totalQuantity: 50,
  startAt: future(3_600_000).toISOString(),
  endAt: future(86_400_000).toISOString(),
});

// ─── Global beforeEach ────────────────────────────────────────────────────────
beforeEach(() => {
  mockProductFindById.mockResolvedValue(mockProduct);
  mockDealFindOne.mockResolvedValue(null); // no duplicate flash sale
  mockDealCreate.mockResolvedValue(buildMockDeal());
  mockDealCountDocuments.mockResolvedValue(1);
});

// =============================================================================
// FUNCTION A – Tạo Flash Sale đơn lẻ
// =============================================================================
describe("Function A – createCampaign", () => {
  // FS-TC-01
  test("FS-TC-01 – Tạo flash sale thành công với đầy đủ dữ liệu hợp lệ", async () => {
    const result = await createCampaign(validPayload());

    expect(result).toBeDefined();
    expect(result._id).toBeTruthy();
    expect(result.salePrice).toBe(100_000);
    expect(result.totalQuantity).toBe(50);
    expect(result.status).toBe("pending");
    expect(result.startAt).toBeDefined();
    expect(result.endAt).toBeDefined();
    expect(result.discountPercent).toBeGreaterThanOrEqual(0);
  });

  // FS-TC-02
  test("FS-TC-02 – Thiếu các trường bắt buộc → Error 400", async () => {
    const requiredFields = [
      "productId",
      "salePrice",
      "totalQuantity",
      "startAt",
      "endAt",
    ];

    for (const field of requiredFields) {
      const payload = { ...validPayload(), [field]: undefined };
      await expect(createCampaign(payload)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("Please provide productId"),
      });
    }
  });

  // FS-TC-03
  test("FS-TC-03 – salePrice <= 0 → Error 400", async () => {
    for (const price of [0, -1, -999]) {
      await expect(
        createCampaign({ ...validPayload(), salePrice: price }),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: "salePrice must be greater than 0",
      });
    }
  });

  // FS-TC-04
  test("FS-TC-04 – totalQuantity < 1 → Error 400", async () => {
    // 0 is falsy → triggers the missing-fields guard first.
    // Use -1 (truthy but < 1) to reach the specific totalQuantity check.
    await expect(
      createCampaign({ ...validPayload(), totalQuantity: -1 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "totalQuantity must be at least 1",
    });
  });

  // FS-TC-05
  test("FS-TC-05 – startAt >= endAt → Error 400", async () => {
    const now = future(3_600_000).toISOString();
    await expect(
      createCampaign({ ...validPayload(), startAt: now, endAt: now }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "startAt must be before endAt",
    });

    await expect(
      createCampaign({
        ...validPayload(),
        startAt: future(10_000_000).toISOString(),
        endAt: future(3_600_000).toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  // FS-TC-06
  test("FS-TC-06 – startAt trong quá khứ → Error 400", async () => {
    await expect(
      createCampaign({
        ...validPayload(),
        startAt: past(3_600_000).toISOString(),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "startAt must be in the future",
    });
  });

  // FS-TC-07
  test("FS-TC-07 – Sản phẩm không tồn tại → Error 404", async () => {
    mockProductFindById.mockResolvedValue(null);
    await expect(createCampaign(validPayload())).rejects.toMatchObject({
      statusCode: 404,
      message: "Product not found",
    });
  });

  // FS-TC-08
  test("FS-TC-08 – Sản phẩm đã có flash sale pending/active → Error 400", async () => {
    // Simulate an existing active/pending flash sale
    mockDealFindOne.mockResolvedValue(buildMockDeal({ status: "pending" }));

    await expect(createCampaign(validPayload())).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(
        "An active or upcoming flash sale already exists for this product",
      ),
    });
  });
});

// =============================================================================
// FUNCTION B – Tạo Flash Sale hàng loạt (Batch)
// =============================================================================
describe("Function B – createBatchCampaign", () => {
  const batchPayload = () => ({
    productId: PRODUCT_ID,
    campaignTitle: "Summer Campaign",
    startAt: future(3_600_000).toISOString(),
    endAt: future(86_400_000).toISOString(),
    variants: [
      { variantSku: "SKU-A", salePrice: 100_000, totalQuantity: 10 },
      { variantSku: "SKU-B", salePrice: 120_000, totalQuantity: 20 },
    ],
  });

  // FS-TC-09
  test("FS-TC-09 – Tạo batch flash sale thành công với nhiều variant", async () => {
    mockDealCreate
      .mockResolvedValueOnce(
        buildMockDeal({ variantSku: "SKU-A", dealPrice: 100_000 }),
      )
      .mockResolvedValueOnce(
        buildMockDeal({ variantSku: "SKU-B", dealPrice: 120_000 }),
      );

    const result = await createBatchCampaign(batchPayload());

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(mockDealCreate).toHaveBeenCalledTimes(2);
  });

  // FS-TC-10
  test("FS-TC-10 – variants rỗng → Error 400", async () => {
    await expect(
      createBatchCampaign({ ...batchPayload(), variants: [] }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("at least one variant"),
    });
  });

  // FS-TC-11
  test("FS-TC-11 – Một variant có salePrice <= 0 → Error 400", async () => {
    const payload = {
      ...batchPayload(),
      variants: [{ variantSku: "SKU-A", salePrice: 0, totalQuantity: 10 }],
    };
    await expect(createBatchCampaign(payload)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("salePrice must be > 0"),
    });
  });

  // FS-TC-12
  test("FS-TC-12 – Variant đã có flash sale đang chạy → Error 400", async () => {
    // First call in the loop (duplicate check) resolves with an existing deal
    mockDealFindOne.mockResolvedValue(buildMockDeal({ variantSku: "SKU-A" }));

    const payload = {
      ...batchPayload(),
      variants: [
        { variantSku: "SKU-A", salePrice: 100_000, totalQuantity: 10 },
      ],
    };
    await expect(createBatchCampaign(payload)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("already exists for variant SKU-A"),
    });
  });
});

// =============================================================================
// FUNCTION C – Xem danh sách / chi tiết Flash Sale
// =============================================================================
describe("Function C – getCampaigns / getCampaignDetail / getActiveCampaigns", () => {
  // FS-TC-13
  test("FS-TC-13 – Danh sách flash sale với phân trang mặc định", async () => {
    const docs = [buildMockDeal()];
    mockDealFind.mockReturnValue(makeChainableFindMock(docs));
    mockDealCountDocuments.mockResolvedValue(1);

    const result = await getCampaigns({});

    expect(result.data).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(1);
  });

  // FS-TC-14
  test("FS-TC-14 – Lọc theo status=active", async () => {
    const activeDeal = buildMockDeal({ status: "active" });
    mockDealFind.mockReturnValue(makeChainableFindMock([activeDeal]));
    mockDealCountDocuments.mockResolvedValue(1);

    const result = await getCampaigns({ status: "active" });

    expect(result.data[0].status).toBe("active");
    // Deal.find should have been called with { type: "flash_sale", status: "active" }
    expect(mockDealFind).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  // FS-TC-14b – upcoming maps to pending
  test("FS-TC-14b – status=upcoming maps to pending trong query", async () => {
    mockDealFind.mockReturnValue(makeChainableFindMock([]));
    mockDealCountDocuments.mockResolvedValue(0);

    await getCampaigns({ status: "upcoming" });

    expect(mockDealFind).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });

  // FS-TC-15
  test("FS-TC-15 – Phân trang page=2, limit=5", async () => {
    // Create 12 mock deals (simulating 3 campaigns with 4 SKUs each)
    const mockDeals = Array.from({ length: 12 }, () => buildMockDeal());
    mockDealFind.mockReturnValue(makeChainableFindMock(mockDeals));

    const result = await getCampaigns({ page: 2, limit: 5 });

    expect(result.page).toBe(2);
    expect(result.limit).toBe(5);
    // 12 deals with same product+title+dates = 1 campaign
    expect(result.total).toBe(1);
    expect(result.data.length).toBeLessThanOrEqual(5);
  });

  // FS-TC-16
  test("FS-TC-16 – Lấy chi tiết flash sale theo ID hợp lệ", async () => {
    const deal = buildMockDeal();
    // getCampaignDetail uses findOne().populate()
    mockDealFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(deal),
    });

    const result = await getCampaignDetail(FLASH_SALE_ID);

    expect(result).toBeDefined();
    expect(result._id).toBe(FLASH_SALE_ID);
    expect(result.salePrice).toBe(100_000);
    expect(result.totalQuantity).toBe(50);
    expect(result.status).toBe("pending");
  });

  // FS-TC-17
  test("FS-TC-17 – Lấy chi tiết flash sale với ID không tồn tại → Error 404", async () => {
    mockDealFindOne.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });

    await expect(getCampaignDetail("nonexistent_id")).rejects.toMatchObject({
      statusCode: 404,
      message: "Campaign not found",
    });
  });

  // FS-TC-18
  test("FS-TC-18 – Lấy flash sale active với countdown (timeRemaining > 0)", async () => {
    const activeDeal = buildMockDeal({
      status: "active",
      startDate: past(3_600_000),
      endDate: future(3_600_000),
    });
    mockDealFind.mockReturnValue({
      populate: jest.fn().mockResolvedValue([activeDeal]),
    });

    const result = await getActiveCampaigns();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("active");
    expect(result[0].timeRemaining).toBeGreaterThan(0);
  });
});

// =============================================================================
// FUNCTION D – Cập nhật Flash Sale
// =============================================================================
describe("Function D – updateCampaign", () => {
  // FS-TC-19
  test("FS-TC-19 – Cập nhật flash sale pending với dữ liệu hợp lệ", async () => {
    const pendingDeal = buildMockDeal({ status: "pending" });
    mockDealFindOne.mockResolvedValue(pendingDeal);

    const result = await updateCampaign(FLASH_SALE_ID, {
      salePrice: 130_000,
      totalQuantity: 60,
    });

    expect(pendingDeal.save).toHaveBeenCalled();
    expect(result.salePrice).toBe(130_000);
    expect(result.totalQuantity).toBe(60);
  });

  // FS-TC-20
  test("FS-TC-20 – Đổi startAt của flash sale đang active → Error 400", async () => {
    const now = new Date();
    const activeDeal = buildMockDeal({
      status: "active",
      startDate: new Date(now.getTime() - 1_000), // started 1 s ago
      endDate: future(3_600_000),
    });
    mockDealFindOne.mockResolvedValue(activeDeal);

    await expect(
      updateCampaign(FLASH_SALE_ID, {
        startAt: future(7_200_000).toISOString(), // different future time
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Cannot change start time of an already active flash sale",
    });
  });

  // FS-TC-21
  test("FS-TC-21 – Cập nhật endAt về quá khứ → Error 400", async () => {
    // Use an ACTIVE deal (startDate in past) so the service's
    // "startAt >= newEndAt" guard won't fire first.
    // endAt must be: past(now) but > startDate(2h ago), e.g. 1h ago.
    const activeDeal = buildMockDeal({
      status: "active",
      startDate: past(7_200_000), // 2 h ago
      endDate: future(3_600_000), // ends in 1 h
    });
    mockDealFindOne.mockResolvedValue(activeDeal);

    await expect(
      updateCampaign(FLASH_SALE_ID, {
        endAt: past(3_600_000).toISOString(), // 1 h ago, after startDate of 2 h ago
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "endAt must be in the future",
    });
  });

  // FS-TC-22
  test("FS-TC-22 – Cập nhật startAt về quá khứ khi flash sale pending → Error 400", async () => {
    const pendingDeal = buildMockDeal({ status: "pending" });
    mockDealFindOne.mockResolvedValue(pendingDeal);

    await expect(
      updateCampaign(FLASH_SALE_ID, {
        startAt: past(3_600_000).toISOString(),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "startAt must be in the future",
    });
  });

  // FS-TC-23
  test("FS-TC-23 – Cập nhật flash sale không tồn tại → Error 404", async () => {
    mockDealFindOne.mockResolvedValue(null);

    await expect(
      updateCampaign("nonexistent_id", { salePrice: 50_000 }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "Campaign not found",
    });
  });
});

// =============================================================================
// FUNCTION E – Xóa Flash Sale
// =============================================================================
describe("Function E – deleteCampaign", () => {
  // FS-TC-24
  test("FS-TC-24 – Xóa flash sale hợp lệ → thành công", async () => {
    const deal = buildMockDeal();
    mockDealFindOne.mockResolvedValue(deal);

    const result = await deleteCampaign(FLASH_SALE_ID);

    expect(mockDealFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: FLASH_SALE_ID }),
    );
    expect(result._id).toBe(FLASH_SALE_ID);
  });

  // FS-TC-25
  test("FS-TC-25 – Xóa flash sale không tồn tại → Error 404", async () => {
    mockDealFindOne.mockResolvedValue(null);

    await expect(deleteCampaign("nonexistent_id")).rejects.toMatchObject({
      statusCode: 404,
      message: "Campaign not found",
    });
  });
});
