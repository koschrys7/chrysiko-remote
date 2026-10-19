// Ampero II Stomp protocol for the page: normal-mode SysEx (read preset/scene/parameter, write parameter, select scene)
// and documented MIDI CC/PC. No I/O here: the page owns Web MIDI. Save, model, routing and anything else cannot be
// encoded (see ALLOWED, CC_ALLOWED).
// Framing follows history/rp360-migration-20261017/background-transport/offline-protocol/normal_wire.py
// (host TX, derived from the native HTMIDIDevice::sendMessage) and sysex_observations.py (device RX).

const HEADER = [0x21, 0x25, 0x4d, 0x50, 0x00, 0x00];
const MAX_HOST_CHUNK = 183;
export const READ_CURRENT_PRESET = 0x01000000;
// The one request this version may send; byte-identical to the frame that read TRAD VIOLIN over CoreMIDI.
const PROVEN_READ_FRAME = "f021254d50000001110800000000000000000000010000000000000000f7";

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function frameMessage(message, flag = 0x11) {
  const frames = [], total = message.length;
  for (let offset = 0; offset < total; offset += MAX_HOST_CHUNK) {
    const data = [];
    for (const b of message.slice(offset, offset + MAX_HOST_CHUNK)) data.push(b >> 4, b & 15);
    const checksum = data.reduce((a, b) => a + b, 0) & 127;
    frames.push(Uint8Array.from([0xf0, ...HEADER, checksum, flag, total & 127, total >> 7, offset & 127, offset >> 7, ...data, 0xf7]));
  }
  return frames;
}

function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }

export const CURRENT_SCENE = 0x03000001, SLOT_PARAMETER = 0x01040003;
export const FLAG = { REQUEST: 0x11, SEND: 0x12, ERROR: 0x13, ACK: 0x14, RETRY: 0x15 };
// The only requests this page can build. Payload length tells read from write:
// scene 0 = read, 1 = select; parameter 4 = read, 8 = write. Preset save is not included.
const ALLOWED = { [READ_CURRENT_PRESET]: [0], [CURRENT_SCENE]: [0, 1], [SLOT_PARAMETER]: [4, 8] };
// The editor's native library (HTUSBTools sendMidiMessage) LZO-compresses every non-empty payload by default
// (connectDevice sets the device's compress flag to 1) and marks writes with flag 0x12 (SEND), reads with 0x11 (REQUEST).
// For payloads this short, lzo1x_1_compress emits literals only: [17 + n, ...bytes, 0x11, 0x00, 0x00]
// (checked against liblzo2 in test/lzo-vectors.json). Sending raw payloads made the pedal hang.
export function lzoLiterals(data) {
  if (data.length < 1 || data.length > 238) throw new Error("literal-only LZO needs 1..238 bytes");
  return Uint8Array.from([17 + data.length, ...data, 0x11, 0x00, 0x00]);
}
export function encodeCommand(address, payload = new Uint8Array(0), flag = 0x11) {
  if (!(address in ALLOWED) || !ALLOWED[address].includes(payload.length)) throw new Error("command not allowed");
  if (flag !== 0x11 && flag !== 0x12) throw new Error("flag must be REQUEST or SEND");
  const body = payload.length ? lzoLiterals(payload) : payload;
  return frameMessage(Uint8Array.from([...u32(address), ...u32(body.length), ...body]), flag);
}
const u16 = (v) => [v & 255, (v >> 8) & 255];
export const readSceneFrames = () => encodeCommand(CURRENT_SCENE);
export const readParamFrames = (slot, id) => encodeCommand(SLOT_PARAMETER, Uint8Array.from([...u16(slot), ...u16(id)]));
export function writeParamFrames(slot, id, value) {
  if (!Number.isFinite(value)) throw new Error("value must be finite");
  const f = new Uint8Array(new Float32Array([value]).buffer);
  return encodeCommand(SLOT_PARAMETER, Uint8Array.from([...u16(slot), ...u16(id), ...f]), 0x12);
}
/** {slot, id, value} from a SLOT_PARAMETER reply. */
export function parseParam(data) {
  if (!data || data.length < 8) return null;
  const dv = new DataView(data.buffer, data.byteOffset);
  return { slot: dv.getUint16(0, true), id: dv.getUint16(2, true), value: dv.getFloat32(4, true) };
}
export const parseScene = (data) => (data && data.length >= 2 ? data[0] | (data[1] << 8) : null);
export function writeSceneFrames(scene) {
  if (!Number.isInteger(scene) || scene < 0 || scene > 2) throw new Error("scene must be 0..2");
  return encodeCommand(CURRENT_SCENE, Uint8Array.of(scene), 0x12);
}
export const locationOf = (index) => `A${String(Math.floor(index / 3)).padStart(2, "0")}-${(index % 3) + 1}`;
export function indexOf(label) {
  const m = /^A(\d{2})-([123])$/.exec(String(label).trim().toUpperCase());
  return m ? +m[1] * 3 + (+m[2] - 1) : null;
}

