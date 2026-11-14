// DOM and formatting helpers. Text always goes in as text nodes, never as HTML.

/** House style: the word "job" is too rude to print, so it shows as "j*b" (J*b, j*bs, J*BS). */
export const censor = (s) => String(s).replace(/(j)o(b)/gi, '$1*$2');

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(censor(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const fmtInt = (n) => Math.round(n).toLocaleString('en-GB');
export const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

const asDate = (s) => new Date(`${s}T12:00:00Z`);
export const fmtDate = (s, withYear = false) => asDate(s).toLocaleDateString('en-GB', {
  timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}),
});
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
export const daysSince = (s) => Math.round((asDate(todayISO()) - asDate(s)) / 864e5);
/** The UK date n days ago, YYYY-MM-DD. */
export function isoDaysAgo(n) {
  const d = asDate(todayISO());
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

export function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable (private mode or blocked) */ }
  return null;
}
