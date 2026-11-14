# AIagentAbuse.com

A static, free-to-host website documenting real-world incidents involving AI agents, and how to defend against them.

Every incident belongs to exactly one **track**:

- **cause**: the AI agent itself caused harm (overreach, unauthorized actions, deleting data, deception, outages).
- **target**: an attacker manipulated the agent (prompt injection, tool hijacking, credential theft, data exfiltration).

Incidents may also carry an OWASP risk ID (`LLM01`–`LLM10` or `ASI01`–`ASI10`).

## Human review is required (read this first)

**This site must not publish agent-generated content without human review.**

- Automated tools and AI agents may help find, draft, or check incidents, but they may only write to a review queue or a draft branch (see [`docs/agentic-workflow.md`](docs/agentic-workflow.md)).
- Only a human maintainer may set `verification_status: verified` or `corrected`, and only after checking every claim against the cited sources.
- Summaries must be paraphrased. No long quotations from sources.
- No exploit code or working attack payloads, anywhere in the repository.

## Evidence agent: how it works and how to approve

A GitHub Action (`.github/workflows/evidence-agent.yml`) runs **every Monday 03:00 UTC** and on manual trigger. For each defense category in `data/categories.yaml` it:

1. **Searches** the web for up to 8 sources from the last 36 months, using Anthropic's hosted web search and web fetch tools (`agent/search.mjs`).
2. **Extracts** one record per source. Code checks that each claim is supported by text it actually fetched, that nothing quotes more than 15 words, and that the model supplied no score (`agent/extract.mjs`, `agent/schema.mjs`). Fields it cannot verify are set to `null` and listed as unverified.
3. **Scores** with fixed rules in `agent/score.mjs`. No AI model is involved. The rules are published at `/method#evidence-weighting`.
4. **Opens one pull request**, "Evidence proposals: <date>", labelled `evidence-review`, with each record, its score, its source link, and the unverified list.

Records are written to `data/evidence/<category>.yaml` with `status: proposed`. **Proposed records never appear on the site.** Only `status: approved` records do.

### How to approve
1. Open the PR. For each record, open the source link and confirm the claim. Also check `evidence_type` and the three true/false fields: they are model judgements and they drive the score.
2. Edit the YAML: set `status: approved` on records you accept, and `status: rejected` (or delete) the rest.
3. Merge. Closing the PR without merging discards everything.

### Recheck
`--recheck` re-fetches every approved source. A source that fails to load becomes `needs_recheck`; one whose content changed is re-extracted and proposed as an update. Both arrive as a PR. The agent never edits an approved record outside a PR.

### Setup (once)
1. Add the repository secret `ANTHROPIC_API_KEY`. It is the only secret.
2. Settings → Actions → General → enable **"Allow GitHub Actions to create and approve pull requests"**.
3. Optionally set a spend limit on the Anthropic workspace.

### Run it
- On GitHub: Actions → Evidence agent → Run workflow (inputs: `category`, `dry_run`, `recheck`).
- Locally: `AGENT_ENABLED=true ANTHROPIC_API_KEY=... npm run agent:dry -- --category untrusted-content`. A dry run prints proposals and a score table and writes nothing.

### Guardrails (enforced in code)
- **Write allowlist:** only `data/evidence/` and `data/logs/agent-runs/`. Anything else is rejected, and again before the commit.
- **Token cap:** `MAX_RUN_TOKENS` (default 300000). The run stops and logs the reason. Categories are processed stalest-first so a cap never starves the same ones.
- **Kill switch:** create a file named `.agent-disabled` at the repo root, or set the repository variable `AGENT_ENABLED` to anything other than `true`. The workflow defaults it to `true`.
- **Untrusted content:** fetched pages are data. The model has no write, shell, or GitHub tools; only hosted search and fetch.
- **Logs:** one JSON file per run in `data/logs/agent-runs/` with model, prompt versions, sources, and token use. API keys are read from the environment only and redacted from output.

Tests: `npm test` (mocked API, no key needed).

## Stack

- [Astro](https://astro.build) (static output) with Markdown pages
- One YAML file per incident in `data/incidents/`; taxonomy in `data/taxonomy/`; checklists in `data/defenses.yaml`
- [Pagefind](https://pagefind.app) search index, generated at build time
- Hosted on Cloudflare Pages. No server, no cookies, no trackers, no third-party fonts or scripts.

## Run locally

Requires Node.js 22.23.4 or newer (see `.nvmrc`).

```sh
npm install
npm run dev        # http://localhost:4321 (search is not available in dev mode)
npm run build      # validate data, build to dist/, then build the search index
npm run preview    # serve dist/ (search works here)
npm run validate   # validate incidents, categories, evidence files
npm test           # agent tests (mocked API, no key needed)
```

`npm run build` fails if any incident is invalid.

## Deploy to Cloudflare Pages

No Wrangler needed.

1. Push this repository to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, and select the repository.
3. Build settings:
   - Framework preset: **Astro** (or None)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION` = `22.23.4` (or newer)
4. Deploy, then add the custom domain `aiagentabuse.com` under **Custom domains**.

`public/_headers` sets a strict Content Security Policy that allows only same-origin resources.

## Add an incident

1. Create `data/incidents/<id>.yaml`. The file name must equal the `id` (lowercase kebab-case).
2. Fill in the schema below. Quote all dates.
3. Run `npm run validate`, then open a pull request. New entries start as `draft`.

```yaml
id: 2025-example-agent-does-something      # required, must match file name
title: "Short, neutral title"              # required
track: cause                               # required: cause | target
category: data-destruction                 # required: see data/taxonomy/categories.yaml (must match track)
owasp_id: LLM06                            # optional: LLM01-LLM10 or ASI01-ASI10
date: "2025-01-15"                         # required, YYYY-MM-DD
agent_or_product: "Product name"           # required
vendor: "Vendor name"                      # optional
summary: >-                                # required, 2-4 sentences, paraphrased
  ...
impact: "Who or what was affected."        # required
severity: high                             # required: low | medium | high | critical
sources:                                   # required, at least one
  - title: "Source title"
    url: "https://..."
    accessed: "2026-11-14"
verification_status: draft                 # required: draft | verified | corrected
last_reviewed: "2026-11-14"                # required, YYYY-MM-DD
```

The validator also rejects unknown fields, a category from the wrong track, unknown OWASP IDs, invalid dates or URLs, and `verified` entries that still have placeholder sources.

## Repository layout

```
data/incidents/      one YAML file per incident
data/taxonomy/       tracks, categories, OWASP IDs
data/defenses.yaml   defense checklists, mapped to categories
scripts/             schema validator and shared data loader
src/                 Astro layouts, pages, styles
public/              static files, Cloudflare _headers, client JS
agent/               evidence agent (search, extract, score, guard, PR)
data/categories.yaml defense categories the agent researches
data/evidence/       agent output (merged via PR only)
data/logs/agent-runs/ one JSON log per agent run
tests/               tests for the evidence agent
docs/                design docs and evidence method
.github/ISSUE_TEMPLATE/  incident submission form
```

## License

Content (data, page text, docs): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Code: [MIT](LICENSE).

Not legal advice. See `/disclaimer`.
