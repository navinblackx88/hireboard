import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { resumes, type Resume } from "../../db/schema.js";
import { notFound, unauthorized } from "../../lib/errors.js";
import { storage } from "../../lib/storage.js";

/** Presigned S3/GCS URL, or (local driver) a 5-minute signed link served by /files. */
export async function downloadUrl(r: Resume) {
  const direct = await storage.downloadUrl(r.storageKey, r.filename);
  if (direct) return direct;
  const sig = jwt.sign({ rid: r.id }, env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
  return `${env.API_URL}/api/v1/files/resumes/${r.id}?sig=${sig}`;
}

export const publicFilesRouter = Router();
publicFilesRouter.get("/resumes/:id", async (req, res) => {
  try {
    const { rid } = jwt.verify(String(req.query.sig ?? ""), env.JWT_ACCESS_SECRET) as { rid: string };
    if (rid !== req.params.id) throw new Error();
  } catch { throw unauthorized("Download link is invalid or has expired"); }
  const [r] = await db.select().from(resumes).where(eq(resumes.id, String(req.params.id)));
  if (!r) throw notFound("Resume");
  const data = await storage.read(r.storageKey);
  res.setHeader("Content-Type", r.mimeType);
  res.setHeader("Content-Length", data.length);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(data);
});
