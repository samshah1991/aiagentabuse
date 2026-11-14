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

## Evidence agent

A weekly GitHub Action (`.github/workflows/evidence.yml`) researches each defense category, scores the evidence with a fixed formula, and opens a PR. **A human approves or rejects it; nothing publishes unless merged.** The only secret is `ANTHROPIC_API_KEY`. Setup, scoring formula, and safety controls: [`docs/evidence-method.md`](docs/evidence-method.md). Try it locally with `npm run agent:dry`.

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
npm test           # agent unit tests (mocked API, no key needed)
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
docs/                design docs and evidence method
.github/ISSUE_TEMPLATE/  incident submission form
```

## License

Content (data, page text, docs): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Code: [MIT](LICENSE).

Not legal advice. See `/disclaimer`.
