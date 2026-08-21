import { access, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import "../server/config/env.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function secureEndpoint() {
  const endpoint = required("BACKUP_S3_ENDPOINT");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("BACKUP_S3_ENDPOINT must be a valid HTTPS URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("BACKUP_S3_ENDPOINT must use HTTPS.");
  }
  return endpoint.replace(/\/$/, "");
}

async function newestBackup(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    // Only select archives produced by backup-mongodb.js. This prevents a
    // downloaded restore-drill file with a generic name from being uploaded
    // by an unattended scheduled run.
    if (!entry.isFile() || !entry.name.startsWith("abct-") || !entry.name.endsWith(".archive.gz.abct.enc")) continue;
    const file = path.join(directory, entry.name);
    files.push({ file, modified: (await stat(file)).mtimeMs });
  }
  files.sort((left, right) => right.modified - left.modified);
  return files[0]?.file;
}

async function resolveAwsCli() {
  const candidates = [
    process.env.AWS_CLI_BIN,
    process.platform === "win32"
      ? path.join(process.env.ProgramFiles || "C:\\Program Files", "Amazon", "AWSCLIV2", "aws.exe")
      : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next configured/default location, then PATH.
    }
  }
  return "aws";
}

async function runAws(args) {
  const aws = await resolveAwsCli();
  const child = spawn(aws, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const [code, signal] = await once(child, "close");
  if (code !== 0) {
    const detail = stderr.trim().replaceAll(process.env.AWS_SECRET_ACCESS_KEY || "", "<redacted>");
    throw new Error(`AWS CLI failed with code ${code || "unknown"}${signal ? ` (${signal})` : ""}${detail ? `. ${detail}` : ""}`);
  }
  return stdout;
}

async function run() {
  const directory = path.resolve(required("BACKUP_DIR"));
  const bucket = required("BACKUP_S3_BUCKET");
  const endpoint = secureEndpoint();
  const region = process.env.BACKUP_S3_REGION || "auto";
  const prefix = String(process.env.BACKUP_S3_PREFIX || "mongodb").trim().replace(/^\/+|\/+$/g, "");
  const backupFile = path.resolve(process.env.BACKUP_FILE || await newestBackup(directory) || "");
  if (!backupFile || !backupFile.endsWith(".archive.gz.abct.enc")) {
    throw new Error("BACKUP_FILE must identify an encrypted .archive.gz.abct.enc backup.");
  }
  const fileInfo = await stat(backupFile);
  if (fileInfo.size <= 0) throw new Error("Backup file is empty.");
  const objectKey = `${prefix ? `${prefix}/` : ""}${path.basename(backupFile)}`;
  const objectUri = `s3://${bucket}/${objectKey}`;
  const common = ["--endpoint-url", endpoint, "--region", region];

  await runAws(["s3", "cp", backupFile, objectUri, "--only-show-errors", ...common]);
  const metadata = JSON.parse(await runAws(["s3api", "head-object", "--bucket", bucket, "--key", objectKey, ...common]));
  if (Number(metadata.ContentLength) !== fileInfo.size) {
    throw new Error(`Uploaded object size mismatch: local=${fileInfo.size}, cloud=${metadata.ContentLength}.`);
  }

  if (process.env.BACKUP_REMOVE_LOCAL_AFTER_UPLOAD === "true") {
    await unlink(backupFile);
  }
  console.log(JSON.stringify({
    event: "mongodb_backup_uploaded",
    object: objectUri,
    bytes: fileInfo.size,
    localCopyRemoved: process.env.BACKUP_REMOVE_LOCAL_AFTER_UPLOAD === "true",
  }));
}

run().catch((error) => {
  console.error(`MongoDB backup upload failed: ${error.message}`);
  process.exitCode = 1;
});
