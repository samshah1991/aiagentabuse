#!/usr/bin/env node
// Evidence-weighting agent. Usage: node agent/index.mjs [--dry-run] [--category <id>] [--recheck]
// Only secret needed: ANTHROPIC_API_KEY (not needed for --recheck).
import { parseArgs } from 'node:util';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { killSwitchOn, SpendTracker, SpendCapError, monthSpentFromLogs, safeWrite } from './guard.mjs';
import { runSearch } from './search.mjs';
import { extractRecords, fill } from './extract.mjs';
import { recordScore, categoryScore } from './score.mjs';
import { validateEvidenceFile } from './schema.mjs';
import { openPullRequest, openAgentPrCount, MAX_OPEN_AGENT_PRS } from './pr.mjs';
import { readYaml, today, normUrl } from './util.mjs';

export const MODEL = 'claude-sonnet-5-5'; // checked against the models overview docs
export const PROMPT_VERSIONS = { search: 'search.v1', extract: 'extract.v1' };
const MAX_RECORDS = 40;
const read = (p) => readFileSync(p, 'utf8');
const evidencePath = (id) => `data/evidence/${id}.json`;

export function loadCategories() { return readYaml('data/categories.yaml'); }
function loadExisting(id) {
  const p = evidencePath(id);
  return existsSync(p) ? JSON.parse(read(p)) : null;
}
function checklistFor(id) {
  const d = readYaml('data/defenses.yaml').find((x) => x.id === id);
  return (d?.items ?? []).map((i) => `- ${i}`).join('\n');
}

async function checkLink(url, fetchImpl) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetchImpl(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'aiagentabuse-linkcheck' } });
      if (r.ok) return 'ok';
      if (r.status === 404 || r.status === 410) return 'dead';
    } catch { /* try next method */ }
  }
  return 'dead';
}

