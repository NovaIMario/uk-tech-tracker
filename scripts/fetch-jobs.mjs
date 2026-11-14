#!/usr/bin/env node
/**
 * UK early-careers job fetcher.
 *
 *   node scripts/fetch-jobs.mjs
 *
 * Reads every employer board listed in sources.mjs through the public job-board APIs the
 * employers publish (Greenhouse, Lever, Ashby and Workday), keeps UK-based internships,
 * placements, spring weeks, graduate roles and apprenticeships, and merges them into
 * data/jobs.json:
 *   - each role keeps the date it was first posted (or first seen, when the board gives no date)
 *   - roles that disappear get a closed date and are dropped 21 days later
 *   - if a board can't be read, its roles are left exactly as they were
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SOURCES } from './sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'jobs.json');
const UA = 'Mozilla/5.0 (compatible; early-careers-tracker/1.0)';
const IN_CI = Boolean(process.env.GITHUB_ACTIONS);
const KEEP_CLOSED_DAYS = 21;
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const today = daysAgo(0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const warn = (msg) => console.warn(IN_CI ? `::warning::${msg}` : `warning: ${msg}`);

// Per-host pacing. Lever's robots.txt asks for one request a second.
const lastHit = new Map();
const GAP = { 'api.lever.co': 1100 };
async function request(url, init = {}) {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    const wait = (lastHit.get(host) ?? 0) + (GAP[host] ?? 400) - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return await res.json();
      if (res.status < 500 || attempt >= 3) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 3 || /HTTP 4/.test(err.message)) throw err;
    }
    await sleep(2000 * attempt);
  }
}

// ---------------------------------------------------------------- where: is a location in the UK?

const UK_COUNTRY_RE = /\b(uk|u\.k\.|gb|gbr|united kingdom|great britain|britain|england|scotland|wales|northern ireland)\b/i;
const UK_CITY_RE = new RegExp(`\\b(${[
  'london', 'cambridge', 'oxford', 'edinburgh', 'manchester', 'bristol', 'glasgow', 'belfast', 'leeds', 'birmingham',
  'reading', 'newcastle', 'sheffield', 'nottingham', 'cardiff', 'brighton', 'hove', 'guildford', 'milton keynes',
  'basingstoke', 'bath', 'exeter', 'southampton', 'york', 'knutsford', 'northampton', 'macclesfield', 'cheltenham',
  'gloucester', 'harrogate', 'halifax', 'warwick', 'coventry', 'leicester', 'liverpool', 'aberdeen', 'dundee',
  'stirling', 'livingston', 'swindon', 'bracknell', 'wokingham', 'slough', 'maidenhead', 'farnborough', 'crawley',
  'horsham', 'stevenage', 'hatfield', 'st albans', 'watford', 'hemel hempstead', 'harpenden', 'luton', 'dunstable',
  'filton', 'derby', 'chester', 'crewe', 'warrington', 'stockport', 'salford', 'preston', 'bolton', 'sunderland',
  'swansea', 'ipswich', 'norwich', 'chelmsford', 'colchester', 'feltham', 'uxbridge', 'hayes', 'stockley park',
  'staines', 'woking', 'weybridge', 'newbury', 'theale', 'chippenham', 'portsmouth', 'plymouth', 'bournemouth',
  'poole', 'winchester', 'eastleigh', 'chandlers ford', 'chichester', 'peterborough', 'huntingdon', 'didcot',
  'harwell', 'abingdon', 'banbury', 'bicester', 'solihull', 'wolverhampton', 'telford', 'loughborough', 'malvern',
  'broughton', 'barrow-in-furness', 'warton', 'samlesbury', 'daresbury', 'canary wharf', 'croydon', 'wimbledon',
  'new malden', 'londonderry', 'derry', 'lisburn', 'inverness',
].join('|')})\\b`, 'i');
// Same-named places abroad: New York, London (Ontario), Cambridge MA, Birmingham AL, Newcastle NSW.
const FOREIGN_RE = /\b(new york|nyc|new jersey|new england|massachusetts|ontario|quebec|nova scotia|british columbia|canada|united states|usa|alabama|new hampshire|pennsylvania|connecticut|kentucky|ohio|maine|virginia|carolina|texas|california|australia|queensland|new zealand|tasmania|jamaica|south africa)\b/;
// Upper-case state and province codes standing alone ("Cambridge, MA", "US - Cambridge Kendall SQ - MA", "London ON").
const FOREIGN_CODE_RE = /(?:^|[\s,(–-])(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HK]|ON|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]|BC|QC|AB|MB|NS|NB|NL|SK|NSW|VIC|QLD|ACT|TAS|US|USA)(?=$|[\s,).–-])/;

/** True if any of the locations listed (split on ; | / • or "or") is in the UK. */
export function isUK(location) {
  const parts = String(location || '').split(/;|\||\n|•|·|\/| or /i).map((p) => p.trim()).filter(Boolean);
  return parts.some((raw) => {
    const p = raw
      .replace(/\bnew south wales\b/gi, 'NSW')
      .replace(/\bnew england\b/gi, 'US')
      .replace(/\bcanada (square|water|place)\b/gi, 'Docklands');
    if (UK_COUNTRY_RE.test(p)) return true;
    return UK_CITY_RE.test(p) && !FOREIGN_RE.test(p.toLowerCase()) && !FOREIGN_CODE_RE.test(p);
  });
}

