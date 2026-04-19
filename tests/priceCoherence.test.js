import { describe, expect, test } from "@jest/globals";
import { coherencePriceFilter } from "../src/utils/priceCoherence.js";

describe("coherencePriceFilter", () => {
  test("lọc sản phẩm lệch giá quá xa median", () => {
    const products = [
      { _id: "1", models: [{ price: 100000 }], originalPrice: 0 },
      { _id: "2", models: [{ price: 110000 }], originalPrice: 0 },
      { _id: "3", models: [{ price: 5000000 }], originalPrice: 0 },
    ];
    const out = coherencePriceFilter(products, 0.45);
    expect(out.some((p) => p._id === "3")).toBe(false);
  });
});
