// End-to-end button test, no hands needed.
//
//   scripted virtual Xbox 360 pad (VIIPER)
//     -> Windows XInput -> the real bridge (src/bridge.js) -> VIIPER
//     -> virtual DualSense Edge -> Windows HID -> raw report read back here
//
// Every Xbox input is pressed in turn and the DualSense report that Windows
// (and so PS Remote Play) receives is checked byte by byte.
//
//   node e2e/run.js
//
// Needs the VIIPER server running. Do not keep PS Remote Play focused while it
// runs: the presses are real as far as the PS5 is concerned. The test refuses
// to press anything while Remote Play is the foreground window.

const path = require('path');
const { spawn } = require('child_process');
const HID = require('node-hid');
const { ViiperClient } = require('viiperclient');
const X = require('viiperclient/devices/Xbox360');
const xinput = require('../src/xinput');

const SONY = 0x054c;
const MS = 0x045e;
const HOLD_MS = 160;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- safety: never press buttons into a focused Remote Play ------------------
let foregroundTitle = () => '';
try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const GetForegroundWindow = user32.func('void* GetForegroundWindow()');
  const GetWindowTextW = user32.func('int GetWindowTextW(void*, _Out_ uint16_t*, int)');
  foregroundTitle = () => {
    const buf = Buffer.alloc(512);
    const n = GetWindowTextW(GetForegroundWindow(), buf, 255);
    return buf.toString('utf16le', 0, Math.max(0, n) * 2);
  };
} catch {}
const remotePlayFocused = () => /remote play/i.test(foregroundTitle());

// ---- DualSense USB input report (ID 0x01) decoding ---------------------------
const DS_BITS = {
  Square: [8, 0x10], Cross: [8, 0x20], Circle: [8, 0x40], Triangle: [8, 0x80],
  L1: [9, 0x01], R1: [9, 0x02], L2: [9, 0x04], R2: [9, 0x08],
  Create: [9, 0x10], Options: [9, 0x20], L3: [9, 0x40], R3: [9, 0x80],
  PS: [10, 0x01], Touchpad: [10, 0x02], MicMute: [10, 0x04],
};
const HAT = ['Up', 'UpRight', 'Right', 'DownRight', 'Down', 'DownLeft', 'Left', 'UpLeft', 'Neutral'];

function decode(r) {
  const buttons = Object.entries(DS_BITS).filter(([, [i, bit]]) => r[i] & bit).map(([n]) => n);
  return {
    lx: r[1], ly: r[2], rx: r[3], ry: r[4], l2: r[5], r2: r[6],
    hat: HAT[r[8] & 0x0f] || `?${r[8] & 0x0f}`,
    buttons,
    touch: !(r[33] & 0x80),
    touchX: r[34] | ((r[35] & 0x0f) << 8),
    touchY: (r[35] >> 4) | (r[36] << 4),
  };
}

// ---- test bookkeeping ---------------------------------------------------------
let latest = null;       // most recent decoded report
let seen = new Set();    // every button seen during the current step
let seenTouch = false;
let finished = false;
const results = [];

