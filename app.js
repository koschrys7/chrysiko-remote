// Chrysiko Remote: page logic. Web MIDI I/O, rendering, live control with read-back verification.
// Protocol, whitelists and MIDI CC/PC live in ampero.js; drawings in views.js.
import { readPresetFrames, readSceneFrames, readParamFrames, writeParamFrames, writeSceneFrames, parseParam, parseScene,
  presetSelectMessages, slotSwitchMessage, midiCC, CC, locationOf, Receiver, parsePreset,
  READ_CURRENT_PRESET, CURRENT_SCENE, SLOT_PARAMETER } from "./ampero.js";
import { CATALOG } from "./catalog.js";
import { chainHTML, pedalSVG, ampSVG, cabSVG, eqSVG, eqBands, kindOf, positionName, displayModel, formatValue, eqF, eqDb, qFromOctaves } from "./views.js";

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const demo = qs.has("demo") || !!window.__CHRYSIKO_FORCE_DEMO__; // the preview build forces demo (no MIDI there)
const rx = new Receiver();
let midi = null, input = null, output = null, preset = null, scene = 0, selected = null, waiting = null, deviceScene = null, liveOn = false;
let tunerOn = false, browseBank = 0, verifyAfterRead = null;
// Editing state. Keys are "slot:paramId". original = values at first change; marks = per-parameter verify state.
const original = new Map(), pending = new Map(), marks = new Map(), expected = new Map(), selBand = new Map(), commitTimers = new Map();
let flushTimer = null, current = null; // current = {box, b, c} of the open detail

const wide = matchMedia("(min-width: 820px)");
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const addr = (a) => "0x" + a.toString(16).padStart(8, "0");
const hexs = (f) => Array.from(f, (x) => x.toString(16).padStart(2, "0")).join("");
const key = (slot, id) => `${slot}:${id}`;
const live = () => !demo && output;
const sceneName = (s) => (preset && preset.sceneNames[s]) || `Scene ${s + 1}`;
const editing = () => liveOn;
const canEditHere = () => editing() && scene === (deviceScene ?? 0);

function log(line) { const t = new Date().toLocaleTimeString("el-GR"); $("log").textContent = `${t}  ${line}\n` + $("log").textContent.slice(0, 20000); }
function conn(state, text) { const c = $("conn"); c.dataset.state = state; $("connText").textContent = text; }
function toast(text) { const t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3400); }
function send(frames, what) { if (!live()) return; for (const f of frames) output.send(f); log(`→ ${what} ${hexs(frames[0]).slice(0, 64)}…`); }
function sendMidi(msgs, what) { if (!live()) return; for (const m of msgs) output.send(m); log(`→ ${what} ${msgs.map(hexs).join(" ")}`); }
const needLive = () => { if (!editing()) { toast("Άνοιξε το Live για να ελέγξεις το πετάλι."); return false; } return true; };

// ---------- parameter changes ----------
function quantize(q, v) { const st = q.step > 0 ? q.step : 1; v = Math.round(v / st) * st; return Math.max(q.min, Math.min(q.max, +v.toFixed(4))); }
function currentValue(k) { const [slot, id] = k.split(":").map(Number); const b = preset.slots.find((x) => x.slot === slot); return b ? b.scenes[deviceScene ?? 0].values[id] : null; }
function updateRevert() { $("revert").disabled = ![...original].some(([k, ov]) => currentValue(k) !== ov); }
function setValue(b, q, v) {
  const k = key(b.slot, q.id), sc = b.scenes[scene];
  v = quantize(q, v);
  if (!original.has(k)) original.set(k, sc.values[q.id]);
  if (sc.values[q.id] === v) return;
  sc.values[q.id] = v; pending.set(k, { slot: b.slot, id: q.id, v }); marks.set(k, "wait");
  if (!flushTimer) flushTimer = setTimeout(flush, 60);
  updateRevert();
}
function flush() {
  flushTimer = null;
  for (const [k, p] of pending) { send(writeParamFrames(p.slot, p.id, p.v), `set slot ${p.slot} param ${p.id} = ${p.v}`); expected.set(k, p.v); }
  pending.clear();
}
function commit(b, q) { // after a drag, slider or stepper: write now, then read the value back from the pedal
  if (flushTimer) { clearTimeout(flushTimer); flush(); }
  const k = key(b.slot, q.id);
  if (!live()) { marks.set(k, "ok"); refreshRows(); return; }
  setTimeout(() => send(readParamFrames(b.slot, q.id), `read back slot ${b.slot} param ${q.id}`), 250);
  setTimeout(() => { if (marks.get(k) === "wait") { marks.set(k, "diff"); refreshRows(); log(`no read-back for ${k}`); } }, 2500);
}
function scheduleCommit(b, q) { const k = key(b.slot, q.id); clearTimeout(commitTimers.get(k)); commitTimers.set(k, setTimeout(() => commit(b, q), 350)); }
function onParamReply(p) {
  const k = key(p.slot, p.id), want = expected.get(k);
  if (want == null) return;
  const b = preset && preset.slots.find((x) => x.slot === p.slot), q = b && b.params.find((x) => x.id === p.id);
  marks.set(k, Math.abs(p.value - want) <= Math.max((q?.step || 1) / 2, 1e-4) ? "ok" : "diff");
  log(`← read-back ${k} = ${p.value} (${marks.get(k) === "ok" ? "ταιριάζει" : "ΔΙΑΦΟΡΑ, αναμενόταν " + want})`);
  refreshRows();
}

