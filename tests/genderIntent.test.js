import { describe, expect, test } from "@jest/globals";
import {
  extractGenderIntent,
  productMatchesGenderIntent,
  filterProductsByGenderIntent,
} from "../src/utils/genderIntent.js";

describe("extractGenderIntent", () => {
  test("nhận đồ nam / set đồ nam", () => {
    expect(extractGenderIntent("gợi ý set đồ đi chơi nam")).toBe("male");
    expect(extractGenderIntent("áo khoác nam")).toBe("male");
  });

  test("nhận đồ nữ", () => {
    expect(extractGenderIntent("váy đầm nữ")).toBe("female");
  });

  test("không chọn khi trái ngược cả hai", () => {
    expect(extractGenderIntent("đồ nam và nữ")).toBe(null);
  });

  test("bắt nam giữa câu (outfit + slot: đi chơi nam quần)", () => {
    expect(extractGenderIntent("đi chơi nam quần")).toBe("male");
  });

  test("Việt Nam không kích hoạt nam", () => {
    expect(extractGenderIntent("ship từ việt nam")).toBe(null);
  });
});

describe("productMatchesGenderIntent", () => {
  test("loại áo có NỮ khi intent male (NỮ không cần \\b)", () => {
    const p = {
      name: "Áo khoác chống nắng NỮ SunStop Master chống tia UV dáng dài",
      tags: "",
    };
    expect(productMatchesGenderIntent(p, "male")).toBe(false);
  });

  test("loại túi xách mini đeo vai khi intent male (không có nam/unisex)", () => {
    const p = {
      name: "Túi Xách Mini Thời Trang Ly Hợp Đeo Vai",
      tags: "",
    };
    expect(productMatchesGenderIntent(p, "male")).toBe(false);
  });

  test("loại quần có chữ nữ trong tên khi intent male", () => {
    const p = {
      name: "Quần jean bò ống suông rộng nữ xuông jeans cạp cao phong cách style Hàn Quốc",
      tags: "",
    };
    expect(productMatchesGenderIntent(p, "male")).toBe(false);
  });

  test("giữ áo nam", () => {
    const p = { name: "Áo thun nam cổ tròn", tags: "" };
    expect(productMatchesGenderIntent(p, "male")).toBe(true);
  });

  test("filterProductsByGenderIntent", () => {
    const list = [
      { name: "Quần jean nam", tags: "" },
      { name: "Váy maxi nữ", tags: "" },
    ];
    const out = filterProductsByGenderIntent(list, "male");
    expect(out).toHaveLength(1);
    expect(out[0].name).toContain("nam");
  });

  test("loại theo tên category (Thời trang nữ) dù tên SP trung tính", () => {
    const p = { name: "Áo sơ mi basic", tags: "", categoryId: "507f1f77bcf86cd799439011" };
    expect(
      productMatchesGenderIntent(p, "male", "Thời trang nữ"),
    ).toBe(false);
  });

  test("filterProductsByGenderIntent dùng map categoryId → name", () => {
    const cid = "507f1f77bcf86cd799439012";
    const list = [
      { name: "SP 1", tags: "", categoryId: cid },
      { name: "SP 2", tags: "", categoryId: "507f1f77bcf86cd799439099" },
    ];
    const map = {
      [cid]: "Quần jean nam",
      "507f1f77bcf86cd799439099": "Váy maxi",
    };
    const out = filterProductsByGenderIntent(list, "female", map);
    expect(out.map((x) => x.name)).toContain("SP 2");
    expect(out.map((x) => x.name)).not.toContain("SP 1");
  });
});
