// A small SVG chart kit.
// Thin bars with a 4px rounded data end, solid hairline grid, text in ink colours (never the
// series colour), a tooltip on every mark (pointer and keyboard), and a table view for every chart.

import { h, fmtInt } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function s(name, attrs, parent) {
  const el = document.createElementNS(NS, name);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}
function text(parent, x, y, str, cls, anchor = 'start') {
  const t = s('text', { x, y, class: cls, 'text-anchor': anchor }, parent);
  t.textContent = str;
  return t;
}

const measureCtx = document.createElement('canvas').getContext('2d');
export function textWidth(str, size = 12, weight = 400) {
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(String(str)).width;
}

export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw * 0.999);
  const ticks = [];
  for (let i = 0; ; i++) {
    const v = Number((i * step).toPrecision(12));
    ticks.push(v);
    if (v >= max * 0.999) break;
  }
  return ticks;
}
const tickLabel = (v) => (Number.isInteger(v) ? fmtInt(v) : String(Number(v.toFixed(3))));

// Rounded data end, square at the baseline.
function columnPath(x, top, w, hgt, r = 4) {
  r = Math.min(r, w / 2, hgt);
  const b = top + hgt;
  return `M${x},${b}V${top + r}A${r},${r} 0 0 1 ${x + r},${top}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${top + r}V${b}Z`;
}
function rowPath(x, y, w, hgt, r = 4) {
  r = Math.min(r, hgt / 2, w);
  const e = x + w;
  return `M${x},${y}H${e - r}A${r},${r} 0 0 1 ${e},${y + r}V${y + hgt - r}A${r},${r} 0 0 1 ${e - r},${y + hgt}H${x}Z`;
}

// ---------------------------------------------------------------- tooltip

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = h('div', { class: 'viz-tip', role: 'status', 'aria-live': 'polite' });
    tipEl.hidden = true;
    document.body.append(tipEl);
  }
  return tipEl;
}
/** content = { title, rows: [{ value, label, key }] }; values lead, labels follow. */
export function showTip(content, at) {
  const el = tip();
  el.replaceChildren(...[
    content.title ? h('div', { class: 'tip-title' }, content.title) : null,
    ...content.rows.map((r) => h('div', { class: 'tip-row' },
      r.key ? h('span', { class: `tip-key ${r.key}`, 'aria-hidden': 'true' }) : null,
      h('strong', null, r.value),
      r.label ? h('span', { class: 'tip-label' }, r.label) : null)),
  ].filter(Boolean));
  el.hidden = false;
  const pad = 14;
  const { offsetWidth: w, offsetHeight: hh } = el;
  let x = at.x + pad;
  let y = at.y - hh - pad;
  if (x + w > window.innerWidth - 8) x = at.x - w - pad;
  x = Math.max(8, x);
  if (y < 8) y = at.y + pad;
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
export function hideTip() {
  if (tipEl) tipEl.hidden = true;
}

/** Shared hover/keyboard behaviour: index-based marks inside one SVG. onSelect (optional) runs on click or Enter. */
function interact(root, count, locate, onActivate, anchorOf, onSelect) {
  let active = -1;
  const set = (i, at) => {
    if (i === active && !at) return;
    active = i;
    onActivate(i);
    if (i < 0) return hideTip();
    const r = root.getBoundingClientRect();
    const a = anchorOf(i);
    showTip(a.tip, at || { x: r.left + a.x, y: r.top + a.y });
  };
  const fromPointer = (e) => {
    const r = root.getBoundingClientRect();
    const i = locate(e.clientX - r.left, e.clientY - r.top);
    set(i, i >= 0 ? { x: e.clientX, y: e.clientY } : null);
  };
  root.addEventListener('pointermove', fromPointer);
  root.addEventListener('pointerdown', fromPointer);
  root.addEventListener('pointerleave', () => set(-1));
  root.addEventListener('blur', () => set(-1));
  root.addEventListener('focus', () => { if (root.matches(':focus-visible') && active < 0) set(0); });
  root.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      set(active < 0 ? (step > 0 ? 0 : count - 1) : Math.max(0, Math.min(count - 1, active + step)));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      set(e.key === 'Home' ? 0 : count - 1);
    } else if (e.key === 'Escape') set(-1);
    else if (onSelect && (e.key === 'Enter' || e.key === ' ') && active >= 0) {
      e.preventDefault();
      hideTip();
      onSelect(active);
    }
  });
  if (onSelect) {
    root.style.cursor = 'pointer';
    root.addEventListener('click', (e) => {
      const r = root.getBoundingClientRect();
      const i = locate(e.clientX - r.left, e.clientY - r.top);
      if (i >= 0) { hideTip(); onSelect(i); }
    });
  }
}

