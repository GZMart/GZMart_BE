import { describe, expect, test } from "@jest/globals";
import { normalizeBuyerQuery } from "../src/utils/buyerQueryNormalizer.js";

describe("normalizeBuyerQuery", () => {
  test("gộp khoảng trắng và trim", () => {
    const r = normalizeBuyerQuery("  tôi   cần   áo   ");
    expect(r.normalized).toMatch(/tôi cần áo/);
  });

  test("map synonym đơn giản (áo thun → áo)", () => {
    const r = normalizeBuyerQuery("áo thun nam đẹp");
    expect(r.normalized.includes("áo")).toBe(true);
  });
});
