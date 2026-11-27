import { test } from "node:test";
import assert from "node:assert/strict";
import { assessSimilarity, SIMILARITY_SCOPE } from "../server/similarity.ts";

const passage = "The relationship between instructional scaffolding and learner autonomy has been examined across many contexts with mixed results reported by researchers";
const original = "Our study recruited ninety graduate students from three universities and measured their writing development over a full academic year using validated rubrics";

test("identical passages are reported with evidence and source label", () => {
  const r = assessSimilarity(`${original}. ${passage}.`, [{ id: 7, label: "your document \"Draft 1\"", content: `Intro text here. ${passage}. More.` }]);
  assert.ok(r.overlapPercent > 30 && r.overlapPercent < 70, String(r.overlapPercent));
  assert.equal(r.matchedSources[0].sourceId, 7);
  assert.ok(r.findings.length >= 1);
  assert.match(r.findings[0].text, /instructional scaffolding/);
  assert.ok(r.score < 100);
  assert.ok(r.summary.includes(SIMILARITY_SCOPE));
});

test("unrelated text yields no findings and states scope limits", () => {
  const r = assessSimilarity(original, [{ id: 1, label: "x", content: passage }]);
  assert.equal(r.findings.length, 0);
  assert.equal(r.score, 100);
  assert.match(r.summary, /Not checked against the web/);
});

test("matching is case and punctuation insensitive", () => {
  const r = assessSimilarity(passage.toUpperCase(), [{ id: 1, label: "x", content: passage.replace(/ /g, ",  ") }]);
  assert.equal(r.overlapPercent, 100);
  assert.equal(r.score, 0);
});
