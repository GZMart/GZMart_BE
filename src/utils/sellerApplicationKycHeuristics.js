/** @typedef {{ code: string, passed: boolean, detail: string }} KycCheck */

const DIGITS_ONLY = /^\d+$/;

/**
 * @param {object} input
 * @param {string} [input.phone]
 * @param {string} [input.citizenId]
 * @param {string} [input.taxId]
 * @returns {{ allPassed: boolean, checks: KycCheck[] }}
 */
export function runLocalKycChecks(input = {}) {
  const checks = [];

  const phone = (input.phone || "").trim();
  const phoneOk = /^[0-9]{10,11}$/.test(phone);
  checks.push({
    code: "phone_format",
    passed: phoneOk,
    detail: phoneOk ? "OK" : "Số điện thoại VN cần 10–11 chữ số",
  });

  const cid = (input.citizenId || "").replace(/\s/g, "");
  const cidDigits = DIGITS_ONLY.test(cid) && (cid.length === 9 || cid.length === 12);
  checks.push({
    code: "citizen_id_format",
    passed: cidDigits,
    detail: cidDigits ? "OK" : "CCCD 12 số hoặc CMND cũ 9 số (chỉ chữ số)",
  });

  const taxRaw = (input.taxId || "").replace(/[-\s]/g, "");
  const taxOk = DIGITS_ONLY.test(taxRaw) && taxRaw.length >= 10 && taxRaw.length <= 13;
  checks.push({
    code: "tax_id_format",
    passed: taxOk,
    detail: taxOk ? "OK" : "MST (chữ số) thường 10–13 ký tự sau khi bỏ dấu gạch",
  });

  return {
    allPassed: checks.every((c) => c.passed),
    checks,
  };
}
