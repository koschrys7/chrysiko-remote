// Visual renderers for Chrysiko Remote: signal chain, compact pedals (Chrysiko house style, as the VST suite),
// EQ response curves, amp panels and cabinets. Pure functions returning SVG markup; read-only displays.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const IVORY = "#f3ecdc", COPPER = "#c98a55", INK = "#0b0b0c";

// Enclosure colours per module (body, print), echoing the Chrysiko Pedals families. Picked per model by code.
const PALETTE = {
  DYN: [["#2f63b8", IVORY], ["#3b7ad0", IVORY], ["#e9edf2", "#1f3d8a"]],
  FREQ: [["#6e3b24", IVORY], ["#9a2b6b", IVORY], ["#55606a", IVORY]],
  WAH: [["#262628", "#e8812d"], ["#3a8f4a", IVORY]],
  DRV: [["#e2711d", "#141414"], ["#e8c21f", "#141414"], ["#f0d24a", "#141414"], ["#ee9b22", "#141414"], ["#b3201f", IVORY], ["#262628", "#e8812d"], ["#3a1012", "#f05a3c"]],
  MOD: [["#5fb6c9", "#141414"], ["#6a3d9a", IVORY], ["#2d7d52", IVORY], ["#3c4fa8", IVORY], ["#9a2b6b", IVORY]],
  DLY: [["#e6e2d8", "#1a1d24"], ["#7a1f24", IVORY], ["#2d7d52", IVORY]],
  RVB: [["#2b6f8a", IVORY], ["#c9cbcf", "#1a1d24"], ["#3c4fa8", IVORY]],
  VOL: [["#1d1d1f", "#c9ccd2"]],
  CLONE: [["#55606a", IVORY], ["#1d1d1f", COPPER]],
};
export const moduleColour = (m) => (PALETTE[m] || [["#55606a", IVORY]])[0][0];
const pick = (b) => {
  if (b.category === 1 && b.code === 0x01000025) return ["#6e3b24", IVORY]; // Chrysiko OC-2: the VST's copper-brown
  const p = PALETTE[b.module] || [["#55606a", IVORY]]; return p[(b.code >>> 0) % p.length];
};
export const blockColour = (b) => pick(b)[0];

export function kindOf(b) {
  if (b.module === "EQ") return "eq";
  if (b.module === "AMP" || b.module === "PRE AMP") return "amp";
  if (b.module === "CAB" || b.module === "IR") return "cab";
  return "pedal";
}

export const positionName = (i) => (i < 6 ? "A" : "B") + ((i % 6) + 1);
export const displayModel = (b) => (b.category === 1 && b.code === 0x01000025 ? "Chrysiko OC-2" : b.model);

export function formatValue(q, v) {
  const n = q.name.toLowerCase();
  if (/^(band|freq)\s*\d/.test(n)) return v >= 1000 ? `${+(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;
  if (/gain|shelf/.test(n) || (q.min < 0 && q.max <= 12 && q.max >= 6)) return `${v > 0 ? "+" : ""}${+v.toFixed(1)} dB`;
  if (/^q\s*\d/.test(n)) return v.toFixed(2);
  return Math.abs(v - Math.round(v)) < 1e-4 ? String(Math.round(v)) : v.toFixed(2);
}
const pct = (q, v) => (q.max > q.min ? Math.max(0, Math.min(1, (v - q.min) / (q.max - q.min))) : 0);
const fitCaps = (text, width, max) => Math.max(6, Math.min(max, width / (Math.max(1, text.length) * 0.68)));
// font-size plus, when the estimate still overflows, a textLength clamp so the browser squeezes it into `room`.
const capsAttrs = (text, room, max) => {
  const fs = fitCaps(text, room, max), est = text.length * 0.72 * fs;
  return `font-size="${fs.toFixed(1)}"` + (est > room ? ` textLength="${room.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : "");
};
const isSwitch = (q) => q.type === 3 || (q.min === 0 && q.max === 1);

