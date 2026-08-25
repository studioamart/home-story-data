#!/usr/bin/env node
/**
 * Rebuilds the OTA manifests the Home Story app fetches:
 *
 *   data/manifest.json          <- data/home-tasks.json                       (maintenance schedules)
 *   data/lessons-manifest.json  <- data/lessons/*.json -> data/lessons.json   (fix guides)
 *
 * For each channel:
 *  - Computes the sha256 of the served data file.
 *  - Bumps `version` ONLY when the data actually changed (idempotent), so
 *    re-running on unchanged data is a no-op and produces no churn.
 *  - Points `url` at this repo's GitHub Pages (studioamart), never the legacy
 *    support-teamam account.
 *
 * The app reads each manifest, compares `version` to its cached value, and
 * downloads the new data only when it's higher — so content ships without an
 * App Store release.
 *
 * Run locally:  node scripts/build-manifest.mjs
 * In CI:        invoked by .github/workflows/update-data.yml
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { assertValidRepository, buildLessonIndex } from './content-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

// Public Pages base URL for THIS repo. All channels are served from here.
const BASE = 'https://studioamart.github.io/home-story-data/data';

// Bump only if a channel's JSON shape changes incompatibly. Older app builds
// ignore remote data whose schema is newer than they understand.
const SCHEMA = 1;
const CHECK_ONLY = process.argv.includes('--check');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const readPrev = (p) => {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};

/**
 * Write a manifest, keeping it idempotent:
 *  - data sha unchanged + same url + same schema -> leave the file untouched.
 *  - data sha unchanged but url/schema changed   -> rewrite, keep version.
 *  - data sha changed                            -> rewrite, bump version.
 */
function writeManifest(path, { url, sha256, countField, count }) {
  const prev = readPrev(path);
  const dataSame = prev && prev.sha256 === sha256 && prev.schema === SCHEMA;
  if (dataSame && prev.url === url) {
    console.log(`  ${path.split('/').pop()}: unchanged (v${prev.version}).`);
    return prev.version;
  }
  const version = dataSame ? prev.version : (prev?.version || 0) + 1;
  const manifest = {
    schema: SCHEMA,
    version,
    url,
    sha256,
    [countField]: count,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  const noun = countField === 'taskCount' ? 'tasks' : 'lessons';
  console.log(`  ${path.split('/').pop()}: v${version}, ${count} ${noun}, url ${url}`);
  return version;
}

function assertEqualFile(path, expected) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== expected) {
    throw new Error(`${path.split('/').pop()} is stale; run node scripts/build-manifest.mjs and commit the result.`);
  }
}

function checkManifest(path, { url, sha256, countField, count }) {
  const manifest = readPrev(path);
  if (!manifest || manifest.schema !== SCHEMA || !Number.isInteger(manifest.version) || manifest.version < 1 ||
      manifest.url !== url || manifest.sha256 !== sha256 || manifest[countField] !== count ||
      typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new Error(`${path.split('/').pop()} is stale or invalid; run node scripts/build-manifest.mjs and commit the result.`);
  }
}

// --- Schedule channel: data/home-tasks.json -> data/manifest.json -----------
function buildSchedule(tasksDoc) {
  const dataPath = join(DATA, 'home-tasks.json');
  const raw = readFileSync(dataPath);
  const taskCount = tasksDoc.tasks.length;
  if (taskCount === 0) { console.error('Refusing to publish: tasks array is empty.'); process.exit(1); }
  console.log('schedule:');
  const spec = {
    url: `${BASE}/home-tasks.json`,
    sha256: sha(raw),
    countField: 'taskCount',
    count: taskCount,
  };
  if (CHECK_ONLY) checkManifest(join(DATA, 'manifest.json'), spec);
  else writeManifest(join(DATA, 'manifest.json'), spec);
}

// --- Lessons channel: data/lessons/*.json -> data/lessons.json + manifest ----
function buildLessons(sources, lessons) {
  const dir = join(DATA, 'lessons');
  if (lessons.length === 0) {
    console.error('Refusing to publish: no verified lessons.');
    process.exit(1);
  }
  const excluded = sources.length - lessons.length;
  if (excluded > 0) console.log(`  excluded ${excluded} unverified lesson drafts.`);
  // Deterministic serialization (files already sorted by slug) so the sha is stable.
  const combined = JSON.stringify(lessons, null, 2) + '\n';
  const index = JSON.stringify(buildLessonIndex(lessons), null, 2) + '\n';
  if (CHECK_ONLY) {
    assertEqualFile(join(DATA, 'lessons.json'), combined);
    assertEqualFile(join(dir, 'index.json'), index);
  } else {
    writeFileSync(join(DATA, 'lessons.json'), combined);
    writeFileSync(join(dir, 'index.json'), index);
  }
  console.log('lessons:');
  const spec = {
    url: `${BASE}/lessons.json`,
    sha256: sha(Buffer.from(combined)),
    countField: 'lessonCount',
    count: lessons.length,
  };
  if (CHECK_ONLY) checkManifest(join(DATA, 'lessons-manifest.json'), spec);
  else writeManifest(join(DATA, 'lessons-manifest.json'), spec);
}

try {
  const content = assertValidRepository(ROOT);
  buildSchedule(content.tasksDoc);
  buildLessons(content.lessons, content.publishedLessons);
  console.log(CHECK_ONLY ? 'All generated artifacts are current.' : 'Build completed and validated.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