// Frequency sliders are logarithmic (0..1000 steps across min..max), as on plugin EQs.
const isFreq = (q) => /^(band|freq)\s*\d+$/i.test(q.name) && q.min > 0;
const toSlider = (q, v) => (isFreq(q) ? Math.round((1000 * Math.log(v / q.min)) / Math.log(q.max / q.min)) : v);
const fromSlider = (q, r) => (isFreq(q) ? q.min * Math.pow(q.max / q.min, r / 1000) : r);
const isSwitchParam = (q) => q.type === 3 || (q.min === 0 && q.max === 1);

// ---------- detail ----------
function rowsFor(b, sc, editable) {
  const dl = h("dl", "knobs");
  for (const q of b.params) {
    const v = sc.values[q.id], dt = h("dt"), dd = h("dd"), k = key(b.slot, q.id);
    dd.dataset.k = k; dd.append(h("span", "val", formatValue(q, v)), h("span", "mark", ""));
    const label = h("span", "", q.name); label.id = `lbl-${b.slot}-${q.id}`; dt.append(label);
    if (editable && isSwitchParam(q)) {
      const t = h("button", "toggle"); t.type = "button"; t.dataset.k = k; t.setAttribute("role", "switch"); t.setAttribute("aria-labelledby", label.id);
      t.setAttribute("aria-checked", String(v >= 0.5));
      t.addEventListener("click", () => { setValue(b, q, b.scenes[scene].values[q.id] >= 0.5 ? 0 : 1); redrawVisual(); refreshRows(); commit(b, q); });
      dt.append(t);
    } else if (editable) {
      const r = h("input"); r.type = "range"; r.dataset.k = k;
      if (isFreq(q)) { r.min = 0; r.max = 1000; r.step = 1; } else { r.min = q.min; r.max = q.max; r.step = q.step || 1; }
      r.value = toSlider(q, v);
      r.setAttribute("aria-labelledby", label.id); r.setAttribute("aria-valuetext", formatValue(q, v));
      r.addEventListener("input", () => { setValue(b, q, fromSlider(q, +r.value)); redrawVisual(); refreshRows(); });
      r.addEventListener("change", () => commit(b, q));
      dt.append(r);
    } else {
      const p = q.max > q.min ? Math.max(0, Math.min(1, (v - q.min) / (q.max - q.min))) : 0;
      const bar = h("span", "bar"); bar.setAttribute("aria-hidden", "true"); const i = h("i"); i.style.width = (p * 100).toFixed(1) + "%"; bar.append(i); dt.append(bar);
    }
    dl.append(dt, dd);
  }
  return dl;
}
function refreshRows() {
  if (!current) return;
  const { box, b } = current, sc = b.scenes[scene];
  for (const q of b.params) {
    const k = key(b.slot, q.id), st = marks.get(k);
    for (const el of box.querySelectorAll(`[data-k="${k}"]:not(input):not(.toggle)`)) {
      const val = el.querySelector(".val"); if (val) val.textContent = formatValue(q, sc.values[q.id]);
      const m = el.querySelector(".mark"); if (!m) continue;
      m.className = "mark" + (st ? " " + st : "");
      m.textContent = st === "ok" ? "✓" : st === "diff" ? "⚠" : st === "wait" ? "…" : "";
      m.title = st === "ok" ? (demo ? "Demo: δεν στάλθηκε" : "Επιβεβαιώθηκε από το πετάλι") : st === "diff" ? "Το πετάλι δεν επιβεβαίωσε την τιμή" : "";
    }
    const r = box.querySelector(`input[data-k="${k}"]`);
    if (r && document.activeElement !== r) r.value = toSlider(q, sc.values[q.id]);
    if (r) r.setAttribute("aria-valuetext", formatValue(q, sc.values[q.id]));
    const t = box.querySelector(`.toggle[data-k="${k}"]`); if (t) t.setAttribute("aria-checked", String(sc.values[q.id] >= 0.5));
  }
}
const selOf = (b) => { // default: the first band with a frequency (not a shelf)
  const bands = eqBands(b, b.scenes[scene]).bands; if (!bands.length) return null;
  const s = selBand.get(b.slot) ?? Math.max(0, bands.findIndex((k) => k.type === "peak")); return Math.min(s, bands.length - 1); };
