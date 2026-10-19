// JS encoder vs the native-derived Python encoder (normal_wire.py), and LZO decoding of real short replies.
// Usage: node test/protocol_test.mjs   (run from the folder)
import { readFileSync } from "node:fs";
import { readSceneFrames, readParamFrames, writeParamFrames, writeSceneFrames, encodeCommand, Receiver, parseScene, presetSelectMessages, slotSwitchMessage, midiCC, CC, indexOf, locationOf } from "../ampero.js";
const py = JSON.parse(readFileSync(new URL("./python-frames.json", import.meta.url)));
const hx = (fs) => fs.map((f) => Buffer.from(f).toString("hex"));
const fail = (m) => { console.error("FAIL", m); process.exit(1); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: ${a} != ${b}`); };
eq(hx(readSceneFrames()), py.scene, "scene read");
eq(hx(readParamFrames(1, 0)), py.readp, "param read");
eq(hx(writeParamFrames(1, 0, -10)), py.w1, "write 1");
eq(hx(writeParamFrames(4, 2, 6.5)), py.w2, "write 2");
eq(hx(writeParamFrames(11, 24, 1234.5)), py.w3, "write 3");
eq(hx(writeSceneFrames(1)), py.scene1, "scene select 2"); eq(hx(writeSceneFrames(2)), py.scene2, "scene select 3");
// Official MIDI Control Information List: P00-1..P42-2 CC0=0, P42-3..P85-1 CC0=1, P85-2..P99-3 CC0=2 (PC 0-43).
const sel = (l) => presetSelectMessages(indexOf(l)).map((m) => Buffer.from(m).toString("hex"));
eq(sel("A00-1"), ["b00000", "c000"], "A00-1"); eq(sel("A42-2"), ["b00000", "c07f"], "A42-2"); eq(sel("A42-3"), ["b00001", "c000"], "A42-3");
eq(sel("A85-1"), ["b00001", "c07f"], "A85-1"); eq(sel("A85-2"), ["b00002", "c000"], "A85-2"); eq(sel("A99-3"), ["b00002", "c02b"], "A99-3");
eq(locationOf(127), "A42-2", "location of 127");
eq(Buffer.from(slotSwitchMessage(0, true)).toString("hex"), "b0307f", "A1 on = CC48 127"); eq(Buffer.from(slotSwitchMessage(11, false)).toString("hex"), "b03b00", "B6 off = CC59 0");
eq(Buffer.from(midiCC(CC.PATCH_VOLUME, 100)).toString("hex"), "b00764", "patch volume 100 = CC7");
for (const bad of [[1, 0], [7, 101], [61, 127], [77, 0]]) { let t = false; try { midiCC(...bad); } catch { t = true; } if (!t) fail(`CC ${bad} accepted`); }
for (const [a, p] of [[0x05000000, 21], [0x01040002, 7], [0x02000003, 4], [0x01040003, 6], [0x03000003, 4], [0x03000001, 2]]) {
  let threw = false; try { encodeCommand(a, new Uint8Array(p)); } catch { threw = true; }
  if (!threw) fail(`command 0x${a.toString(16)} (${p} bytes) was not refused`);
}
let threw = false; try { writeParamFrames(1, 0, NaN); } catch { threw = true; } if (!threw) fail("NaN accepted");
const replay = (file) => { const cap = JSON.parse(readFileSync(new URL(file, import.meta.url))), rx = new Receiver(), out = [];
  for (const p of cap.received) out.push(...rx.push(Buffer.from(p.hex, "hex"))); return out; };
const scene = replay("./capture-trad-violin.json").find((m) => m.address === 0x03000001);
eq(parseScene(scene.data), 0, "scene reply decodes to 0");
const model = replay("./capture-slot-model.json").find((m) => m.address === 0x01040002);
eq(Buffer.from(model.data).toString("hex"), "00001b00000000", "slot model reply (slot 0, cat 0, code 27 = AI Gate, off)");
console.log("OK protocol: 7 frames identical to normal_wire.py; bank/PC and CC match the official MIDI table; save, model, routing and preset-change SysEx refused; LZO replies decoded");
