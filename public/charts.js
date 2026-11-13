// Tiny dependency-free SVG chart kit: area/line, bars, horizontal bars,
// donut, ring gauge, sparkline, uptime strip and animated counters.
// Every plotted chart has a hover layer (crosshair or per-mark tooltip).

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    document.body.appendChild(tip);
  }
  return tip;
}
export function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.style.opacity = '1';
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 10;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top < 8) top = y + 16;
  t.style.transform = `translate(${left}px, ${top}px)`;
}
export function hideTip() { if (tip) tip.style.opacity = '0'; }

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const fmtDate = (d) => new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function size(el, h) {
  const w = Math.max(120, Math.round(el.clientWidth));
  return { w, h: h || Math.max(120, el.clientHeight || 220) };
}

// Re-render charts when their container resizes.
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const r = e.target.__chart;
    if (r && Math.abs(e.contentRect.width - (r.lastW || 0)) > 4) r.redraw(false);
  }
});
function register(el, redraw) {
  const first = !el.__chart;
  el.__chart = { redraw, lastW: el.clientWidth };
  if (first) ro.observe(el);
}

/** Smooth monotone path through points. */
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

/**
 * Area chart with crosshair tooltip.
 * data: [{date, value}], opts: {color, format, height, animate, label}
 */
export function areaChart(el, data, opts = {}) {
  const draw = (animate) => {
    const { w, h } = size(el, opts.height);
    el.__chart && (el.__chart.lastW = w);
    const pad = { t: 12, r: 12, b: 26, l: 48 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const vals = data.map((d) => d.value);
    // zero:false zooms the y-domain to the data range (for slow-moving totals).
    let min = 0, max = niceMax(Math.max(...vals, 0) * 1.08);
    if (opts.zero === false && vals.length) {
      const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || hi * 0.1 || 1;
      const step = niceMax(span / 3);
      min = Math.max(0, Math.floor((lo - span * 0.15) / step) * step);
      max = Math.ceil((hi + span * 0.1) / step) * step;
    }
    const x = (i) => pad.l + (data.length < 2 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = (v) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;
    const pts = data.map((d, i) => [x(i), y(d.value)]);
    const line = smoothPath(pts);
    const area = pts.length ? `${line} L${pts.at(-1)[0]},${pad.t + ih} L${pts[0][0]},${pad.t + ih} Z` : '';
    const fmt = opts.format || ((v) => v.toLocaleString('en-GB'));
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
    const xTicks = data.length > 2 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : data.length === 2 ? [0, 1] : data.length ? [0] : [];
    const color = opts.color || 'var(--series-1)';

    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chart ${animate ? 'animate' : ''}" role="img" aria-label="${esc(opts.label || 'Trend chart')}">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(opts.axisFormat ? opts.axisFormat(t) : compact(t))}</text>`).join('')}
      ${xTicks.map((i, k) => `<text class="axis" x="${x(i)}" y="${h - 6}" text-anchor="${xTicks.length === 1 ? 'middle' : k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'}">${esc(fmtDate(data[i].date))}</text>`).join('')}
      <path class="area-fill" d="${area}" fill="url(#${gid})"/>
      <path class="area-line" d="${line}" stroke="${color}" pathLength="1"/>
      ${pts.length ? `<circle class="end-dot" cx="${pts.at(-1)[0]}" cy="${pts.at(-1)[1]}" r="4" fill="${color}"/>` : ''}
      <line class="crosshair" y1="${pad.t}" y2="${pad.t + ih}" x1="0" x2="0" opacity="0"/>
      <circle class="hover-dot" r="5" fill="${color}" opacity="0"/>
      <rect class="hit" x="${pad.l}" y="0" width="${iw}" height="${h}" fill="transparent"/>
    </svg>`;
    const svg = el.firstElementChild;
    const cross = svg.querySelector('.crosshair'), dot = svg.querySelector('.hover-dot');
    svg.querySelector('.hit').addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * w;
      const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - pad.l) / iw) * (data.length - 1))));
      if (!data[i]) return;
      cross.setAttribute('x1', pts[i][0]); cross.setAttribute('x2', pts[i][0]); cross.setAttribute('opacity', '1');
      dot.setAttribute('cx', pts[i][0]); dot.setAttribute('cy', pts[i][1]); dot.setAttribute('opacity', '1');
      showTip(`<div class="tip-label">${esc(fmtDate(data[i].date))}</div><div class="tip-value">${esc(fmt(data[i].value))}</div>`, ev.clientX, ev.clientY);
    });
    svg.querySelector('.hit').addEventListener('pointerleave', () => { cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); hideTip(); });
  };
  register(el, draw);
  draw(opts.animate !== false);
}

/** Vertical bars (e.g. sessions by hour). values: number[], labels: string[] */
export function barChart(el, values, labels, opts = {}) {
  const draw = (animate) => {
    const { w, h } = size(el, opts.height);
    el.__chart && (el.__chart.lastW = w);
    const pad = { t: 10, r: 8, b: 24, l: 36 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = niceMax(Math.max(...values, 0) * 1.05);
    const n = values.length, gap = 2;
    const bw = Math.max(2, iw / n - gap);
    const fmt = opts.format || ((v) => v.toLocaleString('en-GB'));
    const color = opts.color || 'var(--series-1)';
    const bars = values.map((v, i) => {
      const bh = Math.max(v > 0 ? 2 : 0, (v / max) * ih);
      const bx = pad.l + i * (bw + gap) + gap / 2, by = pad.t + ih - bh;
      const r = Math.min(4, bw / 2, bh);
      const d = bh ? `M${bx},${by + bh} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${by + bh} Z` : '';
      const active = opts.highlight === i;
      return `<path class="bar ${active ? 'active' : ''}" style="--i:${i}" d="${d}" fill="${color}" opacity="${opts.highlight != null && !active ? 0.55 : 1}"/>
        <rect class="hit" data-i="${i}" x="${bx - gap / 2}" y="${pad.t}" width="${bw + gap}" height="${ih}" fill="transparent"/>`;
    }).join('');
    const every = Math.ceil(n / Math.max(1, Math.floor(iw / 34)));
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="chart ${animate ? 'animate' : ''}" role="img" aria-label="${esc(opts.label || 'Bar chart')}">
      ${[0, 0.5, 1].map((f) => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${pad.t + ih - f * ih}" y2="${pad.t + ih - f * ih}"/><text class="axis" x="${pad.l - 6}" y="${pad.t + ih - f * ih + 4}" text-anchor="end">${compact(max * f)}</text>`).join('')}
      <g class="bars">${bars}</g>
      ${labels.map((l, i) => (i % every === 0 ? `<text class="axis" x="${pad.l + i * (bw + gap) + gap / 2 + bw / 2}" y="${h - 6}" text-anchor="middle">${esc(l)}</text>` : '')).join('')}
    </svg>`;
    el.querySelectorAll('.hit').forEach((r) => {
      r.addEventListener('pointermove', (ev) => {
        const i = +r.dataset.i;
        el.querySelectorAll('.bar').forEach((b, k) => b.classList.toggle('hovered', k === i));
        showTip(`<div class="tip-label">${esc(opts.tipLabel ? opts.tipLabel(i) : labels[i])}</div><div class="tip-value">${esc(fmt(values[i]))}</div>`, ev.clientX, ev.clientY);
      });
      r.addEventListener('pointerleave', () => { el.querySelectorAll('.bar.hovered').forEach((b) => b.classList.remove('hovered')); hideTip(); });
    });
  };
  register(el, draw);
  draw(opts.animate !== false);
}

/** Horizontal bars with direct labels (HTML). items: [{name, value}] */
export function hBars(el, items, opts = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const fmt = opts.format || ((v) => v.toLocaleString('en-GB'));
  const prev = el.__hb || {};
  el.innerHTML = items.map((it, i) => `
    <div class="hbar" data-i="${i}" tabindex="0">
      <div class="hbar-label"><span>${esc(it.name)}</span><span class="hbar-value">${esc(fmt(it.value))}</span></div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${prev[it.name] ?? 0}%; background:${opts.color || 'var(--series-1)'}; transition-delay:${i * 50}ms"></div></div>
    </div>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.querySelectorAll('.hbar-fill').forEach((f, i) => (f.style.width = `${(items[i].value / max) * 100}%`));
  }));
  el.__hb = Object.fromEntries(items.map((it) => [it.name, (it.value / max) * 100]));
  el.querySelectorAll('.hbar').forEach((row) => {
    row.addEventListener('pointermove', (ev) => {
      const it = items[+row.dataset.i];
      showTip(`<div class="tip-label">${esc(it.name)}</div><div class="tip-value">${esc(fmt(it.value))} <span class="muted">· ${((it.value / total) * 100).toFixed(1)}%</span></div>`, ev.clientX, ev.clientY);
    });
    row.addEventListener('pointerleave', hideTip);
  });
}