function visualSVG(b) {
  const sc = b.scenes[scene], kind = kindOf(b), ed = canEditHere();
  if (kind === "eq") return eqSVG(b, sc, { editable: ed, sel: selOf(b) }).svg;
  return kind === "amp" ? ampSVG(b, sc, ed) : kind === "cab" ? cabSVG(b, sc) : pedalSVG(b, sc, ed);
}
function redrawVisual() {
  if (!current) return;
  current.box.querySelector(".visual").innerHTML = visualSVG(current.b);
  if (kindOf(current.b) === "eq") renderBandPanel();
}

// Selected-band strip: band chips plus big - / + steppers for Freq, Gain and Q (touch friendly, keyboard reachable).
function renderBandPanel() {
  if (!current) return;
  const { box, b } = current, panel = box.querySelector(".bandpanel"); if (!panel) return;
  const sc = b.scenes[scene], { bands } = eqBands(b, sc), si = selOf(b), k = bands[si], edit = canEditHere();
  panel.replaceChildren();
  const chips = h("div", "chips"); chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Μπάντα");
  bands.forEach((bd, i) => {
    const c = h("button", "chip", bd.label); c.type = "button"; c.style.setProperty("--c", bd.colour);
    c.setAttribute("aria-pressed", String(i === si)); c.setAttribute("aria-label", `Μπάντα ${bd.label}`);
    c.addEventListener("click", () => { selBand.set(b.slot, i); redrawVisual(); panel.querySelector('.chip[aria-pressed="true"]')?.focus(); });
    chips.append(c);
  });
  panel.append(chips);
  if (!k) return;
  const fields = h("div", "fields");
  const field = (name, q, text, down, up) => {
    const f = h("div", "field"); f.style.setProperty("--c", k.colour);
    const val = h("div", "fval"); val.dataset.k = q ? key(b.slot, q.id) : "";
    val.append(h("span", "val", text), h("span", "mark", ""));
    const row = h("div", "steps");
    if (edit && q) {
      const mk = (sym, fn, what) => { const bt = h("button", "step", sym); bt.type = "button"; bt.setAttribute("aria-label", `${what} ${name}`);
        bt.addEventListener("click", () => { setValue(b, q, fn(b.scenes[scene].values[q.id])); redrawVisual(); refreshRows(); scheduleCommit(b, q); }); return bt; };
      row.append(mk("−", down, "Μείωση"), val, mk("+", up, "Αύξηση"));
    } else row.append(val);
    f.append(h("div", "flabel", name), row); fields.append(f);
  };
  const st = (q) => q.step || 1;
  if (k.ref.f) field("Freq", k.ref.f, formatValue(k.ref.f, k.f), (v) => v / Math.pow(2, 1 / 6), (v) => v * Math.pow(2, 1 / 6));
  else field("Freq", null, k.type === "low" ? "Lo shelf" : k.type === "high" ? "Hi shelf" : `${k.label} Hz`);
  field("Gain", k.ref.g, `${k.g > 0 ? "+" : ""}${+k.g.toFixed(1)} dB`, (v) => v - st(k.ref.g), (v) => v + st(k.ref.g));
  if (k.ref.q) field("Q", k.ref.q, k.q.toFixed(2), (v) => v / 1.12, (v) => v * 1.12);
  panel.append(fields);
  if (edit) panel.append(h("p", "hint", k.ref.q ? "Σύρε τη λαβή για συχνότητα και gain· τα φτερά ή δύο δάχτυλα για Q." : "Σύρε τη λαβή πάνω-κάτω για gain."));
  refreshRows();
}