// ---------------------------------------------------------------- what: is it an early-careers role?

const TYPES = [
  ['insight', /\b(spring (week|weeks|insight|internship|programme|program|intern)|insight (week|weeks|day|days|programme|programmes|program|programs|event|events|scheme)|discovery (day|days|week|programme|program)|first[- ]year (programme|program|insight|internship|intern|students?)|1st[- ]year|pre[- ]university|open day|taster (day|days|week)|work experience)\b/i],
  ['placement', /\b(placement|placements|industrial (trainee|placement|year)|year in industry|sandwich (year|placement|student)|12[- ]month (intern|internship)|year[- ]long internship|industrial internship)\b/i],
  ['apprenticeship', /\b(apprentice|apprentices|apprenticeship|apprenticeships)\b/i],
  ['internship', /\b(intern|interns|internship|internships|summer analyst|summer associate|summer engineer|summer student|summer (20\d\d|program|programme)|off[- ]cycle|co-?op|vacation scheme|undergraduate|undergrad)\b/i],
  ['graduate', /\b(graduate|graduates|grad|new grad|early careers?|early talent|entry[- ]level|campus|university (hire|graduate)|junior|associate programme|analyst programme|analyst program|full[- ]time analyst|associate product manager|rotational|trainee|20(2[6-9]|3\d) start)\b/i],
];
// Past entry level, running an early-careers programme rather than joining one, or only open to
// returning interns ("2026 Summer Intern Converts Only").
const EXCLUDE = /\b(senior|sr\.?|staff|principal|director|executive director|head of|vp|avp|vice president|assistant vice president|chief \w+ officer|chief of staff|experienced|mid[- ]level|\d+\+ years|(recruiting|recruitment|program|programme|campus|early careers?|university|emerging talent|internships?|graduate|apprenticeships?|events?|partnerships?|relations|outreach) (manager|coordinator|lead|specialist|partner|director|advisor|officer|consultant)|interns? (converts? )?only|converts? only|returning interns?)\b/i;
// Recruiting jobs, unless the title makes clear a student does it ("Talent Acquisition Placement").
const RECRUITING = /\b(recruiter|recruiters|sourcer|talent (acquisition|partner|advisor|sourcer|specialist|coordinator|manager|lead))\b/i;
const STUDENT = /\b(placement|intern|interns|internship|apprentice|apprenticeship|industrial|year in industry|summer analyst|work experience)\b/i;
// "Manager" and "lead" mean a senior role unless the title also says graduate, intern and so on.
const SOFT_EXCLUDE = /\b(manager|lead)\b/i;
const STRONG_EARLY = /\b(graduate|grad|intern|internship|placement|apprentice|apprenticeship|trainee|junior|entry[- ]level|associate product manager|rotational)\b/i;

export function jobType(title) {
  if (EXCLUDE.test(title)) return null;
  if (RECRUITING.test(title) && !STUDENT.test(title)) return null;
  if (SOFT_EXCLUDE.test(title) && !STRONG_EARLY.test(title)) return null;
  for (const [type, re] of TYPES) if (re.test(title)) return type;
  return null;
}

