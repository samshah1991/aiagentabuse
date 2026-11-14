import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWritable, killSwitchOn, SpendTracker, SpendCapError, pathsAllowed } from '../guard.mjs';
import { recordScore, categoryScore, recencyFactor } from '../score.mjs';
import { validateModelRecord, validateEvidenceFile } from '../schema.mjs';
import { extractRecords, parseJson } from '../extract.mjs';
import { main, loadCategories } from '../index.mjs';

const NOW = new Date('2026-11-14T00:00:00Z');
const rec = (o = {}) => ({
  id: 'x-1', category: 'x', claim: 'A defense reduced attack success in a benchmark.', defense: 'd', finding_direction: 'supports',
  evidence_design: 'benchmark_or_controlled', metrics: null, limitations: null,
  source: { url: 'https://arxiv.org/abs/1', title: 't', publisher: null, published: '2026-06', source_type: 'peer_reviewed', vendor_authored: false },
  quote: 'quote text that is long enough', quote_verified: true, link_status: 'ok', last_checked: '2026-11-14', score: 0, ...o,
});

test('guard: only data/evidence is writable', () => {
  assert.doesNotThrow(() => assertWritable('data/evidence/a.json'));
  assert.doesNotThrow(() => assertWritable('data/evidence/_log/r.json'));
  for (const bad of ['data/incidents/a.yaml', 'src/pages/index.astro', '../x', '/etc/passwd', 'data/evidence/../incidents/a.yaml', '.github/workflows/evidence.yml', 'agent/index.mjs'])
    assert.throws(() => assertWritable(bad), `should block ${bad}`);
  assert.equal(pathsAllowed(['data/evidence/a.json', 'package.json']), false);
});
test('guard: kill switch', () => {
  assert.equal(killSwitchOn({ AGENT_KILL_SWITCH: 'on' }, mkdtempSync(join(tmpdir(), 'k-'))), true);
  assert.equal(killSwitchOn({}, mkdtempSync(join(tmpdir(), 'k-'))), false);
  const d = mkdtempSync(join(tmpdir(), 'k-')); mkdirSync(join(d, 'agent')); writeFileSync(join(d, 'agent/KILL_SWITCH'), '');
  assert.equal(killSwitchOn({}, d), true); // file-based switch
});
test('guard: spend cap stops further calls', () => {
  const t = new SpendTracker({ runUsd: 0.01, monthUsd: 50 }, {});
  t.assertBudget();
  t.add('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.throws(() => t.assertBudget(), SpendCapError);
  const m = new SpendTracker({ runUsd: 10, monthUsd: 1, monthSpent: 1 }, {});
  assert.throws(() => m.assertBudget(), SpendCapError);
});
test('score: deterministic and bounded', () => {
  const a = recordScore(rec(), NOW);
  assert.equal(a, recordScore(rec(), NOW));
  assert.equal(a, 100);
  assert.equal(recordScore(rec({ link_status: 'dead' }), NOW), 0);
  assert.equal(recordScore(rec({ quote_verified: false }), NOW), 0);
  assert.equal(recordScore(rec({ source: { ...rec().source, vendor_authored: true } }), NOW), 60);
  assert.equal(recordScore(rec({ evidence_design: 'guidance_or_opinion' }), NOW), 30);
  assert.equal(recencyFactor('2020-01-01', NOW), 0.5);
  assert.equal(recencyFactor(null, NOW), 0.5);
});
test('score: corroboration needs distinct domains', () => {
  const same = [rec(), rec({ id: 'x-2' })];
  assert.equal(categoryScore(same, NOW).distinct_domains, 1);
  assert.equal(categoryScore(same, NOW).grade, 'weak'); // 1 domain: 100 * 1/3 = 33.3, capped to weak
  const three = ['arxiv.org', 'nist.gov', 'acm.org'].map((h, i) => rec({ id: `x-${i}`, source: { ...rec().source, url: `https://${h}/p` } }));
  const s = categoryScore(three, NOW);
  assert.equal(s.score, 100); assert.equal(s.grade, 'strong');
  assert.equal(categoryScore([], NOW).grade, 'insufficient');
});
test('schema: rejects bad model records', () => {
  const good = { source_url: 'https://a.com/x', claim: 'A paraphrased claim sentence.', defense: 'sandboxing', finding_direction: 'supports', quote: 'a verbatim quote of sufficient length', source_type: 'preprint', evidence_design: 'case_study', vendor_authored: false };
  assert.deepEqual(validateModelRecord(good), []);
  assert.notEqual(validateModelRecord({ ...good, source_type: 'blogspam' }).length, 0);
  assert.notEqual(validateModelRecord({ ...good, score: 100 }).length, 0); // model may not set a score
  assert.notEqual(validateModelRecord({ ...good, source_url: 'javascript:alert(1)' }).length, 0);
});

const PAGE = 'Our benchmark shows that spotlighting reduced attack success from 50 percent to 2 percent in the tested agent suite.';
const client = (extractRecordsJson) => ({
  messages: {
    create: async (p) => p.tools
      ? { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 1, web_fetch_requests: 1 } },
          content: [{ type: 'server_tool_use', name: 'web_search', input: { query: 'q' } },
            { type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url: 'https://arxiv.org/abs/2', retrieved_at: null, content: { title: 'Paper', source: { type: 'text', data: PAGE } } } },
            { type: 'text', text: 'https://arxiv.org/abs/2' }] }
      : { stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify({ records: extractRecordsJson }) }] },
  },
});
const base = { source_url: 'https://arxiv.org/abs/2', claim: 'Spotlighting cut attack success in the tested suite.', defense: 'spotlighting', finding_direction: 'supports', quote: 'spotlighting reduced attack success from 50 percent to 2 percent', source_type: 'preprint', evidence_design: 'benchmark_or_controlled', vendor_authored: false, published: '2026-09' };