/** Shorten a label with an ellipsis so it fits in maxWidth pixels. */
function fitLabel(str, size, maxWidth) {
  if (textWidth(str, size) <= maxWidth) return str;
  let s = str;
  while (s.length > 1 && textWidth(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// ---------------------------------------------------------------- column chart

/**
 * Vertical columns. items: [{ label, value, marker?, tip: () => content }]
 * opts: { height, ref: { value, lo, hi }, xLabel(i) -> string|null, extremes, aria, gap }
 */
export function columnChart(host, items, opts = {}) {
  host.replaceChildren();
  const W = Math.max(240, Math.floor(host.clientWidth));
  const H = opts.height ?? 220;
  const m = { top: 20, right: 4, bottom: 24, left: 34 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  const peak = Math.max(1e-9, ...items.map((d) => Math.max(d.value, d.marker ?? 0)), opts.ref?.hi ?? opts.ref?.value ?? 0);
  const ticks = niceTicks(peak);
  const top = ticks[ticks.length - 1];
  const y = (v) => m.top + ph - (v / top) * ph;
  const band = pw / items.length;
  const bw = Math.max(1.5, Math.min(24, opts.gap != null ? band - opts.gap : band * 0.62));

  const root = s('svg', { class: 'viz', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria, tabindex: 0 });
  for (const t of ticks.slice(1)) {
    const yy = Math.round(y(t)) + 0.5;
    s('line', { class: 'grid', x1: m.left, x2: W - m.right, y1: yy, y2: yy }, root);
  }
  for (const t of ticks) text(root, m.left - 6, Math.round(y(t)) + 4, tickLabel(t), 'tick', 'end');

  if (opts.ref?.lo != null) {
    const y1 = y(Math.min(opts.ref.hi, top));
    s('rect', { class: 'ref-band', x: m.left, width: pw, y: y1, height: Math.max(0, y(Math.max(0, opts.ref.lo)) - y1) }, root);
  }

  const bars = items.map((d, i) => {
    const x = m.left + band * i + (band - bw) / 2;
    const hgt = y(0) - y(d.value);
    return hgt > 0.25 ? s('path', { class: 'bar', d: columnPath(x, y(d.value), bw, hgt) }, root) : null;
  });

  if (opts.ref?.value != null) {
    const yy = Math.round(y(opts.ref.value)) + 0.5;
    s('line', { class: 'ref-line', x1: m.left, x2: W - m.right, y1: yy, y2: yy }, root);
  }

  const markers = items.map((d, i) => (d.marker == null ? null
    : s('circle', { class: 'marker', cx: m.left + band * (i + 0.5), cy: y(d.marker), r: 4 }, root)));

  const base = Math.round(y(0)) + 0.5;
  s('line', { class: 'axis', x1: m.left, x2: W - m.right, y1: base, y2: base }, root);

  // x labels: thinned to every 2nd/5th/10th so they never collide (1, 5, 10, 15... for numbers)
  const widest = Math.max(...items.map((d) => textWidth(d.label, 11)));
  const every = [1, 2, 5, 10, 20].find((k) => band * k >= widest + 6) ?? 25;
  items.forEach((d, i) => {
    const show = opts.xLabel ? opts.xLabel(i, every) : (i + 1) % every === 0 || (i === 0 && every >= 4);
    if (show) text(root, m.left + band * (i + 0.5), H - 7, typeof show === 'string' ? show : d.label, 'tick', 'middle');
  });

  // Direct labels only on the extremes: the tallest and the shortest column.
  if (opts.extremes && items.length > 2) {
    let hi = 0;
    let lo = 0;
    items.forEach((d, i) => {
      if (d.value > items[hi].value) hi = i;
      if (d.value < items[lo].value) lo = i;
    });
    for (const i of Math.abs(hi - lo) > 1 ? [hi, lo] : [hi]) {
      const cx = m.left + band * (i + 0.5);
      const x = Math.max(m.left + 10, Math.min(W - m.right - 10, cx));
      text(root, x, y(items[i].value) - 6, tickLabel(items[i].value), 'value-label', 'middle');
    }
  }

  interact(root, items.length,
    (px, py) => (py < m.top - 12 || py > H || px < m.left || px > W - m.right ? -1 : Math.min(items.length - 1, Math.floor((px - m.left) / band))),
    (i) => {
      bars.forEach((b, j) => b?.classList.toggle('active', j === i));
      markers.forEach((c, j) => c?.classList.toggle('active', j === i));
    },
    (i) => ({ x: m.left + band * (i + 0.5), y: y(Math.max(items[i].value, items[i].marker ?? 0)), tip: items[i].tip() }));

  host.append(root);
}

// ---------------------------------------------------------------- horizontal bar chart

/**
 * Horizontal bars, one row per item: [{ label, value, valueLabel, tip: () => content }]
 * opts: { ref: { value, lo, hi }, rowHeight, aria, max, labelShare (of width, default 0.4), onSelect(i) }
 */
export function barChart(host, items, opts = {}) {
  host.replaceChildren();
  const W = Math.max(240, Math.floor(host.clientWidth));
  const rowH = opts.rowHeight ?? 27;
  const thick = 14;
  const labelW = Math.min(Math.round(W * (opts.labelShare ?? 0.4)), 14 + Math.max(...items.map((d) => textWidth(d.label, 12.5))));
  const valueW = 10 + Math.max(...items.map((d) => textWidth(d.valueLabel, 11.5, 600)));
  const m = { top: 4, right: Math.max(valueW, 16), bottom: 24, left: labelW };
  const pw = W - m.left - m.right;
  const H = m.top + rowH * items.length + m.bottom;
  const peak = opts.max ?? Math.max(1e-9, ...items.map((d) => d.value), opts.ref?.hi ?? opts.ref?.value ?? 0);
  const ticks = niceTicks(peak, W < 420 ? 3 : 4);
  const top = ticks[ticks.length - 1];
  const x = (v) => m.left + (v / top) * pw;
  const plotBottom = m.top + rowH * items.length;

  const root = s('svg', { class: 'viz', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria, tabindex: 0 });
  for (const t of ticks) {
    const xx = Math.round(x(t)) + 0.5;
    if (t > 0) s('line', { class: 'grid', x1: xx, x2: xx, y1: m.top, y2: plotBottom }, root);
    text(root, xx, H - 7, tickLabel(t), 'tick', 'middle');
  }
  if (opts.ref?.lo != null) {
    const x1 = x(Math.max(0, opts.ref.lo));
    s('rect', { class: 'ref-band', x: x1, width: Math.max(0, x(opts.ref.hi) - x1), y: m.top, height: plotBottom - m.top }, root);
  }
  const bars = items.map((d, i) => {
    const yy = m.top + rowH * i + (rowH - thick) / 2;
    text(root, 0, yy + thick / 2 + 4.5, fitLabel(d.label, 12.5, labelW - 12), 'row-label');
    const w = x(d.value) - x(0);
    const bar = w > 0.25 ? s('path', { class: 'bar', d: rowPath(x(0), yy, w, thick) }, root) : null;
    text(root, x(d.value) + 6, yy + thick / 2 + 4, d.valueLabel, 'value-label');
    return bar;
  });
  if (opts.ref?.value != null) {
    const xx = Math.round(x(opts.ref.value)) + 0.5;
    s('line', { class: 'ref-line', x1: xx, x2: xx, y1: m.top - 2, y2: plotBottom + 2 }, root);
  }
  const base = Math.round(x(0)) + 0.5;
  s('line', { class: 'axis', x1: base, x2: base, y1: m.top, y2: plotBottom }, root);

  interact(root, items.length,
    (px, py) => (py < m.top || py > plotBottom ? -1 : Math.min(items.length - 1, Math.floor((py - m.top) / rowH))),
    (i) => bars.forEach((b, j) => b?.classList.toggle('active', j === i)),
    (i) => ({ x: x(items[i].value), y: m.top + rowH * i + 4, tip: items[i].tip() }),
    opts.onSelect);

  host.append(root);
}

// ---------------------------------------------------------------- cards and tables

export function buildTable({ head, rows, numeric = [] }) {
  const isNum = (i) => numeric.includes(i);
  return h('div', { class: 'table-scroll' },
    h('table', { class: 'data' },
      h('thead', null, h('tr', null, head.map((c, i) => h('th', { scope: 'col', class: isNum(i) ? 'num' : null }, c)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: isNum(i) ? 'num' : null }, c)))))));
}

const drawers = new WeakMap();
const widths = new WeakMap();
const resizer = new ResizeObserver((entries) => {
  for (const e of entries) {
    const w = Math.round(e.contentRect.width);
    const draw = drawers.get(e.target);
    if (!draw || w <= 0 || widths.get(e.target) === w) continue;
    widths.set(e.target, w);
    hideTip();
    draw(e.target);
  }
});

/** Stop watching every chart inside `container` (call before replacing a section). */
export function releaseCharts(container) {
  for (const host of container.querySelectorAll('.viz-host')) {
    resizer.unobserve(host);
    drawers.delete(host);
  }
}

/**
 * A chart in a card, with a Table button that swaps in the same numbers as a table.
 * legend: [{ label, key: 'bar' | 'dot' | 'line' | 'band' }]
 */
export function chartCard({ title, subtitle, legend, draw, table, note, wide }) {
  const host = h('div', { class: 'viz-host' });
  const tableWrap = h('div', { class: 'viz-table' });
  tableWrap.hidden = true;
  const toggle = h('button', { class: 'btn small ghost', type: 'button', 'aria-pressed': 'false' }, 'Table');
  let built = false;
  toggle.addEventListener('click', () => {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Chart' : 'Table';
    if (on && !built) {
      tableWrap.append(buildTable(table()));
      built = true;
    }
    tableWrap.hidden = !on;
    host.hidden = on;
    hideTip();
  });
  drawers.set(host, draw);
  resizer.observe(host);
  return h('figure', { class: `card chart-card${wide ? ' wide' : ''}` },
    h('div', { class: 'chart-head' },
      h('figcaption', null, h('h3', null, title), subtitle ? h('p', { class: 'sub' }, subtitle) : null),
      toggle),
    legend?.length ? h('ul', { class: 'legend' }, legend.map((l) => h('li', null, h('span', { class: `key ${l.key}`, 'aria-hidden': 'true' }), l.label))) : null,
    host,
    tableWrap,
    note ? h('p', { class: 'note' }, note) : null);
}
