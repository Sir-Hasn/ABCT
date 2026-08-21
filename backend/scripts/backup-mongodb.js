import { once } from "node:events";
import { createCipheriv, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import "../server/config/env.js";

const MAGIC = Buffer.from("ABCT-MONGO-BACKUP-V1\0", "ascii");
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function encryptionKey() {
  const value = required("BACKUP_ENCRYPTION_KEY");
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.");
  }
  return Buffer.from(value, "hex");
}

async function run() {
  const uri = required("MONGODB_URI");
  const database = required("BACKUP_DATABASE");
  const backupDirectory = path.resolve(required("BACKUP_DIR"));
  const mongodump = process.env.MONGODUMP_BIN || "mongodump";
  const key = encryptionKey();
  await mkdir(backupDirectory, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `abct-${database}-${timestamp}.archive.gz.abct.enc`;
  const destination = path.join(backupDirectory, filename);
  const temporary = `${destination}.part`;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const output = createWriteStream(temporary, { flags: "wx" });
  output.write(MAGIC);
  output.write(iv);

  const child = spawn(mongodump, [
    "--uri", uri,
    "--db", database,
    "--archive",
    "--gzip",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  try {
    const close = once(child, "close");
    await pipeline(child.stdout, cipher, output);
    const [code, signal] = await close;
    if (code !== 0) {
      const detail = stderr.trim().replaceAll(uri, "<redacted-mongodb-uri>");
      throw new Error(`mongodump failed with code ${code || "unknown"}${signal ? ` (${signal})` : ""}${detail ? `. ${detail}` : ""}`);
    }

    await appendFile(temporary, cipher.getAuthTag());
    const size = (await stat(temporary)).size;
    if (size <= MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error("mongodump produced an empty backup archive.");
    }
    await rename(temporary, destination);
    console.log(JSON.stringify({ event: "mongodb_backup_created", file: destination, bytes: size }));
  } catch (error) {
    child.kill();
    await rm(temporary, { force: true });
    throw error;
  }
}

run().catch((error) => {
  console.error(`MongoDB backup failed: ${error.message}`);
  process.exitCode = 1;
});
