import { describe, expect, test } from "@jest/globals";
import { runLocalKycChecks } from "../src/utils/sellerApplicationKycHeuristics.js";

describe("runLocalKycChecks", () => {
  test("hợp lệ: phone 10 số, CCCD 12 số, MST 10 số", () => {
    const r = runLocalKycChecks({
      phone: "0901234567",
      citizenId: "079200001234",
      taxId: "0123456789",
    });
    expect(r.allPassed).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
  });

  test("phone sai độ dài", () => {
    const r = runLocalKycChecks({ phone: "123", citizenId: "079200001234", taxId: "0123456789" });
    expect(r.allPassed).toBe(false);
    const phoneCheck = r.checks.find((c) => c.code === "phone_format");
    expect(phoneCheck?.passed).toBe(false);
  });

  test("CCCD 12 số hoặc CMND 9 số", () => {
    expect(runLocalKycChecks({ phone: "0901234567", citizenId: "123456789", taxId: "0123456789" }).allPassed).toBe(true);
    expect(runLocalKycChecks({ phone: "0901234567", citizenId: "12", taxId: "0123456789" }).allPassed).toBe(false);
  });
});
