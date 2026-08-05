import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');
const directory = process.env.SRA_BACKUP_DIR || path.resolve('backups');
await fs.mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const backupPath = path.join(directory, `sra-${stamp}.dump`);

await new Promise((resolve, reject) => {
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', backupPath, connectionString], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}.`)));
});

const hash = createHash('sha256');
await new Promise((resolve, reject) => {
  const stream = createReadStream(backupPath);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.once('end', resolve);
  stream.once('error', reject);
});
const stat = await fs.stat(backupPath);
const manifest = {
  format: 'POSTGRES_CUSTOM',
  backupFile: path.basename(backupPath),
  sha256: hash.digest('hex'),
  bytes: stat.size,
  createdAt: new Date().toISOString(),
  environment: process.env.NODE_ENV || 'unknown',
  application: 'SAIN_REAL_ASSET_MARKET',
};
await fs.writeFile(`${backupPath}.manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
