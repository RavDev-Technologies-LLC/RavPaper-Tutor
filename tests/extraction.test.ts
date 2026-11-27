import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractText, ExtractionError } from "../server/extraction.ts";
import { makeDocx, makePdf } from "./fixtures.ts";

const body = "This dissertation chapter examines statistical power in educational research and argues for preregistration.";

test("extracts text from PDF", async () => {
  const r = await extractText("paper.pdf", makePdf(body));
  assert.equal(r.format, "pdf");
  assert.equal(r.pages, 1);
  assert.match(r.text, /statistical power/);
  assert.doesNotMatch(r.text, /-- 1 of 1 --/);
});

test("extracts text from DOCX", async () => {
  const r = await extractText("paper.docx", await makeDocx(body));
  assert.equal(r.format, "docx");
  assert.match(r.text, /preregistration/);
});

test("accepts UTF-8 text and markdown", async () => {
  const r = await extractText("notes.md", Buffer.from(`# Title\n\n${body} Café.`));
  assert.equal(r.format, "text");
  assert.match(r.text, /Café/);
});

test("rejects spoofed, legacy, binary and empty files", async () => {
  const cases: [string, Buffer, string][] = [
    ["fake.pdf", Buffer.from(body), "signature_mismatch"],
    ["fake.docx", Buffer.from(body), "signature_mismatch"],
    ["old.doc", Buffer.from(body), "unsupported_format"],
    ["bin.txt", Buffer.concat([Buffer.from(body), Buffer.from([0, 1, 2])]), "signature_mismatch"],
    ["latin1.txt", Buffer.from([...Buffer.from(body), 0xe9, 0xff]), "encoding"],
    ["empty.txt", Buffer.alloc(0), "empty"],
    ["short.txt", Buffer.from("hi"), "no_text"],
    ["x.exe", Buffer.from(body), "unsupported_format"],
    ["broken.pdf", Buffer.from("%PDF-1.4 garbage"), "corrupt"],
  ];
  for (const [name, buf, code] of cases) {
    await assert.rejects(extractText(name, buf), (e: unknown) => e instanceof ExtractionError && e.code === code, name);
  }
});
