import { describe, expect, test } from "@jest/globals";
import { detectPrimaryLocale } from "../src/utils/replyLocale.js";

describe("detectPrimaryLocale", () => {
  test("có dấu tiếng Việt → vi", () => {
    expect(detectPrimaryLocale("gợi ý set đồ nam")).toBe("vi");
  });

  test("tiếng Anh dài → en", () => {
    expect(
      detectPrimaryLocale(
        "Suggest a men's casual outfit set for going out this weekend",
      ),
    ).toBe("en");
  });

  test("chuỗi rỗng → vi", () => {
    expect(detectPrimaryLocale("")).toBe("vi");
  });
});