function check(name, problems, detail) {
  results.push({ name, ok: problems.length === 0, problems, detail });
  const mark = problems.length === 0 ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name.padEnd(34)} ${detail}${problems.length ? '\n        ' + problems.join('\n        ') : ''}`);
}
const sameSet = (a, b) => a.length === b.length && a.every((v) => b.includes(v));
const near = (v, target, tol = 2) => Math.abs(v - target) <= tol;

async function main() {
  const client = new ViiperClient('localhost', 3242);
  try { await client.ping(); } catch {
    console.error('VIIPER server is not running. Start it and try again.');
    process.exit(2);
  }
  // A virtual pad from a previous run lingers for a few seconds; let it go first.
  for (let i = 0; i < 80 && HID.devices().some((d) => d.vendorId === SONY); i++) await sleep(100);
  if (HID.devices().some((d) => d.vendorId === SONY)) {
    console.error('A PlayStation controller (real or virtual) is already connected. Stop the bridge first.');
    process.exit(2);
  }
  if (remotePlayFocused()) {
    console.error('PS Remote Play is the focused window. Click on another window and run again.');
    process.exit(2);
  }

  // 1. Scripted virtual Xbox pad.
  const before = new Set(xinput.connectedSlots());
  const { buses } = await client.buslist();
  const createdBus = buses.length === 0;
  const busId = createdBus ? (await client.buscreate()).busId : Math.min(...buses);
  const xbox = await client.addDeviceAndConnect(busId, { type: 'xbox360' });
  xbox.device.on('error', () => {});

  let pad = { Buttons: 0, Lt: 0, Rt: 0, Lx: 0, Ly: 0, Rx: 0, Ry: 0 };
  const push = () => xbox.device.send(new X.Xbox360Input({ ...pad, Reserved: [0, 0, 0, 0, 0, 0] })).catch(() => {});
  const keepAlive = setInterval(push, 8);
  const set = (next) => { pad = { Buttons: 0, Lt: 0, Rt: 0, Lx: 0, Ly: 0, Rx: 0, Ry: 0, ...next }; push(); };

  let slot = null;
  for (let i = 0; i < 50 && slot === null; i++) {
    await sleep(100);
    slot = xinput.connectedSlots().find((n) => !before.has(n)) ?? null;
  }
  let bridge = null;
  let ds = null;
  const cleanup = async () => {
    finished = true;
    clearInterval(keepAlive);
    try { if (ds) ds.close(); } catch {}
    if (bridge) bridge.kill();
    try { xbox.device.close(); } catch {}
    try { await client.busdeviceremove(xbox.response.busId, xbox.response.devId); } catch {}
    await sleep(300);
  };
  if (slot === null) { console.error('Windows never showed the virtual Xbox pad.'); await cleanup(); process.exit(2); }
  console.log(`Virtual Xbox pad: slot ${slot + 1}`);

  // 2. The real bridge, told to read only that pad.
  bridge = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'bridge.js'), '--slot', String(slot + 1), '--verbose'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bridgeLog = '';
  bridge.stdout.on('data', (d) => { bridgeLog += d; });
  bridge.stderr.on('data', (d) => { bridgeLog += d; });
  bridge.on('exit', (code) => {
    if (!finished) console.error(`
