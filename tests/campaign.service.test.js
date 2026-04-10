/**
 * Unit Test: createCampaign (Create Campaign)
 * Function Code : Function1
 * Function Name : createCampaign
 * Class         : CampaignService
 * Lines of code : ~100
 *
 * Test Matrix (8 cases)
 * ┌────────┬─────────────────────────────────────────────────────────────┬──────┐
 * │ UTC ID │ Description                                                 │ Type │
 * ├────────┼─────────────────────────────────────────────────────────────┼──────┤
 * │ UTC001 │ All required fields valid                                   │  N   │
 * │ UTC002 │ Optional campaignTitle is propagated                        │  N   │
 * │ UTC003 │ salePrice = 1 (boundary minimum > 0)                        │  B   │
 * │ UTC004 │ totalQuantity = 1 (boundary minimum)                        │  B   │
 * │ UTC005 │ productId missing → Error 400                               │  A   │
 * │ UTC006 │ salePrice = 0 → Error 400                                   │  A   │
 * │ UTC007 │ startAt in the past → Error 400                             │  A   │
 * │ UTC008 │ Product not found in DB → Error 404                         │  A   │
 * └────────┴─────────────────────────────────────────────────────────────┴──────┘
 *
 * Precondition : Can connect to database (mocked via jest.unstable_mockModule)
 * Log message  : "success" (returned in controller response)
 */

import { jest } from "@jest/globals";

// ─── Mock Models (must be declared before dynamic imports) ────────────────────
const mockDealCreate = jest.fn();
const mockDealFindOne = jest.fn();
const mockProductFindById = jest.fn();

jest.unstable_mockModule("../src/models/Deal.js", () => ({
  default: {
    create: mockDealCreate,
    findOne: mockDealFindOne,
  },
}));

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: {
    findById: mockProductFindById,
  },
}));

// ─── Dynamic imports after mocks are registered ───────────────────────────────
const { createCampaign } =
  await import("../src/services/campaign.service.js");

// ─── Test Helpers ─────────────────────────────────────────────────────────────
const PRODUCT_ID = "64f1a2b3c4d5e6f7a8b9c001";
const SELLER_ID = "64f1a2b3c4d5e6f7a8b9c002";

const future = (ms) => new Date(Date.now() + ms);

const mockProduct = {
  _id: PRODUCT_ID,
  originalPrice: 200000,
  sellerId: SELLER_ID,
};

const buildMockDeal = (overrides = {}) => ({
  _id: "64f1a2b3c4d5e6f7a8b9c099",
  productId: {
    _id: PRODUCT_ID,
    originalPrice: 200000,
    toJSON() {
      return { _id: this._id, originalPrice: this.originalPrice };
    },
  },
  title: null,
  variantSku: null,
  dealPrice: 100000,
  quantityLimit: 50,
  soldCount: 0,
  status: "pending",
  startDate: future(3600_000),
  endDate: future(86400_000),
  createdAt: new Date(),
  ...overrides,
});

const validPayload = () => ({
  productId: PRODUCT_ID,
  salePrice: 100000,
  totalQuantity: 50,
  startAt: future(3600_000).toISOString(), // 1 hour from now
  endAt: future(86400_000).toISOString(), // 24 hours from now
});

// ─── Reset mocks before each test ────────────────────────────────────────────
beforeEach(() => {
  mockProductFindById.mockResolvedValue(mockProduct);
  mockDealFindOne.mockResolvedValue(null);
  mockDealCreate.mockResolvedValue(buildMockDeal());
});

