import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const directory = path.dirname(filename);

// Load the repository-root environment before route dependencies initialize.
// dotenv never overrides values supplied by the hosting provider or tests.
dotenv.config({ path: path.resolve(directory, "../../../.env") });
