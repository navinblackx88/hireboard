import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun } from "docx";

/** Generates real PDF / DOCX resumes for tests and seeding. */
export function makePdf(lines: string[], pages = 1): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    const per = Math.ceil(lines.length / pages);
    lines.forEach((l, i) => {
      if (i > 0 && i % per === 0) doc.addPage();
      doc.fontSize(i === 0 ? 18 : 11).text(l).moveDown(0.4);
    });
    doc.end();
  });
}

export async function makeDocx(lines: string[]): Promise<Buffer> {
  const doc = new Document({ sections: [{ children: lines.map((l, i) => new Paragraph({ children: [new TextRun({ text: l, bold: i === 0, size: i === 0 ? 32 : 22 })] })) }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export const RESUME_LINES = (name: string, skills: string[]) => [
  name,
  "Senior Software Engineer · Bengaluru",
  "Summary: Backend-focused engineer with 7 years building distributed systems and APIs.",
  `Skills: ${skills.join(", ")}`,
  "Experience",
  "Acme Payments — Senior Engineer (2021–present): Led migration to event-driven microservices on AWS; cut p99 latency 40%.",
  "Nimbus Labs — Software Engineer (2018–2021): Built GraphQL and REST APIs in TypeScript; owned CI/CD and observability.",
  "Education: B.Tech Computer Science",
];
