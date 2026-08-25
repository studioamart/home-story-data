import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentSha256, loadAndValidateRepository, repoRoot } from './content-policy.mjs';

function withRepositoryCopy(run) {
  const root = mkdtempSync(join(tmpdir(), 'home-story-content-policy-'));
  cpSync(join(repoRoot, 'data'), join(root, 'data'), { recursive: true });
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) { writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }

test('the checked-in source corpus satisfies the strict publication policy', () => {
  assert.deepEqual(loadAndValidateRepository(repoRoot).errors, []);
});

test('unknown safety levels fail closed', () => withRepositoryCopy((root) => {
  const path = join(root, 'data', 'lessons', 'window-wont-open.json');
  const lesson = readJson(path);
  lesson.safetyLevel = 'low';
  writeJson(path, lesson);
  assert.ok(loadAndValidateRepository(root).errors.some((error) => error.includes('safetyLevel')));
}));

test('a changed legacy publication cannot inherit the old approval', () => withRepositoryCopy((root) => {
  const path = join(root, 'data', 'lessons', 'airseal-exterior-penetrations.json');
  const lesson = readJson(path);
  lesson.summary += ' Unreviewed change.';
  writeJson(path, lesson);
  assert.ok(loadAndValidateRepository(root).errors.some((error) => error.includes('legacy lessons: content digest changed')));
}));

test('new publication requires authoritative sources and content-bound approval', () => withRepositoryCopy((root) => {
  const path = join(root, 'data', 'lessons', 'window-wont-open.json');
  const lesson = readJson(path);
  lesson.verified = true;
  lesson.sources = [{
    title: 'Renovation, Repair and Painting Program: Consumers',
    publisher: 'U.S. Environmental Protection Agency',
    url: 'https://www.epa.gov/lead/renovation-repair-and-painting-program-consumers',
    sourceType: 'government',
    claimRefs: ['lead-safe boundary'],
  }];
  lesson.review = {
    status: 'approved',
    approvals: [{ reviewerId: 'test-fixture-reviewer', reviewerRole: 'lead-safe-professional', reviewedAt: '2030-01-01T00:00:00.000Z' }],
    contentSha256: contentSha256(lesson),
  };
  writeJson(path, lesson);
  assert.deepEqual(loadAndValidateRepository(root).errors, []);

  lesson.summary += ' Changed after approval.';
  writeJson(path, lesson);
  assert.ok(loadAndValidateRepository(root).errors.some((error) => error.includes('does not bind this content')));
}));

test('gas-leak guidance may not defer evacuation for ventilation', () => withRepositoryCopy((root) => {
  const path = join(root, 'data', 'lessons', 'appliances-gas-range-burner-wont-light.json');
  const lesson = readJson(path);
  lesson.safetyNote = 'If you smell gas, open windows to ventilate and leave only if it persists.';
  writeJson(path, lesson);
  assert.ok(loadAndValidateRepository(root).errors.some((error) => error.includes('immediate evacuation')));
}));

test('task IDs are unique and retired aliases resolve to a current task', () => withRepositoryCopy((root) => {
  const path = join(root, 'data', 'home-tasks.json');
  const tasks = readJson(path);
  tasks.tasks.push({ ...tasks.tasks[0] });
  writeJson(path, tasks);
  assert.ok(loadAndValidateRepository(root).errors.some((error) => error.includes('duplicate IDs')));
}));

test('an unreviewed safety remediation is source-backed and content-bound', () => withRepositoryCopy((root) => {
  const path = join(root, 'data', 'home-tasks.json');
  const tasks = readJson(path);
  const task = tasks.tasks.find((item) => item.id === 'panel-inspect');
  task.description += ' Unbound change.';
  writeJson(path, tasks);
  const errors = loadAndValidateRepository(root).errors;
  assert.ok(errors.some((error) => error.includes('does not bind this remediation')));
  assert.ok(errors.some((error) => error.includes('task safety remediations: content digest changed')));
}));