/** Donut with legend. items: [{name, value}] colors: css colors in fixed slot order */
export function donut(el, items, colors, opts = {}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const R = 70, r = 48, C = 90, gapA = items.length > 1 ? 0.025 : 0;
  let a0 = -Math.PI / 2;
  const arcs = items.map((it, i) => {
    const sweep = (it.value / total) * Math.PI * 2;
    const s = a0 + gapA / 2, e = a0 + sweep - gapA / 2;
    a0 += sweep;
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad, a) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const d = `M${p(R, s)} A${R},${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${large} 0 ${p(r, s)} Z`;
    return `<path class="donut-seg" data-i="${i}" d="${d}" fill="${colors[i]}" style="--i:${i}"/>`;
  }).join('');
  el.innerHTML = `<div class="donut-wrap">
    <svg viewBox="0 0 180 180" class="donut animate" role="img" aria-label="${esc(opts.label || 'Breakdown')}">${arcs}
      <text x="90" y="86" text-anchor="middle" class="donut-total">${compact(total)}</text>
      <text x="90" y="106" text-anchor="middle" class="donut-sub">${esc(opts.center || 'total')}</text></svg>
    <ul class="legend">${items.map((it, i) => `<li><i style="background:${colors[i]}"></i><span>${esc(it.name)}</span><b>${((it.value / total) * 100).toFixed(0)}%</b></li>`).join('')}</ul>
  </div>`;
  el.querySelectorAll('.donut-seg').forEach((seg) => {
    seg.addEventListener('pointermove', (ev) => {
      const it = items[+seg.dataset.i];
      showTip(`<div class="tip-label">${esc(it.name)}</div><div class="tip-value">${it.value.toLocaleString('en-GB')} <span class="muted">· ${((it.value / total) * 100).toFixed(1)}%</span></div>`, ev.clientX, ev.clientY);
    });
    seg.addEventListener('pointerleave', hideTip);
  });
}

