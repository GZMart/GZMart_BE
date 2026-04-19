import { describe, expect, test, afterEach, jest } from "@jest/globals";

describe("sellerApplicationAi.service fetch + parse", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AI_API_URL;
    delete process.env.AI_API_TOKEN;
    jest.resetModules();
  });

  test("parse JSON từ LLM khi response hợp lệ", async () => {
    process.env.AI_API_URL = "https://example.com/ai";
    process.env.AI_API_TOKEN = "test-token";

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          response: JSON.stringify({
            recommendation: "needs_human",
            confidence: 0.5,
            flags: ["review_address"],
            summary: "Cần admin xem thêm địa chỉ.",
          }),
        }),
    });

    const mod = await import("../src/services/sellerApplicationAi.service.js");
    const result = await mod.screenUserPayloadWithAi({
      fullName: "Nguyen Van A",
      email: "a@example.com",
      phone: "0901234567",
      citizenId: "079200001234",
      taxId: "0123456789",
      address: "123 ABC",
      provinceName: "TP HCM",
      wardName: "Phuong 1",
      localChecks: { allPassed: true, checks: [] },
    });

    expect(result.provider).toBe("ai");
    expect(result.recommendation).toBe("needs_human");
    expect(Array.isArray(result.flags)).toBe(true);
  });

  test("thiếu env trả skipped", async () => {
    const mod = await import("../src/services/sellerApplicationAi.service.js");
    const result = await mod.screenUserPayloadWithAi({
      fullName: "A",
      email: "a@b.com",
      phone: "0901234567",
      citizenId: "079200001234",
      taxId: "0123456789",
    });
    expect(result.provider).toBe("skipped");
    expect(result.recommendation).toBe("needs_human");
  });

  test("chấp nhận phản hồi bọc ```json ... ```", async () => {
    process.env.AI_API_URL = "https://example.com/ai";
    process.env.AI_API_TOKEN = "test-token";

    const inner = JSON.stringify({
      recommendation: "likely_approve",
      confidence: 0.82,
      flags: [],
      summary: "Hồ sơ nhất quán.",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          response: `\`\`\`json\n${inner}\n\`\`\``,
        }),
    });

    const mod = await import("../src/services/sellerApplicationAi.service.js");
    const result = await mod.screenUserPayloadWithAi({
      fullName: "A",
      email: "a@b.com",
      phone: "0901234567",
      citizenId: "079200001234",
      taxId: "0123456789",
    });

    expect(result.provider).toBe("ai");
    expect(result.recommendation).toBe("likely_approve");
  });
});
