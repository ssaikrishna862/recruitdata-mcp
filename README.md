# RecruitData — Live Jobs & Hiring Data API for AI Agents (MCP)

The reliable **jobs & hiring data layer** that recruiting-AI agents plug into. One call → unified, deduplicated job listings from **Foundit, Shine, RemoteOK, BuiltIn & WeWorkRemotely** — no need to build and maintain 5 separate scrapers.

**Live MCP server:** `https://recruitdata-mcp.datapulse.workers.dev/mcp`

## Why

Recruiting and HR AI agents need live job/hiring data constantly — but each job board is a separate, often-defended integration. RecruitData does the hard part once and exposes it as a single reliable MCP tool:

- **5 sources, 1 call** — unified schema: title, company, location, salary, skills, experience, url.
- **Deduplicated** across boards.
- **Reliable** — uses each board's real data endpoints, not fragile page-scraping.
- **Pay-per-use** via subscription — built for AI products, not humans.

## Tools

| Tool | Description |
|---|---|
| `search_jobs` | Search jobs across all boards by keyword + location |
| `get_pricing` | Tiers and subscribe link |

### Example
```json
{ "tool": "search_jobs", "arguments": { "keyword": "data scientist", "location": "bangalore", "max": 50 } }
```

## Connect

Add to any MCP client (Claude, Cursor, Cline, Windsurf, agents) via the remote URL:
```
https://recruitdata-mcp.datapulse.workers.dev/mcp
```

## Pricing

- **Free:** 15 jobs per call, all public boards.
- **Pro — $49/month:** up to 300 jobs/call, all sources, priority. After subscribing, pass your account email as `customerEmail`.
- Subscribe: https://checkout.dodopayments.com/buy/pdt_0Ngl1yN9u8QXlW1cZqYrU?quantity=1

## Use cases

- **Recruiting / sourcing AI agents** — live candidate-facing job data.
- **HR-tech & job aggregators** — one feed instead of many integrations.
- **Market-intelligence agents** — hiring trends, in-demand skills, salaries.

## Tech

Cloudflare Workers · Model Context Protocol · streamable-HTTP. Sources accessed via their public data endpoints. Built for reliability and low latency at the edge.