test('extract: drops invented urls and unverifiable quotes', async () => {
  const pages = [{ url: 'https://arxiv.org/abs/2', title: 'Paper', text: PAGE }];
  const c = client([base, { ...base, source_url: 'https://evil.example/x' }, { ...base, quote: 'a fabricated sentence that is not on the page' }]);
  const r = await extractRecords({ client: c, model: 'claude-sonnet-5-5', instructions: 'x', pages, tracker: new SpendTracker({}, {}), category: 'x', now: NOW });
  assert.equal(r.records.length, 1);
  assert.deepEqual(r.dropped.map((d) => d.reason).sort(), ['quote not found verbatim in page', 'url was not fetched in this run']);
});
test('extract: tolerates code fences', () => assert.deepEqual(parseJson('```json\n{"records": []}\n```'), { records: [] }));

test('pipeline dry-run end to end with mock client', async () => {
  const logs = [];
  const r = await main(['--dry-run', '--category', 'untrusted-content'], { client: client([base]), now: NOW, log: (m) => logs.push(m) });
  assert.equal(r.status, 'dry-run');
  assert.equal(r.writes.length, 1);
  const doc = JSON.parse(r.writes[0][1]);
  assert.deepEqual(validateEvidenceFile(doc), []);
  assert.equal(doc.provenance.model, 'claude-sonnet-5-5');
  assert.deepEqual(doc.provenance.prompt_versions, { search: 'search.v1', extract: 'extract.v1' });
  assert.equal(doc.records[0].quote_verified, true);
  assert.ok(doc.records[0].score > 0 && doc.summary.score >= 0);
});
test('pipeline aborts cleanly when spend cap is hit', async () => {
  process.env.AGENT_RUN_CAP_USD = '0.0001';
  try {
    const r = await main(['--dry-run', '--category', 'untrusted-content'], { client: client([base]), now: NOW, log: () => {} });
    assert.match(r.runLog.aborted_reason, /spend cap/);
    assert.equal(r.writes.length, 0); // nothing half-written after an abort before extraction
  } finally { delete process.env.AGENT_RUN_CAP_USD; }
});
test('unknown category is rejected', async () => {
  await assert.rejects(main(['--dry-run', '--category', 'nope'], { client: client([]), log: () => {} }), /unknown category/);
});
test('categories.yaml covers all 8 defenses', () => assert.equal(loadCategories().length, 8));