/** Ring gauge 0–100. */
export function ring(el, pct, opts = {}) {
  const R = 52, L = 2 * Math.PI * R;
  const v = Math.max(0, Math.min(100, pct || 0));
  if (!el.querySelector('.ring')) {
    el.innerHTML = `<svg viewBox="0 0 128 128" class="ring" role="img" aria-label="${esc(opts.label || '')}">
      <circle cx="64" cy="64" r="${R}" class="ring-track"/>
      <circle cx="64" cy="64" r="${R}" class="ring-fill" stroke="${opts.color || 'var(--series-1)'}" stroke-dasharray="${L}" stroke-dashoffset="${L}" transform="rotate(-90 64 64)"/>
      <text x="64" y="68" text-anchor="middle" class="ring-value">0%</text></svg>
      ${opts.caption ? `<div class="ring-caption">${esc(opts.caption)}</div>` : ''}`;
  }
  const fill = el.querySelector('.ring-fill');
  requestAnimationFrame(() => fill.setAttribute('stroke-dashoffset', String(L * (1 - v / 100))));
  countUp(el.querySelector('.ring-value'), v, (n) => `${n.toFixed(opts.decimals ?? 0)}%`);
}

/** Inline sparkline (no axes). */
export function sparkline(el, values, opts = {}) {
  const w = opts.width || el.clientWidth || 120, h = opts.height || 36;
  if (!values?.length) { el.innerHTML = ''; return; }
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 8)]);
  const line = smoothPath(pts);
  const color = opts.color || 'currentColor';
  const gid = 's' + Math.random().toString(36).slice(2, 8);
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" class="spark ${opts.animate === false ? '' : 'animate'}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".28"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${pts.at(-1)[0]},${h} L${pts[0][0]},${h} Z" fill="url(#${gid})" class="area-fill"/>
    <path d="${line}" class="area-line" stroke="${color}" pathLength="1" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Uptime strip: buckets of 0..1 (or null for no data). */
export function uptimeStrip(el, buckets, opts = {}) {
  el.innerHTML = `<div class="ustrip">${buckets.map((b, i) => {
    const cls = b == null ? 'none' : b >= 0.999 ? 'up' : b >= 0.9 ? 'warn' : 'down';
    return `<i class="${cls}" data-i="${i}" style="--i:${i}"></i>`;
  }).join('')}</div>`;
  el.querySelectorAll('i').forEach((cell) => {
    cell.addEventListener('pointermove', (ev) => {
      const i = +cell.dataset.i, b = buckets[i];
      const end = new Date(Date.now() - (buckets.length - 1 - i) * (opts.bucketMs || 1_800_000));
      const start = new Date(end - (opts.bucketMs || 1_800_000));
      const t = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      showTip(`<div class="tip-label">${t(start)}–${t(end)}</div><div class="tip-value">${b == null ? 'No data' : (b * 100).toFixed(1) + '% up'}</div>`, ev.clientX, ev.clientY);
    });
    cell.addEventListener('pointerleave', hideTip);
  });
}

/** Animate a number in an element from its previous value. */
export function countUp(el, to, format = (n) => Math.round(n).toLocaleString('en-GB'), ms = 1100) {
  if (!el) return;
  const from = el.__val ?? 0;
  el.__val = to;
  if (to == null || Number.isNaN(to)) { el.textContent = '—'; return; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = format(to); return; }
  cancelAnimationFrame(el.__raf);
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - p, 4);
    el.textContent = format(from + (to - from) * e);
    if (p < 1) el.__raf = requestAnimationFrame(step);
    else if (from !== 0) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
  };
  el.__raf = requestAnimationFrame(step);
}

export function compact(v) {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v * 10) / 10);
}
export { esc };
