// RecruitData — the reliable jobs & hiring-data layer that recruiting-AI agents depend on.
// Remote MCP server on Cloudflare Workers. Unified, multi-source job data from sources
// that generic agent tools fail on. Billed via Dodo (free tier + paid). Pays to India.
//
// Worker-safe sources (fetch + regex/JSON, no browser): Foundit, Shine, RemoteOK, BuiltIn,
// WeWorkRemotely. (Naukri needs a browser → offered as a premium Apify-backed source later.)

import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const FREE_MAX = 15;
const PAID_MAX = 300;
const CHECKOUT_URL = 'https://checkout.dodopayments.com/buy/pdt_0Ngl1yN9u8QXlW1cZqYrU?quantity=1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export class RecruitDataMCP extends McpAgent {
    server = new McpServer({ name: 'RecruitData', version: '1.0.0' });

    async init() {
        this.server.tool(
            'search_jobs',
            'Search live job listings across multiple boards (LinkedIn, Foundit, Shine, RemoteOK, BuiltIn, ' +
            'WeWorkRemotely) in one call — unified, deduplicated, structured. Built for recruiting/HR ' +
            'AI agents that need reliable hiring data. Returns title, company, location, salary, skills, url. ' +
            'LinkedIn is a premium source (paid tier).',
            {
                keyword: z.string().describe('Role or skill, e.g. "python developer", "product manager"'),
                location: z.string().optional().describe('City/region/country, e.g. "India", "bangalore", "remote"'),
                sources: z.array(z.enum(['linkedin', 'foundit', 'shine', 'remoteok', 'builtin', 'weworkremotely']))
                    .optional().describe('Which boards to query; default = all available for your tier'),
                max: z.number().optional().describe('Max results (free tier capped at 15)'),
                customerEmail: z.string().optional().describe('Paid subscription email — unlocks LinkedIn + higher limits'),
            },
            async ({ keyword, location, sources, max, customerEmail }) => {
                const paid = await isPaidCustomer(customerEmail, this.env);
                const cap = paid ? PAID_MAX : FREE_MAX;
                const limit = Math.min(max || cap, cap);
                const freeBoards = ['foundit', 'shine', 'remoteok', 'builtin', 'weworkremotely'];
                const premiumBoards = ['linkedin'];
                const allowed = paid ? [...premiumBoards, ...freeBoards] : freeBoards;
                let boards = sources && sources.length ? sources.filter((s) => allowed.includes(s)) : allowed;
                if (!boards.length) boards = freeBoards;
                const perBoard = Math.ceil(limit / boards.length) + 2;

                const runners = {
                    linkedin: () => scrapeLinkedIn(keyword, location, perBoard),
                    foundit: () => scrapeFoundit(keyword, location, perBoard),
                    shine: () => scrapeShine(keyword, location, perBoard),
                    remoteok: () => scrapeRemoteOK(keyword, perBoard),
                    builtin: () => scrapeBuiltIn(keyword, perBoard),
                    weworkremotely: () => scrapeWWR(keyword, perBoard),
                };
                const settled = await Promise.allSettled(boards.map((b) => runners[b]()));
                let all = [];
                settled.forEach((r) => { if (r.status === 'fulfilled') all.push(...r.value); });

                // dedupe by title+company
                const seen = new Set();
                all = all.filter((j) => { const k = `${(j.title||'').toLowerCase()}|${(j.company||'').toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
                all = all.filter((j) => j.title && j.company).slice(0, limit);

                return { content: [{ type: 'text', text: JSON.stringify({
                    tier: paid ? 'paid' : 'free',
                    count: all.length,
                    sourcesQueried: boards,
                    upgradeNote: paid ? undefined : `Free tier: ${FREE_MAX} jobs/call from public boards. Subscribe ($49/mo) for up to ${PAID_MAX}/call + LinkedIn premium source. ${CHECKOUT_URL}`,
                    jobs: all,
                }, null, 2) }] };
            },
        );

        this.server.tool(
            'get_pricing',
            'Pricing tiers and how recruiting-AI products subscribe.',
            {},
            async () => ({ content: [{ type: 'text', text: JSON.stringify({
                free: `${FREE_MAX} jobs per call, all public boards.`,
                pro: `Higher limits (${PAID_MAX}/call), priority, + premium sources. Usage-based tiers.`,
                checkoutUrl: this.env?.DODO_CHECKOUT_URL || CHECKOUT_URL,
            }, null, 2) }] }),
        );
    }
}

/* ===================== Worker-safe job sources ===================== */

// LinkedIn — public "guest" jobs API (no login). Returns HTML job cards.
// Premium source: highest-demand board. Parsed via regex (Workers-safe).
async function scrapeLinkedIn(keyword, location, max) {
    const url = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
    url.searchParams.set('keywords', keyword);
    if (location) url.searchParams.set('location', location);
    url.searchParams.set('start', '0');
    let html;
    try {
        const res = await fetch(url.toString(), { headers: { 'user-agent': UA, accept: 'text/html' } });
        if (!res.ok) return [];
        html = await res.text();
    } catch { return []; }

    const out = [];
    const cards = html.split('base-card');
    for (const c of cards) {
        if (out.length >= max) break;
        const title = decodeHtml((c.match(/base-search-card__title[^>]*>\s*([^<]+?)\s*</) || [])[1]);
        const company = decodeHtml((c.match(/base-search-card__subtitle[^>]*>\s*(?:<a[^>]*>)?\s*([^<]+?)\s*</) || [])[1]);
        const loc = decodeHtml((c.match(/job-search-card__location[^>]*>\s*([^<]+?)\s*</) || [])[1]);
        const link = (c.match(/href="(https:\/\/[a-z.]*linkedin\.com\/jobs\/view\/[^"?]+)/) || [])[1];
        const posted = (c.match(/datetime="([^"]+)"/) || [])[1];
        if (!title || !company) continue;
        out.push({ source: 'linkedin', title, company, locations: loc ? [loc] : [], experience: null, salary: null, skills: [], postedAt: posted || null, url: link || null });
    }
    return out;
}

async function scrapeFoundit(keyword, location, max) {
    const url = new URL('https://www.foundit.in/middleware/jobsearch');
    url.searchParams.set('query', keyword);
    if (location) url.searchParams.set('locations', location);
    url.searchParams.set('start', '0');
    url.searchParams.set('rows', String(Math.min(max, 25)));
    const res = await fetch(url.toString(), { headers: { accept: 'application/json', referer: `https://www.foundit.in/srp/results?query=${encodeURIComponent(keyword)}`, 'user-agent': UA } });
    if (!res.ok) return [];
    const data = (await res.json())?.jobSearchResponse?.data ?? [];
    return data.filter((j) => j.title && j.companyName).slice(0, max).map((j) => ({
        source: 'foundit', title: j.title, company: j.companyName,
        locations: typeof j.locations === 'string' ? [j.locations] : (j.locations || []),
        experience: j.minimumExperience?.years != null ? `${j.minimumExperience.years}-${j.maximumExperience?.years ?? ''} yrs` : null,
        salary: salaryStr(j.minimumSalary, j.maximumSalary),
        skills: typeof j.skills === 'string' ? j.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
        postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
        url: j.seoJdUrl ? `https://www.foundit.in${j.seoJdUrl}` : null,
    }));
}

async function scrapeShine(keyword, location, max) {
    const slug = keyword.trim().toLowerCase().replace(/\s+/g, '-');
    const url = location
        ? `https://www.shine.com/job-search/${slug}-jobs-in-${location.trim().toLowerCase().replace(/\s+/g, '-')}`
        : `https://www.shine.com/job-search/${slug}-jobs`;
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!res.ok) return [];
    const html = await res.text();
    const m = html.match(/__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
    if (!m) return [];
    let results;
    try { results = JSON.parse(m[1])?.props?.pageProps?.initialState?.jsrp?.searchresult?.data?.results; } catch { return []; }
    if (!Array.isArray(results)) return [];
    return results.filter((j) => j.jJT && j.jCName).slice(0, max).map((j) => ({
        source: 'shine', title: j.jJT, company: j.jCName,
        locations: j.jLoc ? String(j.jLoc).split(/[,;|/]/).map((s) => s.trim()).filter(Boolean) : [],
        experience: j.jExp || null, salary: j.jHRPBA === false ? null : j.jSal,
        skills: typeof j.jKS === 'string' ? j.jKS.split(',').map((s) => s.trim()) : [],
        postedAt: null, url: j.jRUrl || (j.jSEOUrl ? `https://www.shine.com${j.jSEOUrl}` : null),
    }));
}

async function scrapeRemoteOK(keyword, max) {
    const url = keyword ? `https://remoteok.com/api?tags=${encodeURIComponent(keyword.trim().toLowerCase().replace(/\s+/g, '-'))}` : 'https://remoteok.com/api';
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : []).filter((j) => j.position && j.company).slice(0, max).map((j) => ({
        source: 'remoteok', title: j.position, company: j.company,
        locations: j.location ? [j.location] : ['Remote'],
        experience: null, salary: (j.salary_min || j.salary_max) ? `$${j.salary_min || '?'} - $${j.salary_max || '?'}` : null,
        skills: Array.isArray(j.tags) ? j.tags : [], postedAt: j.date || null,
        url: j.url || (j.slug ? `https://remoteok.com/remote-jobs/${j.slug}` : null),
    }));
}

async function scrapeBuiltIn(keyword, max) {
    const url = `https://builtin.com/jobs${keyword ? `?search=${encodeURIComponent(keyword)}` : ''}`;
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!res.ok) return [];
    const html = await res.text();
    const out = [];
    // title anchors → climb handled via regex on surrounding block
    const anchorRe = /<a[^>]+href="(\/job\/[^"]+)"[^>]*>([^<]{3,80})<\/a>/g;
    let m; const seen = new Set();
    while ((m = anchorRe.exec(html)) && out.length < max) {
        const href = m[1]; const title = m[2].trim();
        if (seen.has(href) || !title) continue; seen.add(href);
        // grab a window after the anchor for company/salary
        const win = html.slice(m.index, m.index + 1200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const company = (win.match(/\/company\/[^ ]*/) ? '' : '') || (win.match(new RegExp(title.slice(0, 12) + '\\s+([A-Z][\\w&.,\'\\- ]{2,40})')) || [])[1] || '';
        const salary = (win.match(/\$?\d{2,3}K\s*[-–]\s*\$?\d{2,3}K/) || [])[0] || null;
        out.push({ source: 'builtin', title, company: company.trim() || 'BuiltIn employer', locations: (/(Remote|Hybrid)[^|$]{0,20}/i.exec(win)?.[0] || '').trim() ? [(/(Remote|Hybrid)[^|$]{0,20}/i.exec(win)[0]).trim()] : [], experience: null, salary, skills: [], postedAt: null, url: `https://builtin.com${href}` });
    }
    return out;
}

async function scrapeWWR(keyword, max) {
    const url = keyword ? `https://weworkremotely.com/remote-jobs/search.rss?term=${encodeURIComponent(keyword)}` : 'https://weworkremotely.com/remote-jobs.rss';
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml' } });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const out = [];
    for (const it of items) {
        if (out.length >= max) break;
        const rawTitle = clean((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
        const link = clean((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
        const region = clean((it.match(/<region>([\s\S]*?)<\/region>/) || [])[1]);
        const cat = clean((it.match(/<category>([\s\S]*?)<\/category>/) || [])[1]);
        let company = '', title = rawTitle;
        const mm = rawTitle.match(/^(.+?):\s*(.+)$/);
        if (mm) { company = mm[1].trim(); title = mm[2].trim(); }
        if (!title || !company) continue;
        out.push({ source: 'weworkremotely', title, company, locations: region ? [region] : ['Remote'], experience: null, salary: null, skills: cat ? [cat] : [], postedAt: null, url: link || null });
    }
    return out;
}

/* ===================== helpers ===================== */
function clean(v) { return (v || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
function decodeHtml(v) {
    if (!v) return '';
    return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\s+/g, ' ').trim();
}
function salaryStr(min, max) {
    const a = min?.absoluteValue ?? 0, b = max?.absoluteValue ?? 0;
    if (!a && !b) return null;
    const cur = min?.currency ?? 'INR';
    return a && b ? `${cur} ${a} - ${b}` : `${cur} ${a || b}`;
}

/* ===================== Dodo paid gate ===================== */
async function isPaidCustomer(email, env) {
    if (!email || !env?.DODO_API_KEY) return false;
    try {
        const res = await fetch('https://live.dodopayments.com/subscriptions?page_size=100', { headers: { authorization: `Bearer ${env.DODO_API_KEY}` } });
        if (!res.ok) return false;
        const items = (await res.json())?.items ?? [];
        const t = email.trim().toLowerCase();
        return items.some((s) => (s.status === 'active' || s.status === 'on_trial') && ((s.customer?.email || s.customer_email || '').toLowerCase() === t));
    } catch { return false; }
}

/* ===================== Worker entry ===================== */
export default {
    fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/sse' || url.pathname === '/sse/message') return RecruitDataMCP.serveSSE('/sse').fetch(request, env, ctx);
        if (url.pathname === '/mcp') return RecruitDataMCP.serve('/mcp').fetch(request, env, ctx);
        if (url.pathname === '/') return new Response(JSON.stringify({ name: 'RecruitData MCP', mcp: '/mcp', sse: '/sse', tools: ['search_jobs', 'get_pricing'] }, null, 2), { headers: { 'content-type': 'application/json' } });
        return new Response('Not found', { status: 404 });
    },
};