function attachEqDrag(vis, b) {
  const pts = new Map(); let mode = null, pinch = null;
  const toSvg = (e) => { const svg = vis.querySelector("svg"), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  const band = () => eqBands(b, b.scenes[scene]).bands[selOf(b)];
  const dist = () => { const [p, q] = [...pts.values()]; return Math.hypot(p.x - q.x, p.y - q.y); };
  vis.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = e.target.closest(".h"), w = e.target.closest(".wing");
    if (pts.size === 2 && canEditHere()) { const k = band(); if (k?.ref.q) { pinch = { d0: dist(), q0: k.q }; mode = "pinch"; } return; }
    if (g) { selBand.set(b.slot, +g.dataset.band); redrawVisual(); }
    if (!canEditHere() || !(g || w)) return;
    try { vis.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault(); mode = w ? "wing" : "band";
  });
  vis.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const k = band(); if (!mode || !k) return;
    if (mode === "pinch" && pts.size === 2) setValue(b, k.ref.q, pinch.q0 * (pinch.d0 / Math.max(10, dist())));
    else if (mode === "wing") { const p = toSvg(e); setValue(b, k.ref.q, qFromOctaves(Math.max(0.03, 2 * Math.abs(Math.log2(eqF(p.x) / k.f))))); }
    else if (mode === "band") { const p = toSvg(e); if (k.ref.f) setValue(b, k.ref.f, eqF(p.x)); if (k.ref.g) setValue(b, k.ref.g, eqDb(p.y) * k.gScale); }
    redrawVisual(); refreshRows();
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (!mode) return;
    const k = band(); if (k) for (const q of [k.ref.f, k.ref.g, k.ref.q]) if (q) commit(b, q);
    if (pts.size === 0 || mode === "pinch") { mode = null; pinch = null; }
  };
  vis.addEventListener("pointerup", end); vis.addEventListener("pointercancel", end);
  vis.addEventListener("wheel", (e) => { // mouse wheel / trackpad over the graph: Q of the selected band
    const k = band(); if (!canEditHere() || !k?.ref.q) return;
    e.preventDefault(); setValue(b, k.ref.q, k.q * Math.exp(e.deltaY * 0.0015)); redrawVisual(); refreshRows(); scheduleCommit(b, k.ref.q);
  }, { passive: false });
}

