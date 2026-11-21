#!/usr/bin/env node
/**
 * The consumer check. It packs the package as npm publishes it, and checks it
 * from the side of an app:
 *
 * 1. Each file that `package.json` points to is in the tarball, and no test,
 *    example or fixture file is.
 * 2. A copy of `fixtures/consumer` installs the tarball with npm. The copy is
 *    outside the repository, so nothing resolves from the `node_modules` of
 *    the repository.
 * 3. TypeScript checks the app against the published types.
 * 4. `expo export` bundles the app for iOS and Android. Metro must read the
 *    engine from `src/`, through the `react-native` condition. The source
 *    maps show which files it read.
 *
 * CI and the release workflow run it. It needs the network, and about 1 GB
 * of disk for the install.
 *
 * Usage:
 *   node scripts/check-consumer.mjs                    the full check
 *   node scripts/check-consumer.mjs --tarball <file>   use this tarball, no pack
 *   node scripts/check-consumer.mjs --tarball-only     stop after step 1
 */

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = '@rootnative/game-engine'
const inActions = process.env.GITHUB_ACTIONS === 'true'

const REQUIRED_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'llms.txt',
  'llms-full.txt',
  'docs/README.md',
]
const FORBIDDEN_PREFIXES = [
  'test/',
  'example/',
  'example-3d/',
  'fixtures/',
  'scripts/',
  '.github/',
  'node_modules/',
]

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

function fail(message) {
  console.error(`${inActions ? '::error::' : 'ERROR  '}${message}`)
  process.exit(1)
}

function run(command, args, cwd) {
  console.log(`\n$ ${[command, ...args].join(' ')}`)
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  })
}

function filesUnder(dir, suffix) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(path, suffix))
    else if (entry.name.endsWith(suffix)) out.push(path)
  }
  return out
}

const work = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'consumer-'))

// 1. The tarball.
let tarball = arg('tarball')
if (tarball) {
  tarball = resolve(tarball)
} else {
  const packDir = join(work, 'pack')
  mkdirSync(packDir)
  // `prepack` builds `dist/` and `llms-full.txt` first, as at a publish.
  run('npm', ['pack', '--pack-destination', packDir], repoRoot)
  const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (packed.length !== 1) {
    fail(`npm pack gave ${packed.length} tarballs in ${packDir}, not 1.`)
  }
  tarball = join(packDir, packed[0])
}

const entries = new Set(
  execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry !== '' && !entry.endsWith('/'))
    .map((entry) => entry.replace(/^package\//, '')),
)

const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
)
const targets = new Set()
for (const field of ['main', 'module', 'types', 'react-native', 'source']) {
  if (typeof manifest[field] === 'string') targets.add(manifest[field])
}
const collect = (value) => {
  if (typeof value === 'string') targets.add(value)
  else if (value && typeof value === 'object')
    Object.values(value).forEach(collect)
}
collect(manifest.exports)

const problems = []
for (const target of targets) {
  if (target.includes('*')) {
    problems.push(
      `package.json points to the pattern ${target}. This check doesn't expand patterns: list the files.`,
    )
    continue
  }
  const path = target.replace(/^\.\//, '')
  if (!entries.has(path)) {
    problems.push(
      `package.json points to ${target}, and the tarball doesn't have it.`,
    )
  }
}
for (const path of REQUIRED_FILES) {
  if (!entries.has(path)) problems.push(`The tarball doesn't have ${path}.`)
}
for (const path of entries) {
  if (
    FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    /\.test\.tsx?$/.test(path)
  ) {
    problems.push(
      `The tarball has ${path}, which users don't need. Check the "files" field.`,
    )
  }
}
if (problems.length > 0) {
  fail(
    `The tarball ${tarball} has ${problems.length} problem(s):\n  ${problems.join('\n  ')}`,
  )
}
console.log(
  `\n[check-consumer] The tarball has the ${targets.size} files that package.json points to, and ${entries.size} files in all.`,
)

if (process.argv.includes('--tarball-only')) {
  rmSync(work, { recursive: true, force: true })
  process.exit(0)
}

// 2. The install.
const app = join(work, 'consumer')
cpSync(join(repoRoot, 'fixtures', 'consumer'), app, {
  recursive: true,
  filter: (source) => !source.includes('node_modules'),
})
// The fixture has no tsconfig.json in the repository. There, nothing installs
// the engine, so each type checker that finds the file reports the engine
// imports as missing. The copy gets the file that create-expo-app writes.
writeFileSync(
  join(app, 'tsconfig.json'),
  `${JSON.stringify(
    { extends: 'expo/tsconfig.base', compilerOptions: { strict: true } },
    null,
    2,
  )}\n`,
)
run(
  'npm',
  [
    'install',
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    tarball,
  ],
  app,
)

// 3. The types.
run(join(app, 'node_modules', '.bin', 'tsc'), ['--noEmit'], app)

// 4. The bundle.
const exportDir = join(work, 'export')
run(
  join(app, 'node_modules', '.bin', 'expo'),
  [
    'export',
    '--platform',
    'ios',
    '--platform',
    'android',
    '--output-dir',
    exportDir,
    // Last on purpose: the CLI reads a plain value after this flag as the
    // project root.
    '--source-maps',
  ],
  app,
)

const maps = existsSync(exportDir) ? filesUnder(exportDir, '.map') : []
if (maps.length < 2) {
  fail(
    `expo export wrote ${maps.length} source map(s) in ${exportDir}, not one for each platform.`,
  )
}
const enginePath = `node_modules/${PACKAGE}/`
for (const map of maps) {
  const sources = JSON.parse(readFileSync(map, 'utf8')).sources ?? []
  const engine = sources.filter((source) => source.includes(enginePath))
  const fromSrc = engine.filter((source) =>
    source.includes(`${enginePath}src/`),
  )
  const name = relative(exportDir, map)
  if (fromSrc.length === 0) {
    fail(
      `The bundle ${name} has no file from ${enginePath}src/. Metro didn't use the "react-native" condition.`,
    )
  }
  if (fromSrc.length !== engine.length) {
    fail(
      `The bundle ${name} has engine files from outside src/:\n  ${engine.filter((s) => !fromSrc.includes(s)).join('\n  ')}`,
    )
  }
  console.log(
    `[check-consumer] ${name}: ${fromSrc.length} engine files, each from src/.`,
  )
}

rmSync(work, { recursive: true, force: true })
console.log(
  '\n[check-consumer] ok: the packed package installs, type checks and bundles in an Expo app.',
)
