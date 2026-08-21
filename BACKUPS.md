# Encrypted MongoDB backups

The Atlas M0 tier does not provide managed backups. This repository provides a
non-destructive client-side backup workflow using `mongodump` and AES-256-GCM.
It never deletes or updates MongoDB records and does not implement backup
retention or automatic cleanup.

## Required tools and variables

Install MongoDB Database Tools so `mongodump` and `mongorestore` are available.
Set these variables in the machine or scheduler environment, never in Git:

```powershell
$env:MONGODB_URI = "<production connection string>"
$env:BACKUP_DATABASE = "<application database name>"
$env:BACKUP_ENCRYPTION_KEY = "<64 hexadecimal characters>"
$env:BACKUP_DIR = "C:\ABCT-secure-backups"
```

Generate a key once and store it in a password manager or a dedicated secret
store. Do not commit it or store it beside the backup files:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create a backup manually:

```powershell
cd "C:\Users\Shan Ricz\Downloads\ABCT\backend"
npm run backup:mongo
```

The encrypted archive is written to `BACKUP_DIR`. No file cleanup is performed;
the owner must manage storage capacity and any retention requirement separately.

## Automatic private-cloud upload

For a client handoff, configure a private S3-compatible bucket (Cloudflare R2,
Amazon S3, or equivalent) and run the combined job. The archive is encrypted
before upload, and the upload is verified with `head-object` before an
optional local cleanup. Never make the bucket public.

Set these scheduler-only variables outside Git:

```powershell
$env:BACKUP_S3_ENDPOINT = "https://<account-id>.r2.cloudflarestorage.com"
$env:BACKUP_S3_BUCKET = "abct-mongodb-backups"
$env:BACKUP_S3_REGION = "auto"
$env:BACKUP_S3_PREFIX = "mongodb"
$env:AWS_ACCESS_KEY_ID = "<bucket-scoped-access-key>"
$env:AWS_SECRET_ACCESS_KEY = "<bucket-scoped-secret>"
$env:BACKUP_REMOVE_LOCAL_AFTER_UPLOAD = "true"
```

Install the AWS CLI on the scheduler machine. The R2 token must be limited to
the backup bucket and the bucket must have public access disabled. Run once to
verify configuration:

```powershell
cd "C:\Users\Shan Ricz\Downloads\ABCT\backend"
npm run backup:cloud
```

The combined command creates a new encrypted archive, uploads it, verifies the
cloud object size, and then removes only the temporary local archive when
`BACKUP_REMOVE_LOCAL_AFTER_UPLOAD=true`. It never deletes MongoDB records or
cloud backup objects.

Use Windows Task Scheduler or a trusted external scheduler to run
`backend/scripts/run-backup.ps1` daily. The scheduler account must have access
to the bucket-scoped credentials, encryption key, MongoDB URI, and protected
temporary directory. Do not put secrets in task arguments or Git.

## Restore drill (disposable database only)

Restore into a separate empty database or disposable cluster. Never use the
production database URI and never add `--drop`:

Use a restore target matching the production MongoDB major/minor version. The
current Atlas source reported MongoDB 8.0.x, so a local drill should use a
`mongo:8.0` image rather than the moving `mongo:8` tag.

```powershell
$env:BACKUP_FILE = "C:\ABCT-secure-backups\<archive>.archive.gz.abct.enc"
$env:MONGODB_RESTORE_URI = "<disposable MongoDB connection string>"
$env:RESTORE_DATABASE = "abct_restore_drill"
$env:RESTORE_TARGET_CONFIRMATION = "DISPOSABLE_ONLY"

npm run restore:mongo
```

Verify the restored collections and representative menu/booking documents,
record the restore date and duration, then manually remove the disposable
restore database only after verification. This workflow does not delete any
production data.