// ─────────────────────────────────────────────────────────────────────────────
describe("createCampaign – Unit Tests", () => {
  // ── NORMAL (N) ──────────────────────────────────────────────────────────────

  /**
   * UTC001 – Normal
   * Precondition : Can connect with server (mocked)
   * Input1       : productId (valid ObjectId)
   * Input2       : salePrice=100000, totalQuantity=50, startAt=1h, endAt=24h
   * Return       : Object { _id, salePrice=100000, totalQuantity=50, status="pending" }
   * Log message  : "success"
   */
  test("UTC001 – All required fields valid → returns flash sale object", async () => {
    const result = await createCampaign(validPayload());

    expect(result).toBeDefined();
    expect(result._id).toBeTruthy();
    expect(result.salePrice).toBe(100000);
    expect(result.totalQuantity).toBe(50);
    expect(result.status).toBe("pending");
  });

  /**
   * UTC002 – Normal
   * Precondition : Can connect with server (mocked)
   * Input1       : Required fields + campaignTitle = "Summer Sale"
   * Return       : result.campaignTitle === "Summer Sale"
   *                Deal.create called with { title: "Summer Sale" }
   * Log message  : "success"
   */
  test("UTC002 – campaignTitle provided → propagated to created Deal", async () => {
    mockDealCreate.mockResolvedValue(buildMockDeal({ title: "Summer Sale" }));

    const result = await createCampaign({
      ...validPayload(),
      campaignTitle: "Summer Sale",
    });

    expect(mockDealCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Summer Sale" }),
    );
    expect(result.campaignTitle).toBe("Summer Sale");
  });

  // ── BOUNDARY (B) ────────────────────────────────────────────────────────────

  /**
   * UTC003 – Boundary
   * Precondition : Can connect with server (mocked)
   * Input1       : salePrice = 1  (lower boundary, just above 0)
   * Input2       : remaining fields valid
   * Return       : Flash sale created, result.salePrice = 1
   */
  test("UTC003 – salePrice = 1 (boundary min) → success", async () => {
    mockDealCreate.mockResolvedValue(buildMockDeal({ dealPrice: 1 }));

    const result = await createCampaign({ ...validPayload(), salePrice: 1 });

    expect(result.salePrice).toBe(1);
  });

  /**
   * UTC004 – Boundary
   * Precondition : Can connect with server (mocked)
   * Input1       : totalQuantity = 1  (lower boundary minimum)
   * Input2       : remaining fields valid
   * Return       : Flash sale created, result.totalQuantity = 1
   */
  test("UTC004 – totalQuantity = 1 (boundary min) → success", async () => {
    mockDealCreate.mockResolvedValue(buildMockDeal({ quantityLimit: 1 }));

    const result = await createCampaign({
      ...validPayload(),
      totalQuantity: 1,
    });

    expect(result.totalQuantity).toBe(1);
  });

  // ── ABNORMAL (A) ────────────────────────────────────────────────────────────

  /**
   * UTC005 – Abnormal
   * Precondition : Can connect with server (mocked)
   * Input1       : productId = null  (required field missing)
   * Exception    : Error 400 – "Please provide productId, salePrice, totalQuantity, startAt, and endAt"
   */
  test("UTC005 – productId missing → Error 400", async () => {
    await expect(
      createCampaign({ ...validPayload(), productId: null }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("Please provide productId"),
    });
  });

  /**
   * UTC006 – Abnormal
   * Precondition : Can connect with server (mocked)
   * Input1       : salePrice = 0  (invalid, must be > 0)
   * Exception    : Error 400 – "salePrice must be greater than 0"
   */
  test("UTC006 – salePrice = 0 → Error 400", async () => {
    await expect(
      createCampaign({ ...validPayload(), salePrice: 0 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "salePrice must be greater than 0",
    });
  });

  /**
   * UTC007 – Abnormal
   * Precondition : Can connect with server (mocked)
   * Input1       : startAt = 1 hour ago  (in the past)
   * Exception    : Error 400 – "startAt must be in the future"
   */
  test("UTC007 – startAt in the past → Error 400", async () => {
    await expect(
      createCampaign({
        ...validPayload(),
        startAt: new Date(Date.now() - 3600_000).toISOString(),
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "startAt must be in the future",
    });
  });

  /**
   * UTC008 – Abnormal
   * Precondition : Can connect with server (mocked)
   * Input1       : productId has valid format but does not exist in DB
   *                (Product.findById returns null)
   * Exception    : Error 404 – "Product not found"
   */
  test("UTC008 – Product not found → Error 404", async () => {
    mockProductFindById.mockResolvedValue(null);

    await expect(createCampaign(validPayload())).rejects.toMatchObject({
      statusCode: 404,
      message: "Product not found",
    });
  });
});
