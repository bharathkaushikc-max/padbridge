const test = require('node:test');
const assert = require('node:assert/strict');
const { KbmMapper, mergeIntoReport, FULL_SPEED, TURBO_HALF_MS } = require('../src/kbm/mapper');
const { GTAV } = require('../src/kbm/gtav');
const { BUTTON, DPAD, Mapper, neutralInput } = require('../src/mapping');
const { VK, NAME_BY_VK } = require('../src/kbm/keys');

const fresh = (settings) => new KbmMapper(GTAV, settings);
const names = (bits) => Object.entries(BUTTON).filter(([, b]) => bits & b).map(([n]) => n).sort();

test('K1 on foot: WASD move the left stick, diagonals stay on the unit circle', () => {
  const m = fresh();
  m.keyDown('W', 0);
  let out = m.update(1);
  assert.deepEqual([out.lx, out.ly], [0, -1]);
  m.keyDown('D', 2);
  out = m.update(3);
  assert.ok(Math.abs(Math.hypot(out.lx, out.ly) - 1) < 1e-9);
  assert.ok(out.lx > 0.7 && out.ly < -0.7);
  m.keyDown('S', 4); // W and S cancel
  out = m.update(5);
  assert.deepEqual([out.lx, out.ly], [1, 0]);
});

test('K2 on foot: GTA V PC keys send the PlayStation buttons for the same action', () => {
  const cases = {
    Space: ['Square'], F: ['Triangle'], LCtrl: ['L3'], C: ['R3'], RMB: ['L2'], LMB: ['R2'],
    Q: ['R1'], R: ['Circle'], Tab: ['L1'], CapsLock: ['L3', 'R3'], P: ['Options'], Escape: ['Options'],
    Enter: ['Cross'], Backspace: ['Circle'],
  };
  for (const [key, want] of Object.entries(cases)) {
    const m = fresh();
    m.keyDown(key, 0);
    assert.deepEqual(names(m.update(1).buttons), want.sort(), key);
  }
  const dpad = { E: DPAD.DpadRight, Up: DPAD.DpadUp, LAlt: DPAD.DpadDown, MMB: DPAD.DpadUp };
  for (const [key, want] of Object.entries(dpad)) {
    const m = fresh();
    m.keyDown(key, 0);
    assert.equal(m.update(1).dpad, want, key);
  }
});

test('K3 aim and fire also drive the analog triggers', () => {
  const m = fresh();
  m.keyDown('RMB', 0); m.keyDown('LMB', 0);
  const out = m.update(1);
  assert.equal(out.l2, 1);
  assert.equal(out.r2, 1);
});

test('K4 sprint taps Cross repeatedly while Left Shift is held', () => {
  const m = fresh();
  m.keyDown('LShift', 0);
  const pattern = [];
  for (let t = 0; t < TURBO_HALF_MS * 6; t += TURBO_HALF_MS) pattern.push(m.update(t + 1).buttons & BUTTON.Cross ? 1 : 0);
  assert.deepEqual(pattern, [1, 0, 1, 0, 1, 0]);
  m.keyUp('LShift', 300);
  assert.equal(m.update(301).buttons, 0);
});

test('K5 F enters a vehicle: Triangle, then the vehicle layer', () => {
  const m = fresh();
  m.keyDown('F', 0);
  let out = m.update(1);
  assert.deepEqual(names(out.buttons), ['Triangle']);
  assert.equal(out.layer, 'vehicle');
  m.keyUp('F', 100);
  assert.equal(m.update(101).buttons, 0, 'Triangle released with the key');
  m.keyDown('W', 200);
  out = m.update(201);
  assert.deepEqual(names(out.buttons), ['R2'], 'W accelerates in a vehicle');
  assert.equal(out.r2, 1);
  assert.deepEqual([out.lx, out.ly], [0, 0]);
  m.keyUp('W', 300);
  m.keyDown('F', 400);
  assert.equal(m.update(401).layer, 'foot');
});

test('K6 in a vehicle: driving keys', () => {
  const m = fresh();
  m.setLayer('vehicle');
  const cases = { S: ['L2'], Space: ['R1'], E: ['L3'], C: ['R3'], R: ['Circle'], X: ['Cross'], RMB: ['L1'], LMB: ['L1', 'R1'] };
  for (const [key, want] of Object.entries(cases)) {
    m.reset('vehicle');
    m.keyDown(key, 0);
    assert.deepEqual(names(m.update(1).buttons), want.sort(), key);
  }
  m.reset('vehicle');
  m.keyDown('A', 0); m.keyDown('LShift', 0);
  const out = m.update(1);
  assert.ok(out.lx < 0 && out.ly < 0, 'steer left and lean forward share the left stick');
  m.reset('vehicle');
  m.keyDown('H', 0);
  assert.equal(m.update(1).dpad, DPAD.DpadRight);
});

test('K7 taps: V is a short Create press however long the key is held', () => {
  const m = fresh();
  m.keyDown('V', 0);
  assert.deepEqual(names(m.update(10).buttons), ['Create']);
  assert.equal(m.update(100).buttons, 0, 'pulse over even though V is still held');
  m.keyUp('V', 500);
  assert.equal(m.update(501).buttons, 0);
});

test('K8 holds: a quick M still holds Create long enough to open the interaction menu', () => {
  const m = fresh();
  m.keyDown('M', 0);
  m.keyUp('M', 50);
  assert.deepEqual(names(m.update(400).buttons), ['Create']);
  assert.equal(m.update(701).buttons, 0);
  m.keyDown('M', 1000);
  m.keyUp('M', 2000); // held longer than the minimum: released with the key
  assert.equal(m.update(2001).buttons, 0);
});

