// Shared data loader and validator. Used by the build-time validator and by the Astro site.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { load, CORE_SCHEMA } from 'js-yaml';

// Resolved from the working directory: npm scripts and Astro always run from the repo root.
export const ROOT = resolve(process.cwd());
export const DATA = join(ROOT, 'data');

const yaml = (file) => load(readFileSync(file, 'utf8'), { schema: CORE_SCHEMA });

export const loadTracks = () => yaml(join(DATA, 'taxonomy', 'tracks.yaml'));
export const loadCategories = () => yaml(join(DATA, 'taxonomy', 'categories.yaml'));
export const loadOwasp = () => yaml(join(DATA, 'taxonomy', 'owasp.yaml'));
export const loadDefenses = () => yaml(join(DATA, 'defenses.yaml'));

export const incidentFiles = (dir = join(DATA, 'incidents')) =>
  readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => join(dir, f));

export const loadIncident = (file) => ({ ...yaml(file), _file: file });

export function loadIncidents(dir) {
  return incidentFiles(dir)
    .map(loadIncident)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export const REQUIRED = [
  'id', 'title', 'track', 'category', 'date', 'agent_or_product', 'summary',
  'impact', 'severity', 'sources', 'verification_status', 'last_reviewed',
];
export const OPTIONAL = ['owasp_id', 'vendor'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const STATUSES = ['draft', 'verified', 'corrected'];

const isDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const isUrl = (v) => { try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } };
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** Returns a list of error strings for one incident object. */
export function validateIncident(inc, { tracks, categories, owasp }) {
  const errors = [];
  const trackIds = tracks.map((t) => t.id);
  const owaspIds = owasp.map((o) => o.id);

  for (const f of REQUIRED) if (blank(inc[f])) errors.push(`missing required field "${f}"`);
  for (const k of Object.keys(inc)) {
    if (k !== '_file' && !REQUIRED.includes(k) && !OPTIONAL.includes(k)) errors.push(`unknown field "${k}"`);
  }
  if (!blank(inc.id) && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(inc.id)) errors.push('id must be lowercase kebab-case');
  if (inc._file && !blank(inc.id) && basename(inc._file).replace(/\.ya?ml$/, '') !== inc.id) {
    errors.push(`id "${inc.id}" must match the file name`);
  }
  if (!blank(inc.track) && !trackIds.includes(inc.track)) {
    errors.push(`invalid track "${inc.track}" (allowed: ${trackIds.join(', ')})`);
  }
  if (!blank(inc.category)) {
    const cat = categories.find((c) => c.id === inc.category);
    if (!cat) errors.push(`unknown category "${inc.category}"`);
    else if (trackIds.includes(inc.track) && cat.track !== inc.track) {
      errors.push(`category "${inc.category}" belongs to track "${cat.track}", not "${inc.track}"`);
    }
  }
  if (!blank(inc.owasp_id) && !owaspIds.includes(inc.owasp_id)) errors.push(`unknown owasp_id "${inc.owasp_id}"`);
  for (const f of ['date', 'last_reviewed']) {
    if (!blank(inc[f]) && !isDate(inc[f])) errors.push(`${f} must be a quoted YYYY-MM-DD date`);
  }
  if (!blank(inc.severity) && !SEVERITIES.includes(inc.severity)) errors.push(`invalid severity "${inc.severity}"`);
  if (!blank(inc.verification_status) && !STATUSES.includes(inc.verification_status)) {
    errors.push(`invalid verification_status "${inc.verification_status}"`);
  }
  if (!blank(inc.summary) && typeof inc.summary === 'string') {
    const sentences = inc.summary.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;
    if (sentences < 2 || sentences > 4) errors.push(`summary must be 2-4 sentences (found ${sentences})`);
  }
  if (!blank(inc.sources)) {
    if (!Array.isArray(inc.sources)) errors.push('sources must be a list');
    else inc.sources.forEach((s, i) => {
      if (!s || typeof s !== 'object') return errors.push(`sources[${i}] must be an object`);
      if (blank(s.title)) errors.push(`sources[${i}].title is required`);
      if (!isUrl(s.url)) errors.push(`sources[${i}].url must be an http(s) URL`);
      if (!isDate(s.accessed)) errors.push(`sources[${i}].accessed must be a quoted YYYY-MM-DD date`);
    });
  }
  if (inc.verification_status === 'verified' && Array.isArray(inc.sources) &&
      inc.sources.some((s) => /example\.com|TODO/i.test(`${s?.url} ${s?.title}`))) {
    errors.push('a verified incident cannot have placeholder sources');
  }
  return errors;
}

// Evidence summary for a defense category, if the evidence agent has produced one that a human merged.
export const loadEvidence = (id) => {
  const f = join(DATA, 'evidence', `${id}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};
