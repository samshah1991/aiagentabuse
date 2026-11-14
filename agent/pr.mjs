// Creates a branch, commits only allowlisted paths, opens a PR via the gh CLI (uses GH_TOKEN / GITHUB_TOKEN). Never merges.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathsAllowed, WRITE_ALLOW } from './guard.mjs';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
export const LABEL = 'evidence-review';
export const MAX_OPEN_PRS = 3; // stop unreviewed PRs piling up and conflicting on the same files

export function openPrCount() {
  try { return JSON.parse(run('gh', ['pr', 'list', '--label', LABEL, '--state', 'open', '--json', 'number'])).length; } catch { return 0; }
}
export function openPullRequest({ runId, title, body }) {
  run('git', ['add', '--', ...WRITE_ALLOW]);
  const staged = run('git', ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  if (!staged.length) return { skipped: 'no changes' };
  if (!pathsAllowed(staged)) { run('git', ['reset']); throw new Error(`refusing to commit paths outside the allowlist: ${staged.join(', ')}`); }
  const branch = `agent/evidence-${runId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  run('git', ['checkout', '-b', branch]);
  run('git', ['-c', 'user.name=evidence-agent', '-c', 'user.email=evidence-agent@users.noreply.github.com', 'commit', '-m', `${title}\n\nMachine-generated. Requires human review before merge.`]);
  run('git', ['push', '-u', 'origin', branch]);
  try { run('gh', ['label', 'create', LABEL, '--color', 'b42318', '--description', 'Machine-generated evidence: human review required']); } catch { /* exists */ }
  const file = join(mkdtempSync(join(tmpdir(), 'pr-')), 'body.md');
  writeFileSync(file, body);
  return { branch, url: run('gh', ['pr', 'create', '--title', title, '--body-file', file, '--label', LABEL]), files: staged };
}
