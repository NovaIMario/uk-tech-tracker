import { h, $, fmtInt, plural, fmtDate, daysSince, timeAgo, store, censor, todayISO, isoDaysAgo } from './dom.js';
import { barChart, chartCard, releaseCharts } from './charts.js';

const TYPES = {
  internship: ['Internship', 'Internships'],
  placement: ['Placement', 'Placements'],
  insight: ['Spring week / insight', 'Spring weeks'],
  graduate: ['Graduate', 'Graduate & entry level'],
  apprenticeship: ['Apprenticeship', 'Apprenticeships'],
};
const DISCIPLINES = {
  software: 'Software engineering',
  data: 'Data & AI',
  quant: 'Quant & trading',
  hardware: 'Hardware & engineering',
  security: 'Cyber security',
  product: 'Product & design',
  business: 'Business & other',
};
const STATUSES = [
  ['', 'Not tracked'],
  // 'tracked' is the "All tracked" chip, not a status a role can have.
  ['saved', 'Saved'],
  ['applied', 'Applied'],
  ['interview', 'Interviewing'],
  ['offer', 'Offer'],
  ['rejected', 'Rejected'],
  ['hidden', 'Not interested'],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const CITIES = ['London', 'Cambridge', 'Oxford', 'Edinburgh', 'Manchester', 'Bristol', 'Glasgow', 'Belfast', 'Reading', 'Leeds', 'Birmingham'];
// since: only roles posted (or first seen) on or after this date, YYYY-MM-DD.
const DEFAULTS = { q: '', type: 'all', disc: 'tech', company: 'all', loc: 'all', since: '', status: 'all', closed: false, sort: 'new' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 40;

const state = {
  data: null,
  f: { ...DEFAULTS },
  limit: PAGE,
  tracked: loadTracked(),
};

// ---------------------------------------------------------------- application tracking (this browser only)

function loadTracked() {
  try { return JSON.parse(store('ect-tracked') || '{}') || {}; } catch { return {}; }
}
function saveTracked() {
  store('ect-tracked', JSON.stringify(state.tracked));
}
function setStatus(job, status) {
  if (!status) delete state.tracked[job.id];
  else state.tracked[job.id] = { status, updated: new Date().toISOString().slice(0, 10), company: job.company, title: job.title, url: job.url, type: job.type };
  saveTracked();
}
const statusOf = (id) => state.tracked[id]?.status || '';

function exportTracked() {
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), tracked: state.tracked }, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'my-applications.json' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
function importTracked(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incoming = JSON.parse(reader.result).tracked;
      if (!incoming || typeof incoming !== 'object') throw new Error('No applications found in that file.');
      let n = 0;
      for (const [id, v] of Object.entries(incoming)) {
        if (!v || !STATUS_LABEL[v.status] || v.status === '') continue;
        state.tracked[id] = { status: v.status, updated: String(v.updated || ''), company: String(v.company || ''), title: String(v.title || ''), url: String(v.url || ''), type: String(v.type || '') };
        n++;
      }
      saveTracked();
      render();
      flash(`Imported ${plural(n, 'application')}.`);
    } catch (err) {
      flash(`Couldn't import that file: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function flash(msg) {
  const el = $('#flash');
  el.textContent = censor(msg);
  el.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------------------------------------------------------------- filtering

function cityOf(job) {
  const loc = job.location || '';
  for (const c of CITIES) if (new RegExp(`\\b${c}\\b`, 'i').test(loc)) return c;
  if (/remote|home/i.test(loc)) return 'Remote';
  return 'Elsewhere in the UK';
}

const addedOn = (j) => j.firstSeen;

// Your own list (a status chip) shows every role you tracked with that status, open, closed or no
// longer listed, whatever the field, employer, location and date filters say. Search and type still apply.
function matches(job, f, { ignore = '' } = {}) {
  const st = statusOf(job.id);
  if (f.status !== 'all') {
    if (f.status === 'tracked' ? !st || st === 'hidden' : st !== f.status) return false;
  } else {
    if (st === 'hidden') return false;
    if (job.closed && !f.closed) return false;
    if (f.disc === 'tech' ? job.discipline === 'business' : f.disc !== 'all' && job.discipline !== f.disc) return false;
    if (f.company !== 'all' && job.company !== f.company) return false;
    if (f.loc !== 'all' && cityOf(job) !== f.loc) return false;
    // A "30+ days ago" date is only an upper bound, so it never counts as falling on the cut-off day.
    if (f.since && (addedOn(job) < f.since || (job.approx && addedOn(job) === f.since))) return false;
  }
  if (ignore !== 'type' && f.type !== 'all' && job.type !== f.type) return false;
  if (f.q) {
    const hay = `${job.title} ${job.company} ${job.location} ${TYPES[job.type][0]} ${DISCIPLINES[job.discipline]}`.toLowerCase();
    const words = f.q.toLowerCase().replace(/j\*b/g, 'job').split(/\s+/).filter(Boolean);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

function sorted(list) {
  const f = state.f;
  const byNew = (a, b) => addedOn(b).localeCompare(addedOn(a)) || a.company.localeCompare(b.company);
  if (f.sort === 'company') return list.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  return list.sort(byNew);
}

// Tracked roles that have dropped out of the data still show in "My applications".
function archivedTracked() {
  const known = new Set(state.data.jobs.map((j) => j.id));
  return Object.entries(state.tracked)
    .filter(([id, v]) => !known.has(id) && v.status !== 'hidden')
    .map(([id, v]) => ({ id, company: v.company, title: v.title, url: v.url, type: TYPES[v.type] ? v.type : 'graduate', discipline: 'business', location: '', firstSeen: v.updated || '2000-01-01', archived: true, closed: v.updated }));
}

// ---------------------------------------------------------------- URL state

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const f = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (!p.has(k)) continue;
    f[k] = typeof DEFAULTS[k] === 'boolean' ? p.get(k) === '1' : p.get(k);
  }
  if (!ISO_DATE.test(f.since)) f.since = '';
  return f;
}
function writeHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.f)) {
    if (v === DEFAULTS[k]) continue;
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
  }
  const hash = p.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

function setFilter(patch) {
  Object.assign(state.f, patch);
  state.limit = PAGE;
  writeHash();
  render();
}

// ---------------------------------------------------------------- rendering

function tile(label, value, active, onclick, sub) {
  return h('button', { class: `tile${active ? ' active' : ''}`, type: 'button', 'aria-pressed': String(active), onclick },
    h('span', { class: 'tile-value' }, fmtInt(value)),
    h('span', { class: 'tile-label' }, label),
    sub ? h('span', { class: 'tile-sub' }, sub) : null);
}

function renderTiles() {
  const base = state.data.jobs.filter((j) => matches(j, state.f, { ignore: 'type' }));
  const count = (t) => base.filter((j) => j.type === t).length;
  const fresh = base.filter((j) => daysSince(addedOn(j)) <= 7).length;
  $('#tiles').replaceChildren(
    tile('All roles', base.length, state.f.type === 'all', () => setFilter({ type: 'all' }), `${fmtInt(fresh)} added this week`),
    ...Object.entries(TYPES).map(([t, [, many]]) => tile(many, count(t), state.f.type === t, () => setFilter({ type: state.f.type === t ? 'all' : t }))));
}

// The date a quick-date chip stands for: "Any time" is no date, the others n days back.
const quickDate = (b) => (b.dataset.days ? isoDaysAgo(Number(b.dataset.days)) : '');

function option(value, label, selected) {
  return h('option', { value, selected: selected === value }, label);
}

function renderFilters() {
  const f = state.f;
  const jobs = state.data.jobs.filter((j) => !j.closed || f.closed);
  const companies = [...new Set(jobs.map((j) => j.company))].sort((a, b) => a.localeCompare(b));
  const cityCounts = {};
  for (const j of jobs) { const c = cityOf(j); cityCounts[c] = (cityCounts[c] || 0) + 1; }
  const cities = Object.keys(cityCounts).sort((a, b) => cityCounts[b] - cityCounts[a]);

  const search = $('#q');
  if (document.activeElement !== search) search.value = f.q;
  $('#disc').replaceChildren(
    option('tech', 'All tech roles', f.disc),
    ...Object.entries(DISCIPLINES).map(([k, v]) => option(k, k === 'business' ? 'Non-tech roles' : v, f.disc)),
    option('all', 'Every role', f.disc));
  $('#company').replaceChildren(option('all', `All employers (${companies.length})`, f.company), ...companies.map((c) => option(c, c, f.company)));
  $('#loc').replaceChildren(option('all', 'Anywhere in the UK', f.loc), ...cities.map((c) => option(c, `${c} (${cityCounts[c]})`, f.loc)));
  $('#sort').value = f.sort;
  const since = $('#since');
  if (document.activeElement !== since) since.value = f.since;
  since.max = todayISO();
  since.min = state.data.jobs.reduce((min, j) => (j.firstSeen < min ? j.firstSeen : min), todayISO());
  for (const b of document.querySelectorAll('.quick-date')) b.setAttribute('aria-pressed', String(f.since === quickDate(b)));
  $('#closed').checked = f.closed;
  $('#reset').hidden = JSON.stringify(f) === JSON.stringify({ ...DEFAULTS, status: f.status });
  updateMoreFilters();
}

// Phones: everything but search sits behind "More filters"; the button says how many are on.
function updateMoreFilters() {
  const f = state.f;
  const on = [f.disc !== DEFAULTS.disc, f.company !== 'all', f.loc !== 'all', f.since, f.closed].filter(Boolean).length;
  const open = $('.filters').classList.contains('open');
  const btn = $('#more-filters');
  btn.setAttribute('aria-expanded', String(open));
  btn.textContent = open ? 'Hide filters' : `More filters${on ? ` (${on} on)` : ''}`;
}

function renderTracker() {
  const counts = {};
  for (const v of Object.values(state.tracked)) counts[v.status] = (counts[v.status] || 0) + 1;
  const chip = (value, label, n) => h('button', {
    class: `chip-btn${state.f.status === value ? ' active' : ''}`,
    type: 'button',
    'aria-pressed': String(state.f.status === value),
    onclick: () => setFilter({ status: state.f.status === value ? 'all' : value }),
  }, label, h('span', { class: 'count' }, fmtInt(n)));
  const tracked = Object.values(state.tracked).filter((v) => v.status !== 'hidden').length;
  $('#tracker-chips').replaceChildren(
    chip('tracked', 'All tracked', tracked),
    ...STATUSES.slice(1).map(([v, label]) => chip(v, label, counts[v] || 0)));
}

function statusSelect(job) {
  const sel = h('select', {
    class: `status-select s-${statusOf(job.id) || 'none'}`,
    'aria-label': `Your status for ${job.title} at ${job.company}`,
    onchange: (e) => {
      setStatus(job, e.target.value);
      e.target.className = `status-select s-${e.target.value || 'none'}`;
      renderTracker();
      if (state.f.status !== 'all' || e.target.value === 'hidden') {
        render();
        flash(e.target.value === 'hidden' ? `Hid ${job.title}. Find it again under "Not interested".` : 'Saved.');
      }
    },
  }, STATUSES.map(([v, label]) => option(v, label, statusOf(job.id))));
  return sel;
}

function dateLabel(job) {
  if (job.archived) return 'No longer listed';
  if (job.closed) return `Closed ${fmtDate(job.closed)}`;
  if (job.posted) return `Posted ${fmtDate(job.posted, daysSince(job.posted) > 300)}`;
  if (job.approx) return 'Posted 30+ days ago';
  return `Added ${fmtDate(job.firstSeen, daysSince(job.firstSeen) > 300)}`;
}

function jobRow(job) {
  const added = addedOn(job);
  const isNew = !job.closed && !job.archived && daysSince(added) <= 3;
  return h('article', { class: `job${job.closed ? ' is-closed' : ''}` },
    h('div', { class: 'job-main' },
      h('div', { class: 'job-company' }, job.company),
      h('h3', { class: 'job-title' }, h('a', { href: job.url, target: '_blank', rel: 'noopener' }, job.title)),
      h('div', { class: 'job-meta' },
        h('span', { class: `type type-${job.type}` }, TYPES[job.type][0]),
        job.archived ? null : h('span', null, DISCIPLINES[job.discipline]),
        job.location ? h('span', null, job.location) : null,
        h('span', { class: job.closed || job.archived ? 'closed' : null }, dateLabel(job)),
        isNew ? h('span', { class: 'badge-new' }, 'New') : null)),
    h('div', { class: 'job-side' },
      statusSelect(job),
      h('a', { class: 'btn primary small', href: job.url, target: '_blank', rel: 'noopener', 'aria-label': `Apply: ${job.title} at ${job.company}` }, job.closed ? 'View' : 'Apply')));
}

function renderList() {
  const f = state.f;
  const own = f.status !== 'all';
  let list = state.data.jobs.filter((j) => matches(j, f));
  if (own) list = list.concat(archivedTracked().filter((j) => matches(j, f)));
  list = sorted(list);
  const shown = list.slice(0, state.limit);
  $('#count').replaceChildren(...[
    own ? `${plural(list.length, 'role')} marked ${STATUS_LABEL[f.status] ? `“${STATUS_LABEL[f.status]}”` : 'by you'}`
      : list.length ? `${plural(list.length, 'role')}${f.since ? ` posted since ${fmtDate(f.since, true)}` : ''}` : '',
    own ? h('button', { class: 'linkish', type: 'button', onclick: () => setFilter({ status: 'all' }) }, 'Back to all roles') : null,
  ].filter(Boolean)); // replaceChildren would print a null as the text "null"
  // The field, employer, location and date filters don't apply to your own list, so switch them off.
  for (const el of document.querySelectorAll('#disc, #company, #loc, #since, .quick-date, #closed')) el.disabled = own;
  $('#results').replaceChildren(...(shown.length ? shown.map(jobRow) : [h('div', { class: 'empty' },
    h('p', null, own ? 'Nothing here yet. Use the status menu on any role to track it.' : 'No roles match these filters.'),
    !own && JSON.stringify(f) !== JSON.stringify(DEFAULTS) ? h('button', { class: 'btn small', type: 'button', onclick: () => setFilter({ ...DEFAULTS }) }, 'Clear filters') : null)]));
  const more = $('#more');
  more.hidden = shown.length >= list.length;
  more.textContent = `Show ${Math.min(PAGE, list.length - shown.length)} more`;
  return list;
}

function renderHiring(list) {
  const host = $('#hiring');
  releaseCharts(host);
  const counts = new Map();
  for (const j of list) if (!j.archived) counts.set(j.company, (counts.get(j.company) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10);
  if (top.length < 2) { host.replaceChildren(); return; }
  const items = top.map(([company, n]) => ({
    label: company,
    value: n,
    valueLabel: fmtInt(n),
    tip: () => ({ title: company, rows: [{ value: plural(n, 'role'), label: 'matching your filters', key: 'bar' }] }),
  }));
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  host.replaceChildren(chartCard({
    title: 'Who has the most roles open',
    subtitle: 'Top employers for the current filters. Click a bar to see only that employer.',
    draw: (el) => barChart(el, items, {
      aria: 'Bar chart of the employers with the most matching roles. Use the arrow keys to read each bar and Enter to show only that employer.',
      labelShare: 0.5,
      onSelect: (i) => setFilter({ company: top[i][0] }),
    }),
    table: () => ({ head: ['Employer', 'Roles'], numeric: [1], rows: all.map(([c, n]) => [c, fmtInt(n)]) }),
  }));
}

function renderSources() {
  const rows = [...state.data.sources].sort((a, b) => b.open - a.open || b.uk - a.uk || a.company.localeCompare(b.company));
  const board = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', amazon: 'Careers site', eightfold: 'Careers site', sitemap: 'Careers site' };
  const failing = rows.filter((s) => !s.ok);
  const open = rows.reduce((n, s) => n + s.open, 0);
  $('#sources-summary').textContent = censor(`${plural(rows.length, 'employer job board')}, with ${plural(open, 'early-career UK role')} between them. Last changed ${timeAgo(state.data.updated)}.${failing.length ? ` ${plural(failing.length, 'board')} couldn't be read on the last run (usually because the site was limiting requests), so their roles were kept from the last good read.` : ''}`);
  $('#sources-table').replaceChildren(h('table', { class: 'data' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Employer'),
      h('th', { scope: 'col' }, 'Job board'),
      h('th', { scope: 'col', class: 'num' }, 'Early-career UK roles'),
      h('th', { scope: 'col', class: 'num' }, 'All UK roles'))),
    h('tbody', null, rows.map((s) => h('tr', null,
      h('td', null, s.company, s.ok ? null : h('span', { class: 'warn', title: s.error || '' }, s.read ? ` · not read since ${fmtDate(s.read.slice(0, 10))}` : ' · not read last time')),
      h('td', null, board[s.ats] || s.ats),
      h('td', { class: 'num' }, fmtInt(s.open)),
      // Employers read through a search for early-career roles have no count of all their UK roles.
      s.uk == null ? h('td', { class: 'num', title: 'Read through a search for early-career roles, so there is no count of all UK roles' }, '—') : h('td', { class: 'num' }, fmtInt(s.uk)))))));
}

function render() {
  if (!state.data) return;
  renderTiles();
  renderFilters();
  renderTracker();
  const list = renderList();
  renderHiring(list.filter((j) => !j.closed));
}

// ---------------------------------------------------------------- boot

function initTheme() {
  const btn = $('#theme-toggle');
  const current = () => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => btn.setAttribute('aria-label', current() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  label();
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store('theme', next);
    label();
  });
}

function initControls() {
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => setFilter({ q: e.target.value.trim() }), 160);
  });
  $('#disc').addEventListener('change', (e) => setFilter({ disc: e.target.value }));
  $('#company').addEventListener('change', (e) => setFilter({ company: e.target.value }));
  $('#loc').addEventListener('change', (e) => setFilter({ loc: e.target.value }));
  $('#sort').addEventListener('change', (e) => setFilter({ sort: e.target.value }));
  // A full date (or a cleared field) fires "change"; half-typed dates don't.
  $('#since').addEventListener('change', (e) => setFilter({ since: ISO_DATE.test(e.target.value) ? e.target.value : '' }));
  for (const b of document.querySelectorAll('.quick-date')) b.addEventListener('click', () => setFilter({ since: quickDate(b) }));
  $('#closed').addEventListener('change', (e) => setFilter({ closed: e.target.checked }));
  $('#reset').addEventListener('click', () => setFilter({ ...DEFAULTS, status: state.f.status }));
  $('#more-filters').addEventListener('click', () => {
    $('.filters').classList.toggle('open');
    updateMoreFilters();
  });
  $('#more').addEventListener('click', () => { state.limit += PAGE; renderList(); });
  $('#export').addEventListener('click', exportTracked);
  $('#import-file').addEventListener('change', (e) => { if (e.target.files[0]) importTracked(e.target.files[0]); e.target.value = ''; });
  $('#import').addEventListener('click', () => $('#import-file').click());
  window.addEventListener('hashchange', () => { state.f = readHash(); render(); });
}

async function init() {
  initTheme();
  initControls();
  state.f = readHash();
  try {
    const res = await fetch('data/jobs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
  } catch (err) {
    $('#results').replaceChildren(h('div', { class: 'empty' }, h('p', null, `Couldn't load the roles (${err.message}). Try again in a minute.`)));
    return;
  }
  $('#updated').textContent = `Updated ${timeAgo(state.data.updated)}`;
  render();
  renderSources();
}

init();