// First match wins, so the specific fields come before the catch-all words.
const DISCIPLINES = [
  ['hardware', /\bdata cent(er|re)s?\b/i],
  ['quant', /\b(quant|quants|quantitative|trader|traders|trading|market making|strats?|algorithmic)\b/i],
  ['security', /\b(security|cyber|infosec|penetration|threat)\b/i],
  ['software', /\b(desktop support|it support|service desk|help ?desk|technical support|end user support|information communications technician|ict|network|networks|networking|internet|telecoms?)\b/i],
  ['data', /\b(data|machine learning|ml|ai|artificial intelligence|research scientist|research engineer|analytics|statistic(s|al|ian)?|deep learning|computer vision|nlp|llm)\b/i],
  ['hardware', /\b(hardware|electronic|electronics|electrical|analog|analogue|mixed[- ]signal|circuits?|ic design|power management|fpga|asic|soc|cpu|gpu|silicon|chip|embedded|firmware|vlsi|rf|mechanical|robotics|aerospace|aeronautical|avionics|mechatronics?|semiconductor|verification|physical design|photonics?|optical|civil|structural|chemical|nuclear|materials|manufacturing|propulsion|satellites?|spacecraft|space systems?|craft|machining|aerostructures?|aerosystems|structures|tool room|surface finisher|welding|fabrication|research and development|r&d|integrated logistics)\b/i],
  ['software', /\b(software|developer|developers|devops|development operations|sre|site reliability|cloud|full[- ]?stack|front[- ]?end|back[- ]?end|mobile|ios|android|web|technology|technologist|tech|programmer|programming|it|platform|infrastructure|computer science|application development|information systems)\b/i],
];
const ENGINEERING_RE = /\b(engineer|engineers|engineering|systems|architect|architecture)\b/i;
const PRODUCT_RE = /\b(product|design|designer|ux|ui|user research|user experience)\b/i;
const RESEARCH_RE = /\b(research|researcher|researchers)\b/i;

/**
 * hint: the employer's main field, from sources.mjs. It only settles titles that say no more than
 * "engineer" (hardware companies) or "researcher" (quant firms, AI labs).
 */
export function discipline(title, hint) {
  for (const [d, re] of DISCIPLINES) if (re.test(title)) return d;
  if (ENGINEERING_RE.test(title)) return hint === 'hardware' ? 'hardware' : 'software';
  if (PRODUCT_RE.test(title)) return 'product';
  if (RESEARCH_RE.test(title) && (hint === 'quant' || hint === 'data')) return hint;
  return 'business';
}

// Titles worth a second look when tuning the patterns above.
const NEAR_MISS_RE = /\b(intern|grad|graduate|placement|student|entry|junior|trainee|apprentic\w*|insight|spring|summer|campus|universit\w*|early|undergrad\w*|programme|program|scheme|academy|emerging|new talent|first year|associate|analyst)\b/i;

// ---------------------------------------------------------------- adapters

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const dateOnly = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

