// Safety rails: write-path allowlist, spend cap, kill switch. None of this relies on the model behaving.
import { resolve, relative, sep, isAbsolute, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';

export class GuardError extends Error {}
export class SpendCapError extends GuardError {}

// The agent may write ONLY under these paths. The model itself has no write tools at all:
// only Anthropic-hosted web search/fetch. All file writes are made by this code.
export const WRITE_ALLOW = ['data/evidence'];

export function assertWritable(p, root = process.cwd()) {
  const abs = resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new GuardError(`write outside repo blocked: ${p}`);
  if (!WRITE_ALLOW.some((a) => rel === a || rel.startsWith(a + sep))) throw new GuardError(`write path not allowlisted: ${rel}`);
  return abs;
}
export function safeWrite(p, content, root = process.cwd()) {
  const abs = assertWritable(p, root);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}
export const pathsAllowed = (paths) => paths.every((p) => { try { assertWritable(p); return true; } catch { return false; } });

// Kill switch: set repository variable AGENT_KILL_SWITCH=on, or commit a file named agent/KILL_SWITCH.
// Unset means the agent runs, so it works out of the box.
export function killSwitchOn(env = process.env, root = process.cwd()) {
  return /^(on|true|1|yes)$/i.test(env.AGENT_KILL_SWITCH ?? '') || existsSync(resolve(root, 'agent/KILL_SWITCH'));
}

// Spend cap. USD per million tokens. TODO(owner): confirm against current Anthropic pricing; unknown models use the highest rate.
export const PRICES = {
  'claude-sonnet-5-5': { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  _fallback: { in: 15, out: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};
export const SEARCH_USD_PER_REQUEST = 0.01; // $10 per 1,000 searches (docs)
export const DEFAULT_CAPS = { runUsd: 10, monthUsd: 50 };

export function monthSpentFromLogs(now = new Date(), dir = 'data/evidence/_log') {
  if (!existsSync(dir)) return 0;
  const ym = now.toISOString().slice(0, 7);
  let sum = 0;
  for (const f of readdirSync(dir)) if (f.startsWith(ym) && f.endsWith('.json')) {
    try { sum += Number(JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')).total_cost_usd) || 0; } catch { /* ignore unreadable log */ }
  }
  return sum;
}

export class SpendTracker {
  constructor({ runUsd, monthUsd, monthSpent = 0 } = {}, env = process.env) {
    this.runCap = Number(runUsd ?? env.AGENT_RUN_CAP_USD ?? DEFAULT_CAPS.runUsd);
    this.monthCap = Number(monthUsd ?? env.AGENT_MONTH_CAP_USD ?? DEFAULT_CAPS.monthUsd);
    this.monthSpent = monthSpent;
    this.spent = 0; this.searches = 0; this.fetches = 0;
  }
  costOf(model, u = {}) {
    const p = PRICES[model] ?? PRICES._fallback;
    const t = (n, rate) => ((n ?? 0) / 1e6) * rate;
    return t(u.input_tokens, p.in) + t(u.output_tokens, p.out) + t(u.cache_creation_input_tokens, p.cacheWrite) +
      t(u.cache_read_input_tokens, p.cacheRead) + (u.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD_PER_REQUEST;
  }
  add(model, usage) {
    this.spent += this.costOf(model, usage);
    this.searches += usage?.server_tool_use?.web_search_requests ?? 0;
    this.fetches += usage?.server_tool_use?.web_fetch_requests ?? 0;
  }
  // Checked before every API call, so overshoot is bounded by a single call.
  assertBudget() {
    if (this.spent >= this.runCap) throw new SpendCapError(`run spend cap reached ($${this.spent.toFixed(2)} of $${this.runCap})`);
    if (this.monthSpent + this.spent >= this.monthCap) throw new SpendCapError(`monthly spend cap reached ($${(this.monthSpent + this.spent).toFixed(2)} of $${this.monthCap})`);
  }
}