// ---------- compact pedal ----------
function knob(x, y, r, q, v, print, label, room = 80) {
  const a = (-135 + 270 * pct(q, v)) * Math.PI / 180, ticks = [];
  for (let i = 0; i < 28; i++) { const t = (i / 28) * 2 * Math.PI; ticks.push(`<line x1="${x + Math.sin(t) * (r - 2)}" y1="${y - Math.cos(t) * (r - 2)}" x2="${x + Math.sin(t) * r}" y2="${y - Math.cos(t) * r}"/>`); }
  const dot = (deg) => { const t = deg * Math.PI / 180; return `<circle cx="${x + Math.sin(t) * (r + 7)}" cy="${y - Math.cos(t) * (r + 7)}" r="1.6" fill="${print}"/>`; };
  return `<g class="kn" data-id="${q.id}"><circle cx="${x}" cy="${y}" r="${r + 12}" fill="transparent"/>
    ${dot(-135)}${dot(135)}
    <circle cx="${x}" cy="${y + 2}" r="${r + 1}" fill="#000" opacity=".45"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#skirt)"/>
    <g stroke="#ffffff" stroke-opacity=".10" stroke-width="1">${ticks.join("")}</g>
    <circle cx="${x}" cy="${y}" r="${r * 0.72}" fill="url(#cap)"/>
    <line x1="${x + Math.sin(a) * r * 0.2}" y1="${y - Math.cos(a) * r * 0.2}" x2="${x + Math.sin(a) * (r - 3)}" y2="${y - Math.cos(a) * (r - 3)}" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    <text x="${x}" y="${y + r + 20}" text-anchor="middle" class="cap" fill="${print}" ${capsAttrs(label, room - 6, 10.5)}>${esc(label.toUpperCase())}</text>
  </g>`;
}

function toggle(x, y, q, v, print) {
  const on = v >= 0.5;
  return `<g class="sw" data-id="${q.id}"><rect x="${x - 22}" y="${y - 14}" width="44" height="40" fill="transparent"/><rect x="${x - 14}" y="${y - 7}" width="28" height="14" rx="7" fill="#222224"/>
    <circle cx="${x + (on ? 7 : -7)}" cy="${y}" r="5" fill="${on ? COPPER : "#6a6a6e"}"/>
    <text x="${x}" y="${y + 18}" text-anchor="middle" class="cap" fill="${print}" font-size="9">${esc(q.name.toUpperCase())}</text></g>`;
}

function waveMark(cx, cy, h, col) {
  const hs = [0.35, 0.6, 0.85, 1, 0.75, 0.5, 0.3], bw = h * 0.085, gap = h * 0.055, w = hs.length * bw + (hs.length - 1) * gap;
  return hs.map((k, i) => `<rect x="${cx - w / 2 + i * (bw + gap)}" y="${cy - (h * k) / 2}" width="${bw}" height="${h * k}" rx="${bw / 2}" fill="${col}"/>`).join("");
}

