import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');

test('Vite production bundle builds index.html and JS/CSS assets', () => {
  const distIndex = path.join(webRoot, 'dist', 'index.html');
  assert.ok(fs.existsSync(distIndex), 'dist/index.html should exist after npm run build');
  const html = fs.readFileSync(distIndex, 'utf8');
  assert.match(html, /T-ZONE/);
});
