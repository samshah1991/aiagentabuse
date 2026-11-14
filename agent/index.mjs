#!/usr/bin/env node
// Evidence agent. Usage: node agent/index.mjs [--dry-run] [--category <id>] [--recheck]
// Needs ANTHROPIC_API_KEY (env only) and AGENT_ENABLED=true. See README: "Evidence agent".
import { parseArgs } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { dump } from 'js-yaml';
import { disabledReason, TokenBudget, BudgetExhaustedError, safeWrite, redact } from './guard.mjs';
import { searchCategory, fetchOne } from './search.mjs';
import { extractRecords, fill, mentionsCategory } from './extract.mjs';
import { validateEvidenceFile } from './schema.mjs';
import { openPullRequest, openPrCount, MAX_OPEN_PRS } from './pr.mjs';
import { readYaml, normUrl, contentHash } from './util.mjs';

export const MODEL = 'claude-sonnet-5-5'; // confirmed in the models overview docs
export const PROMPT_VERSIONS = { search: 'search.v1', extract: 'extract.v1', recheck: 'recheck.v1' };
const evidencePath = (id) => `data/evidence/${id}.yaml`;
const prompt = (n) => readFileSync(`agent/prompts/${n}.md`, 'utf8');
export const loadCategories = () => readYaml('data/categories.yaml');
const loadFile = (id) => (existsSync(evidencePath(id)) ? readYaml(evidencePath(id)) : { category: id, records: [] });
const lastAccessed = (f) => f.records.map((r) => r.source.accessed_date).sort().pop() ?? '';
const toYaml = (f) => `# Written only by the evidence agent, via pull request. A human approves by merging.\n# Records appear on the site only when status is "approved".\n${dump(f, { lineWidth: 100, noRefs: true })}`;
const checklistFor = (id) => (readYaml('data/defenses.yaml').find((d) => d.id === id)?.items ?? []).map((i) => `- ${i}`).join('\n');

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { values: o } = parseArgs({ args: argv, options: { 'dry-run': { type: 'boolean', default: false }, category: { type: 'string' }, recheck: { type: 'boolean', default: false } } });
  const env = deps.env ?? process.env; const log = deps.log ?? console.log;
  const off = disabledReason(env);
  if (off) { log(`Agent disabled: ${off}. Nothing ran.`); return { status: 'disabled' }; }

  const runDate = deps.now ?? new Date();
  const date = runDate.toISOString().slice(0, 10);
  const runId = runDate.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const all = loadCategories(); const ids = all.map((c) => c.id);
  if (o.category && !ids.includes(o.category)) throw new Error(`unknown category "${o.category}". Known: ${ids.join(', ')}`);
  const cats = (o.category ? all.filter((c) => c.id === o.category) : all).sort((a, b) => lastAccessed(loadFile(a.id)).localeCompare(lastAccessed(loadFile(b.id)))); // stalest first
  const client = deps.client ?? (env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null);
  if (!client) throw new Error('ANTHROPIC_API_KEY is not set. Add it as a repository secret (Settings > Secrets and variables > Actions).');

  const budget = new TokenBudget(env);
  const runLog = { run_id: runId, started_at: runDate.toISOString(), mode: o.recheck ? 'recheck' : 'search', dry_run: o['dry-run'], model: MODEL, prompt_versions: PROMPT_VERSIONS, token_cap: budget.max, tokens_used: 0, stop_reason: 'completed', categories: [] };
  const changed = new Map(); const proposals = []; const updates = [];

  try {
    for (const c of cats) {
      const file = loadFile(c.id);
      const entry = { id: c.id, sources_fetched: [], discarded: [], new_records: 0 };
      runLog.categories.push(entry);
      const vars = { category_title: c.title, risk: c.risk, hints: c.hints, checklist: checklistFor(c.id), today: date, url: '' };
      try {
        if (o.recheck) {
          for (const r of file.records.filter((x) => x.status === 'approved')) {
            const res = await fetchOne({ client, model: MODEL, budget, url: r.source.url, prompt: fill(prompt('recheck.v1'), { url: r.source.url }) });
            entry.sources_fetched.push(r.source.url);
            if (!res.ok) { r.status = 'needs_recheck'; updates.push({ id: r.id, change: `status -> needs_recheck (${res.reason})` }); changed.set(c.id, file); continue; }
            if (contentHash(res.page.text) === r.source.content_sha256) continue; // unchanged: touch nothing
            const x = await extractRecords({ client, model: MODEL, budget, category: c.id, runDate, pages: [res.page], instructions: fill(prompt('extract.v1'), vars) });
            const upd = x.records[0];
            if (!upd) { r.status = 'needs_recheck'; updates.push({ id: r.id, change: 'content changed and no longer verifiably supports the claim -> needs_recheck' }); }
            else { Object.assign(r, upd, { id: r.id, status: 'proposed' }); updates.push({ id: r.id, change: `content changed; re-extracted, score ${r.score} (${r.weight_label}), status -> proposed` }); }
            changed.set(c.id, file);
          }
        } else {
          const s = await searchCategory({ client, model: MODEL, budget, prompt: fill(prompt('search.v1'), vars) });
          const pages = s.pages.slice(0, 8);
          entry.sources_fetched = pages.map((p) => p.url);
          const keep = pages.filter((p) => mentionsCategory(p.text, c.keywords));
          for (const p of pages) if (!keep.includes(p)) entry.discarded.push({ url: p.url, reason: 'content does not mention the category' });
          const x = await extractRecords({ client, model: MODEL, budget, category: c.id, runDate, pages: keep, instructions: fill(prompt('extract.v1'), vars) });
          entry.discarded.push(...x.dropped);
          const urls = new Set(file.records.map((r) => normUrl(r.source.url))); const hashes = new Set(file.records.map((r) => r.source.content_sha256));
          const fresh = x.records.filter((r) => {
            const dup = urls.has(normUrl(r.source.url)) || hashes.has(r.source.content_sha256);
            if (dup) entry.discarded.push({ url: r.source.url, reason: 'duplicate of an existing record (url or content hash)' });
            return !dup;
          });
          if (fresh.length) { file.records.push(...fresh); changed.set(c.id, file); proposals.push(...fresh); entry.new_records = fresh.length; }
        }
      } catch (e) {
        if (e instanceof BudgetExhaustedError) throw e;
        entry.error = redact(e.message ?? e, env); // one failing category must not stop the rest
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetExhaustedError)) throw e;
    runLog.stop_reason = e.message; // stop the run, log the reason, keep what finished
  }
  if (runLog.stop_reason === 'completed' && budget.used >= budget.max) runLog.stop_reason = `completed, but token cap reached on the final call (${budget.used} of MAX_RUN_TOKENS=${budget.max})`;
  runLog.tokens_used = budget.used; runLog.finished_at = new Date().toISOString();

  for (const f of changed.values()) { const errs = validateEvidenceFile(f); if (errs.length) throw new Error(`refusing to write ${f.category}: ${errs[0]}`); }
  const attempted = runLog.categories.length; const failed = runLog.categories.filter((c) => c.error).length;
  const allFailed = attempted > 0 && failed === attempted;
  if (allFailed) runLog.stop_reason = 'every category failed; see errors';
  const out = report(runLog, proposals, updates);
  if (allFailed && !changed.size) { log(out); return { status: 'failed', runLog }; }
  if (o['dry-run']) { log(out); return { status: 'dry-run', runLog, proposals, updates, wouldWrite: [...changed.keys()].map(evidencePath) }; }
  if (!changed.size) { log(`${out}\nNothing to write.`); return { status: 'no-change', runLog }; }

  const title = `${o.recheck ? 'Evidence recheck' : 'Evidence proposals'}: ${date}`;
  const canOpen = deps.openPr || openPrCount() < MAX_OPEN_PRS;
  for (const [id, f] of changed) safeWrite(evidencePath(id), toYaml(f));
  runLog.files_changed = [...changed.keys()].map(evidencePath);
  safeWrite(`data/logs/agent-runs/${runId}.json`, redact(JSON.stringify(runLog, null, 2), env) + '\n');
  if (!canOpen) { log(`${out}\nFiles written locally, but ${MAX_OPEN_PRS}+ evidence-review PRs are already open. Review those first.`); return { status: 'pr-skipped', runLog }; }
  const pr = await (deps.openPr ?? openPullRequest)({ runId, title, body: prBody(runLog, proposals, updates, o.recheck) });
  log(`${out}\n${pr.url ?? JSON.stringify(pr)}`);
  return { status: 'pr', runLog, pr };
}

