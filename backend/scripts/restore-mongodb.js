import { createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
  if (process.env.RESTORE_TARGET_CONFIRMATION !== "DISPOSABLE_ONLY") {
    throw new Error("Set RESTORE_TARGET_CONFIRMATION=DISPOSABLE_ONLY. Never restore into production without an approved procedure.");
  }

  const backupFile = path.resolve(required("BACKUP_FILE"));
  const restoreUri = required("MONGODB_RESTORE_URI");
  const sourceDatabase = required("BACKUP_DATABASE");
  const restoreDatabase = required("RESTORE_DATABASE");
  if (sourceDatabase === restoreDatabase) {
    throw new Error("RESTORE_DATABASE must be a separate disposable database name.");
  }

  const backupSize = (await stat(backupFile)).size;
  const payloadStart = MAGIC.length + IV_LENGTH;
  if (backupSize <= payloadStart + AUTH_TAG_LENGTH) {
    throw new Error("Backup file format is invalid or incomplete.");
  }

  const headerHandle = await open(backupFile, "r");
  const header = Buffer.alloc(payloadStart);
  const tag = Buffer.alloc(AUTH_TAG_LENGTH);
  try {
    await headerHandle.read(header, 0, header.length, 0);
    await headerHandle.read(tag, 0, tag.length, backupSize - AUTH_TAG_LENGTH);
  } finally {
    await headerHandle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Backup file format is invalid or incomplete.");
  }

  const iv = header.subarray(MAGIC.length, payloadStart);
  const authTag = tag;
  const encryptedStart = payloadStart;
  const encryptedEnd = backupSize - AUTH_TAG_LENGTH - 1;
  const key = encryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const temporary = `${backupFile}.restore-${process.pid}.archive.gz`;
  const keepDecrypted = process.env.RESTORE_KEEP_DECRYPTED === "true";

  try {
    // Keep a promise for the destination stream's close event before
    // starting the pipeline. `pipeline()` waits for the stream to finish,
    // but on Windows the file handle can otherwise still be closing when
    // mongorestore starts reading the archive, which presents as EOF.
    const output = createWriteStream(temporary, { flags: "wx" });
    const outputClosed = once(output, "close");
    await pipeline(
      createReadStream(backupFile, { start: encryptedStart, end: encryptedEnd }),
      decipher,
      output,
    );
    await outputClosed;

    const mongorestore = process.env.MONGORESTORE_BIN || "mongorestore";
    const restoreArgs = [
      "--uri", restoreUri,
      // mongorestore treats --archive as a flag whose value must be supplied
      // with an equals sign on Windows. Passing it as two argv entries makes
      // the tool fall back to stdin and fail with EOF.
      `--archive=${temporary}`,
      "--gzip",
      "--nsFrom", `${sourceDatabase}.*`,
      "--nsTo", `${restoreDatabase}.*`,
    ];
    if (process.env.MONGORESTORE_VERBOSE === "true") restoreArgs.push("--verbose");
    const child = spawn(mongorestore, restoreArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const [code, signal] = await once(child, "close");
    if (code !== 0) {
      const detail = stderr.trim().replaceAll(restoreUri, "<redacted-restore-uri>");
      const output = stdout.trim();
      throw new Error(`mongorestore failed with code ${code || "unknown"}${signal ? ` (${signal})` : ""}${detail ? `. ${detail}` : ""}${output ? ` Output: ${output}` : ""}`);
    }

    console.log(JSON.stringify({
      event: "mongodb_restore_completed",
      sourceFile: backupFile,
      restoreDatabase,
      bytes: (await stat(temporary)).size,
    }));
  } finally {
    if (keepDecrypted) {
      console.error(`Decrypted restore archive kept for diagnostics: ${temporary}`);
    } else {
      await rm(temporary, { force: true });
    }
  }
}

run().catch((error) => {
  console.error(`MongoDB restore failed: ${error.message}`);
  process.exitCode = 1;
});
