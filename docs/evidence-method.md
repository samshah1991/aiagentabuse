# Evidence agent: method and operations

The agent in `agent/` researches how well each defense category works, scores the evidence with a fixed formula, and opens a pull request. **A human approves or rejects every PR. Nothing is published unless merged.**

## Pipeline (per category in `data/categories.yaml`)
1. **Search** (`search.mjs`): the model uses Anthropic's hosted `web_search_20260318` and `web_fetch_20260318` tools (max 8 searches, 10 fetches). It has no file, shell, or GitHub tools.
2. **Extract** (`extract.mjs`): a second, tool-free model call turns the fetched page text into structured records. Code then discards any record whose source URL was not fetched in this run, whose quote does not appear verbatim in the page, or that fails the JSON schema.
3. **Score** (`score.mjs`): deterministic. The model never sees or sets a score.
4. **Write** (`guard.mjs`): code writes only under `data/evidence/`. Anything else throws.
5. **PR** (`pr.mjs`): creates `agent/evidence-<run>`, commits only `data/evidence/`, opens a PR labelled `agent-evidence`. Never merges. Skips if 2+ agent PRs are already open.

## Scoring formula (version 1)
Record score = `100 × source_type × evidence_design × recency × independence`, or 0 if the link is dead or the quote failed verification.

| Factor | Values |
|---|---|
| source_type | peer_reviewed 1.0 · standards_or_government 0.8 · preprint 0.7 · independent_research 0.6 · vendor_research 0.5 · news_or_blog 0.3 · other 0.2 |
| evidence_design | benchmark_or_controlled 1.0 · field_or_incident_analysis 0.8 · case_study 0.5 · guidance_or_opinion 0.3 |
| recency | 1.0 within 12 months, falling linearly to 0.5 at 36 months; unknown date 0.5 |
| independence | 1.0, or 0.6 if the authors sell the defense |

Category score = mean of the top 3 domains' best record scores × `min(1, domains / 3)`. Grades: strong ≥ 60, moderate ≥ 35, weak ≥ 15, otherwise insufficient. Fewer than 2 distinct domains caps the grade at weak.

The score measures **strength of evidence, not effectiveness**. `finding_direction` (supports / mixed / contradicts / inconclusive) is counted separately so contradicting evidence stays visible.

**What is model judgement, not computed:** `source_type`, `evidence_design`, `vendor_authored`, and `published`. PR reviewers must spot-check these. They drive the score.

## Safety controls
| Control | How |
|---|---|
| Read-only to the web | Only hosted search/fetch tools; fetch can only open URLs already in context |
| Write allowlist | `guard.mjs` `WRITE_ALLOW`; PR step re-checks staged paths |
| Prompt injection | Pages are untrusted; extraction is schema-checked; quotes are machine-verified; the model has no action tools |
| Provenance | Every file records model, prompt versions, run ID, queries, URLs fetched, cost. Run logs in `data/evidence/_log/` |
| Spend cap | Default $10 per run and $50 per calendar month (summed from run logs); checked before every API call. Override with `AGENT_RUN_CAP_USD` / `AGENT_MONTH_CAP_USD` |
| Kill switch | Repo variable `AGENT_KILL_SWITCH=on`, or commit a file `agent/KILL_SWITCH` |

Also set a **spend limit on the Anthropic workspace** in the Console. That is the only cap the agent cannot bypass.

## Running it
- Scheduled: Mondays 05:17 UTC (`.github/workflows/evidence.yml`).
- Manual: Actions → Evidence agent → Run workflow (inputs: category, recheck, dry run).
- Locally: `ANTHROPIC_API_KEY=... npm run agent:dry` (or `npm run agent -- --category untrusted-content`).
- `--recheck` re-tests existing source links without calling the model, and zeroes the score of dead links.
- Tests (`npm test`) use a mocked API client and need no key.

## One-time setup (by hand)
1. Add secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions).
2. Enable **Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"**. Without it the PR step fails.
3. Set a spend limit in the Anthropic Console.

## Known limits
- PRs opened with the default `GITHUB_TOKEN` do not trigger other workflows, so CI will not run on agent PRs. The agent validates its own output with the same schema, and `npm run build` re-validates on merge.
- PDFs are skipped: their text cannot be machine-verified.
- Prices in `guard.mjs` are estimates. Confirm them against current Anthropic pricing.