// Pedals and amps: drag a knob up/down (full range over ~180 px), tap a switch, tap the rubber pad to switch the block.
function attachKnobDrag(vis, b, c) {
  let drag = null;
  vis.addEventListener("pointerdown", (e) => {
    const pad = e.target.closest(".pad"), sw = e.target.closest(".sw"), kn = e.target.closest(".kn");
    if (pad) { footswitch(c); return; }
    if (!canEditHere()) return;
    if (sw) { const q = b.params.find((x) => x.id === +sw.dataset.id); if (q) { setValue(b, q, b.scenes[scene].values[q.id] >= 0.5 ? 0 : 1); redrawVisual(); refreshRows(); commit(b, q); } return; }
    if (!kn) return;
    const q = b.params.find((x) => x.id === +kn.dataset.id); if (!q) return;
    drag = { q, y0: e.clientY, v0: b.scenes[scene].values[q.id] };
    try { vis.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  vis.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const { q, y0, v0 } = drag;
    setValue(b, q, v0 + ((y0 - e.clientY) / 180) * (q.max - q.min)); redrawVisual(); refreshRows();
  });
  const end = () => { if (!drag) return; const q = drag.q; drag = null; commit(b, q); };
  vis.addEventListener("pointerup", end); vis.addEventListener("pointercancel", end);
}

function footswitch(c) {
  if (!needLive()) return;
  const b = c.block, sc = b.scenes[scene], on = !sc.enabled;
  sendMidi([slotSwitchMessage(c.position, on)], `${positionName(c.position)} ${on ? "ON" : "OFF"} (CC${CC.SLOT_A1 + c.position})`);
  sc.enabled = on; render(); showDetailIfOpen();
  if (!live()) { toast(`Demo: ${positionName(c.position)} ${on ? "ON" : "OFF"} (δεν στάλθηκε)`); return; }
  verifyAfterRead = (p) => { const nb = p.slots.find((x) => x.slot === b.slot); const ok = nb && nb.scenes[deviceScene ?? 0].enabled === on;
    toast(ok ? `✓ ${positionName(c.position)} ${on ? "ON" : "OFF"}` : `⚠ Το πετάλι δεν άλλαξε το ${positionName(c.position)}`); };
  setTimeout(readPreset, 400);
}

function detail(c) {
  const b = c.block, sc = b.scenes[scene], box = h("article", "detail"), kind = kindOf(b);
  box.setAttribute("aria-labelledby", "detail-title");
  const head = h("header", "detail-head");
  const title = h("h2", "model", displayModel(b)); title.id = "detail-title"; title.tabIndex = -1;
  const meta = h("div", "detail-meta");
  meta.append(h("span", "pos", positionName(c.position)), h("span", "mod", b.module), h("span", "state " + (sc.enabled ? "on" : "off"), sc.enabled ? "ON" : "OFF"));
  head.append(meta, title);
  if (editing()) {
    const fs = h("button", "btn small", sc.enabled ? "Απενεργοποίηση block" : "Ενεργοποίηση block"); fs.type = "button";
    fs.addEventListener("click", () => footswitch(c)); head.append(fs);
  }
  box.append(head);
  const editable = canEditHere();
  const body = h("div", "detail-body"), left = h("div", "detail-visual"), right = h("div", "detail-controls");
  const vis = h("div", "visual");
  current = { box, b, c };
  vis.innerHTML = visualSVG(b);
  left.append(vis);
  if (kind === "eq") { attachEqDrag(vis, b); right.append(h("div", "bandpanel")); const ap = eqSVG(b, sc).approx; if (ap.length) { const ul = h("ul", "approx"); for (const a of ap) ul.append(h("li", "", a)); left.append(ul); } }
  else if (kind === "pedal" || kind === "amp") { attachKnobDrag(vis, b, c); if (editable) left.append(h("p", "hint center", kind === "pedal" ? "Σύρε ένα knob πάνω-κάτω · πάτα το pad για on/off" : "Σύρε ένα knob πάνω-κάτω")); }
  if (editing() && !editable) right.append(h("p", "scene-note", `Η επεξεργασία γίνεται στη σκηνή που παίζει τώρα (${sceneName(deviceScene ?? 0)}).`));
  if (b.params.length) {
    if (kind === "eq") { const d = h("details", "allparams"); d.append(h("summary", "", "Όλες οι παράμετροι"), rowsFor(b, sc, editable)); right.append(d); }
    else { right.append(h("h3", "", "Τιμές"), rowsFor(b, sc, editable)); }
  }
  body.append(left, right); box.append(body);
  return box;
}

// ---------- sheets (phone) / inline (tablet) ----------
const sheet = $("sheet");
function showDetail() {
  const c = preset && preset.chain.find((x) => x.block && x.block.slot === selected);
  const inline = $("inline");
  inline.replaceChildren(); $("sheetBody").replaceChildren(); current = null;
  if (!c) { if (sheet.open) sheet.close(); return; }
  const box = detail(c);
  if (wide.matches) { inline.append(box); if (sheet.open) sheet.close(); }
  else { const reopen = !sheet.open; $("sheetBody").append(box); if (reopen) { sheet.showModal(); sheet.scrollTop = 0; box.querySelector("#detail-title").focus({ preventScroll: true }); } }
  if (kindOf(c.block) === "eq") renderBandPanel();
  refreshRows();
}
function showDetailIfOpen() { if (wide.matches || sheet.open) { const st = sheet.scrollTop; showDetail(); sheet.scrollTop = st; } }
function closeDialog(d) { if (!d.open) return; d.classList.add("closing"); setTimeout(() => { d.classList.remove("closing"); d.close(); }, 180); }
sheet.addEventListener("close", () => { current = null; if (!wide.matches) document.querySelector(`button.tile[data-slot="${selected}"]`)?.focus(); });
for (const d of document.querySelectorAll("dialog.sheet")) {
  d.addEventListener("click", (e) => { if (e.target === d) closeDialog(d); }); // tap on the backdrop
  d.querySelector(".sheet-close").addEventListener("click", () => closeDialog(d));
  const grab = d.querySelector(".grab"); let y0 = null; // swipe the grabber down to close
  grab.addEventListener("pointerdown", (e) => { y0 = e.clientY; grab.setPointerCapture(e.pointerId); });
  grab.addEventListener("pointermove", (e) => { if (y0 != null) d.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  const up = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; d.style.transform = ""; if (dy > 90) closeDialog(d); };
  grab.addEventListener("pointerup", up); grab.addEventListener("pointercancel", up);
}
wide.addEventListener("change", () => { if (preset) showDetail(); });

// ---------- preset browser ----------
const presetsSheet = $("presetsSheet");
function renderBrowser() {
  $("bankLabel").textContent = `A${String(browseBank).padStart(2, "0")}`;
  const grid = $("bankPatches"); grid.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const idx = browseBank * 3 + i, isCur = preset && preset.index === idx;
    const bt = h("button", "patch" + (isCur ? " current" : "")); bt.type = "button";
    bt.append(h("span", "ploc", locationOf(idx)), h("span", "pname", isCur ? preset.name : "Φόρτωση"));
    if (isCur) bt.setAttribute("aria-current", "true");
    bt.addEventListener("click", () => selectPreset(idx));
    grid.append(bt);
  }
}
function selectPreset(idx) {
  if (!needLive()) return;
  sendMidi(presetSelectMessages(idx), `select ${locationOf(idx)} (CC0 + PC)`);
  if (!live()) { toast(`Demo: φόρτωση ${locationOf(idx)} (δεν στάλθηκε)`); return; }
  verifyAfterRead = (p) => toast(p.index === idx ? `✓ ${p.location} ${p.name}` : `⚠ Το πετάλι είναι στο ${p.location}, όχι στο ${locationOf(idx)}`);
  closeDialog(presetsSheet); deviceScene = null; setTimeout(readPreset, 600);
}
function stepPatch(up) {
  if (!needLive()) return;
  sendMidi([midiCC(up ? CC.PATCH_UP : CC.PATCH_DOWN, 127)], up ? "Patch + (CC27)" : "Patch − (CC26)");
  if (!live()) { toast("Demo: δεν στάλθηκε"); return; }
  verifyAfterRead = (p) => toast(`✓ ${p.location} ${p.name}`);
  deviceScene = null; setTimeout(readPreset, 600);
}
$("presetsBtn").addEventListener("click", () => { browseBank = preset ? Math.floor(preset.index / 3) : 0; renderBrowser(); presetsSheet.showModal(); });
$("bankDown").addEventListener("click", () => { browseBank = (browseBank + 99) % 100; renderBrowser(); });
$("bankUp").addEventListener("click", () => { browseBank = (browseBank + 1) % 100; renderBrowser(); });
$("patchDown").addEventListener("click", () => stepPatch(false));
$("patchUp").addEventListener("click", () => stepPatch(true));

// ---------- performance strip: patch volume, tuner, tap ----------
let volTimer = null;
$("volume").addEventListener("input", (e) => {
  const v = +e.target.value; $("volumeVal").textContent = v; e.target.setAttribute("aria-valuetext", String(v));
  if (!editing()) return;
  clearTimeout(volTimer); volTimer = setTimeout(() => sendMidi([midiCC(CC.PATCH_VOLUME, v)], `patch volume ${v} (CC7)`), 60);
});
$("volume").addEventListener("change", (e) => {
  const v = +e.target.value; if (!editing() || !live()) return;
  verifyAfterRead = (p) => { const got = p.levels[deviceScene ?? 0]; toast(got === v ? `✓ Patch volume ${v}` : `Patch volume: το preset γράφει ${got}`); };
  setTimeout(readPreset, 500);
});
$("tuner").addEventListener("click", () => { if (!needLive()) return; tunerOn = !tunerOn; $("tuner").setAttribute("aria-pressed", String(tunerOn)); sendMidi([midiCC(CC.TUNER, tunerOn ? 127 : 0)], `tuner ${tunerOn ? "on" : "off"} (CC60)`); });
$("tap").addEventListener("click", () => { if (!needLive()) return; sendMidi([midiCC(CC.TAP, 127)], "tap tempo (CC76)"); $("tap").classList.add("flash"); setTimeout(() => $("tap").classList.remove("flash"), 120); });

// ---------- main render ----------
function render() {
  $("connectCard").hidden = !!preset;
  $("presetArea").hidden = !preset;
  $("live").hidden = !preset; $("refresh").hidden = !preset || demo; $("presetsBtn").hidden = !preset;
  if (!preset) return;
  $("loc").textContent = preset.location;
  $("pname").textContent = preset.name || "(χωρίς όνομα)";
  $("pmeta").textContent = `Level ${preset.levels[scene]} · ${preset.bpms[scene]} BPM · ${preset.slots.length} blocks`;
  $("sub").textContent = `${preset.location} · ${preset.name}`;
  if (document.activeElement !== $("volume")) { $("volume").value = preset.levels[deviceScene ?? 0]; $("volumeVal").textContent = preset.levels[deviceScene ?? 0]; }

  const tabs = $("scenes"); tabs.replaceChildren();
  [0, 1, 2].forEach((s) => {
    const playing = deviceScene === s, b = h("button", "seg"); b.type = "button"; b.setAttribute("role", "tab");
    b.append(h("span", "", sceneName(s))); if (playing) { const p = h("span", "playing", "▶"); p.setAttribute("aria-hidden", "true"); b.prepend(p); }
    b.setAttribute("aria-label", sceneName(s) + (playing ? ", παίζει τώρα" : ""));
    b.setAttribute("aria-selected", String(s === scene)); b.tabIndex = s === scene ? 0 : -1;
    const go = (n) => { selectScene(n); $("scenes").querySelector('[aria-selected="true"]')?.focus(); };
    b.addEventListener("click", () => go(s));
    b.addEventListener("keydown", (e) => { const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (d) { e.preventDefault(); go((scene + d + 3) % 3); } });
    tabs.append(b);
  });
  $("scenesHint").textContent = editing() ? "Τα tabs αλλάζουν τη σκηνή στο πετάλι" : "Προβολή · άνοιξε το Live για αλλαγή στο πετάλι";

  const chain = $("chain");
  chain.innerHTML = preset.slots.length ? chainHTML(preset.chain, scene, selected) : `<p class="empty-note">Άδειο preset.</p>`;
  chain.querySelectorAll("button.tile").forEach((t) => t.addEventListener("click", () => { selected = +t.dataset.slot; render(); showDetail(); }));
  $("liveBanner").hidden = !editing(); $("perf").hidden = !editing();
  $("liveScene").textContent = sceneName(deviceScene ?? 0);
  $("live").setAttribute("aria-pressed", String(editing()));
}
function selectScene(n) {
  scene = n;
  if (editing()) {
    send(writeSceneFrames(n), `select scene ${n + 1}`);
    if (live()) setTimeout(() => send(readSceneFrames(), "read scene back"), 250); else deviceScene = n;
  }
  render(); showDetailIfOpen();
}

// ---------- MIDI ----------
function onMessage(m) {
  log(`← ${addr(m.address)} flag 0x${m.flag.toString(16)} (${m.payload.length} bytes)`);
  if (m.address === CURRENT_SCENE) {
    const s = parseScene(m.data);
    if (s != null && s < 3) { const was = deviceScene; deviceScene = s; if (preset) { scene = s; render(); showDetailIfOpen(); if (editing() && was !== null && was !== s) toast(`✓ ${sceneName(s)}`); } }
    return;
  }
  if (m.address === SLOT_PARAMETER) { const p = parseParam(m.data); if (p) onParamReply(p); return; }
  if (m.address !== READ_CURRENT_PRESET) return;
  try {
    const p = parsePreset(m.payload, CATALOG), same = preset && preset.index === p.index;
    preset = p; scene = deviceScene ?? 0;
    if (!same) { original.clear(); marks.clear(); expected.clear(); pending.clear(); $("revert").disabled = true;
      const first = p.chain.find((c) => c.block && c.block.scenes[0].enabled) || p.chain.find((c) => c.block); selected = first ? first.block.slot : null; }
    else { updateRevert(); if (!p.slots.some((x) => x.slot === selected)) selected = p.slots[0]?.slot ?? null; }
    conn(demo ? "demo" : "ok", demo ? "Demo" : "Συνδεδεμένο");
    render(); if (wide.matches) showDetail(); else showDetailIfOpen();
    if (verifyAfterRead) { const f = verifyAfterRead; verifyAfterRead = null; f(p); }
    setTimeout(() => { if (deviceScene == null) send(readSceneFrames(), "read current scene"); }, 600);
  } catch (e) { toast("Δεν αποκωδικοποιήθηκε το preset: " + e.message); log("decode error: " + e.message); }
  if (waiting) { clearTimeout(waiting); waiting = null; $("read").disabled = false; $("refresh").disabled = false; }
}
function attach() {
  input = output = null;
  for (const i of midi.inputs.values()) if (/ampero/i.test(i.name)) input = i;
  for (const o of midi.outputs.values()) if (/ampero/i.test(o.name)) output = o;
  if (input) input.onmidimessage = (e) => { for (const m of rx.push(e.data)) onMessage(m); };
  const ok = !!(input && output);
  $("read").disabled = !ok; $("refresh").disabled = !ok;
  conn(ok ? "ok" : "off", ok ? "Συνδεδεμένο" : "Δεν βρέθηκε");
  $("connectHint").textContent = ok ? `Βρέθηκε: ${output.name}. Πάτα «Διάβασε το preset».` : "Το Ampero δεν βρέθηκε. Σύνδεσε το καλώδιο USB-C και ξαναπάτα «Σύνδεση».";
  log("ports: in=" + [...midi.inputs.values()].map((x) => x.name).join(", ") + " | out=" + [...midi.outputs.values()].map((x) => x.name).join(", "));
}
$("connect").addEventListener("click", async () => {
  if (!navigator.requestMIDIAccess) { $("connectHint").textContent = "Αυτός ο browser δεν έχει Web MIDI. Στο iPhone άνοιξε τη σελίδα από την εφαρμογή «Web MIDI Browser»."; return; }
  try { midi = await navigator.requestMIDIAccess({ sysex: true }); midi.onstatechange = attach; attach(); }
  catch (e) { $("connectHint").textContent = "Δεν δόθηκε άδεια για MIDI (SysEx): " + e.message; log("requestMIDIAccess: " + e); }
});
function readPreset() {
  if (!output) return;
  const frames = readPresetFrames(); // throws unless identical to the proven read request
  $("read").disabled = true; $("refresh").disabled = true; conn("busy", "Ανάγνωση…");
  for (const f of frames) { output.send(f); log("→ read current preset " + hexs(f)); }
  clearTimeout(waiting);
  waiting = setTimeout(() => { waiting = null; $("read").disabled = false; $("refresh").disabled = false; conn("ok", "Συνδεδεμένο"); toast("Δεν ήρθε απάντηση σε 4 δευτερόλεπτα. Δοκίμασε ξανά."); }, 4000);
}
$("read").addEventListener("click", () => { deviceScene = null; readPreset(); });
$("refresh").addEventListener("click", () => { deviceScene = null; readPreset(); });

$("live").addEventListener("click", () => {
  if (!preset) { toast("Διάβασε πρώτα ένα preset."); return; }
  liveOn = !liveOn; if (liveOn) scene = deviceScene ?? 0;
  toast(liveOn ? (demo ? "Demo: τίποτα δεν στέλνεται στο πετάλι." : "Live: η σελίδα ελέγχει το πετάλι.") : "Live κλειστό: μόνο προβολή.");
  render(); showDetailIfOpen();
});
$("revert").addEventListener("click", () => {
  for (const [k, ov] of original) {
    const [slot, id] = k.split(":").map(Number), b = preset.slots.find((x) => x.slot === slot), q = b?.params.find((x) => x.id === id);
    if (b && q && b.scenes[deviceScene ?? 0].values[id] !== ov) { scene = deviceScene ?? 0; setValue(b, q, ov); commit(b, q); }
  }
  $("revert").disabled = true; render(); showDetailIfOpen(); toast("Στάλθηκαν οι αρχικές τιμές.");
});

// Demo: ?demo replays the saved TRAD VIOLIN capture, without MIDI. &slot=N selects a block, &edit turns Live on, &open opens it.
if (demo) {
  (window.__CHRYSIKO_DEMO__ ? Promise.resolve(window.__CHRYSIKO_DEMO__) : fetch("test/capture-trad-violin.json").then((r) => r.json())).then((cap) => {
    for (const p of cap.received) for (const m of rx.push(Uint8Array.from(p.hex.match(/../g).map((x) => parseInt(x, 16))))) onMessage(m);
    if (qs.has("slot")) selected = +qs.get("slot");
    if (qs.has("edit")) liveOn = true;
    render();
    if (wide.matches || qs.has("open")) showDetail();
    if (qs.has("presets")) $("presetsBtn").click();
  });
}