function report(runLog, proposals, updates) {
  const rows = proposals.map((r) => `${r.category.padEnd(18)} ${String(r.score)} ${r.weight_label.padEnd(9)} ${r.evidence_type.padEnd(13)} ${r.source.url}`);
  const unv = [...proposals, ...updates.map(() => null)].filter((r) => r?.unverified?.length).map((r) => `  ${r.id}: ${r.unverified.join(', ')}`);
  return [`Run ${runLog.run_id} (${runLog.mode}${runLog.dry_run ? ', dry run' : ''}) | tokens ${runLog.tokens_used}/${runLog.token_cap} | stop: ${runLog.stop_reason}`,
    proposals.length ? `\nProposed records:\ncategory           score label     type          source\n${rows.join('\n')}` : '\nNo new records.',
    unv.length ? `\nUnverified fields (set to null):\n${unv.join('\n')}` : '',
    updates.length ? `\nRecheck changes:\n${updates.map((u) => `  ${u.id}: ${u.change}`).join('\n')}` : '',
    runLog.categories.some((c) => c.error) ? `\nERRORS:\n${runLog.categories.filter((c) => c.error).map((c) => `  ${c.id}: ${c.error}`).join('\n')}` : '',
    `\nDiscarded: ${runLog.categories.reduce((n, c) => n + c.discarded.length, 0)} candidate(s)`].join('\n');
}
function prBody(runLog, proposals, updates, recheck) {
  const L = ['## Machine-generated. Human review required.', '', 'Created by the evidence agent. Nothing here is public until a human merges it, and **only records with `status: approved` appear on the site**. Scores come from `agent/score.mjs`; the model never sets them.', ''];
  if (proposals.length) {
    L.push('### New records (status: proposed)', '', '| Record | Score | Type | Source |', '|---|---|---|---|', ...proposals.map((r) => `| \`${r.id}\` | ${r.score} (${r.weight_label}) | ${r.evidence_type} | [${r.source.title.replace(/\|/g, '/')}](${r.source.url}) |`), '');
    const unv = proposals.filter((r) => r.unverified.length);
    L.push('### Unverified fields (set to null; not filled from memory)', '', ...(unv.length ? unv.map((r) => `- \`${r.id}\`: ${r.unverified.join(', ')}`) : ['- none']), '');
  }
  if (updates.length) L.push('### Recheck changes', '', ...updates.map((u) => `- \`${u.id}\`: ${u.change}`), '', 'To accept an update, change that record to `status: approved` in this PR before merging. A record merged as `proposed` or `needs_recheck` stays hidden from the site.', '');
  L.push('### How to review', '- Approve: set `status: approved` on each record you accept (edit the YAML), then merge. Delete or set `rejected` on the rest.',
    '- Open each source and confirm the claim. Check the booleans and `evidence_type`: they are model judgements that drive the score.',
    '- Reject the whole PR to discard everything.', '',
    `Run \`${runLog.run_id}\` · model \`${runLog.model}\` · prompts ${Object.values(runLog.prompt_versions).join(', ')} · tokens ${runLog.tokens_used}/${runLog.token_cap} · stop: ${runLog.stop_reason}`);
  return L.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((r) => { if (r.status === 'failed') process.exit(1); }).catch((e) => { console.error(`Error: ${redact(e.message)}`); process.exit(1); });
}
