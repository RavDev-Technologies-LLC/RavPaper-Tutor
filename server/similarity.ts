import { createHash } from "node:crypto";

/**
 * Deterministic source-similarity assessment.
 *
 * Replaces the former AI "plagiarism detection" prompt, which produced a score with no
 * source comparison behind it. This engine compares overlapping word n-grams (shingles)
 * of the submission against a bounded corpus of other documents stored in the same
 * tenant and reports only overlaps it can show evidence for.
 *
 * Scope limits (also stated in every result): it does NOT search the web, published
 * literature, or commercial databases, and it cannot detect paraphrase or translation.
 */

export const SHINGLE_SIZE = 8;
export const MAX_SOURCES = 200;
const MAX_FINDINGS = 25;
const MIN_PASSAGE_SHINGLES = 2; // ≥ 9 consecutive matching words

export const SIMILARITY_SCOPE =
  "Compared only against other documents stored in your organization on RavPaper Tutor. " +
  "Not checked against the web, published literature, or commercial plagiarism databases, " +
  "and paraphrased or translated text is not detected. A high score is not proof of originality.";

export type SimilaritySource = { id: number; label: string; content: string };

type Token = { word: string; start: number; end: number };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push({ word: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
  return tokens;
}

function hashShingle(words: string[]): string {
  return createHash("sha1").update(words.join(" ")).digest("base64").slice(0, 12);
}

export function shingles(tokens: Token[], n = SHINGLE_SIZE): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(hashShingle(tokens.slice(i, i + n).map((t) => t.word)));
  return out;
}

export type SimilarityFinding = {
  text: string;
  issue: string;
  suggestion: string;
  severity: "info" | "warning" | "critical";
  category: "source_overlap";
  sourceId: number;
  sourceLabel: string;
  matchedWords: number;
};

export type SimilarityResult = {
  score: number;
  method: "shingle_containment";
  shingleSize: number;
  overlapPercent: number;
  sourcesCompared: number;
  sourcesTruncated: boolean;
  matchedSources: { sourceId: number; label: string; overlapPercent: number }[];
  findings: SimilarityFinding[];
  scope: string;
  summary: string;
};

export function assessSimilarity(content: string, sources: SimilaritySource[], opts: { sourcesTruncated?: boolean } = {}): SimilarityResult {
  const tokens = tokenize(content);
  const sub = shingles(tokens);
  const base = {
    method: "shingle_containment" as const, shingleSize: SHINGLE_SIZE, sourcesCompared: sources.length,
    sourcesTruncated: !!opts.sourcesTruncated, scope: SIMILARITY_SCOPE,
  };
  if (sub.length === 0) {
    return { ...base, score: 100, overlapPercent: 0, matchedSources: [], findings: [],
      summary: `Document is too short for overlap comparison. ${SIMILARITY_SCOPE}` };
  }

  const covered = new Uint8Array(sub.length);
  const matchedSources: SimilarityResult["matchedSources"] = [];
  const findings: SimilarityFinding[] = [];

  for (const source of sources) {
    const set = new Set(shingles(tokenize(source.content)));
    if (set.size === 0) continue;
    const hits = sub.map((h) => set.has(h));
    const hitCount = hits.filter(Boolean).length;
    if (hitCount === 0) continue;
    matchedSources.push({ sourceId: source.id, label: source.label, overlapPercent: Math.round((hitCount / sub.length) * 1000) / 10 });

    // Contiguous runs of matching shingles become evidence passages.
    for (let i = 0; i < hits.length; ) {
      if (!hits[i]) { i++; continue; }
      let j = i;
      while (j + 1 < hits.length && hits[j + 1]) j++;
      for (let k = i; k <= j; k++) covered[k] = 1;
      const runShingles = j - i + 1;
      if (runShingles >= MIN_PASSAGE_SHINGLES) {
        const first = tokens[i];
        const last = tokens[j + SHINGLE_SIZE - 1];
        const passage = content.slice(first.start, last.end);
        const words = runShingles + SHINGLE_SIZE - 1;
        findings.push({
          text: passage.length > 400 ? passage.slice(0, 397) + "..." : passage,
          issue: `${words} consecutive words match ${source.label}.`,
          suggestion: "If this text is reused, quote and cite it, or rewrite it in your own words with a citation.",
          severity: words >= 40 ? "critical" : words >= 20 ? "warning" : "info",
          category: "source_overlap",
          sourceId: source.id,
          sourceLabel: source.label,
          matchedWords: words,
        });
      }
      i = j + 1;
    }
  }

  const overlap = covered.reduce((a, b) => a + b, 0) / sub.length;
  const overlapPercent = Math.round(overlap * 1000) / 10;
  matchedSources.sort((a, b) => b.overlapPercent - a.overlapPercent);
  findings.sort((a, b) => b.matchedWords - a.matchedWords);
  const score = Math.max(0, Math.min(100, Math.round(100 - overlap * 100)));
  const summary = matchedSources.length
    ? `${overlapPercent}% of the text overlaps with ${matchedSources.length} of ${sources.length} compared document(s). ${SIMILARITY_SCOPE}`
    : `No overlapping passages found among ${sources.length} compared document(s). ${SIMILARITY_SCOPE}`;
  return { ...base, score, overlapPercent, matchedSources: matchedSources.slice(0, 10), findings: findings.slice(0, MAX_FINDINGS), summary };
}
