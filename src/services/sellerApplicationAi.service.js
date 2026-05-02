import SellerApplication from "../models/SellerApplication.js";
import User from "../models/User.js";
import { sanitizePromptInput } from "../utils/promptSanitizer.js";
import { runLocalKycChecks, formatVietQrCheck } from "../utils/sellerApplicationKycHeuristics.js";
import { lookupBusiness } from "./vietqrCitizen.service.js";

const tryParseJsonFromText = (rawText) => {
  if (!rawText || typeof rawText !== "string") return null;

  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
};

/** LLM đôi khi bọc JSON trong ```json ... ``` */
function stripMarkdownJsonFence(s) {
  if (typeof s !== "string") return "";
  let t = s.trim();
  const fenced = /^```(?:json)?\s*\r?\n?([\s\S]*?)```$/im.exec(t);
  if (fenced) return fenced[1].trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[^\n]*\r?\n?/, "").replace(/```[\s]*$/m, "").trim();
  }
  return t;
}

/**
 * Cùng pattern với agentExecutor / aiInsight: body HTTP là text, parse JSON rồi lấy `.response`.
 * Dùng response.json() trực tiếp dễ lỗi khi Worker trả text không chuẩn.
 */
function extractAssistantTextFromHttpBody(rawHttpBody) {
  try {
    const json = JSON.parse(rawHttpBody);
    if (typeof json?.response === "string") return json.response;
    if (json?.response != null && typeof json.response === "object") {
      return JSON.stringify(json.response);
    }
    if (typeof json?.data?.response === "string") return json.data.response;
  } catch {
    /* không phải JSON — có thể là text thuần từ model */
  }
  return rawHttpBody;
}

const SYSTEM_PROMPT =
  "You screen Vietnamese e-commerce seller registration data. " +
  "Output ONLY valid JSON with keys: recommendation (string: likely_approve | likely_reject | needs_human), " +
  "confidence (number 0..1), flags (string[] of short machine codes), summary (Vietnamese, concise for admin). " +
  "You assist human admins only — flag inconsistencies, suspicious patterns, or unclear data; do not claim legal verification.";

const RECOMMENDATIONS = new Set(["likely_approve", "likely_reject", "needs_human"]);

function buildSellerScreeningPrompt(payload) {
  const lines = [];
  const fields = [
    "fullName",
    "email",
    "phone",
    "citizenId",
    "taxId",
    "address",
    "provinceName",
    "wardName",
  ];
  for (const k of fields) {
    const raw = payload[k] != null ? String(payload[k]) : "";
    const safe = sanitizePromptInput(raw, { maxLength: 500 });
    lines.push(`${k}: ${safe.sanitized}`);
  }

  // VietQR real-world identity verification result (Tax ID only)
  const vietqr = payload.vietqrTaxResult;
  if (vietqr) {
    lines.push("vietqr_business_api (Tax ID):");
    lines.push(`  checked: ${vietqr.checked}`);
    if (vietqr.checked) {
      lines.push(`  matched: ${vietqr.matched === null ? "indeterminate" : vietqr.matched}`);
      lines.push(`  desc: ${vietqr.desc}`);
    } else {
      lines.push(`  skip_reason: ${vietqr.desc}`);
    }
  }

  const lc = payload.localChecks;
  if (lc?.checks?.length) {
    lines.push("local_format_checks:");
    for (const c of lc.checks) {
      lines.push(`  - ${c.code}: ${c.passed ? "PASS" : "FAIL"} (${c.detail})`);
    }
    lines.push(`local_all_passed: ${lc.allPassed ? "yes" : "no"}`);
  }
  const combined = lines.join("\n");
  const wrap = sanitizePromptInput(`Seller registration fields:\n${combined}`, { maxLength: 4000 });
  return wrap.sanitized;
}

/**
 * @param {object} payload
 * @param {object} [payload.localChecks] — result of runLocalKycChecks
 * @returns {Promise<{
 *   provider: 'ai'|'skipped'|'failed',
 *   recommendation: string,
 *   confidence: number,
 *   flags: string[],
 *   summary: string,
 *   rawText: string|null,
 *   error: string|null
 * }>}
 */
export async function screenUserPayloadWithAi(payload = {}) {
  const url = process.env.AI_API_URL;
  const token = process.env.AI_API_TOKEN;

  if (!url || !token) {
    return {
      provider: "skipped",
      recommendation: "needs_human",
      confidence: 0,
      flags: ["ai_not_configured"],
      summary: "AI chưa cấu hình (AI_API_URL / AI_API_TOKEN); chỉ có kiểm tra định dạng cục bộ.",
      rawText: null,
      error: null,
    };
  }

  const userPrompt = buildSellerScreeningPrompt(payload);
  const prompt = `${userPrompt}\n\nReturn only the JSON object, no markdown.`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        history: [],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        provider: "failed",
        recommendation: "needs_human",
        confidence: 0,
        flags: ["ai_http_error"],
        summary: "Gọi AI thất bại (HTTP).",
        rawText: errText || null,
        error: `http_${response.status}`,
      };
    }

    const rawHttp = await response.text();
    const assistantRaw = extractAssistantTextFromHttpBody(rawHttp);
    const forParse = stripMarkdownJsonFence(
      typeof assistantRaw === "string" ? assistantRaw : String(assistantRaw),
    );
    let parsed = tryParseJsonFromText(forParse);
    if (!parsed || typeof parsed !== "object") {
      parsed = tryParseJsonFromText(assistantRaw);
    }
    const rawText =
      typeof assistantRaw === "string" ? assistantRaw : String(assistantRaw);

    if (!parsed || typeof parsed !== "object") {
      return {
        provider: "failed",
        recommendation: "needs_human",
        confidence: 0,
        flags: ["ai_parse_error"],
        summary: "Không đọc được phản hồi JSON từ AI.",
        rawText: rawText || null,
        error: "parse_error",
      };
    }

    let recommendation = typeof parsed.recommendation === "string" ? parsed.recommendation.trim() : "";
    if (!RECOMMENDATIONS.has(recommendation)) {
      recommendation = "needs_human";
    }

    let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    const flags = Array.isArray(parsed.flags)
      ? parsed.flags.map((f) => String(f).trim()).filter(Boolean).slice(0, 20)
      : [];

    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim().slice(0, 2000)
        : "Không có tóm tắt từ AI.";

    return {
      provider: "ai",
      recommendation,
      confidence,
      flags,
      summary,
      rawText: typeof rawText === "string" ? rawText : null,
      error: null,
    };
  } catch (err) {
    return {
      provider: "failed",
      recommendation: "needs_human",
      confidence: 0,
      flags: ["ai_request_error"],
      summary: "Lỗi khi gọi dịch vụ AI.",
      rawText: null,
      error: err?.message || "request_error",
    };
  }
}

export async function runAiScreeningForApplication(applicationId) {
  const app = await SellerApplication.findById(applicationId);
  if (!app || app.status !== "pending") return;

  const user = await User.findById(app.user)
    .select("fullName email phone citizenId taxId address provinceName wardName")
    .lean();

  if (!user) {
    await SellerApplication.updateOne(
      { _id: applicationId },
      {
        $set: {
          "aiScreening.status": "failed",
          "aiScreening.error": "User not found",
          "aiScreening.evaluatedAt": new Date(),
        },
      },
    );
    return;
  }

  // --- 1. Local format checks ---
  const local = runLocalKycChecks({
    phone: user.phone,
    citizenId: user.citizenId,
    taxId: user.taxId,
  });

  // --- 2. VietQR real-world identity verification (MST only) ---
  const vietqrTax = await lookupBusiness({
    taxCode: user.taxId || "",
  });

  // Append VietQR results as KycCheck entries so the LLM sees them
  const taxCheck = formatVietQrCheck(vietqrTax);
  // Override check code for tax
  taxCheck.code = "tax_api_verify";

  const enrichedLocal = {
    allPassed: local.allPassed && taxCheck.passed,
    checks: [...local.checks, taxCheck],
  };

  // --- 3. LLM screening with enriched context ---
  const ai = await screenUserPayloadWithAi({
    ...user,
    localChecks: enrichedLocal,
    vietqrTaxResult: vietqrTax, // Explicitly pass tax lookup result
  });

  const evaluatedAt = new Date();
  const setDoc = {
    "aiScreening.status": "complete",
    "aiScreening.provider": ai.provider,
    "aiScreening.recommendation": ai.recommendation,
    "aiScreening.confidence": ai.confidence,
    "aiScreening.flags": ai.flags,
    "aiScreening.summary": ai.summary,
    "aiScreening.localChecks": enrichedLocal.checks,
    "aiScreening.error": ai.error,
    "aiScreening.evaluatedAt": evaluatedAt,
    // Store VietQR results separately for admin UI display
    "aiScreening.vietqrCheck": {
      taxId: {
        checked: vietqrTax.checked,
        matched: vietqrTax.matched,
        code: vietqrTax.code,
        desc: vietqrTax.desc,
      },
      citizenId: {
        checked: false,
        matched: null,
        code: "endpoint_removed",
        desc: "Endpoint tra cứu CCCD đã bị VietQR gỡ bỏ",
      },
    },
  };

  if (ai.provider === "skipped") {
    setDoc["aiScreening.status"] = "skipped";
  } else if (ai.provider === "failed") {
    setDoc["aiScreening.status"] = "failed";
  }

  await SellerApplication.updateOne({ _id: applicationId }, { $set: setDoc });
}
