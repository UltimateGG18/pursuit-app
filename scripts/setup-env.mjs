// Copies every packages/*/.env.example to a sibling .env when it does not exist.
// Existing .env files are never overwritten.
import { copyFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const results = [];
for (const pkg of await readdir(packagesDir)) {
  const example = join(packagesDir, pkg, '.env.example');
  if (!(await exists(example))) continue;

  const target = join(packagesDir, pkg, '.env');
  if (await exists(target)) {
    results.push(`kept    packages/${pkg}/.env (already present)`);
    continue;
  }
  await copyFile(example, target);
  results.push(`created packages/${pkg}/.env`);
}

process.stdout.write(`${results.join('\n')}\n`);
