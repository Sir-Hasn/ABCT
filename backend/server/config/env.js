import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const directory = path.dirname(filename);

// Load the repository-root environment before route dependencies initialize.
// dotenv never overrides values supplied by the hosting provider or tests.
dotenv.config({ path: path.resolve(directory, "../../../.env") });

// Render does not require NODE_ENV to be set. Treat a hosted Render service,
// an explicitly production process, or an enabled Cloudflare Access boundary
// as production so security controls cannot silently fall back to local mode.
function isProductionEnvironment() {
  return process.env.NODE_ENV === "production"
    || process.env.RENDER === "true"
    || Boolean(process.env.RENDER_EXTERNAL_URL)
    || process.env.CF_ACCESS_ENABLED === "true";
}

export { isProductionEnvironment };
