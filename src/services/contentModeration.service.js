const TOXIC_TERMS = [
  "dm",
  "đm",
  "dmm",
  "đmm",
  "địt",
  "dit",
  "đụ",
  "du",
  "lồn",
  "lon",
  "cặc",
  "cac",
  "vcl",
  "vl",
  "cc",
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
];

const extractModelText = (payload) => {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  if (typeof payload?.response === "string") {
    return payload.response;
  }

  if (typeof payload?.data?.response === "string") {
    return payload.data.response;
  }

  if (typeof payload?.text === "string") {
    return payload.text;
  }

  return "";
};

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

const heuristicModeration = (content) => {
  const normalized = (content || "").toLowerCase();
  const hits = TOXIC_TERMS.filter((term) => normalized.includes(term));
  const isOffensive = hits.length > 0;

  return {
    isOffensive,
    score: isOffensive ? Math.min(0.6 + hits.length * 0.1, 0.99) : 0.05,
    labels: hits.length ? ["abusive_language"] : ["clean"],
    reason: hits.length
      ? `Matched restricted terms: ${hits.slice(0, 3).join(", ")}`
      : "No obvious toxic terms detected",
  };
};

class ContentModerationService {
  async moderateReviewText(content) {
    const heuristic = heuristicModeration(content);
    const aiApiUrl = process.env.AI_API_URL;
    const aiApiToken = process.env.AI_API_TOKEN;

    if (!aiApiUrl || !aiApiToken) {
      return {
        provider: "heuristic",
        ...heuristic,
      };
    }

    const systemPrompt =
      "You are a strict content moderation engine for e-commerce product reviews. " +
      "Classify whether text contains abusive, obscene, hateful, sexual harassment, or toxic insults. " +
      "Return ONLY JSON with keys: isOffensive(boolean), score(number 0..1), labels(string[]), reason(string).";

    try {
      const response = await fetch(aiApiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${aiApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: content,
          systemPrompt,
          history: [],
        }),
      });

      if (!response.ok) {
        return {
          provider: "heuristic",
          ...heuristic,
        };
      }

      const data = await response.json();
      const rawText = extractModelText(data);
      const parsed = tryParseJsonFromText(rawText);

      if (!parsed || typeof parsed.isOffensive !== "boolean") {
        return {
          provider: "heuristic",
          ...heuristic,
        };
      }

      return {
        provider: "ai",
        isOffensive: parsed.isOffensive,
        score:
          typeof parsed.score === "number"
            ? Math.max(0, Math.min(parsed.score, 1))
            : heuristic.score,
        labels: Array.isArray(parsed.labels) ? parsed.labels : heuristic.labels,
        reason:
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim()
            : heuristic.reason,
      };
    } catch {
      return {
        provider: "heuristic",
        ...heuristic,
      };
    }
  }
}

export default new ContentModerationService();
