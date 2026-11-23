import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { badRequest } from "./errors.js";

export const RESUME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** Detect by content, not by the client-supplied MIME type or extension. */
export function sniff(buf: Buffer): keyof typeof RESUME_TYPES | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // DOCX is a ZIP container whose entries include word/document.xml
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from("word/"))) return "docx";
  return null;
}

const tidy = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

export async function extractText(buf: Buffer): Promise<{ kind: keyof typeof RESUME_TYPES; text: string; pageCount: number | null }> {
  const kind = sniff(buf);
  if (!kind) throw badRequest("Upload a PDF or Word (.docx) file");
  try {
    if (kind === "pdf") {
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        const r = await parser.getText();
        return { kind, text: tidy(r.text.replace(/-- \d+ of \d+ --/g, "")), pageCount: r.total ?? null };
      } finally { await parser.destroy(); }
    }
    const r = await mammoth.extractRawText({ buffer: buf });
    return { kind, text: tidy(r.value), pageCount: null };
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw badRequest("We couldn't read that file. It may be corrupted or password-protected.");
  }
}
