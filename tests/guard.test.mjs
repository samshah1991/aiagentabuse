import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWritable, pathsAllowed, disabledReason, TokenBudget, BudgetExhaustedError, hasLongQuote, redact, DEFAULT_MAX_RUN_TOKENS } from '../agent/guard.mjs';

test('writes allowed only under data/evidence and data/logs/agent-runs', () => {
  for (const ok of ['data/evidence/x.yaml', 'data/logs/agent-runs/r.json']) assert.doesNotThrow(() => assertWritable(ok));
  for (const bad of ['data/incidents/a.yaml', 'data/logs/other.json', 'data/evidence', 'src/pages/index.astro', 'agent/guard.mjs', '.github/workflows/evidence-agent.yml', '../x', '/etc/passwd', 'data/evidence/../incidents/a.yaml', 'data/evidencex/a.yaml'])
    assert.throws(() => assertWritable(bad), `should block ${bad}`);
  assert.equal(pathsAllowed(['data/evidence/a.yaml', 'package.json']), false);
  assert.equal(pathsAllowed(['data/evidence/a.yaml', 'data/logs/agent-runs/r.json']), true);
});
test('kill switch: AGENT_ENABLED must be exactly "true"', () => {
  const root = mkdtempSync(join(tmpdir(), 'g-'));
  assert.equal(disabledReason({ AGENT_ENABLED: 'true' }, root), null);
  for (const v of [undefined, '', 'false', 'TRUE', '1']) assert.match(disabledReason({ AGENT_ENABLED: v }, root), /AGENT_ENABLED/);
});
test('kill switch: .agent-disabled file wins even when enabled', () => {
  const root = mkdtempSync(join(tmpdir(), 'g-'));
  writeFileSync(join(root, '.agent-disabled'), '');
  assert.match(disabledReason({ AGENT_ENABLED: 'true' }, root), /\.agent-disabled/);
});
test('spend cap: default 300000, env override, stops at the cap', () => {
  assert.equal(new TokenBudget({}).max, DEFAULT_MAX_RUN_TOKENS);
  assert.equal(DEFAULT_MAX_RUN_TOKENS, 300000);
  assert.equal(new TokenBudget({ MAX_RUN_TOKENS: '1000' }).max, 1000);
  assert.equal(new TokenBudget({ MAX_RUN_TOKENS: 'abc' }).max, 300000);
  const b = new TokenBudget({ MAX_RUN_TOKENS: '1000' });
  b.assertBudget();
  b.add({ input_tokens: 600, output_tokens: 100 }); b.assertBudget();
  b.add({ input_tokens: 200, cache_read_input_tokens: 100 });
  assert.equal(b.used, 1000);
  assert.throws(() => b.assertBudget(), BudgetExhaustedError);
});
test('quote limit: 15 words ok, 16 rejected', () => {
  const src = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau';
  const w = src.split(' ');
  assert.equal(hasLongQuote(w.slice(0, 15).join(' '), src), false);
  assert.equal(hasLongQuote(`ours ${w.slice(0, 16).join(' ')} ours`, src), true);
  assert.equal(hasLongQuote('a completely different sentence about something else entirely and unrelated text', src), false);
});
test('redact removes API keys', () => {
  assert.equal(redact('key sk-ant-api03-abcdefgh1234 end', {}), 'key [REDACTED] end');
  assert.equal(redact('token=supersecretvalue123', { ANTHROPIC_API_KEY: 'supersecretvalue123' }), 'token=[REDACTED]');
});
