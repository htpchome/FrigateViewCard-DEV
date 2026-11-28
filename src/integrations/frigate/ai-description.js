const cleanText = (value) => String(value ?? "").trim();

const normalizeConcerns = (value) => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(cleanText).filter(Boolean);
};

const normalizeConfidence = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percentage = number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, Math.round(percentage)));
};

export const resolveFrigateAiDescription = (review) => {
  const metadata = review?.data?.metadata;
  if (!metadata || typeof metadata !== "object") return null;

  const title = cleanText(metadata.title);
  if (!title) return null;

  return {
    title,
    description:
      cleanText(metadata.scene) || cleanText(metadata.shortSummary),
    score: normalizeConfidence(metadata.confidence),
    concerns: normalizeConcerns(metadata.other_concerns),
  };
};
