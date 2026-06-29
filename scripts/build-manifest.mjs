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
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

// Public Pages base URL for THIS repo. All channels are served from here.
const BASE = 'https://studioamart.github.io/home-story-data/data';

// Bump only if a channel's JSON shape changes incompatibly. Older app builds
// ignore remote data whose schema is newer than they understand.
const SCHEMA = 1;

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

// --- Schedule channel: data/home-tasks.json -> data/manifest.json -----------
function buildSchedule() {
  const dataPath = join(DATA, 'home-tasks.json');
  const raw = readFileSync(dataPath);
  let parsed;
  try { parsed = JSON.parse(raw.toString('utf8')); }
  catch (e) { console.error('home-tasks.json is not valid JSON:', e.message); process.exit(1); }
  const taskCount = Array.isArray(parsed.tasks) ? parsed.tasks.length : 0;
  if (taskCount === 0) { console.error('Refusing to publish: tasks array is empty.'); process.exit(1); }
  console.log('schedule:');
  writeManifest(join(DATA, 'manifest.json'), {
    url: `${BASE}/home-tasks.json`,
    sha256: sha(raw),
    countField: 'taskCount',
    count: taskCount,
  });
}

// --- Lessons channel: data/lessons/*.json -> data/lessons.json + manifest ----
function buildLessons() {
  const dir = join(DATA, 'lessons');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) { console.error('Refusing to publish: no lesson files.'); process.exit(1); }
  const lessons = files.map((f) => {
    try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); }
    catch (e) { console.error(`lessons/${f} is not valid JSON:`, e.message); process.exit(1); }
  });
  // Deterministic serialization (files already sorted by slug) so the sha is stable.
  const combined = JSON.stringify(lessons, null, 2) + '\n';
  writeFileSync(join(DATA, 'lessons.json'), combined);
  console.log('lessons:');
  writeManifest(join(DATA, 'lessons-manifest.json'), {
    url: `${BASE}/lessons.json`,
    sha256: sha(Buffer.from(combined)),
    countField: 'lessonCount',
    count: lessons.length,
  });
}

buildSchedule();
buildLessons();