// ---- standard MIDI channel messages (official "MIDI Control Information List", manual p. 98-99) ----
// Sent on channel 1; the pedal's USB MIDI input channel defaults to Omni.
export const CC = { BANK_MSB: 0, PATCH_VOLUME: 7, PATCH_DOWN: 26, PATCH_UP: 27, SLOT_A1: 48, TUNER: 60, TAP: 76 };
const CC_ALLOWED = new Set([0, 7, 26, 27, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 76]);
export function midiCC(number, value) {
  if (!CC_ALLOWED.has(number)) throw new Error(`CC ${number} not allowed`);
  if (!Number.isInteger(value) || value < 0 || value > 127) throw new Error("CC value 0..127");
  if (number === CC.PATCH_VOLUME && value > 100) throw new Error("patch volume 0..100");
  return Uint8Array.of(0xb0, number, value);
}
/** Select patch A00-1..A99-3: bank MSB (CC0 = 0/1/2) then Program Change, as in the official table. */
export function presetSelectMessages(index) {
  if (!Number.isInteger(index) || index < 0 || index > 299) throw new Error("patch must be A00-1..A99-3");
  const msb = index < 128 ? 0 : index < 256 ? 1 : 2, pc = index - msb * 128;
  return [midiCC(CC.BANK_MSB, msb), Uint8Array.of(0xc0, pc)];
}
/** Slot position 0..11 (A1..B6) on/off. */
export function slotSwitchMessage(position, on) {
  if (!Number.isInteger(position) || position < 0 || position > 11) throw new Error("position 0..11");
  return midiCC(CC.SLOT_A1 + position, on ? 127 : 0);
}

/** The frames for "read current preset". Throws unless they equal the proven frame. */
export function readPresetFrames() {
  const frames = frameMessage(Uint8Array.from([...u32(READ_CURRENT_PRESET), ...u32(0)]));
  if (frames.length !== 1 || hex(frames[0]) !== PROVEN_READ_FRAME) throw new Error("read frame differs from the proven request");
  return frames;
}

/** Collects incoming SysEx bytes and yields complete messages {address, flag, payload}. */
export class Receiver {
  constructor() { this.buf = null; this.active = null; this.chunks = []; }
  push(bytes) {
    const out = [];
    for (const b of bytes) {
      if (b >= 0xf8) continue; // realtime bytes may interleave
      if (b === 0xf0) { this.buf = [b]; continue; }
      if (!this.buf) continue;
      this.buf.push(b);
      if (b === 0xf7) { const m = this.#frame(this.buf); this.buf = null; if (m) out.push(m); }
    }
    return out;
  }
  #frame(f) {
    if (f.length < 14 || f[1] !== 0x21 || f[2] !== 0x25 || f[3] !== 0x4d || f[4] !== 0x50) return null;
    const nib = f.slice(13, -1);
    if (nib.length % 2 || nib.some((x) => x > 15)) return null;
    const chunk = []; for (let i = 0; i < nib.length; i += 2) chunk.push(nib[i] * 16 + nib[i + 1]);
    const flag = f[8], total = f[9] | (f[10] << 7), offset = f[11] | (f[12] << 7);
    if (offset === 0) { this.active = { flag, total }; this.chunks = []; }
    if (!this.active || this.active.total !== total || this.active.flag !== flag || offset !== this.chunks.length) { this.active = null; return null; }
    this.chunks.push(...chunk);
    if (this.chunks.length < total) return null;
    const msg = Uint8Array.from(this.chunks); this.active = null; this.chunks = [];
    const dv = new DataView(msg.buffer);
    if (msg.length < 8) return null;
    const address = dv.getUint32(0, true), len = dv.getUint32(4, true);
    const payload = msg.slice(8, 8 + len);
    // Device replies with flag 0x12 carry an LZO1X stream (also the short ones, e.g. 15 00000000 110000 = 4 zero bytes).
    let data = payload;
    if (flag === 0x12) { try { data = lzo1xDecompress(payload); } catch { data = null; } }
    return { address, flag, payload, data };
  }
}

