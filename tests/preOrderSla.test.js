import { describe, expect, test } from "@jest/globals";
import {
  buildPreOrderFieldsFromProduct,
  orderHasPreOrderSlaBreach,
  isPreOrderProduct,
} from "../src/utils/preOrderSla.js";

describe("isPreOrderProduct", () => {
  test("true khi preOrderDays > 0", () => {
    expect(isPreOrderProduct({ preOrderDays: 3 })).toBe(true);
  });
  test("false khi 0 hoặc thiếu", () => {
    expect(isPreOrderProduct({ preOrderDays: 0 })).toBe(false);
    expect(isPreOrderProduct({})).toBe(false);
  });
});

describe("buildPreOrderFieldsFromProduct", () => {
  test("không pre-order khi 0 hoặc thiếu", () => {
    expect(buildPreOrderFieldsFromProduct(0, new Date("2026-04-19T10:00:00Z"))).toEqual({
      isPreOrder: false,
      preOrderDaysSnapshot: 0,
      estimatedShipBy: null,
    });
    expect(buildPreOrderFieldsFromProduct(undefined, new Date())).toMatchObject({
      isPreOrder: false,
      preOrderDaysSnapshot: 0,
    });
  });

  test("cộng đúng số ngày dương lịch trên mốc anchor", () => {
    const anchor = new Date("2026-04-19T10:00:00Z");
    const { isPreOrder, preOrderDaysSnapshot, estimatedShipBy } =
      buildPreOrderFieldsFromProduct(3, anchor);
    expect(isPreOrder).toBe(true);
    expect(preOrderDaysSnapshot).toBe(3);
    expect(estimatedShipBy).toBeInstanceOf(Date);
    const expected = new Date(anchor);
    expected.setDate(expected.getDate() + 3);
    expect(estimatedShipBy.getTime()).toBe(expected.getTime());
  });
});

describe("orderHasPreOrderSlaBreach", () => {
  test("false khi đã shipped / completed", () => {
    const items = [
      { isPreOrder: true, estimatedShipBy: new Date("2020-01-01") },
    ];
    expect(orderHasPreOrderSlaBreach("shipped", items)).toBe(false);
    expect(orderHasPreOrderSlaBreach("completed", items)).toBe(false);
  });

  test("true khi pending và đã quá estimatedShipBy", () => {
    const past = new Date(Date.now() - 86400000);
    expect(
      orderHasPreOrderSlaBreach("pending", [
        { isPreOrder: true, estimatedShipBy: past },
      ]),
    ).toBe(true);
  });

  test("false khi chưa tới hạn", () => {
    const future = new Date(Date.now() + 86400000 * 7);
    expect(
      orderHasPreOrderSlaBreach("confirmed", [
        { isPreOrder: true, estimatedShipBy: future },
      ]),
    ).toBe(false);
  });
});
