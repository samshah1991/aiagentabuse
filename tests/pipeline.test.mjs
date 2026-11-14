import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { load, dump } from 'js-yaml';

const SRC = process.cwd();
const sandbox = mkdtempSync(join(tmpdir(), 'pipe-'));
mkdirSync(join(sandbox, 'data'), { recursive: true });
cpSync(join(SRC, 'data/categories.yaml'), join(sandbox, 'data/categories.yaml'));
cpSync(join(SRC, 'data/defenses.yaml'), join(sandbox, 'data/defenses.yaml'));
cpSync(join(SRC, 'agent/prompts'), join(sandbox, 'agent/prompts'), { recursive: true });
process.chdir(sandbox);
const { main } = await import(join(SRC, 'agent/index.mjs'));

const KEY = 'sk-ant-api03-TESTKEYSECRET123';
const ENV = { AGENT_ENABLED: 'true', ANTHROPIC_API_KEY: KEY };
const NOW = new Date('2026-11-14T03:00:00Z');
const GOOD = 'A prompt injection benchmark found that spotlighting reduced attack success from fifty percent to two percent across the tested agent suite. Code and data are public.';
const OFFTOPIC = 'A cooking blog about sourdough starters and baking temperatures for the weekend.';
const LONG = 'prompt injection ' + Array.from({ length: 30 }, (_, i) => `copiedword${i}`).join(' ');
const pages = { 'https://a.example/good': GOOD, 'https://b.example/offtopic': OFFTOPIC, 'https://c.example/score': GOOD + ' extra c', 'https://d.example/long': LONG };
const rec = (url, o = {}) => ({ source_url: url, claim: 'Spotlighting cut attack success in the tested agent suite.', evidence_type: 'benchmark', support_quote: 'spotlighting reduced attack success from fifty percent to two percent', published_date: '2026-06', code_or_data_public: true, independently_replicated: null, evaluated_product_owner_is_author: false, limitations: 'Only one agent suite was tested.', ...o });
const MODEL_JSON = { records: [rec('https://a.example/good'), rec('https://c.example/score', { score: 5 }), { ...rec('https://d.example/long'), claim: 'Copies words.', support_quote: 'copiedword0 copiedword1 copiedword2 copiedword3', limitations: Array.from({ length: 20 }, (_, i) => `copiedword${i}`).join(' ') + '.' }] };

function mock({ fetchMode = 'normal', usage = { input_tokens: 1000, output_tokens: 100 }, records = MODEL_JSON } = {}) {
  const calls = { search: 0, fetch: 0, extract: 0 };
  return { calls, messages: { create: async (p) => {
    if (p.tools?.length === 2) { calls.search++; return { stop_reason: 'end_turn', usage, content: Object.entries(pages).map(([url, data]) => ({ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url, content: { title: 'T ' + url, source: { type: 'text', data } } } })) }; }
    if (p.tools?.length === 1) { calls.fetch++; const url = /https?:\/\/\S+/.exec(p.messages[0].content)[0];
      if (fetchMode === 'error') return { stop_reason: 'end_turn', usage, content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } }] };
      return { stop_reason: 'end_turn', usage, content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_result', url, content: { title: 'T', source: { type: 'text', data: fetchMode === 'changed' ? GOOD + ' now updated' : GOOD } } } }] }; }
    calls.extract++; return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: JSON.stringify(records) }] };
  } } };
}
const tree = (d = '.') => existsSync(d) ? readdirSync(d, { recursive: true }).map(String).filter((f) => statSync(join(d, f)).isFile()).sort() : [];
const noop = () => {};

