import { describe, expect, test } from "@jest/globals";
import { escapeRegex, extractSearchTerms } from "../src/utils/productSearchQuery.js";

describe("extractSearchTerms", () => {
  test("câu 'tôi cần tìm quần áo' → quần, áo (không còn filler)", () => {
    expect(extractSearchTerms("tôi cần tìm quần áo").sort()).toEqual(["quần", "áo"].sort());
  });

  test("escapeRegex tránh ký tự đặc biệt regex", () => {
    expect(escapeRegex("a+b")).toBe("a\\+b");
  });
});
