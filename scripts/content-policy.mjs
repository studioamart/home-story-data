import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const LESSON_SYSTEMS = new Set(['appliances', 'electrical', 'exterior', 'hvac', 'interior', 'plumbing', 'safety', 'yard']);
const TASK_SYSTEMS = LESSON_SYSTEMS;
const KINDS = new Set(['pillar', 'spoke']);
const SAFETY_LEVELS = new Set(['none', 'caution', 'call-a-pro']);
const LIKELIHOODS = new Set(['most common', 'common', 'less common', 'rare', 'warning sign', 'safety check', 'important to rule out', 'less common but serious']);
const SEASONS = new Set([null, 'spring', 'summer', 'fall', 'winter']);
const HOME_TYPES = new Set(['house', 'townhouse', 'condo', 'apartment']);
const SERVICE_MODES = new Set(['manual-or-pro', 'diy-per-manufacturer', 'inspect-or-pro', 'visual-only-or-pro', 'qualified-pro']);
const SOURCE_TYPES = new Set(['government', 'standards-body', 'manufacturer']);
const REVIEW_ROLES = new Set([
  'certified-arborist', 'fire-safety-professional', 'licensed-electrician',
  'licensed-hvac', 'licensed-plumber', 'licensed-plumber-gas',
  'licensed-roofing', 'lead-safe-professional', 'asbestos-professional',
  'mold-remediation-professional', 'qualified-home-maintenance-reviewer',
  'safety-professional',
]);
const HAZARD_REVIEW_ROLES = {
  electrical: new Set(['licensed-electrician']),
  combustion: new Set(['fire-safety-professional', 'licensed-hvac', 'licensed-plumber-gas']),
  roofing: new Set(['licensed-roofing', 'safety-professional']),
  tree: new Set(['certified-arborist']),
  lead: new Set(['lead-safe-professional']),
  asbestos: new Set(['asbestos-professional']),
  mold: new Set(['mold-remediation-professional']),
  plumbing: new Set(['licensed-plumber', 'licensed-plumber-gas']),
  fire: new Set(['fire-safety-professional']),
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const LESSON_KEYS = new Set(['slug', 'system', 'title', 'question', 'summary', 'commonCauses', 'fixes', 'diyVsPro', 'typicalCostUSD', 'timeEstimate', 'safetyLevel', 'safetyNote', 'toolsParts', 'searchTerms', 'sources', 'disclaimer', 'verified', 'verifierNote', 'kind', 'review']);
const TASK_KEYS = new Set(['id', 'task', 'system', 'monthInterval', 'season', 'estimatedCost', 'diy', 'appliesTo', 'description', 'serviceMode', 'safetyLevel', 'sources', 'review']);

function validateKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}: unknown field`);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export const canonicalJson = (value) => JSON.stringify(canonicalize(value));
export const contentSha256 = (value) => {
  const copy = structuredClone(value);
  delete copy.review;
  delete copy.verified;
  delete copy.verifierNote;
  return sha256(canonicalJson(copy));
};
export const aggregateSha256 = (items) => sha256(canonicalJson([...items].sort((a, b) => {
  const aid = a.slug || a.id;
  const bid = b.slug || b.id;
  return aid.localeCompare(bid);
})));

function readJson(path, errors, label = path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { errors.push(`${label}: invalid JSON (${error.message})`); return null; }
}

function requireString(value, path, errors, { min = 1, max = 20_000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    errors.push(`${path}: expected a string of ${min}-${max} characters`);
  }
}

function requireStringArray(value, path, errors, { min = 1, max = 100 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    errors.push(`${path}: expected ${min}-${max} strings`);
    return;
  }
  value.forEach((item, index) => requireString(item, `${path}[${index}]`, errors));
}

function validateSource(source, path, errors) {
  if (!isObject(source)) { errors.push(`${path}: reviewed content requires source objects`); return; }
  validateKeys(source, new Set(['title', 'publisher', 'url', 'sourceType', 'claimRefs']), path, errors);
  requireString(source.title, `${path}.title`, errors);
  requireString(source.publisher, `${path}.publisher`, errors);
  requireString(source.url, `${path}.url`, errors);
  if (typeof source.url === 'string') {
    try { if (new URL(source.url).protocol !== 'https:') errors.push(`${path}.url: must use https`); }
    catch { errors.push(`${path}.url: must be a valid URL`); }
  }
  if (!SOURCE_TYPES.has(source.sourceType)) errors.push(`${path}.sourceType: unsupported value`);
  requireStringArray(source.claimRefs, `${path}.claimRefs`, errors);
}

function detectHazards(item) {
  const text = canonicalJson(item).toLowerCase();
  const hazards = new Set();
  if (item.system === 'electrical' || /\b(?:120v|240v|electrical panel|receptacle|house wiring)\b/.test(text)) hazards.add('electrical');
  if (/\b(?:natural gas|carbon monoxide|combustion|fuel-burning|gas appliance|gas line|flue)\b/.test(text)) hazards.add('combustion');
  if (/\b(?:roof|roofing|rooftop)\b/.test(text)) hazards.add('roofing');
  if (/\b(?:tree trimming|tree limb|arborist|power line)\b/.test(text)) hazards.add('tree');
  if (/\blead(?:-based|-safe| paint| dust)?\b/.test(text)) hazards.add('lead');
  if (/\basbestos\b/.test(text)) hazards.add('asbestos');
  if (/\bmold\b/.test(text)) hazards.add('mold');
  if (item.system === 'plumbing' && /\b(?:pressure|water heater|scald|sewer|supply line)\b/.test(text)) hazards.add('plumbing');
  if (item.system === 'safety' || /\b(?:fire extinguisher|smoke alarm|emergency evacuation)\b/.test(text)) hazards.add('fire');
  return [...hazards].sort();
}

function validateReview(item, path, errors) {
  const review = item.review;
  if (!isObject(review) || review.status !== 'approved') {
    errors.push(`${path}.review: changed/new published content requires status=approved`);
    return false;
  }
  validateKeys(review, new Set(['status', 'approvals', 'contentSha256']), `${path}.review`, errors);
  if (!Array.isArray(review.approvals) || review.approvals.length === 0) {
    errors.push(`${path}.review.approvals: at least one qualified approval is required`);
  } else {
    review.approvals.forEach((approval, index) => {
      const prefix = `${path}.review.approvals[${index}]`;
      if (!isObject(approval)) { errors.push(`${prefix}: expected object`); return; }
      validateKeys(approval, new Set(['reviewerId', 'reviewerRole', 'reviewedAt']), prefix, errors);
      requireString(approval.reviewerId, `${prefix}.reviewerId`, errors, { min: 3, max: 200 });
      if (!REVIEW_ROLES.has(approval.reviewerRole)) errors.push(`${prefix}.reviewerRole: unsupported qualified role`);
      if (typeof approval.reviewedAt !== 'string' || Number.isNaN(Date.parse(approval.reviewedAt))) {
        errors.push(`${prefix}.reviewedAt: expected ISO date-time`);
      }
    });
  }
  const roles = new Set(Array.isArray(review.approvals) ? review.approvals.map((approval) => approval?.reviewerRole) : []);
  const hazards = detectHazards(item);
  if (hazards.length === 0 && !roles.has('qualified-home-maintenance-reviewer')) {
    errors.push(`${path}.review.approvals: general content requires a qualified-home-maintenance-reviewer`);
  }
  for (const hazard of hazards) {
    if (![...HAZARD_REVIEW_ROLES[hazard]].some((role) => roles.has(role))) {
      errors.push(`${path}.review.approvals: ${hazard} content requires an applicable qualified role`);
    }
  }
  if (review.contentSha256 !== contentSha256(item)) errors.push(`${path}.review.contentSha256: does not bind this content`);
  return true;
}

function validateLesson(lesson, file, errors) {
  const path = `data/lessons/${file}`;
  if (!isObject(lesson)) { errors.push(`${path}: expected object`); return; }
  validateKeys(lesson, LESSON_KEYS, path, errors);
  requireString(lesson.slug, `${path}.slug`, errors);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lesson.slug || '')) errors.push(`${path}.slug: invalid slug`);
  if (`${lesson.slug}.json` !== file) errors.push(`${path}.slug: must match filename`);
  if (!LESSON_SYSTEMS.has(lesson.system)) errors.push(`${path}.system: unsupported value`);
  if (!KINDS.has(lesson.kind)) errors.push(`${path}.kind: unsupported value`);
  if (!SAFETY_LEVELS.has(lesson.safetyLevel)) errors.push(`${path}.safetyLevel: must be none, caution, or call-a-pro`);
  for (const key of ['title', 'question', 'summary', 'diyVsPro', 'typicalCostUSD', 'timeEstimate', 'safetyNote', 'disclaimer', 'verifierNote']) {
    requireString(lesson[key], `${path}.${key}`, errors);
  }
  if (typeof lesson.verified !== 'boolean') errors.push(`${path}.verified: expected boolean`);
  if (!Array.isArray(lesson.commonCauses) || lesson.commonCauses.length === 0) errors.push(`${path}.commonCauses: expected non-empty array`);
  else lesson.commonCauses.forEach((cause, index) => {
    const prefix = `${path}.commonCauses[${index}]`;
    if (!isObject(cause)) { errors.push(`${prefix}: expected object`); return; }
    requireString(cause.cause, `${prefix}.cause`, errors);
    requireString(cause.quickCheck, `${prefix}.quickCheck`, errors);
    if (!LIKELIHOODS.has(cause.likelihood)) errors.push(`${prefix}.likelihood: unsupported value`);
  });
  for (const key of ['fixes', 'toolsParts', 'searchTerms']) requireStringArray(lesson[key], `${path}.${key}`, errors);
  if (!Array.isArray(lesson.sources) || lesson.sources.length === 0) errors.push(`${path}.sources: expected non-empty array`);
  else lesson.sources.forEach((source, index) => {
    if (typeof source === 'string') requireString(source, `${path}.sources[${index}]`, errors);
    else validateSource(source, `${path}.sources[${index}]`, errors);
  });
  if (lesson.review?.status === 'pending-qualified-review' && lesson.verified !== false) {
    errors.push(`${path}.review: pending content must remain unverified`);
  }
  if (lesson.review?.status === 'pending-qualified-review') validateKeys(lesson.review, new Set(['status']), `${path}.review`, errors);
  else if (lesson.review !== undefined && lesson.review?.status !== 'approved') errors.push(`${path}.review.status: unsupported value`);
  if (lesson.verified && lesson.review?.status === 'approved') {
    lesson.sources.forEach((source, index) => validateSource(source, `${path}.sources[${index}]`, errors));
    validateReview(lesson, path, errors);
  }
  const text = canonicalJson(lesson);
  if (/if you (?:ever )?smell gas[^.]{0,220}(?:open (?:a )?window|ventilat)|smell gas that (?:doesn't|does not) clear/i.test(text)) {
    errors.push(`${path}: natural-gas emergency guidance must require immediate evacuation, not conditional ventilation`);
  }
}

function validateTask(task, index, errors) {
  const path = `data/home-tasks.json.tasks[${index}]`;
  if (!isObject(task)) { errors.push(`${path}: expected object`); return; }
  validateKeys(task, TASK_KEYS, path, errors);
  requireString(task.id, `${path}.id`, errors);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.id || '')) errors.push(`${path}.id: invalid ID`);
  requireString(task.task, `${path}.task`, errors);
  requireString(task.description, `${path}.description`, errors);
  if (!TASK_SYSTEMS.has(task.system)) errors.push(`${path}.system: unsupported value`);
  if (!Number.isInteger(task.monthInterval) || task.monthInterval < 1 || task.monthInterval > 600) errors.push(`${path}.monthInterval: expected integer 1-600`);
  if (!SEASONS.has(task.season)) errors.push(`${path}.season: unsupported value`);
  if (typeof task.diy !== 'boolean') errors.push(`${path}.diy: expected boolean`);
  if (!Array.isArray(task.estimatedCost) || task.estimatedCost.length !== 2 || task.estimatedCost.some((n) => typeof n !== 'number' || n < 0) || task.estimatedCost[0] > task.estimatedCost[1]) {
    errors.push(`${path}.estimatedCost: expected ascending non-negative [min,max]`);
  }
  if (!Array.isArray(task.appliesTo) || task.appliesTo.length === 0 || task.appliesTo.some((value) => !HOME_TYPES.has(value))) errors.push(`${path}.appliesTo: unsupported home type`);
  if ((task.serviceMode === undefined) !== (task.safetyLevel === undefined)) errors.push(`${path}: serviceMode and safetyLevel must be supplied together`);
  if (task.serviceMode !== undefined && !SERVICE_MODES.has(task.serviceMode)) errors.push(`${path}.serviceMode: unsupported value`);
  if (task.safetyLevel !== undefined && !SAFETY_LEVELS.has(task.safetyLevel)) errors.push(`${path}.safetyLevel: unsupported value`);
  if (task.sources !== undefined) {
    if (!Array.isArray(task.sources) || task.sources.length === 0) errors.push(`${path}.sources: expected non-empty array`);
    else task.sources.forEach((source, sourceIndex) => validateSource(source, `${path}.sources[${sourceIndex}]`, errors));
  }
  if (task.review?.status === 'safety-remediated-unreviewed') {
    validateKeys(task.review, new Set(['status', 'contentSha256']), `${path}.review`, errors);
    if (task.review.contentSha256 !== contentSha256(task)) errors.push(`${path}.review.contentSha256: does not bind this remediation`);
    if (!task.serviceMode || !task.safetyLevel || !Array.isArray(task.sources) || task.sources.length === 0) {
      errors.push(`${path}: safety remediation requires serviceMode, safetyLevel, and authoritative sources`);
    }
  } else if (task.review !== undefined && task.review?.status !== 'approved') {
    errors.push(`${path}.review.status: unsupported value`);
  } else if (task.review?.status === 'approved') {
    if (!Array.isArray(task.sources) || task.sources.length === 0) errors.push(`${path}.sources: reviewed content requires sources`);
    else task.sources.forEach((source, sourceIndex) => validateSource(source, `${path}.sources[${sourceIndex}]`, errors));
    validateReview(task, path, errors);
  }
}

function compareLegacyGroup({ items, ledger, prefix, errors }) {
  const ids = items.map((item) => item.slug || item.id).sort();
  if (!ledger || !Array.isArray(ledger.ids)) { errors.push(`data/review/legacy-approved.json.${prefix}: missing explicit legacy allowlist`); return; }
  if (canonicalJson(ids) !== canonicalJson(ledger.ids)) errors.push(`legacy ${prefix}: ID allowlist changed; add qualified content review instead of silently grandfathering`);
  if (aggregateSha256(items) !== ledger.aggregateSha256) errors.push(`legacy ${prefix}: content digest changed; add qualified content review instead of silently grandfathering`);
}

export function loadAndValidateRepository(root = DEFAULT_ROOT) {
  const errors = [];
  const lessonDir = join(root, 'data', 'lessons');
  const lessonFiles = existsSync(lessonDir) ? readdirSync(lessonDir).filter((file) => file.endsWith('.json') && file !== 'index.json').sort() : [];
  const lessons = lessonFiles.map((file) => ({ file, value: readJson(join(lessonDir, file), errors, `data/lessons/${file}`) })).filter((entry) => entry.value);
  lessons.forEach(({ file, value }) => validateLesson(value, file, errors));
  const lessonIds = lessons.map(({ value }) => value.slug);
  const duplicateLessonIds = lessonIds.filter((id, index) => lessonIds.indexOf(id) !== index);
  if (duplicateLessonIds.length) errors.push(`lessons: duplicate slugs ${[...new Set(duplicateLessonIds)].sort().join(', ')}`);

  const tasksDoc = readJson(join(root, 'data', 'home-tasks.json'), errors, 'data/home-tasks.json');
  if (!isObject(tasksDoc) || tasksDoc.schema !== 1 || !Number.isInteger(tasksDoc.version) || !Array.isArray(tasksDoc.tasks) || tasksDoc.tasks.length === 0) {
    errors.push('data/home-tasks.json: expected schema=1, integer version, and non-empty tasks');
  }
  if (isObject(tasksDoc)) validateKeys(tasksDoc, new Set(['schema', 'version', 'taskAliases', 'tasks']), 'data/home-tasks.json', errors);
  const tasks = Array.isArray(tasksDoc?.tasks) ? tasksDoc.tasks : [];
  tasks.forEach((task, index) => validateTask(task, index, errors));
  const taskIds = tasks.map((task) => task.id);
  const duplicateTaskIds = taskIds.filter((id, index) => taskIds.indexOf(id) !== index);
  if (duplicateTaskIds.length) errors.push(`tasks: duplicate IDs ${[...new Set(duplicateTaskIds)].sort().join(', ')}`);

  const migrations = readJson(join(root, 'data', 'task-id-migrations.json'), errors, 'data/task-id-migrations.json');
  if (!isObject(migrations) || migrations.schema !== 1 || !isObject(migrations.aliases)) errors.push('data/task-id-migrations.json: expected schema=1 and aliases object');
  else {
    validateKeys(migrations, new Set(['schema', 'aliases', 'note']), 'data/task-id-migrations.json', errors);
    requireString(migrations.note, 'data/task-id-migrations.json.note', errors);
    for (const [oldId, currentId] of Object.entries(migrations.aliases)) {
    if (oldId === currentId || taskIds.includes(oldId) || !taskIds.includes(currentId)) errors.push(`task alias ${oldId}: must map absent legacy ID to a current canonical ID`);
    }
    if (canonicalJson(tasksDoc?.taskAliases) !== canonicalJson(migrations.aliases)) errors.push('data/home-tasks.json.taskAliases: must match task-id-migrations.json');
  }

  const ledger = readJson(join(root, 'data', 'review', 'legacy-approved.json'), errors, 'data/review/legacy-approved.json');
  const legacyLessons = lessons.map(({ value }) => value).filter((lesson) => lesson.verified === true && lesson.review?.status !== 'approved');
  const legacyTasks = tasks.filter((task) => task.review === undefined);
  const remediationTasks = tasks.filter((task) => task.review?.status === 'safety-remediated-unreviewed');
  compareLegacyGroup({ items: legacyLessons, ledger: ledger?.lessons, prefix: 'lessons', errors });
  compareLegacyGroup({ items: legacyTasks, ledger: ledger?.tasks, prefix: 'tasks', errors });
  const remediationLedger = readJson(join(root, 'data', 'review', 'task-safety-remediations.json'), errors, 'data/review/task-safety-remediations.json');
  compareLegacyGroup({ items: remediationTasks, ledger: remediationLedger?.tasks, prefix: 'task safety remediations', errors });

  const publishedLessons = lessons.map(({ value }) => value).filter((lesson) => lesson.verified === true);
  return { errors: errors.sort(), lessons: lessons.map(({ value }) => value), publishedLessons, tasks, tasksDoc, migrations };
}

export function assertValidRepository(root = DEFAULT_ROOT) {
  const result = loadAndValidateRepository(root);
  if (result.errors.length) throw new Error(`Content validation failed:\n${result.errors.map((error) => ` - ${error}`).join('\n')}`);
  return result;
}

export function buildLessonIndex(lessons) {
  const kinds = Object.fromEntries([...KINDS].sort().map((kind) => [kind, lessons.filter((lesson) => lesson.kind === kind).length]));
  return {
    schema: 1,
    count: lessons.length,
    kinds,
    lessons: lessons.map(({ slug, system, title, question, kind }) => ({ slug, system, title, question, kind })),
  };
}

export const repoRoot = DEFAULT_ROOT;
