#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sources = [
  { path: 'README.md', label: 'README.md — install, peer deps, minimal example' },
  { path: 'docs/README.md', label: 'docs/README.md — documentation index' },
  { path: 'docs/concepts.md', label: 'docs/concepts.md — architecture' },
  { path: 'docs/api-core.md', label: 'docs/api-core.md — core API' },
  { path: 'docs/api-game-engine.md', label: 'docs/api-game-engine.md — `<GameEngine>` and `useEngine`' },
  { path: 'docs/api-physics.md', label: 'docs/api-physics.md — physics' },
  { path: 'docs/api-assets.md', label: 'docs/api-assets.md — assets' },
  { path: 'docs/api-renderer-skia.md', label: 'docs/api-renderer-skia.md — Skia renderer' },
  { path: 'docs/api-renderer-three.md', label: 'docs/api-renderer-three.md — Three.js renderer' },
];

const divider = '='.repeat(80);

const parts = [
  '# @rootnative/game-engine — full documentation',
  '',
  '> Concatenated for offline LLM ingestion. This file inlines the README and every doc under docs/. Each section below is delimited by a divider and labelled with its source path. Internal markdown links between docs (e.g. `./api-core.md`) refer to other sections in this same file.',
  '',
  'Contents:',
  '',
  ...sources.map((s, i) => `${i + 1}. ${s.label}`),
  '',
];

for (const { path } of sources) {
  const content = readFileSync(join(root, path), 'utf8');
  parts.push('', divider, `# Source: ${path}`, divider, '', content.trimEnd());
}

writeFileSync(join(root, 'llms-full.txt'), parts.join('\n') + '\n');
console.log(`wrote llms-full.txt (${parts.length} blocks, ${sources.length} sources)`);
