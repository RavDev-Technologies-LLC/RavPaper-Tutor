import path from "node:path";

// Server-side text extraction for uploaded submissions. The browser never decodes
// binary formats; files are validated by extension AND content signature.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2_000_000;
const EXTRACTION_TIMEOUT_MS = 30_000;

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
export type SupportedFormat = "pdf" | "docx" | "text";

export class ExtractionError extends Error {
  constructor(message: string, public readonly code: string) { super(message); }
}

export type Extracted = { text: string; format: SupportedFormat; pages: number | null; words: number; chars: number };

const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";
const isZip = (b: Buffer) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOle = (b: Buffer) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));

export function detectFormat(fileName: string, buf: Buffer): SupportedFormat {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".doc" || isOle(buf)) throw new ExtractionError("Legacy .doc files are not supported. Save as .docx or PDF and upload again.", "unsupported_format");
  if (ext === ".pdf") {
    if (!isPdf(buf)) throw new ExtractionError("File content is not a valid PDF.", "signature_mismatch");
    return "pdf";
  }
  if (ext === ".docx") {
    if (!isZip(buf)) throw new ExtractionError("File content is not a valid DOCX document.", "signature_mismatch");
    return "docx";
  }
  if (ext === ".txt" || ext === ".md") {
    if (isPdf(buf) || isZip(buf) || buf.includes(0)) throw new ExtractionError("Text file contains binary data.", "signature_mismatch");
    return "text";
  }
  throw new ExtractionError(`Unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`, "unsupported_format");
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new ExtractionError("Document took too long to process.", "timeout")), EXTRACTION_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function extractPdf(buf: Buffer): Promise<{ text: string; pages: number }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return { text: result.pages.map((p) => p.text).join("\n\n"), pages: result.total };
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new ExtractionError("Password-protected PDFs are not supported.", "encrypted");
    throw new ExtractionError("The PDF could not be read. It may be damaged.", "corrupt");
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  try {
    const result = await (mammoth.default ?? mammoth).extractRawText({ buffer: buf });
    return result.value;
  } catch {
    throw new ExtractionError("The DOCX file could not be read. It may be damaged.", "corrupt");
  }
}

function decodeUtf8(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    throw new ExtractionError("Text files must be UTF-8 encoded.", "encoding");
  }
}

export async function extractText(fileName: string, buf: Buffer): Promise<Extracted> {
  if (buf.length === 0) throw new ExtractionError("The file is empty.", "empty");
  if (buf.length > MAX_UPLOAD_BYTES) throw new ExtractionError("File exceeds the 20 MB limit.", "too_large");
  const format = detectFormat(fileName, buf);
  let raw: string;
  let pages: number | null = null;
  if (format === "pdf") ({ text: raw, pages } = await withTimeout(extractPdf(buf)));
  else if (format === "docx") raw = await withTimeout(extractDocx(buf));
  else raw = decodeUtf8(buf);

  const text = normalizeText(raw);
  if (text.length < 50) {
    throw new ExtractionError(format === "pdf"
      ? "No selectable text found. Scanned PDFs need OCR before upload."
      : "The document contains too little text to analyze.", "no_text");
  }
  if (text.length > MAX_TEXT_CHARS) throw new ExtractionError("Extracted text exceeds the 2,000,000 character limit.", "too_long");
  return { text, format, pages, chars: text.length, words: text.split(/\s+/).filter(Boolean).length };
}
