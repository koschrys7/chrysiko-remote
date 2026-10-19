// Replays a real CoreMIDI capture (read of TRAD VIOLIN) through ampero.js and checks it against the Python codec.
// Usage: node test/decode_test.mjs <capture-result.json> <python-reference.json>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Receiver, readPresetFrames, lzo1xDecompress, parsePreset, READ_CURRENT_PRESET } from "../ampero.js";
import { CATALOG } from "../catalog.js";
const [cap, ref] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, "utf8")));
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const sent = Buffer.from(readPresetFrames()[0]).toString("hex");
if (sent !== cap.sent[0].hex) fail("request frame differs from the captured request");
const rx = new Receiver(), msgs = [];
for (const p of cap.received) msgs.push(...rx.push(Buffer.from(p.hex, "hex")));
const m = msgs.find((x) => x.address === READ_CURRENT_PRESET);
if (!m) fail("no preset message");
const raw = lzo1xDecompress(m.payload);
const sha = createHash("sha256").update(raw).digest("hex");
if (sha !== ref.raw_sha256) fail(`LZO output ${sha} != python ${ref.raw_sha256}`);
const p = parsePreset(m.payload, CATALOG);
if (p.name !== ref.name || p.index !== ref.index) fail("name/index");
if (JSON.stringify(p.slots.map((s) => [s.slot, s.category, s.code, s.scenes.map((c) => [c.enabled, ...c.values])])) !==
    JSON.stringify(ref.blocks.map((b) => [b.slot, b.category, b.code, b.scenes.map((c) => [c.enabled, ...c.params])]))) fail("slots differ");
console.log("OK", p.location, p.name, "messages:", msgs.map((x) => "0x" + x.address.toString(16).padStart(8, "0")).join(" "));
for (const s of p.slots) console.log(` slot ${s.slot}: ${s.module} / ${s.model}  on=${s.scenes.map((c) => +c.enabled).join("")}  ` +
  s.params.map((q) => `${q.name}=${s.scenes[0].values[q.id]}`).join(" "));