The bridge process stopped early (exit ${code}). Its log:
${bridgeLog}`);
  });
  for (let i = 0; i < 80 && !/Bridge running/.test(bridgeLog); i++) await sleep(100);
  if (!/Xbox controller connected/.test(bridgeLog)) {
    console.error(`Bridge did not pick up the virtual pad:\n${bridgeLog}`);
    await cleanup(); process.exit(2);
  }

  // 3. Raw HID readback of the virtual DualSense.
  let info = null;
  for (let i = 0; i < 50 && !info; i++) {
    await sleep(100);
    info = HID.devices().find((d) => d.vendorId === SONY);
  }
  if (!info) { console.error('Windows never showed the virtual DualSense.'); await cleanup(); process.exit(2); }
  ds = new HID.HID(info.path);
  ds.on('error', () => {});
  ds.on('data', (r) => {
    if (r[0] !== 0x01) return;
    latest = decode(r);
    for (const b of latest.buttons) seen.add(b);
    if (latest.touch) seenTouch = true;
  });
  for (let i = 0; i < 30 && !latest; i++) await sleep(100);
  if (!latest) { console.error('No input reports from the virtual DualSense.'); await cleanup(); process.exit(2); }
  console.log(`Virtual DualSense: USB ${info.vendorId.toString(16)}:${info.productId.toString(16)}  "${info.product}"\n`);

  const guard = async () => {
    if (remotePlayFocused()) {
      set({});
      console.error('\nStopped: PS Remote Play took focus. Nothing more was pressed.');
      await cleanup(); process.exit(2);
    }
  };
  // Hold an Xbox state, sample the DualSense while held, release, return the sample.
  const hold = async (state, ms = HOLD_MS) => {
    await guard();
    seen = new Set(); seenTouch = false;
    set(state);
    await sleep(ms);
    const held = latest;
    set({});
    await sleep(140);
    return held;
  };

  // ---- neutral --------------------------------------------------------------
  {
    await sleep(200);
    const n = latest;
    const p = [];
    if (n.buttons.length) p.push(`buttons pressed at rest: ${n.buttons.join(', ')}`);
    if (n.hat !== 'Neutral') p.push(`d-pad at rest: ${n.hat}`);
    for (const k of ['lx', 'ly', 'rx', 'ry']) if (!near(n[k], 128, 1)) p.push(`${k} at rest = ${n[k]}, expected 128`);
    if (n.l2 || n.r2) p.push(`triggers at rest: ${n.l2}/${n.r2}`);
    if (n.touch) p.push('touchpad touched at rest');
    check('Nothing pressed', p, 'all neutral, sticks centred');
  }

  // ---- one button at a time ---------------------------------------------------
  const B = X.Button;
  const direct = [
    ['A', B.A, 'Cross'], ['B', B.B, 'Circle'], ['X', B.X, 'Square'], ['Y', B.Y, 'Triangle'],
    ['LB', B.LShoulder, 'L1'], ['RB', B.RShoulder, 'R1'],
    ['Left stick click', B.LThumb, 'L3'], ['Right stick click', B.RThumb, 'R3'],
    ['Menu', B.Start, 'Options'],
  ];
  for (const [label, bit, target] of direct) {
    const h = await hold({ Buttons: bit });
    const p = [];
    if (!sameSet(h.buttons, [target])) p.push(`while held got [${h.buttons.join(', ') || 'nothing'}], expected [${target}]`);
    if (h.hat !== 'Neutral') p.push(`d-pad moved: ${h.hat}`);
    if (latest.buttons.length) p.push(`still pressed after release: ${latest.buttons.join(', ')}`);
    check(`${label} -> ${target}`, p, `got ${h.buttons.join(', ') || 'nothing'}`);
  }

  const dpad = [
    ['D-pad up', B.DPadUp, 'Up'], ['D-pad down', B.DPadDown, 'Down'],
    ['D-pad left', B.DPadLeft, 'Left'], ['D-pad right', B.DPadRight, 'Right'],
    ['D-pad up+right', B.DPadUp | B.DPadRight, 'UpRight'], ['D-pad down+left', B.DPadDown | B.DPadLeft, 'DownLeft'],
  ];
  for (const [label, bits, hat] of dpad) {
    const h = await hold({ Buttons: bits });
    const p = [];
    if (h.hat !== hat) p.push(`d-pad reads ${h.hat}, expected ${hat}`);
    if (h.buttons.length) p.push(`extra buttons: ${h.buttons.join(', ')}`);
    if (latest.hat !== 'Neutral') p.push('d-pad stuck after release');
    check(`${label} -> ${hat}`, p, `got ${h.hat}`);
  }

  // ---- triggers ---------------------------------------------------------------
  for (const [label, key, button, axis] of [['LT', 'Lt', 'L2', 'l2'], ['RT', 'Rt', 'R2', 'r2']]) {
    let h = await hold({ [key]: 255 });
    let p = [];
    if (!sameSet(h.buttons, [button])) p.push(`buttons [${h.buttons.join(', ')}], expected [${button}]`);
    if (h[axis] !== 255) p.push(`analog ${h[axis]}, expected 255`);
    check(`${label} full -> ${button} 100%`, p, `analog ${h[axis]}`);
    h = await hold({ [key]: 128 });
    p = [];
    if (!near(h[axis], 128, 3)) p.push(`analog ${h[axis]}, expected ~128`);
    if (!sameSet(h.buttons, [button])) p.push(`buttons [${h.buttons.join(', ')}], expected [${button}]`);
    check(`${label} half -> ${button} 50%`, p, `analog ${h[axis]}`);
  }

  // ---- sticks (Xbox +Y is up; DualSense 0 is up/left, 255 is down/right) -------
  const sticks = [
    ['Left stick right', { Lx: 32767 }, 'lx', 255], ['Left stick left', { Lx: -32768 }, 'lx', 0],
    ['Left stick up', { Ly: 32767 }, 'ly', 0], ['Left stick down', { Ly: -32768 }, 'ly', 255],
    ['Right stick right', { Rx: 32767 }, 'rx', 255], ['Right stick left', { Rx: -32768 }, 'rx', 0],
    ['Right stick up', { Ry: 32767 }, 'ry', 0], ['Right stick down', { Ry: -32768 }, 'ry', 255],
  ];
  for (const [label, state, axis, want] of sticks) {
    const h = await hold(state);
    const p = [];
    if (!near(h[axis], want, 1)) p.push(`${axis} = ${h[axis]}, expected ${want}`);
    for (const other of ['lx', 'ly', 'rx', 'ry']) {
      if (other !== axis && !near(h[other], 128, 1)) p.push(`${other} moved to ${h[other]}`);
    }
    if (h.buttons.length) p.push(`extra buttons: ${h.buttons.join(', ')}`);
    if (!near(latest[axis], 128, 1)) p.push('did not return to centre');
    check(label, p, `${axis} = ${h[axis]}`);
  }
  {
    const h = await hold({ Lx: 16384 });
    const p = [];
    if (!(h.lx > 180 && h.lx < 200)) p.push(`lx = ${h.lx}, expected about 190 for half deflection`);
    check('Left stick half right', p, `lx = ${h.lx}`);
  }

  // ---- View button combinations ----------------------------------------------
  {
    await hold({ Buttons: B.Back }, 100);
    await sleep(120);
    const p = [];
    if (!seen.has('Create')) p.push('Create never pressed');
    if (seen.has('Touchpad')) p.push('Touchpad click leaked');
    if (latest.buttons.length) p.push(`stuck: ${latest.buttons.join(', ')}`);
    check('View tap -> Create', p, `saw [${[...seen].join(', ')}]`);
  }
  {
    const h = await hold({ Buttons: B.Back }, 600);
    const p = [];
    if (!sameSet(h.buttons, ['Touchpad'])) p.push(`while held got [${h.buttons.join(', ')}], expected [Touchpad]`);
    if (seen.has('Create')) p.push('Create leaked');
    check('View hold -> Touchpad click', p, `saw [${[...seen].join(', ')}]`);
  }
  {
    await guard();
    seen = new Set();
    set({ Buttons: B.Back }); await sleep(60);
    set({ Buttons: B.Back | B.Start }); await sleep(HOLD_MS);
    const h = latest;
    set({ Buttons: B.Start }); await sleep(120);   // let go of View first
    set({}); await sleep(200);
    const p = [];
    if (!sameSet(h.buttons, ['PS'])) p.push(`while held got [${h.buttons.join(', ')}], expected [PS]`);
    for (const leak of ['Options', 'Create', 'Touchpad']) if (seen.has(leak)) p.push(`${leak} leaked`);
    check('View + Menu -> PS', p, `saw [${[...seen].join(', ')}]`);
  }
  {
    await guard();
    seen = new Set();
    set({ Buttons: B.Back }); await sleep(60);
    set({ Buttons: B.Back | B.RShoulder }); await sleep(HOLD_MS);
    const h = latest;
    set({ Buttons: B.Back }); await sleep(120);    // let go of RB first
    set({}); await sleep(200);
    const p = [];
    if (!sameSet(h.buttons, ['Touchpad'])) p.push(`while held got [${h.buttons.join(', ')}], expected [Touchpad]`);
    for (const leak of ['R1', 'Create']) if (seen.has(leak)) p.push(`${leak} leaked`);
    check('View + RB -> Touchpad click', p, `saw [${[...seen].join(', ')}]`);
  }
  {
    await guard();
    seen = new Set(); seenTouch = false;
    set({ Buttons: B.Back }); await sleep(60);
    set({ Buttons: B.Back, Rx: 32767 }); await sleep(HOLD_MS);
    const right = latest;
    set({ Buttons: B.Back, Rx: -32768 }); await sleep(HOLD_MS);
    const left = latest;
    set({}); await sleep(200);
    const p = [];
    if (!right.touch) p.push('no touch reported');
    if (!(right.touchX > 1850)) p.push(`touch X at right = ${right.touchX}, expected ~1919`);
    if (!(left.touchX < 70)) p.push(`touch X at left = ${left.touchX}, expected ~0`);
    if (!near(right.rx, 128, 1)) p.push(`right stick moved to ${right.rx} during swipe`);
    if (latest.touch) p.push('touch stuck after release');
    if (seen.size) p.push(`buttons leaked: ${[...seen].join(', ')}`);
    check('View + right stick -> swipe', p, `touch X ${right.touchX} -> ${left.touchX}`);
  }

  // ---- two at once -------------------------------------------------------------
  {
    const h = await hold({ Buttons: B.A | B.X | B.LShoulder, Rt: 255 });
    const want = ['Cross', 'Square', 'L1', 'R2'];
    const p = sameSet(h.buttons, want) ? [] : [`got [${h.buttons.join(', ')}], expected [${want.join(', ')}]`];
    check('A + X + LB + RT together', p, `got ${h.buttons.join(', ')}`);
  }

  // ---- Xbox button, last: on many PCs it also opens Xbox Game Bar, and while
  // Game Bar is up Windows hides every other button from apps like the bridge.
  {
    const h = await hold({ Buttons: B.Guide });
    const p = sameSet(h.buttons, ['PS']) ? [] : [`while held got [${h.buttons.join(', ') || 'nothing'}], expected [PS]`];
    check('Xbox button -> PS', p, `got ${h.buttons.join(', ') || 'nothing'}`);

    let blocked = false;
    for (let i = 0; i < 4; i++) {
      await guard();
      set({ Buttons: B.A }); await sleep(250);
      const through = xinput.read(slot)?.buttons.a;
      set({}); await sleep(250);
      if (through) break;
      blocked = true;
      set({ Buttons: B.Guide }); await sleep(150); set({}); await sleep(1500); // dismiss Game Bar
    }
    console.log(blocked
      ? 'NOTE  Pressing the Xbox button made Windows (Xbox Game Bar) block the other buttons until it was pressed again.'
      : 'NOTE  The Xbox button did not trigger Xbox Game Bar blocking.');
  }

  await cleanup();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
  if (failed.length || process.argv.includes('--bridge-log')) console.log(`
Bridge log:
${bridgeLog}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
