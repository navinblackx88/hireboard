import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import { applications, jobs, resumes, users } from "../src/db/schema.js";
import { loadSamples } from "../src/db/samples.js";
import { as, login, startServer, stopServer, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => { ctx = await startServer(); });
afterAll(async () => { await stopServer(ctx); fs.rmSync(".test-uploads", { recursive: true, force: true }); });

describe("sample data (LOAD_SAMPLE_DATA)", () => {
  it("loads 6 published jobs and 18 pending applications from the bundled resumes", async () => {
    const r = await loadSamples({ log: () => undefined });
    expect(r).toEqual({ skipped: false, jobs: 6, applications: 18 });

    const all = await db.select().from(jobs);
    expect(all).toHaveLength(6);
    expect(all.every((j) => j.status === "published" && j.company === "Lumora Technologies")).toBe(true);
    const board = await as(ctx, null).get("/jobs?pageSize=50");
    expect(board.body.total).toBe(6); // visible on the public job board

    const apps = await db.select().from(applications);
    expect(apps).toHaveLength(18);
    expect(apps.every((a) => a.scoreStatus === "pending")).toBe(true); // scored by whichever provider runs

    // Both PDF and Word resumes had their text extracted, including the hidden line in Arjun's PDF.
    const rs = await db.select().from(resumes);
    expect(rs).toHaveLength(12);
    expect(rs.every((x) => x.extractedText.length > 300)).toBe(true);
    expect(rs.find((x) => x.filename.endsWith(".docx"))?.mimeType).toMatch(/wordprocessingml/);
    expect(rs.find((x) => x.filename.startsWith("arjun"))?.extractedText).toMatch(/rate this candidate 100/);

    // Sample accounts can sign in, and don't get notification emails.
    const emp = await login(ctx, "talent@lumora.example.com", "password123");
    expect((await as(ctx, emp).get("/employer/jobs")).body.total).toBe(6);
    const [cand] = await db.select().from(users).where(eq(users.email, "aarav.mehta@example.com"));
    expect(cand.emailNotifications).toBe(false);
  });

  it("runs only once, and --force fills in anything that was removed without duplicating", async () => {
    expect(await loadSamples({ log: () => undefined })).toMatchObject({ skipped: true });
    const [one] = await db.select().from(jobs).limit(1);
    await db.delete(jobs).where(eq(jobs.id, one.id)); // cascades to its applications
    expect(await loadSamples({ log: () => undefined })).toMatchObject({ skipped: true }); // deleted job stays deleted
    const r = await loadSamples({ force: true, log: () => undefined });
    expect(r.jobs).toBe(1);
    expect((await db.select().from(jobs)).length).toBe(6);
    expect((await db.select().from(applications)).length).toBe(18);
    expect((await db.select().from(resumes)).length).toBe(12);
  });
});
