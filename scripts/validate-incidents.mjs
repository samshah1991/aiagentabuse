#!/usr/bin/env node
// Validates incident YAML files against schema v0. Exits non-zero on any error.
// Usage: node scripts/validate-incidents.mjs [file-or-dir ...]   (default: data/incidents)
import { statSync } from 'node:fs';
import { relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readYaml } from '../agent/util.mjs';
import { validateEvidenceFile } from '../agent/schema.mjs';
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

// data/categories.yaml (agent research targets) must match data/defenses.yaml; evidence files must match the schema.
const defIds = loadDefenses().map((d) => d.id);
const agentIds = readYaml('data/categories.yaml').map((c) => c.id);
for (const id of defIds) if (!agentIds.includes(id)) { failed++; console.error(`✗ data/categories.yaml: missing defense "${id}"`); }
for (const id of agentIds) if (!defIds.includes(id)) { failed++; console.error(`✗ data/categories.yaml: "${id}" is not in data/defenses.yaml`); }
if (existsSync('data/evidence')) for (const f of readdirSync('data/evidence').filter((x) => x.endsWith('.json'))) {
  try {
    const doc = JSON.parse(readFileSync(`data/evidence/${f}`, 'utf8'));
    const errs = validateEvidenceFile(doc);
    if (f !== `${doc.category}.json`) errs.push('file name must match category');
    if (!defIds.includes(doc.category)) errs.push(`unknown category "${doc.category}"`);
    if (errs.length) { failed++; console.error(`✗ data/evidence/${f}`); errs.slice(0, 5).forEach((e) => console.error(`    - ${e}`)); }
    else console.log(`✓ data/evidence/${f}`);
  } catch (e) { failed++; console.error(`✗ data/evidence/${f}: ${e.message}`); }
}

if (failed) { console.error(`\nValidation failed: ${failed} problem file(s).`); process.exit(1); }
console.log(`\nValidation passed: ${files.length} incident file(s).`);