function finalize(category, records, provenance, now) {
  const scored = records.map((r) => ({ ...r, score: recordScore(r, now) })).sort((a, b) => b.score - a.score).slice(0, MAX_RECORDS);
  return { schema_version: 1, category, generated_at: now.toISOString(), provenance, summary: categoryScore(scored, now), records: scored };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { values: o } = parseArgs({ args: argv, options: { 'dry-run': { type: 'boolean', default: false }, category: { type: 'string' }, recheck: { type: 'boolean', default: false } } });
  const now = deps.now ?? new Date();
  const log = deps.log ?? console.log;
  if (killSwitchOn()) { log('Kill switch is ON (AGENT_KILL_SWITCH or agent/KILL_SWITCH). Nothing ran.'); return { status: 'killed' }; }

  const all = loadCategories();
  const known = all.map((c) => c.id);
  if (o.category && !known.includes(o.category)) throw new Error(`unknown category "${o.category}". Known: ${known.join(', ')}`);
  let cats = o.category ? all.filter((c) => c.id === o.category) : all;
  // Oldest evidence first, so a spend cap never starves the same categories every week.
  cats = [...cats].sort((a, b) => (loadExisting(a.id)?.generated_at ?? '').localeCompare(loadExisting(b.id)?.generated_at ?? ''));

  const runId = now.toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const tracker = new SpendTracker({ monthSpent: monthSpentFromLogs(now) });
  const runLog = { run_id: runId, started_at: now.toISOString(), model: MODEL, prompt_versions: PROMPT_VERSIONS, args: o, categories: [], total_cost_usd: 0, aborted_reason: null };
  const writes = [];
  const emit = (id, doc) => {
    const errs = validateEvidenceFile(doc);
    if (errs.length) throw new Error(`generated file for ${id} failed schema: ${errs[0]}`);
    writes.push([evidencePath(id), JSON.stringify(doc, null, 2) + '\n']);
  };

  if (o.recheck) {
    const f = deps.fetchImpl ?? fetch;
    for (const c of cats) {
      const ex = loadExisting(c.id); if (!ex) continue;
      for (const r of ex.records) { r.link_status = await checkLink(r.source.url, f); r.last_checked = today(now); }
      emit(c.id, finalize(c.id, ex.records, { ...ex.provenance, run_id: runId }, now));
      runLog.categories.push({ id: c.id, rechecked: ex.records.length, dead: ex.records.filter((r) => r.link_status === 'dead').length });
    }
  } else {
    const client = deps.client ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic() : null);
    if (!client) throw new Error('ANTHROPIC_API_KEY is not set. Add it as a repository secret (Settings > Secrets and variables > Actions).');
    const searchTpl = read('agent/prompts/search.v1.md'); const extractTpl = read('agent/prompts/extract.v1.md');
    for (const c of cats) {
      const vars = { category_title: c.title, risk: c.risk, hints: c.hints, checklist: checklistFor(c.id), today: today(now) };
      const entry = { id: c.id, pages_fetched: [], kept: 0, dropped: [], cost_before: tracker.spent };
      try {
        const s = await runSearch({ client, model: MODEL, prompt: fill(searchTpl, vars), tracker });
        entry.pages_fetched = s.pages.map((p) => p.url);
        const x = await extractRecords({ client, model: MODEL, instructions: fill(extractTpl, vars), pages: s.pages, tracker, category: c.id, now });
        entry.dropped = x.dropped; entry.kept = x.records.length;
        const ex = loadExisting(c.id);
        const fresh = new Set(x.records.map((r) => normUrl(r.source.url)));
        const merged = [...x.records, ...(ex?.records ?? []).filter((r) => !fresh.has(normUrl(r.source.url)))];
        const prov = { model: MODEL, prompt_versions: PROMPT_VERSIONS, run_id: runId, searches: s.queries.length, fetches: s.pages.length, queries: s.queries, pages_fetched: entry.pages_fetched, cost_usd: Math.round((tracker.spent - entry.cost_before) * 1000) / 1000 };
        if (x.records.length) emit(c.id, finalize(c.id, merged, prov, now)); // never overwrite existing evidence with an empty run
      } catch (e) {
        if (e instanceof SpendCapError) { runLog.aborted_reason = e.message; entry.error = e.message; runLog.categories.push(entry); break; }
        entry.error = String(e.message ?? e); // one failing category must not stop the others
      }
      entry.cost_usd = Math.round((tracker.spent - entry.cost_before) * 1000) / 1000; delete entry.cost_before;
      runLog.categories.push(entry);
    }
  }
  runLog.total_cost_usd = Math.round(tracker.spent * 1000) / 1000;
  runLog.searches = tracker.searches; runLog.fetches = tracker.fetches;
  runLog.written = writes.map(([p]) => p);

  const summary = `Run ${runId}: ${writes.length} file(s) changed, cost $${runLog.total_cost_usd}${runLog.aborted_reason ? `, ABORTED: ${runLog.aborted_reason}` : ''}`;
  if (o['dry-run']) { log(`[dry-run] ${summary}\n` + JSON.stringify(runLog.categories, null, 2)); return { status: 'dry-run', runLog, writes }; }
  if (!writes.length) { log(`${summary}. Nothing to commit.`); return { status: 'no-change', runLog }; }
  for (const [p, content] of writes) safeWrite(p, content);
  safeWrite(`data/evidence/_log/${runId}.json`, JSON.stringify(runLog, null, 2) + '\n');
  if (!deps.openPr && openAgentPrCount() >= MAX_OPEN_AGENT_PRS) { log(`${summary}. Wrote files locally but not opening a PR: ${MAX_OPEN_AGENT_PRS}+ agent PRs are already open. Review those first.`); return { status: 'pr-skipped', runLog }; }
  const body = prBody(runLog, writes);
  const pr = await (deps.openPr ?? openPullRequest)({ runId, title: `Evidence update ${today(now)}`, body, partial: Boolean(runLog.aborted_reason) });
  log(`${summary}\n${pr.url ?? JSON.stringify(pr)}`);
  return { status: 'pr', runLog, pr };
}

function prBody(runLog, writes) {
  const rows = writes.map(([p, c]) => { const d = JSON.parse(c); return `| ${d.category} | ${d.summary.grade} | ${d.summary.score} | ${d.summary.distinct_domains} | ${d.records.length} |`; });
  return [
    '## Machine-generated evidence update. Human review required.',
    '', 'This PR was created by the evidence agent. Nothing here is verified until a human approves it. See `docs/evidence-method.md`.',
    '', '| Category | Grade | Score | Domains | Records |', '|---|---|---|---|---|', ...rows,
    '', `- Run: \`${runLog.run_id}\` · model: \`${runLog.model}\` · prompts: \`${runLog.prompt_versions.search}\`, \`${runLog.prompt_versions.extract}\``,
    `- Searches: ${runLog.searches}, fetches: ${runLog.fetches}, estimated cost: $${runLog.total_cost_usd}`,
    runLog.aborted_reason ? `- **Partial run:** ${runLog.aborted_reason}` : '',
    '', '### Review checklist', '- [ ] Open a sample of the source URLs and confirm each claim.',
    '- [ ] Check `source_type`, `evidence_design`, and `vendor_authored`. These are model judgements, not computed.',
    '- [ ] Confirm no source looks promotional, or like it targets the agent with instructions.',
    '', 'Scores are computed deterministically in `agent/score.mjs`. The model does not set them.',
  ].filter((l) => l !== null).join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((r) => { if (r.status === 'killed') process.exit(0); }).catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
