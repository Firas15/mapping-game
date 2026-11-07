// Packs dist-yandex/ into mapping-yandex.zip for the Yandex Games console:
// index.html at the root, only Latin file names, under 100 MB unpacked.
// Run: npm run build:yandex
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const ROOT = 'dist-yandex';
const OUT = 'mapping-yandex.zip';
const LIMIT = 100 * 1024 * 1024;

const files = {};
let total = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (!/^[A-Za-z0-9._\-/]+$/.test(rel)) throw new Error(`file name not allowed on Yandex Games: ${rel}`);
    const data = fs.readFileSync(full);
    total += data.length;
    files[rel] = data;
  }
};
walk(ROOT);
if (!files['index.html']) throw new Error('index.html must be at the root of the archive');
if (!fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('/sdk.js')) throw new Error('the Yandex SDK is missing from index.html');
if (total > LIMIT) throw new Error(`too big: ${(total / 1048576).toFixed(1)} MB unpacked`);

fs.writeFileSync(OUT, zipSync(files, { level: 9 }));
console.log(`${OUT}: ${Object.keys(files).length} files, ${(total / 1048576).toFixed(2)} MB unpacked, ${(fs.statSync(OUT).size / 1048576).toFixed(2)} MB zipped`);
