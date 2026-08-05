import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const backupPath = process.argv[2];
const target = process.env.SRA_RESTORE_DATABASE_URL;
if (!backupPath) throw new Error('Usage: node scripts/verify-restore.mjs <backup.dump>');
if (!target) throw new Error('SRA_RESTORE_DATABASE_URL is required and must point to a disposable restore database.');

const manifestPath = `${backupPath}.manifest.json`;
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const hash = createHash('sha256');
await new Promise((resolve, reject) => {
  const stream = createReadStream(backupPath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.once('end', resolve);
  stream.once('error', reject);
});
const digest = hash.digest('hex');
if (digest !== manifest.sha256) throw new Error('Backup checksum does not match its manifest.');

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

await run('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--dbname', target, path.resolve(backupPath)]);
await run('psql', [target, '-v', 'ON_ERROR_STOP=1', '-c', `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sra_domain_records') THEN
    RAISE EXCEPTION 'sra_domain_records missing after restore';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sra_audit_events') THEN
    RAISE EXCEPTION 'sra_audit_events missing after restore';
  END IF;
END $$;
SELECT 'domain_records' AS check_name, COUNT(*) AS count FROM sra_domain_records
UNION ALL SELECT 'audit_events', COUNT(*) FROM sra_audit_events
UNION ALL SELECT 'users', COUNT(*) FROM sra_users
UNION ALL SELECT 'sessions', COUNT(*) FROM sra_sessions;
`]);

console.log(JSON.stringify({ status: 'RESTORE_QUALIFIED', backupFile: manifest.backupFile, sha256: digest, verifiedAt: new Date().toISOString() }));