// Each adapter returns [{ id, title, location, url, posted?, old?, country?, ukConfirmed? }].
const adapters = {
  async greenhouse(src) {
    const j = await request(`https://boards-api.greenhouse.io/v1/boards/${src.board}/jobs`);
    return (j.jobs || []).map((x) => ({
      id: `gh:${src.board}:${x.id}`,
      title: clean(x.title),
      location: clean(x.location?.name),
      url: x.absolute_url,
      posted: dateOnly(x.first_published || x.updated_at),
    }));
  },
  async lever(src) {
    const j = await request(`https://api.lever.co/v0/postings/${src.board}?mode=json`);
    return (Array.isArray(j) ? j : []).map((x) => {
      const locs = [x.categories?.location, ...(x.categories?.allLocations || [])].filter(Boolean);
      return {
        id: `lv:${src.board}:${x.id}`,
        title: clean(x.text),
        location: clean([...new Set(locs)].join('; ')),
        country: x.country,
        url: x.hostedUrl,
        posted: dateOnly(x.createdAt),
      };
    });
  },
  async ashby(src) {
    const j = await request(`https://api.ashbyhq.com/posting-api/job-board/${src.board}`);
    return (j.jobs || []).filter((x) => x.isListed !== false).map((x) => {
      const locs = [x.location, ...(x.secondaryLocations || []).map((l) => l.location)].filter(Boolean);
      return {
        id: `ab:${src.board}:${x.id}`,
        title: clean(x.title),
        location: clean([...new Set(locs)].join('; ')),
        country: x.address?.postalAddress?.addressCountry,
        url: x.jobUrl,
        posted: dateOnly(x.publishedAt),
      };
    });
  },
  async workday(src) {
    // The same endpoint the career site calls. Find the site's UK location filter, then page through
    // UK roles only.
    const host = `${src.tenant}.wd${src.wd}.myworkdayjobs.com`;
    const api = `https://${host}/wday/cxs/${src.tenant}/${src.site}/jobs`;
    const post = (body) => request(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let appliedFacets = {};
    let expected = Infinity;
    if (!src.ukOnly) {
      const first = await post({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' });
      const uk = ukFilter(first.facets || []);
      if (!uk) throw new Error('no UK location filter on this site');
      ({ appliedFacets, expected } = uk);
    }
    const jobs = [];
    let total = 0;
    for (let offset = 0; offset < 1000; offset += 20) {
      const page = await post({ appliedFacets, limit: 20, offset, searchText: '' });
      if (offset === 0) {
        total = page.total ?? 0; // later pages report 0
        // If the site ignored the filter we'd be about to label every role worldwide as UK.
        if (total > expected * 1.5 + 20) throw new Error(`UK filter ignored (${total} results, expected about ${expected})`);
      }
      const list = page.jobPostings || [];
      for (const x of list) {
        if (!x.externalPath) continue;
        const n = (x.locationsText || '').match(/^(\d+) Locations$/i);
        jobs.push({
          id: `wd:${src.tenant}:${x.externalPath.split('_').pop()}`,
          title: clean(x.title),
          location: n ? `UK + ${n[1] - 1} other location${n[1] - 1 === 1 ? '' : 's'}` : clean(x.locationsText),
          ukConfirmed: true,
          url: `https://${host}/${src.site}${x.externalPath}`,
          ...workdayPosted(x.postedOn),
        });
      }
      if (list.length < 20 || offset + 20 >= total) break;
    }
    return jobs;
  },
};

/**
 * Pick a Workday site's UK filter. Facets nest, and each nested group carries its own parameter name:
 *   { facetParameter: 'locationMainGroup', values: [{ facetParameter: 'locationCountry', values: [...] }] }
 * Prefer a country value; otherwise every UK place in the location group that names the most of them.
 */
export function ukFilter(facets) {
  const groups = [];
  const walk = (param, values) => {
    const leaves = [];
    for (const v of values || []) {
      if (Array.isArray(v.values)) walk(v.facetParameter || param, v.values);
      else if (v.id) leaves.push(v);
    }
    if (leaves.length) groups.push({ param, values: leaves });
  };
  for (const f of facets) walk(f.facetParameter, f.values);

  const isCountry = (v) => /^(united kingdom|uk|great britain)$/i.test(clean(v.descriptor));
  const country = groups.find((g) => g.values.some(isCountry));
  const pick = country
    ? { param: country.param, values: country.values.filter(isCountry) }
    : groups
      .filter((g) => /location|site|cit(y|ies)|office/i.test(g.param))
      .map((g) => ({ param: g.param, values: g.values.filter((v) => isUK(v.descriptor)) }))
      .sort((a, b) => b.values.length - a.values.length)[0];
  if (!pick?.values.length) return null;
  return {
    appliedFacets: { [pick.param]: pick.values.map((v) => v.id) },
    expected: pick.values.reduce((sum, v) => sum + (v.count || 0), 0),
  };
}

/** "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
function workdayPosted(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('today')) return { posted: daysAgo(0) };
  if (t.includes('yesterday')) return { posted: daysAgo(1) };
  if (/\d+\+\s*days?/.test(t)) return { old: true }; // a month or more; the exact date isn't shown
  const m = t.match(/(\d+)\s+days?\s+ago/);
  return m ? { posted: daysAgo(Number(m[1])) } : {};
}

// ---------------------------------------------------------------- main

async function main() {
  await mkdir(path.dirname(OUT), { recursive: true });
  let prev = { jobs: [], sources: [] };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }
  const prevById = new Map(prev.jobs.map((j) => [j.id, j]));

  const current = new Map();
  const seen = new Set(); // every role id the boards listed, UK and early-career or not
  const failed = new Set();
  const sources = [];
  const nearMiss = process.env.NEAR_MISS ? [] : null; // NEAR_MISS=1 lists UK titles that were left out
  for (const src of SOURCES) {
    const key = `${src.ats}:${src.board || src.tenant}`;
    try {
      const all = await adapters[src.ats](src);
      let uk = 0;
      let kept = 0;
      for (const j of all) {
        seen.add(j.id);
        const inUK = src.ukOnly || j.ukConfirmed || /^(gb|gbr|uk|united kingdom|great britain)$/i.test(j.country || '') || isUK(j.location);
        if (!inUK) continue;
        uk++;
        const type = jobType(j.title);
        if (!type) {
          if (nearMiss && NEAR_MISS_RE.test(j.title)) nearMiss.push(`${src.company} | ${j.title}`);
          continue;
        }
        kept++;
        current.set(j.id, { ...j, company: src.company, type, discipline: discipline(j.title, src.field) });
      }
      sources.push({ company: src.company, ats: src.ats, open: kept, uk, total: all.length, ok: true });
      console.log(`${src.company.padEnd(30)} ${String(kept).padStart(3)} early-career of ${String(uk).padStart(4)} UK roles (${all.length} on board)`);
    } catch (err) {
      failed.add(key);
      const before = prev.sources.find((s) => s.company === src.company && s.ats === src.ats);
      sources.push({ company: src.company, ats: src.ats, open: before?.open ?? 0, uk: before?.uk ?? 0, total: before?.total ?? 0, ok: false, error: err.message });
      warn(`${src.company} (${src.ats}): ${err.message}`);
    }
  }

  const sourceKeyOf = (job) => {
    const [ats, board] = job.id.split(':');
    return `${{ gh: 'greenhouse', lv: 'lever', ab: 'ashby', wd: 'workday' }[ats]}:${board}`;
  };
  const activeKeys = new Set(SOURCES.map((src) => `${src.ats}:${src.board || src.tenant}`));
  const cutoff = daysAgo(KEEP_CLOSED_DAYS);
  const jobs = [];
  for (const [id, j] of current) {
    const old = prevById.get(id);
    // Keep the first posting date we learn: some boards bump dates when a role is edited.
    let posted = old?.posted ?? j.posted ?? null;
    if (posted && posted > today) posted = today;
    let firstSeen = old?.firstSeen;
    let approx = old?.approx ?? false;
    if (!firstSeen) {
      if (posted) firstSeen = posted;
      else if (j.old) { firstSeen = daysAgo(30); approx = true; } // listed for 30+ days already
      else firstSeen = today;
    }
    jobs.push({
      id,
      company: j.company,
      title: j.title,
      type: j.type,
      discipline: j.discipline,
      location: j.location || 'United Kingdom',
      url: j.url,
      ...(posted ? { posted } : {}),
      firstSeen,
      ...(approx && !posted ? { approx: true } : {}),
    });
  }
  for (const old of prev.jobs) {
    if (current.has(old.id)) continue;
    const key = sourceKeyOf(old);
    if (!activeKeys.has(key)) continue; // board removed from sources.mjs
    if (failed.has(key)) { jobs.push(old); continue; } // board unreadable: keep as it was
    if (seen.has(old.id)) continue; // still advertised, but no longer counts as UK early-career
    const closed = old.closed ?? today;
    if (closed >= cutoff) jobs.push({ ...old, closed });
  }
  jobs.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.company.localeCompare(b.company) || a.title.localeCompare(b.title));

  if (nearMiss) console.log(`\nUK titles left out that look early-career (${nearMiss.length}):\n${nearMiss.sort().join('\n')}\n`);

  const comparable = (d) => JSON.stringify({ jobs: d.jobs, sources: d.sources.map(({ company, ats, open, ok }) => ({ company, ats, open, ok })) });
  const next = { updated: new Date().toISOString(), sources, jobs };
  const okCount = sources.filter((s) => s.ok).length;
  if (prev.jobs.length && comparable(prev) === comparable(next)) {
    console.log(`no changes (${okCount}/${sources.length} boards read)`);
    return;
  }
  const lines = jobs.map((j) => `    ${JSON.stringify(j)}`).join(',\n');
  await writeFile(OUT, `{\n  "updated": ${JSON.stringify(next.updated)},\n  "sources": [\n${sources.map((s) => `    ${JSON.stringify(s)}`).join(',\n')}\n  ],\n  "jobs": [\n${lines}\n  ]\n}\n`);
  const open = jobs.filter((j) => !j.closed).length;
  console.log(`wrote ${jobs.length} roles (${open} open) from ${okCount}/${sources.length} boards`);
}

const runDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (runDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
