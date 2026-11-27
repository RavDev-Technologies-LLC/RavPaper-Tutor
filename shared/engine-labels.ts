// Display names for analysis engines. The "plagiarism" key is kept for data compatibility,
// but the engine is a bounded source-similarity comparison, not plagiarism detection.
export const ENGINE_LABELS: Record<string, string> = {
  plagiarism: "Source Similarity",
  rubric_alignment: "Rubric Alignment",
  statistics: "Statistics Review",
  literature_review: "Literature Review",
  anthropomorphism: "Anthropomorphism Check",
  formatting: "Formatting Review",
};

export function engineLabel(type: string): string {
  return ENGINE_LABELS[type] ?? type.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