test('kill switch: nothing runs and no API call is made', async () => {
  const c = mock();
  for (const env of [{ ...ENV, AGENT_ENABLED: undefined }, { ...ENV, AGENT_ENABLED: 'false' }]) {
    const r = await main(['--dry-run', '--category', 'untrusted-content'], { client: c, env, now: NOW, log: noop });
    assert.equal(r.status, 'disabled');
  }
  assert.deepEqual(c.calls, { search: 0, fetch: 0, extract: 0 });
});
test('dry run: proposes records, verifies, scores deterministically, writes NOTHING', async () => {
  const before = tree('.'); const out = [];
  const r = await main(['--dry-run', '--category', 'untrusted-content'], { client: mock(), env: ENV, now: NOW, log: (m) => out.push(m) });
  assert.equal(r.status, 'dry-run');
  assert.deepEqual(tree('.'), before, 'dry run must not write to disk');
  assert.equal(r.proposals.length, 1); // off-topic page discarded, model-scored record rejected, long copy rejected
  const p = r.proposals[0];
  assert.equal(p.score, 4); assert.equal(p.weight_label, 'good'); // benchmark 3 + public code 1, recent, author false
  assert.equal(p.status, 'proposed');
  assert.ok(p.unverified.includes('independently_replicated'));
  assert.match(p.source.content_sha256, /^[0-9a-f]{64}$/);
  const why = r.runLog.categories[0].discarded.map((d) => d.reason).join(' | ');
  assert.match(why, /does not mention the category/); assert.match(why, /schema/); assert.match(why, /copies more than 15 words/);
  assert.match(out.join('\n'), /Proposed records/);
});
test('real run: writes only allowlisted files, never the API key, opens one PR', async () => {
  let prCalls = 0; let prArgs;
  const r = await main(['--category', 'untrusted-content'], { client: mock(), env: ENV, now: NOW, log: noop, openPr: async (a) => { prCalls++; prArgs = a; return { url: 'https://example/pr/1' }; } });
  assert.equal(r.status, 'pr'); assert.equal(prCalls, 1);
  assert.equal(prArgs.title, 'Evidence proposals: 2026-11-14');
  const files = tree('data');
  const extra = files.filter((f) => !/^(categories|defenses)\.yaml$/.test(f));
  assert.ok(extra.every((f) => f.startsWith('evidence/') || f.startsWith('logs/agent-runs/')), extra.join(', '));
  assert.ok(extra.some((f) => f === 'evidence/untrusted-content.yaml'));
  for (const f of files) assert.ok(!readFileSync(join('data', f), 'utf8').includes(KEY), `key leaked in ${f}`);
  assert.match(prArgs.body, /Unverified fields/); assert.match(prArgs.body, /good/);
  const doc = load(readFileSync('data/evidence/untrusted-content.yaml', 'utf8'));
  assert.equal(doc.records[0].status, 'proposed');
});
test('dedup: second run proposes nothing new', async () => {
  const r = await main(['--category', 'untrusted-content'], { client: mock(), env: ENV, now: NOW, log: noop, openPr: async () => assert.fail('no PR expected') });
  assert.equal(r.status, 'no-change');
  assert.match(r.runLog.categories[0].discarded.map((d) => d.reason).join(' '), /duplicate/);
});
test('token cap stops the run and logs the reason', async () => {
  const r = await main(['--dry-run', '--category', 'untrusted-content'], { client: mock({ usage: { input_tokens: 500, output_tokens: 0 } }), env: { ...ENV, MAX_RUN_TOKENS: '100' }, now: NOW, log: noop });
  assert.match(r.runLog.stop_reason, /token cap reached/);
  assert.equal(r.proposals.length, 0);
});
test('recheck: never changes approved records silently; error -> needs_recheck; changed -> proposed update', async () => {
  const f = 'data/evidence/untrusted-content.yaml';
  const doc = load(readFileSync(f, 'utf8')); doc.records[0].status = 'approved'; writeFileSync(f, dump(doc));
  const opened = [];
  const openPr = async (a) => { opened.push(a); return { url: 'https://example/pr/2' }; };
  // unchanged content: nothing is touched, no PR
  let r = await main(['--recheck', '--category', 'untrusted-content'], { client: mock({ fetchMode: 'normal' }), env: ENV, now: NOW, log: noop, openPr });
  assert.equal(r.status, 'no-change'); assert.equal(load(readFileSync(f, 'utf8')).records[0].status, 'approved');
  // error
  r = await main(['--recheck', '--category', 'untrusted-content'], { client: mock({ fetchMode: 'error' }), env: ENV, now: NOW, log: noop, openPr });
  assert.equal(load(readFileSync(f, 'utf8')).records[0].status, 'needs_recheck');
  assert.match(opened.at(-1).title, /^Evidence recheck: /);
  // changed content: re-extracted and proposed in a PR
  const d2 = load(readFileSync(f, 'utf8')); d2.records[0].status = 'approved'; writeFileSync(f, dump(d2));
  const oldHash = d2.records[0].source.content_sha256;
  const changedRecords = { records: [rec('https://a.example/good')] };
  const m = mock({ fetchMode: 'changed', records: changedRecords });
  const pg = { ...pages }; // extraction needs the new text to contain the quote: it does (GOOD + suffix)
  r = await main(['--recheck', '--category', 'untrusted-content'], { client: m, env: ENV, now: NOW, log: noop, openPr });
  const rec2 = load(readFileSync(f, 'utf8')).records[0];
  assert.equal(rec2.status, 'proposed'); assert.notEqual(rec2.source.content_sha256, oldHash);
  assert.match(opened.at(-1).body, /status: approved/);
});
test('API failure is reported loudly, not as "no new records"', async () => {
  const broken = { messages: { create: async () => { throw new Error('connection refused (sk-ant-api03-TESTKEYSECRET123)'); } } };
  const out = [];
  const r = await main(['--dry-run', '--category', 'untrusted-content'], { client: broken, env: ENV, now: NOW, log: (m) => out.push(m) });
  assert.equal(r.status, 'failed');
  assert.match(out.join('\n'), /ERRORS/); assert.ok(!out.join('\n').includes(KEY), 'key must be redacted');
});