export function pedalSVG(b, sc, editable = false) {
  const [body, print] = pick(b), W = 300, H = 520, hinge = 210;
  const knobs = b.params.filter((q) => !isSwitch(q)), switches = b.params.filter(isSwitch);
  const shown = knobs.slice(0, 6), rows = shown.length <= 3 ? [shown] : [shown.slice(0, Math.ceil(shown.length / 2)), shown.slice(Math.ceil(shown.length / 2))];
  // Plate layout (y between 12 and 200): one row, two rows, or two rows plus a switch row.
  const sw = switches.length > 0, two = rows.length === 2;
  const r = !two ? 25 : sw ? 18 : 21, ys = !two ? [sw ? 96 : 108] : sw ? [74, 130] : [84, 162], swY = !two ? 172 : 182, parts = [];
  rows.forEach((row, ri) => {
    const y = ys[ri];
    row.forEach((q, i) => parts.push(knob(30 + (240 / row.length) * (i + 0.5), y, r, q, sc.values[q.id], print, q.name, 240 / row.length)));
  });
  switches.slice(0, 4).forEach((q, i, a) => parts.push(toggle(30 + (240 / a.length) * (i + 0.5), swY, q, sc.values[q.id], print)));
  const name = displayModel(b), fs = Math.min(34, 250 / Math.max(4, name.length * 0.62));
  const on = sc.enabled;
  return `<svg viewBox="0 0 ${W} ${H}" class="pedal${editable ? " editable" : ""}" role="img" aria-label="${esc(`${name}, ${b.module}, ${on ? "ON" : "OFF"}`)}">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
    <linearGradient id="skirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e2e30"/><stop offset="1" stop-color="#070708"/></linearGradient>
    <linearGradient id="cap" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3d3d40"/><stop offset="1" stop-color="#0f0f11"/></linearGradient>
    <linearGradient id="rubber" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2a2c"/><stop offset="1" stop-color="#0e0e10"/></linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#ff3b30" stop-opacity=".6"/><stop offset="1" stop-color="#ff3b30" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="4" y="10" width="${W - 8}" height="${H - 12}" rx="16" fill="#000" opacity=".55"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 8}" rx="14" fill="${body}"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 8}" rx="14" fill="url(#body)"/>
  <rect x="2.5" y="2.5" width="${W - 5}" height="${H - 9}" rx="13.5" fill="none" stroke="#fff" stroke-opacity=".22"/>
  <rect x="12" y="12" width="${W - 24}" height="${hinge - 22}" rx="9" fill="#000" opacity=".18"/>
  ${on ? `<circle cx="150" cy="34" r="16" fill="url(#glow)"/>` : ""}
  <circle cx="150" cy="34" r="5.5" fill="#000" opacity=".6"/>
  <circle cx="150" cy="34" r="4.2" fill="${on ? "#ff4436" : "#4a1814"}"/>
  <text x="150" y="20" text-anchor="middle" class="cap" fill="${print}" font-size="8">ON</text>
  ${parts.join("")}
  <rect x="2" y="${hinge - 2}" width="${W - 4}" height="4" fill="#000" opacity=".55"/>
  <rect x="2" y="${hinge + 2}" width="${W - 4}" height="1" fill="#fff" opacity=".15"/>
  <text x="18" y="${hinge + 22}" class="cap" fill="${print}" font-size="9">◀ OUTPUT</text>
  <text x="${W - 18}" y="${hinge + 22}" text-anchor="end" class="cap" fill="${print}" font-size="9">INPUT ◀</text>
  <text x="150" y="${hinge + 66}" text-anchor="middle" class="name" fill="${print}" font-size="${fs.toFixed(1)}">${esc(name)}</text>
  <text x="${W - 22}" y="${hinge + 88}" text-anchor="end" class="cap" fill="${print}" font-size="10" opacity=".85">${esc(b.module)}</text>
  <g class="pad">
  <rect x="24" y="${hinge + 104}" width="${W - 48}" height="${H - hinge - 130}" rx="9" fill="#000" opacity=".5" transform="translate(0 3)"/>
  <rect x="24" y="${hinge + 104}" width="${W - 48}" height="${H - hinge - 130}" rx="9" fill="url(#rubber)"/>
  <g stroke="#000" stroke-opacity=".35">${Array.from({ length: 22 }, (_, i) => `<line x1="34" x2="${W - 34}" y1="${hinge + 114 + i * 8}" y2="${hinge + 114 + i * 8}"/>`).join("")}</g>
  ${waveMark(150, hinge + 168, 30, "#4a4a4e")}
  <text x="150" y="${hinge + 210}" text-anchor="middle" class="word" fill="#4c4c50" font-size="18">Chrysiko</text>
  <text x="150" y="${hinge + 224}" text-anchor="middle" class="cap" fill="#4c4c50" font-size="7.5" letter-spacing="2">CUSTOM PEDALS</text>
  </g>
</svg>`;
}

