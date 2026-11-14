// Runs before `npm start`: installs dependencies when node_modules is missing or
// package-lock.json has changed since the last install (e.g. after `git pull`).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lock = path.join(root, 'package-lock.json');
const installed = path.join(root, 'node_modules', '.package-lock.json');
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

if (!mtime(installed) || mtime(lock) > mtime(installed)) {
  console.log('Installing dependencies (package-lock.json changed)…');
  execSync('npm install --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit' });
}
