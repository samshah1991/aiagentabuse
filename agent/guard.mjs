// Guardrails enforced in code, not in prompts: write allowlist, token cap, kill switch, quote limit, secret redaction.
import { resolve, relative, sep, isAbsolute, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { normText } from './util.mjs';

export class GuardError extends Error {}
export class BudgetExhaustedError extends GuardError {}

export const WRITE_ALLOW = ['data/evidence', 'data/logs/agent-runs'];
export function assertWritable(p, root = process.cwd()) {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new GuardError(`write outside repo blocked: ${p}`);
  if (!WRITE_ALLOW.some((a) => rel.startsWith(a + sep))) throw new GuardError(`write path not allowlisted: ${rel}`);
  return abs;
}
export function safeWrite(p, content, root = process.cwd()) {
  const abs = assertWritable(p, root);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}
export const pathsAllowed = (paths, root) => paths.every((p) => { try { assertWritable(p, root); return true; } catch { return false; } });

// Kill switch: exit if file .agent-disabled exists at the repo root, or AGENT_ENABLED is not exactly "true".
// (The workflow sets AGENT_ENABLED to "true" by default, so nothing needs configuring there.)
export function disabledReason(env = process.env, root = process.cwd()) {
  if (existsSync(resolve(root, '.agent-disabled'))) return 'the file .agent-disabled exists at the repo root';
  if (env.AGENT_ENABLED !== 'true') return 'AGENT_ENABLED is not "true"';
  return null;
}

// Spend cap: MAX_RUN_TOKENS (default 300000) counts every input, output, and cache token across all calls.
export const DEFAULT_MAX_RUN_TOKENS = 300000;
export class TokenBudget {
  constructor(env = process.env) {
    const n = Number.parseInt(env.MAX_RUN_TOKENS ?? '', 10);
    this.max = Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RUN_TOKENS;
    this.used = 0;
  }
  add(usage = {}) {
    this.used += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  }
  // Checked before every API call, so overshoot is bounded by one call.
  assertBudget() {
    if (this.used >= this.max) throw new BudgetExhaustedError(`token cap reached (${this.used} of MAX_RUN_TOKENS=${this.max})`);
  }
}

// No quotation longer than 15 words may be stored: reject text sharing any 16-word run with its source.
export const MAX_QUOTE_WORDS = 15;
export function hasLongQuote(stored, source, limit = MAX_QUOTE_WORDS) {
  const n = limit + 1;
  const sw = normText(source).split(' '); const tw = normText(stored).split(' ');
  if (tw.length < n || sw.length < n) return false;
  const grams = new Set();
  for (let i = 0; i + n <= sw.length; i++) grams.add(sw.slice(i, i + n).join(' '));
  for (let i = 0; i + n <= tw.length; i++) if (grams.has(tw.slice(i, i + n).join(' '))) return true;
  return false;
}

// Never write API keys to logs or output.
export function redact(text, env = process.env) {
  let t = String(text).replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  const k = env.ANTHROPIC_API_KEY; if (k && k.length > 8) t = t.split(k).join('[REDACTED]');
  return t;
}