// ---------- amp panel ----------
export function ampSVG(b, sc, editable = false) {
  const knobs = b.params.filter((q) => !isSwitch(q)), W = 340, perRow = Math.min(6, Math.max(1, knobs.length));
  const rows = Math.ceil(knobs.length / perRow) || 1, H = 96 + rows * 74, on = sc.enabled, name = displayModel(b);
  const parts = knobs.map((q, i) => {
    const row = Math.floor(i / perRow), inRow = Math.min(perRow, knobs.length - row * perRow), col = i % perRow;
    const x = 28 + ((W - 56) / inRow) * (col + 0.5), y = 104 + row * 74, a = (-135 + 270 * pct(q, sc.values[q.id])) * Math.PI / 180;
    return `<g class="kn" data-id="${q.id}"><circle cx="${x}" cy="${y}" r="24" fill="transparent"/><circle cx="${x}" cy="${y}" r="15" fill="#1a1612"/><circle cx="${x}" cy="${y}" r="12" fill="#efe6cf"/>
      <path d="M ${x + Math.sin(a) * 14} ${y - Math.cos(a) * 14} L ${x + Math.sin(a + 2.2) * 6} ${y - Math.cos(a + 2.2) * 6} L ${x + Math.sin(a - 2.2) * 6} ${y - Math.cos(a - 2.2) * 6} Z" fill="#1a1612"/>
      <text x="${x}" y="${y + 31}" text-anchor="middle" class="cap" fill="#2a2116" ${capsAttrs(q.name, (W - 56) / inRow - 6, 8.5)}>${esc(q.name.toUpperCase())}</text></g>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="amp${editable ? " editable" : ""}" role="img" aria-label="${esc(`${name}, ${b.module}, ${on ? "ON" : "OFF"}`)}">
    <defs><linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9d39a"/><stop offset="1" stop-color="#b8975a"/></linearGradient>
      <pattern id="tolex" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#161414"/><circle cx="1" cy="1" r=".6" fill="#2a2626"/></pattern></defs>
    <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="14" fill="url(#tolex)" stroke="#000"/>
    <rect x="14" y="62" width="${W - 28}" height="${H - 76}" rx="6" fill="url(#gold)"/>
    <text x="22" y="44" class="script" fill="${IVORY}" font-size="${Math.min(26, (W - 120) / Math.max(4, name.length * 0.5)).toFixed(1)}"${name.length * 0.5 * 13 > W - 120 ? ` textLength="${W - 120}" lengthAdjust="spacingAndGlyphs"` : ""}>${esc(name)}</text>
    ${waveMark(W - 54, 34, 22, COPPER)}
    <circle cx="${W - 26}" cy="34" r="7" fill="${on ? "#ff4436" : "#4a1814"}" stroke="#000"/>
    ${parts.join("")}
  </svg>`;
}

// ---------- cabinet / IR ----------
export function cabSVG(b, sc) {
  const on = sc.enabled, name = displayModel(b);
  return `<svg viewBox="0 0 300 220" class="cab" role="img" aria-label="${esc(`${name}, ${b.module}, ${on ? "ON" : "OFF"}`)}">
    <defs><pattern id="grill" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#2b2620"/><path d="M0 6 L6 0" stroke="#4a4136" stroke-width="1.2"/></pattern></defs>
    <rect x="2" y="2" width="296" height="216" rx="12" fill="#151313" stroke="#000"/>
    <rect x="16" y="16" width="268" height="188" rx="6" fill="url(#grill)"/>
    <circle cx="150" cy="110" r="64" fill="#000" opacity=".18"/>
    <rect x="96" y="28" width="108" height="26" rx="5" fill="${INK}" stroke="${COPPER}" stroke-opacity=".6"/>
    ${waveMark(112, 41, 14, COPPER)}<text x="124" y="46" class="word" fill="${IVORY}" font-size="13">Chrysiko</text>
    <text x="150" y="192" text-anchor="middle" class="cap" fill="${IVORY}" font-size="11">${esc(name.toUpperCase())}</text>
    <circle cx="272" cy="30" r="5" fill="${on ? "#ff4436" : "#4a1814"}"/>
  </svg>`;
}

// ---------- EQ response ----------
const FS = 44100;
function biquad(type, f0, q, g) {
  const A = Math.pow(10, g / 40), w0 = 2 * Math.PI * f0 / FS, cw = Math.cos(w0), sw = Math.sin(w0);
  if (type === "peak") { const al = sw / (2 * q); return [1 + al * A, -2 * cw, 1 - al * A, 1 + al / A, -2 * cw, 1 - al / A]; }
  const al = sw / 2 * Math.SQRT2, s = 2 * Math.sqrt(A) * al;
  if (type === "low") return [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - s), (A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - s];
  return [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s), (A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s];
}
function magDb(c, f) {
  const w = 2 * Math.PI * f / FS, cr = (k) => Math.cos(k * w), ci = (k) => -Math.sin(k * w);
  const nr = c[0] + c[1] * cr(1) + c[2] * cr(2), ni = c[1] * ci(1) + c[2] * ci(2), dr = c[3] + c[4] * cr(1) + c[5] * cr(2), di = c[4] * ci(1) + c[5] * ci(2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}
const parseHz = (s) => { const m = /^([\d.]+)\s*(k?)Hz$/i.exec(s.trim()); return m ? parseFloat(m[1]) * (m[2] ? 1000 : 1) : null; };

// EQ graph geometry (SVG units) and its inverse, shared with the page for dragging handles.
export const EQ = { W: 340, H: 230, L: 30, R: 332, T: 14, B: 204, R_DB: 15 };
export const eqX = (f) => EQ.L + (Math.log10(f / 20) / 3) * (EQ.R - EQ.L);
export const eqY = (db) => EQ.T + ((EQ.R_DB - db) / (2 * EQ.R_DB)) * (EQ.B - EQ.T);
export const eqF = (x) => 20 * Math.pow(10, (3 * (x - EQ.L)) / (EQ.R - EQ.L));
export const eqDb = (y) => EQ.R_DB - ((y - EQ.T) / (EQ.B - EQ.T)) * 2 * EQ.R_DB;
export const BAND_COLOURS = ["#ef8a3c", "#e6c440", "#5cc982", "#4ea6e6", "#a983e8", "#e96fa0", "#9fd0c8", "#d8b08c", "#8fb3ff", "#ffb3a7", "#c7e66b"];

// Peaking-band width: Q <-> bandwidth in octaves (RBJ definition), used by the Q "wings".
export const octavesFromQ = (q) => (2 * Math.asinh(1 / (2 * q))) / Math.LN2;
export const qFromOctaves = (n) => 1 / (2 * Math.sinh((n * Math.LN2) / 2));
export const wingFreqs = (f, q) => { const h = Math.pow(2, octavesFromQ(q) / 2); return [f / h, f * h]; };

/** Bands for the curve: {bands:[{type,f,q,g,label,ref:{f,q,g},gScale}], approx:[notes]}. ref names the parameters a handle drives. */
export function eqBands(b, sc) {
  const v = (q) => sc.values[q.id], P = Object.fromEntries(b.params.map((q) => [q.name, q])), bands = [], approx = [];
  if (P["Band 1"] || P["Freq 1"]) {
    for (let i = 1; i <= 5; i++) {
      const f = P[`Band ${i}`] || P[`Freq ${i}`]; if (!f) continue;
      const q = P[`Q ${i}`], g = P[`Gain ${i}`];
      bands.push({ type: "peak", f: v(f), q: Math.max(0.1, v(q)), g: v(g), label: String(i), ref: { f, q, g }, gScale: 1 });
      if (P[`Band ${i} Type`]) approx.push(`Band ${i}: τύπος ${v(P[`Band ${i} Type`])} (σχεδιάζεται ως peak)`);
    }
    if (P["Lo Shelf"]) { bands.unshift({ type: "low", f: 100, q: 0.71, g: v(P["Lo Shelf"]), label: "L", ref: { g: P["Lo Shelf"] }, gScale: 1 }); approx.push("Lo/Hi Shelf: συχνότητα 100 Hz / 8 kHz εκτιμώμενη"); }
    if (P["Hi Shelf"]) bands.push({ type: "high", f: 8000, q: 0.71, g: v(P["Hi Shelf"]), label: "H", ref: { g: P["Hi Shelf"] }, gScale: 1 });
  } else {
    const fb = b.params.map((q) => ({ q, f: parseHz(q.name) })).filter((x) => x.f);
    const qf = fb.length >= 9 ? 1.41 : 0.9;
    for (const { q, f } of fb) { const s = q.max === 50 ? 50 / 12 : 1; bands.push({ type: "peak", f, q: qf, g: v(q) / s, label: q.name.replace(/Hz$/i, ""), ref: { g: q }, gScale: s }); }
    if (fb.some((x) => x.q.max === 50)) approx.push("Κλίμακα sliders −50…+50 ≈ ±12 dB (εκτίμηση)");
  }
  bands.forEach((k, i) => (k.colour = BAND_COLOURS[i % BAND_COLOURS.length]));
  return { bands, approx };
}

const fmtHz = (f) => (f >= 1000 ? `${+(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`);
export const bandReadout = (k) => [k.type === "peak" ? fmtHz(k.f) : k.type === "low" ? "Lo shelf" : "Hi shelf",
  `${k.g > 0 ? "+" : ""}${+k.g.toFixed(1)} dB`, k.ref.q ? `Q ${k.q.toFixed(2)}` : null].filter(Boolean).join(" · ");

/** opts: {editable, sel} — sel = index of the selected band (gets its colour fill, Q wings and a readout). */
export function eqSVG(b, sc, opts = {}) {
  const editable = opts === true || !!opts.editable, sel = typeof opts === "object" ? opts.sel : null;
  const { bands, approx } = eqBands(b, sc), { W, H, L, R, T, B, R_DB } = EQ, x = eqX, y = eqY;
  const clampDb = (d) => Math.max(-R_DB, Math.min(R_DB, d));
  const coefs = bands.map((k) => biquad(k.type, k.f, k.q, k.g)), N = 200, fs = Array.from({ length: N + 1 }, (_, i) => 20 * Math.pow(1000, i / N));
  const path = (dbs) => dbs.map((d, i) => (i ? "L" : "M") + x(fs[i]).toFixed(1) + " " + y(clampDb(d)).toFixed(1)).join(" ");
  const per = coefs.map((c) => fs.map((f) => magDb(c, f)));
  const total = fs.map((_, i) => per.reduce((a, d) => a + d[i], 0));
  const grid = [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000].map((f) => `<line x1="${x(f)}" x2="${x(f)}" y1="${T}" y2="${B}" stroke-opacity="${[100, 1000, 10000].includes(f) ? ".14" : ".06"}"/>`).join("") +
    [-12, -6, 6, 12].map((d) => `<line x1="${L}" x2="${R}" y1="${y(d)}" y2="${y(d)}" stroke-opacity=".07"/>`).join("");
  const labels = [[50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1k"], [2000, "2k"], [5000, "5k"], [10000, "10k"]].map(([f, t]) => `<text x="${x(f)}" y="${H - 9}" text-anchor="middle">${t}</text>`).join("") +
    [-12, -6, 0, 6, 12].map((d) => `<text x="${L - 5}" y="${y(d) + 3.5}" text-anchor="end">${d > 0 ? "+" : ""}${d}</text>`).join("");
  const hx = (k) => (k.type === "low" ? x(32) : k.type === "high" ? x(15000) : x(Math.min(20000, Math.max(20, k.f))));
  const hy = (k) => y(clampDb(k.g));
  const bandCurves = per.map((d, i) => `<path d="${path(d)}" fill="none" stroke="${bands[i].colour}" stroke-width="${i === sel ? 1.6 : 1}" stroke-opacity="${i === sel ? ".9" : ".35"}"/>`).join("");
  let selFill = "", wings = "", bubble = "";
  if (sel != null && bands[sel]) {
    const k = bands[sel];
    selFill = `<path d="${path(per[sel])} L ${R} ${y(0)} L ${L} ${y(0)} Z" fill="${k.colour}" fill-opacity=".22"/>`;
    if (editable && k.ref.q) {
      const [fl, fh] = wingFreqs(k.f, k.q), wy = y(clampDb(k.g / 2));
      const wing = (f, side) => `<g class="wing" data-wing="${side}"><circle cx="${x(f)}" cy="${wy}" r="15" fill="transparent"/>
        <rect x="${x(f) - 3.5}" y="${wy - 11}" width="7" height="22" rx="3.5" fill="${k.colour}" stroke="#fff" stroke-width="1.5"/></g>`;
      wings = `<line x1="${x(fl)}" x2="${x(fh)}" y1="${wy}" y2="${wy}" stroke="${k.colour}" stroke-width="1.5" stroke-dasharray="3 3"/>${wing(fl, "lo")}${wing(fh, "hi")}`;
    }
    const text = bandReadout(k), bw = Math.max(70, text.length * 5.6 + 14), bx = Math.max(L, Math.min(R - bw, hx(k) - bw / 2)), by = hy(k) < T + 46 || k.g > 3 ? B - 26 : T + 4; // keep the readout clear of the handle and its Q wings
    bubble = `<g pointer-events="none"><rect x="${bx}" y="${by}" width="${bw}" height="20" rx="10" fill="#000" fill-opacity=".85" stroke="${k.colour}" stroke-opacity=".9"/>
      <text x="${bx + bw / 2}" y="${by + 13.5}" text-anchor="middle" fill="#fafafa" font-size="9.5" font-weight="600" class="ui">${esc(text)}</text></g>`;
  }
  const handles = bands.map((k, i) => `<g class="h" data-band="${i}">${editable ? `<circle cx="${hx(k)}" cy="${hy(k)}" r="17" fill="transparent"/>` : ""}
    <circle cx="${hx(k)}" cy="${hy(k)}" r="${i === sel ? 11 : k.label.length > 2 ? 9 : 8.5}" fill="${k.colour}" stroke="${i === sel ? "#fff" : "#0b0b0c"}" stroke-width="${i === sel ? 2.5 : 1.5}"/>
    <text x="${hx(k)}" y="${hy(k) + 3.3}" text-anchor="middle" fill="#0b0b0c" font-size="${k.label.length > 2 ? 6.5 : 9}" font-weight="800" pointer-events="none">${esc(k.label)}</text></g>`).join("");
  const name = displayModel(b), on = sc.enabled;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="eq${on ? "" : " bypassed"}${editable ? " editable" : ""}" role="img" aria-label="${esc(`${name}: καμπύλη απόκρισης, ${on ? "ON" : "OFF"}`)}">
    <defs><linearGradient id="eqbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171717"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient></defs>
    <rect width="${W}" height="${H}" rx="14" fill="url(#eqbg)"/>
    <g stroke="#ffffff">${grid}</g>
    <line x1="${L}" x2="${R}" y1="${y(0)}" y2="${y(0)}" stroke="#fff" stroke-opacity=".28"/>
    ${selFill}${bandCurves}
    <path d="${path(total)} L ${R} ${y(0)} L ${L} ${y(0)} Z" fill="#fafafa" fill-opacity=".05"/>
    <path d="${path(total)}" fill="none" stroke="#fafafa" stroke-width="2.2"/>
    ${wings}${handles}${bubble}
    <g fill="#8e8e93" font-size="8.5" class="ui">${labels}</g>
  </svg>`;
  return { svg, approx, bands };
}

// ---------- chain ----------
// Two rows (A1-A6, B1-B6) as in the editor; the wire snakes from A6 back to B1. Tiles are 104x96 with an 8px gap,
// rows 28px apart, so the grid is 664x220 and scrolls sideways on a phone.
export function chainHTML(chain, sceneIdx, selected) {
  const tile = (c) => {
    const b = c.block, pos = positionName(c.position);
    if (!b) return `<div class="tile empty" aria-hidden="true"><span class="pos">${pos}</span></div>`;
    const sc = b.scenes[sceneIdx], [body, print] = pick(b);
    return `<button type="button" class="tile${sc.enabled ? " on" : ""}" data-slot="${b.slot}" aria-pressed="${b.slot === selected}"
      aria-label="${esc(`${pos}: ${b.module}, ${displayModel(b)}, ${sc.enabled ? "ON" : "OFF"}`)}" style="--body:${body};--print:${print}">
      <span class="top"><span class="swatch" aria-hidden="true"></span><span class="m">${esc(b.module)}</span><span class="led" aria-hidden="true"></span></span>
      <span class="name">${esc(displayModel(b))}</span><span class="pos">${pos}</span></button>`;
  };
  return `<div class="chain-grid">
    <svg class="wires" viewBox="0 0 664 220" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 48 H664 M660 48 V110 H4 V172 H664" fill="none"/></svg>
    <div class="row">${chain.slice(0, 6).map(tile).join("")}</div>
    <div class="row">${chain.slice(6, 12).map(tile).join("")}</div>
  </div>`;
}
