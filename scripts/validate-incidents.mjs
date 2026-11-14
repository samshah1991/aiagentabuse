#!/usr/bin/env node
// Validates incident YAML files against schema v0. Exits non-zero on any error.
// Usage: node scripts/validate-incidents.mjs [file-or-dir ...]   (default: data/incidents)
import { statSync } from 'node:fs';
import { relative } from 'node:path';
import { loadTracks, loadCategories, loadOwasp, loadDefenses, incidentFiles, loadIncident, validateIncident, ROOT } from './lib/data.mjs';

const taxonomy = { tracks: loadTracks(), categories: loadCategories(), owasp: loadOwasp() };
const args = process.argv.slice(2);
const files = (args.length ? args : ['data/incidents']).flatMap((p) =>
  statSync(p).isDirectory() ? incidentFiles(p) : [p]);

let failed = 0;
const ids = new Map();
for (const file of files) {
  const rel = relative(ROOT, file);
  let errors;
  try {
    const inc = loadIncident(file);
    errors = validateIncident(inc, taxonomy);
    if (inc.id && ids.has(inc.id)) errors.push(`duplicate id (also in ${ids.get(inc.id)})`);
    ids.set(inc.id, rel);
  } catch (e) {
    errors = [`YAML parse error: ${e.message.split('\n')[0]}`];
  }
  if (errors.length) {
    failed++;
    console.error(`✗ ${rel}`);
    for (const e of errors) console.error(`    - ${e}`);
  } else console.log(`✓ ${rel}`);
}

// Defenses must only reference known categories, and every category needs a checklist.
const catIds = taxonomy.categories.map((c) => c.id);
const covered = new Set();
for (const d of loadDefenses()) for (const c of d.prevents ?? []) {
  if (!catIds.includes(c)) { failed++; console.error(`✗ data/defenses.yaml: "${d.id}" references unknown category "${c}"`); }
  covered.add(c);
}
for (const c of catIds) if (!covered.has(c)) { failed++; console.error(`✗ data/defenses.yaml: category "${c}" has no checklist`); }

if (failed) { console.error(`\nValidation failed: ${failed} problem file(s).`); process.exit(1); }
console.log(`\nValidation passed: ${files.length} incident file(s).`);