/** LZO1X decompression (the format of the editor's preset blobs). */
export function lzo1xDecompress(src) {
  const out = []; let ip = 0, t = 0, m;
  const lit = (n) => { for (let i = 0; i < n; i++) out.push(src[ip++]); };
  const copy = (pos, n) => { if (pos < 0) throw new Error("LZO: bad match"); for (let i = 0; i < n; i++) out.push(out[pos + i]); };
  const ext = (base) => { let n = 0; while (src[ip] === 0) { n += 255; ip++; } return n + base + src[ip++]; };
  let state = "loop";
  if (src[0] > 17) { t = src[ip++] - 17; if (t < 4) { lit(t); t = src[ip++]; state = "match"; } else { lit(t); state = "first"; } }
  for (;;) {
    if (state === "loop") {
      t = src[ip++];
      if (t >= 16) { state = "match"; continue; }
      if (t === 0) t = ext(15);
      lit(t + 3); state = "first"; continue;
    }
    if (state === "first") {
      t = src[ip++];
      if (t >= 16) { state = "match"; continue; }
      m = out.length - 0x801 - (t >> 2) - (src[ip++] << 2); copy(m, 3); state = "done"; continue;
    }
    if (state === "match") {
      if (t >= 64) { m = out.length - 1 - ((t >> 2) & 7) - (src[ip++] << 3); copy(m, (t >> 5) + 1); }
      else if (t >= 32) { t &= 31; if (t === 0) t = ext(31); m = out.length - 1 - ((src[ip] >> 2) + (src[ip + 1] << 6)); ip += 2; copy(m, t + 2); }
      else if (t >= 16) {
        m = out.length - ((t & 8) << 11); t &= 7; if (t === 0) t = ext(7);
        m -= (src[ip] >> 2) + (src[ip + 1] << 6); ip += 2;
        if (m === out.length) return Uint8Array.from(out); // end of stream
        copy(m - 0x4000, t + 2);
      } else { m = out.length - 1 - (t >> 2) - (src[ip++] << 2); copy(m, 2); }
      state = "done"; continue;
    }
    // done: trailing literals of the last match
    t = src[ip - 2] & 3;
    if (t === 0) { state = "loop"; continue; }
    lit(t); t = src[ip++]; state = "match";
  }
}

const RECORD_LENGTHS = [10, 101, 6, 8, 72, 3989, 540, 114, 39, 45];

/** Decode a 0x01000000 payload: LZO -> u32 preset index + ten TLV records. */
export function parsePreset(payload, catalog) {
  const raw = lzo1xDecompress(payload);
  const dv = new DataView(raw.buffer);
  const index = dv.getUint32(0, true);
  const rec = {}; let o = 4;
  while (o < raw.length) {
    const type = dv.getUint32(o, true), len = dv.getUint32(o + 4, true);
    rec[type] = raw.slice(o + 8, o + 8 + len); o += 8 + len;
  }
  for (let i = 0; i < 10; i++) if (!rec[i] || rec[i].length !== RECORD_LENGTHS[i]) throw new Error(`unexpected record ${i}`);
  const name = new TextDecoder("ascii").decode(rec[1].slice(4, 20)).split("\0")[0];
  const r4 = new DataView(rec[4].buffer, rec[4].byteOffset), r5 = new DataView(rec[5].buffer, rec[5].byteOffset);
  const slots = [];
  for (let slot = 0; slot < 12; slot++) {
    const code = r4.getUint32(24 + 4 * slot, true);
    if (code === 0xffffffff) continue;
    const category = rec[4][12 + slot], cat = catalog[category];
    const alg = cat && cat.algs[code];
    const scenes = [0, 1, 2].map((s) => ({
      enabled: rec[5][3600 + s * 12 + slot] !== 0,
      values: Array.from({ length: 25 }, (_, i) => r5.getFloat32(s * 1200 + slot * 100 + i * 4, true)),
    }));
    slots.push({ slot, position: rec[4][slot], category, module: cat ? cat.module : `cat ${category}`,
      code, model: alg ? alg[0] : `code 0x${code.toString(16)}`,
      params: alg ? alg[1].map(([n, id, lo, hi, type, step]) => ({ name: n, id, min: lo, max: hi, type, step })) : [], scenes });
  }
  const levels = [0, 1, 2].map((s) => r5.getUint16(3636 + 2 * s, true));
  const bpms = [0, 1, 2].map((s) => r5.getUint16(3642 + 2 * s, true));
  const sceneNames = [0, 1, 2].map((s) => new TextDecoder("ascii").decode(rec[5].slice(3965 + 8 * s, 3973 + 8 * s)).split("\0")[0]);
  // Chain: position i (0-5 upper row, 6-11 lower row) holds slot record4[i]; checked against the editor's TRAD VIOLIN view.
  const bySlot = Object.fromEntries(slots.map((s) => [s.slot, s]));
  const chain = Array.from({ length: 12 }, (_, i) => ({ position: i, slot: rec[4][i], block: bySlot[rec[4][i]] || null }));
  return { chain, index, location: locationOf(index), name, slots, levels, bpms, sceneNames };
}
