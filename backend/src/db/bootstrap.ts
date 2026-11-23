// Creates/promotes the ADMIN_EMAIL account (also runs automatically at API startup).
import { closeRedis } from "../lib/redis.js";
import { ensureBootstrapAdmin } from "../modules/auth/auth.routes.js";
import { pool } from "./index.js";

try {
  await ensureBootstrapAdmin();
  console.log("Bootstrap admin checked");
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  // Close every connection (Redis included) so the build step exits instead of hanging.
  await pool.end();
  await closeRedis();
  process.exit();
}
