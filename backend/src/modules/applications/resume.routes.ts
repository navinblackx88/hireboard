import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { applications, resumes, type Resume } from "../../db/schema.js";
import { me } from "../../lib/auth.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { extractText, RESUME_TYPES } from "../../lib/extract.js";
import { storage } from "../../lib/storage.js";
import { uuidParam } from "../../lib/validate.js";
import { downloadUrl } from "./files.js";

export const resumeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_RESUME_MB * 1024 * 1024, files: 1 } });
const MAX_RESUMES = 10;

const view = (r: Resume) => ({
  id: r.id, filename: r.filename, mimeType: r.mimeType, sizeBytes: r.sizeBytes, pageCount: r.pageCount,
  isDefault: r.isDefault, createdAt: r.createdAt, textPreview: r.extractedText.slice(0, 400), textLength: r.extractedText.length,
});

resumeRouter.get("/", async (req, res) => {
  const rows = await db.select().from(resumes).where(and(eq(resumes.candidateId, me(req).id), isNull(resumes.deletedAt))).orderBy(desc(resumes.isDefault), desc(resumes.createdAt));
  res.json({ items: rows.map(view) });
});

async function checkQuota(candidateId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(resumes).where(and(eq(resumes.candidateId, candidateId), isNull(resumes.deletedAt)));
  if (n >= MAX_RESUMES) throw badRequest(`You can keep up to ${MAX_RESUMES} resumes. Delete one first.`);
  return n;
}

/** Extracts text (once, so scoring never re-parses files) and records the resume. `key` is set when the file is already in storage. */
async function createResume(candidateId: string, buffer: Buffer, originalName: string, existingKey?: string) {
  const n = await checkQuota(candidateId);
  const { kind, text, pageCount } = await extractText(buffer);
  if (text.length < 80) throw badRequest("We couldn't find enough text in this file. If it's a scanned image, export it as a text-based PDF.");
  const filename = originalName.replace(/[\r\n"]/g, "").slice(-200) || `resume.${kind}`;
  const key = existingKey ?? `resumes/${candidateId}/${crypto.randomUUID()}.${kind}`;
  if (!existingKey) await storage.put(key, buffer, RESUME_TYPES[kind]);
  const [row] = await db.insert(resumes).values({
    candidateId, filename, mimeType: RESUME_TYPES[kind], sizeBytes: buffer.length, storageKey: key,
    extractedText: text, pageCount, isDefault: n === 0,
  }).returning();
  return row;
}

/** Upload a PDF/DOCX (multipart field "file"). */
resumeRouter.post("/", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest("Attach your resume in the 'file' field");
  const row = await createResume(me(req).id, file.buffer, Buffer.from(file.originalname, "latin1").toString("utf8"));
  res.status(201).json(view(row));
});

async function own(req: Parameters<typeof uuidParam>[0]) {
  const [r] = await db.select().from(resumes).where(and(eq(resumes.id, uuidParam(req, "id")), eq(resumes.candidateId, me(req).id), isNull(resumes.deletedAt)));
  if (!r) throw notFound("Resume");
  return r;
}

resumeRouter.get("/:id", async (req, res) => {
  const r = await own(req);
  res.json({ ...view(r), extractedText: r.extractedText });
});

resumeRouter.post("/:id/default", async (req, res) => {
  const r = await own(req);
  await db.transaction(async (tx) => {
    await tx.update(resumes).set({ isDefault: false }).where(eq(resumes.candidateId, r.candidateId));
    await tx.update(resumes).set({ isDefault: true }).where(eq(resumes.id, r.id));
  });
  res.json({ ...view(r), isDefault: true });
});

resumeRouter.get("/:id/download", async (req, res) => {
  const r = await own(req);
  res.json({ url: await downloadUrl(r), expiresInSeconds: 300 });
});

/** Resumes already sent with an application are hidden, not destroyed, so employers keep what they received. */
resumeRouter.delete("/:id", async (req, res) => {
  const r = await own(req);
  const [used] = await db.select({ id: applications.id }).from(applications).where(eq(applications.resumeId, r.id)).limit(1);
  if (used) await db.update(resumes).set({ deletedAt: new Date(), isDefault: false }).where(eq(resumes.id, r.id));
  else { await db.delete(resumes).where(eq(resumes.id, r.id)); await storage.remove(r.storageKey); }
  if (r.isDefault) {
    const [next] = await db.select({ id: resumes.id }).from(resumes).where(and(eq(resumes.candidateId, r.candidateId), isNull(resumes.deletedAt))).orderBy(desc(resumes.createdAt)).limit(1);
    if (next) await db.update(resumes).set({ isDefault: true }).where(eq(resumes.id, next.id));
  }
  res.status(204).end();
});
