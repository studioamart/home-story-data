import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPublishableLesson } from './lesson-publish-policy.mjs';

test('lesson publishing fails closed unless verified is exactly true', () => {
  assert.equal(isPublishableLesson({ slug: 'ready', verified: true }), true);
  assert.equal(isPublishableLesson({ slug: 'draft', verified: false }), false);
  assert.equal(isPublishableLesson({ slug: 'missing' }), false);
  assert.equal(isPublishableLesson({ slug: 'string', verified: 'true' }), false);
  assert.equal(isPublishableLesson(null), false);
});

test('generated feed and manifest contain only verified lessons', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const feedRaw = readFileSync(join(root, 'data', 'lessons.json'));
  const feed = JSON.parse(feedRaw.toString('utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'data', 'lessons-manifest.json'), 'utf8'));

  assert.ok(feed.length > 0);
  assert.ok(feed.every(isPublishableLesson));
  assert.equal(manifest.lessonCount, feed.length);
  assert.equal(
    manifest.sha256,
    createHash('sha256').update(feedRaw).digest('hex'),
  );
});
