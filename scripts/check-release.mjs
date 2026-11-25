#!/usr/bin/env node
/**
 * The release gate. CI checks the code. This script checks the release: is
 * a publish of this version, now, to this dist-tag, what the maintainer
 * wants? The release workflow runs it before the build.
 *
 * Usage:
 *   node scripts/check-release.mjs --version 0.0.0-alpha.1 --dist-tag latest
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = '@rootnative/game-engine'
const REPOSITORY = 'https://github.com/rootnative/game-engine'
const TAG_PREFIX = 'game-engine@'

// Trusted publishing needs npm 11.5.1, and `npm stage publish` needs
// 11.15.0. The trusted publisher on npmjs.com is stage-only.
const MIN_NPM = '11.15.0'

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const problems = []
const warnings = []
const fail = (message) => problems.push(message)
const warn = (message) => warnings.push(message)

const requestedVersion = arg('version')
const distTag = arg('dist-tag')
if (!requestedVersion || !distTag) {
  console.error(
    'Usage: node scripts/check-release.mjs --version <version> --dist-tag <tag>',
  )
  process.exit(2)
}

/** A negative number when `a` is older than `b`. Ignores a prerelease part. */
function compareVersions(a, b) {
  const parse = (version) => version.split('-')[0].split('.').map(Number)
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

const readText = (file) =>
  readFileSync(join(repoRoot, file), 'utf8').replace(/\r\n/g, '\n')

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// An older npm does not try trusted publishing. It looks for a token, finds
// none, and fails with a 404 that names neither problem.
const npmVersion = execFileSync('npm', ['--version'], {
  encoding: 'utf8',
}).trim()
if (compareVersions(npmVersion, MIN_NPM) < 0) {
  fail(
    `npm ${npmVersion} cannot do a staged publish with a trusted publisher. Use npm ${MIN_NPM} or later. In CI, change the npm version in the release workflow.`,
  )
}

const manifest = JSON.parse(readText('package.json'))
const version = manifest.version

if (version !== requestedVersion) {
  fail(
    `You asked for ${requestedVersion}, but package.json has ${version}. The release workflow sets the version. Run it, and don't change the version by hand.`,
  )
}

if (manifest.private === true) {
  fail(
    'package.json has "private": true, so npm refuses the publish. Remove it on main, and run the release again.',
  )
}

// npm compares this URL with the repository in the provenance only at the
// publish, after the push of the tag. A dry run skips the publish.
const repositoryField = manifest.repository
const repositoryUrl =
  typeof repositoryField === 'string' ? repositoryField : repositoryField?.url
const normalizedRepositoryUrl = (repositoryUrl ?? '')
  .replace(/^git\+/, '')
  .replace(/\.git$/, '')
  .replace(/\/$/, '')
if (normalizedRepositoryUrl !== REPOSITORY) {
  fail(
    `package.json has no "repository.url" for ${REPOSITORY}${repositoryUrl ? ` (it has "${repositoryUrl}")` : ''}. npm refuses a publish with provenance without it (E422). Add "repository": { "type": "git", "url": "git+${REPOSITORY}.git" } on main, and run the release again.`,
  )
}

// The release workflow doesn't write the CHANGELOG. A person commits the
// section of the version before the run.
const changelog = readText('CHANGELOG.md')
const escapedVersion = escapeRegExp(version)
if (
  !new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(
    changelog,
  )
) {
  fail(
    `CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section. Move the entries under "## [Unreleased]" to it, commit it to main, and run the release again.`,
  )
}
const tag = `${TAG_PREFIX}${version}`
const releaseLink = `[${version}]: ${REPOSITORY}/releases/tag/${tag}`
if (!changelog.split('\n').includes(releaseLink)) {
  fail(
    `CHANGELOG.md has no link line "${releaseLink}". Add it at the end, and set "[Unreleased]" to compare from ${tag}.`,
  )
}

// The README is also the npm package page. While it has a status line, that
// line must name the version that the publish puts on that page.
const statusLine = readText('README.md')
  .split('\n')
  .find((line) => line.startsWith('> **Status:'))
if (
  statusLine !== undefined &&
  !new RegExp(`\`${escapedVersion}\``).test(statusLine)
) {
  fail(
    `The README status line doesn't name \`${version}\`:\n  ${statusLine}\nUpdate it, run "pnpm run build:llms", commit both files to main, and run the release again.`,
  )
}

// The checkout must have the tags, so a CI checkout uses `fetch-depth: 0`.
let tagExists = true
try {
  execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd: repoRoot,
    stdio: 'ignore',
  })
} catch {
  tagExists = false
}
if (tagExists) {
  fail(
    `The tag ${tag} exists.\n` +
      `  If ${version} is on npm, npm doesn't accept it again. Release the next version.\n` +
      `  If it isn't on npm, an earlier run pushed the tag and then failed. Delete the tag, and run the workflow again:\n` +
      `    git push --delete origin ${tag} && git tag -d ${tag}`,
  )
}

/**
 * The version that `latest` names on npm now. `null` when the package has
 * no version on npm. `undefined` when the lookup failed.
 */
function latestOnNpm() {
  try {
    const out = execFileSync('npm', ['view', PACKAGE, 'dist-tags.latest'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return out === '' ? null : out
  } catch (error) {
    const text = `${error.stderr ?? ''}${error.message ?? ''}`
    return /E404|404 Not Found/.test(text) ? null : undefined
  }
}

// A prerelease on `latest` is correct while the alpha line is the only
// line: the README install command has no dist-tag. It's wrong only when it
// replaces a stable version as the default install.
const isPrerelease = version.includes('-')
if (isPrerelease && distTag === 'latest') {
  const current = latestOnNpm()
  if (current === undefined) {
    fail(
      `${version} is a prerelease for "latest", and the npm lookup failed, so the check can't tell if it replaces a stable version. Check the network, or use the "alpha" dist-tag.`,
    )
  } else if (current !== null && !current.includes('-')) {
    fail(
      `${version} is a prerelease, and it would replace the stable version ${current} on "latest". Use "alpha", "beta", or "rc".`,
    )
  } else {
    warn(
      `${version} is a prerelease for "latest". This is correct while no stable version is on npm. After the first stable version, use "alpha".`,
    )
  }
}
if (!isPrerelease && distTag !== 'latest') {
  warn(
    `${version} is a stable version for the "${distTag}" dist-tag, so "npm install ${PACKAGE}" doesn't install it.`,
  )
}

const inActions = process.env.GITHUB_ACTIONS === 'true'
for (const message of warnings) {
  console.error(`${inActions ? '::warning::' : 'WARN   '}${message}`)
}
for (const message of problems) {
  console.error(`${inActions ? '::error::' : 'ERROR  '}${message}`)
}
if (problems.length > 0) {
  console.error(`\n[check-release] ${problems.length} problem(s).`)
  process.exit(1)
}
console.log(
  `[check-release] ok: ${version} as ${tag} on the dist-tag ${distTag}, with npm ${npmVersion}.`,
)