test('K9 mouse wheel switches weapons, or zooms while aiming', () => {
  const m = fresh();
  m.wheel('WheelUp', 0);
  assert.equal(m.update(1).dpad, DPAD.DpadRight);
  assert.equal(m.update(100).dpad, 0, 'a tap, not a hold');
  m.keyDown('RMB', 200);
  m.wheel('WheelUp', 210);
  assert.equal(m.update(211).dpad, DPAD.DpadUp);
  m.wheel('WheelDown', 300);
  assert.equal(m.update(301).dpad, DPAD.DpadDown);
  m.setLayer('vehicle');
  m.wheel('WheelUp', 400);
  assert.ok(m.update(401).buttons & BUTTON.Square, 'next vehicle weapon in a vehicle');
});

test('K10 the layer key swaps layers by hand and sends nothing', () => {
  const m = fresh();
  m.keyDown('Backquote', 0);
  const out = m.update(1);
  assert.equal(out.layer, 'vehicle');
  assert.equal(out.buttons, 0);
  m.keyUp('Backquote', 50); m.keyDown('Backquote', 60);
  assert.equal(m.update(61).layer, 'foot');
});

test('K11 key auto-repeat does not restart taps or turbo', () => {
  const m = fresh();
  m.keyDown('LShift', 0);
  m.keyDown('LShift', TURBO_HALF_MS + 5); // repeat while held
  assert.equal(m.update(TURBO_HALF_MS + 10).buttons & BUTTON.Cross, 0, 'still following the original rhythm');
});

test('K12 mouse: still mouse is a centred stick', () => {
  const m = fresh();
  assert.deepEqual([m.update(0).rx, m.update(0).ry], [0, 0]);
});

test('K13 mouse: the smallest movement clears the anti-deadzone, fast movement saturates', () => {
  const m = fresh({ antiDeadzone: 0.2, smoothingMs: 16, sensitivity: 1, curve: 1 });
  m.mouse(1, 0, 10);
  let out = m.update(12);
  assert.ok(out.rx >= 0.2 && out.rx < 0.25, `slow ${out.rx}`);
  assert.equal(out.ry, 0);
  m.reset();
  m.mouse(FULL_SPEED * 16 * 2, 0, 10); // twice full speed
  out = m.update(12);
  assert.ok(Math.abs(out.rx - 1) < 1e-9, `fast ${out.rx}`);
});

test('K14 mouse: direction follows the mouse, y down is stick down', () => {
  const m = fresh({ curve: 1 });
  m.mouse(-10, 10, 10);
  const out = m.update(12);
  assert.ok(out.rx < 0 && out.ry > 0);
  assert.ok(Math.abs(Math.abs(out.rx) - Math.abs(out.ry)) < 1e-9);
});

test('K15 mouse: the stick returns to centre once movement stops', () => {
  const m = fresh({ smoothingMs: 16 });
  m.mouse(20, 0, 0);
  assert.ok(m.update(5).rx > 0);
  assert.equal(m.update(17).rx, 0);
});

test('K16 mouse: higher sensitivity deflects further', () => {
  const lo = fresh({ sensitivity: 0.5, curve: 1, antiDeadzone: 0 });
  const hi = fresh({ sensitivity: 2, curve: 1, antiDeadzone: 0 });
  lo.mouse(16, 0, 10); hi.mouse(16, 0, 10);
  assert.ok(hi.update(12).rx > lo.update(12).rx);
});

test('K17 handles() covers bound keys and the layer key, nothing else', () => {
  const m = fresh();
  for (const k of ['W', 'F', 'Space', 'LMB', 'WheelUp', 'Backquote', 'H', 'Period']) assert.equal(m.handles(k), true, k);
  for (const k of ['LWin', 'F12', 'K', 'RShift']) assert.equal(m.handles(k), false, k);
});

test('K18 merge: keyboard adds to the controller, sticks take the stronger input', () => {
  const base = new Mapper().update({ ...neutralInput(), buttons: { a: true }, axes: { lx: 0.3, ly: 0, rx: 0, ry: 0, lt: 0.5, rt: 0 } }, 0);
  const kbm = { buttons: BUTTON.Square, dpad: DPAD.DpadUp, lx: -1, ly: 0, rx: 0, ry: 0, l2: 0, r2: 1 };
  const out = mergeIntoReport(base, kbm);
  assert.equal(out.Buttons, BUTTON.Cross | BUTTON.Square | BUTTON.L2);
  assert.equal(out.Dpad, DPAD.DpadUp);
  assert.equal(out.Sticklx, -128, 'full keyboard deflection beats a partial stick');
  assert.equal(out.Triggerl2, base.Triggerl2);
  assert.equal(out.Triggerr2, 255);
  assert.equal(mergeIntoReport(base, null), base);
});

test('K19 every key named in the preset exists', () => {
  const mouse = new Set(['LMB', 'RMB', 'MMB', 'WheelUp', 'WheelDown']);
  for (const layer of Object.values(GTAV.layers)) {
    for (const b of layer.bindings) assert.ok(b.key in VK || mouse.has(b.key), b.key);
  }
  assert.ok(GTAV.layerKey in VK);
  assert.equal(NAME_BY_VK[VK.LShift], 'LShift');
});

test('K20 every PlayStation input named in the preset exists', () => {
  for (const layer of Object.values(GTAV.layers)) {
    for (const b of layer.bindings) {
      for (const p of [...(b.press || []), ...((b.whenHeld && b.whenHeld.press) || [])]) assert.ok(p in BUTTON || p in DPAD, `${b.key} -> ${p}`);
    }
  }
});
