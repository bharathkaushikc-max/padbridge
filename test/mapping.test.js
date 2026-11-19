const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUTTON, DPAD, DEFAULT_PROFILE, ACCEL_Z_REST,
  Mapper, applyDeadzone, neutralInput, validateProfile, decodeOutput,
} = require('../src/mapping');

const input = (buttons = {}, axes = {}) => {
  const i = neutralInput();
  Object.assign(i.buttons, buttons);
  Object.assign(i.axes, axes);
  return i;
};

test('U1 each direct button sets only its own bit', () => {
  const expected = {
    a: BUTTON.Cross, b: BUTTON.Circle, x: BUTTON.Square, y: BUTTON.Triangle,
    lb: BUTTON.L1, rb: BUTTON.R1, ls: BUTTON.L3, rs: BUTTON.R3,
    menu: BUTTON.Options, guide: BUTTON.PS,
  };
  for (const [key, bit] of Object.entries(expected)) {
    const out = new Mapper().update(input({ [key]: true }), 0);
    assert.equal(out.Buttons, bit, key);
    assert.equal(out.Dpad, 0, key);
  }
});

test('U2 d-pad directions, diagonals and neutral', () => {
  const m = new Mapper();
  assert.equal(m.update(input(), 0).Dpad, 0);
  assert.equal(m.update(input({ up: true }), 0).Dpad, DPAD.DpadUp);
  assert.equal(m.update(input({ down: true }), 0).Dpad, DPAD.DpadDown);
  assert.equal(m.update(input({ left: true }), 0).Dpad, DPAD.DpadLeft);
  assert.equal(m.update(input({ right: true }), 0).Dpad, DPAD.DpadRight);
  assert.equal(m.update(input({ up: true, right: true }), 0).Dpad, DPAD.DpadUp | DPAD.DpadRight);
  assert.equal(m.update(input({ up: true }), 0).Buttons, 0);
});

test('U3 stick centre and extremes', () => {
  const m = new Mapper();
  let out = m.update(input(), 0);
  assert.deepEqual([out.Sticklx, out.Stickly, out.Stickrx, out.Stickry], [0, 0, 0, 0]);
  out = m.update(input({}, { lx: 1, ry: -1 }), 0);
  assert.equal(out.Sticklx, 127);
  assert.equal(out.Stickry, -128);
  out = m.update(input({}, { lx: -1 }), 0);
  assert.equal(out.Sticklx, -128);
  // a corner reading beyond the unit circle is pulled back onto it
  out = m.update(input({}, { lx: -1, ly: 1 }), 0);
  assert.equal(out.Sticklx, -91);
  assert.equal(out.Stickly, 90);
});

test('U4 stick inside the deadzone reports exact centre', () => {
  const out = new Mapper().update(input({}, { lx: 0.05, ly: -0.05, rx: 0.07 }), 0);
  assert.deepEqual([out.Sticklx, out.Stickly, out.Stickrx], [0, 0, 0]);
});

test('U5 output ramps from zero just outside the deadzone', () => {
  const dz = DEFAULT_PROFILE.sticks.deadzone;
  const [x] = applyDeadzone(dz + 0.01, 0, dz);
  assert.ok(x > 0 && x < 0.02, `got ${x}`);
  const [full] = applyDeadzone(1, 0, dz);
  assert.equal(full, 1);
});

test('U6 triggers: analog value and digital bit', () => {
  const m = new Mapper();
  let out = m.update(input({}, { lt: 0, rt: 0 }), 0);
  assert.equal(out.Triggerl2, 0);
  assert.equal(out.Buttons, 0);
  out = m.update(input({}, { lt: 0.5 }), 0);
  assert.equal(out.Triggerl2, 128);
  assert.equal(out.Buttons, BUTTON.L2);
  out = m.update(input({}, { rt: 1 }), 0);
  assert.equal(out.Triggerr2, 255);
  assert.equal(out.Buttons, BUTTON.R2);
  out = m.update(input({}, { rt: 0.05 }), 0);
  assert.equal(out.Buttons, 0, 'below digital threshold');
});

test('U7 View tap gives Create on release, never Touchpad', () => {
  const m = new Mapper();
  assert.equal(m.update(input({ view: true }), 0).Buttons, 0);
  assert.equal(m.update(input({ view: true }), 100).Buttons, 0);
  assert.equal(m.update(input(), 150).Buttons, BUTTON.Create);
  assert.equal(m.update(input(), 200).Buttons, BUTTON.Create);
  assert.equal(m.update(input(), 240).Buttons, 0, 'pulse ends');
});

test('U8 View held gives Touchpad click, never Create', () => {
  const m = new Mapper();
  m.update(input({ view: true }), 0);
  assert.equal(m.update(input({ view: true }), 299).Buttons, 0);
  assert.equal(m.update(input({ view: true }), 300).Buttons, BUTTON.Touchpad);
  assert.equal(m.update(input({ view: true }), 900).Buttons, BUTTON.Touchpad);
  assert.equal(m.update(input(), 910).Buttons, 0);
  assert.equal(m.update(input(), 950).Buttons, 0);
});

test('U9 View+Menu gives PS only', () => {
  const m = new Mapper();
  m.update(input({ view: true }), 0);
  assert.equal(m.update(input({ view: true, menu: true }), 50).Buttons, BUTTON.PS);
  assert.equal(m.update(input({ view: true, menu: true }), 500).Buttons, BUTTON.PS, 'no Touchpad after hold time');
});

test('U10 View + right stick moves a touch point and centres the stick', () => {
  const m = new Mapper();
  m.update(input({ view: true }), 0);
  let out = m.update(input({ view: true }, { rx: 1, ry: 0 }), 20);
  assert.equal(out.Touch1active, 1);
  assert.equal(out.Touch1x, 1919);
  assert.equal(out.Touch1y, 540);
  assert.deepEqual([out.Stickrx, out.Stickry], [0, 0]);
  assert.equal(out.Buttons, 0);
  // finger stays down while View is held, even with the stick back at centre
  out = m.update(input({ view: true }, { rx: 0, ry: 0 }), 600);
  assert.equal(out.Touch1active, 1);
  assert.equal(out.Touch1x, 960);
  assert.equal(out.Buttons, 0, 'no Touchpad click after a swipe');
  out = m.update(input({}, { rx: 0.5 }), 700);
  assert.equal(out.Touch1active, 0);
  assert.ok(out.Stickrx > 0, 'right stick works again');
  assert.equal(out.Buttons, 0, 'no Create after a swipe');
});

test('U11 releasing a chord in either order leaks nothing', () => {
  // View released first: Menu must not turn into Options.
  let m = new Mapper();
  m.update(input({ view: true }), 0);
  m.update(input({ view: true, menu: true }), 50);
  assert.equal(m.update(input({ menu: true }), 100).Buttons, 0);
  assert.equal(m.update(input({ menu: true }), 400).Buttons, 0);
  assert.equal(m.update(input(), 450).Buttons, 0);
  assert.equal(m.update(input({ menu: true }), 500).Buttons, BUTTON.Options, 'Menu works normally afterwards');

  // Menu released first: View must not turn into Create or Touchpad.
  m = new Mapper();
  m.update(input({ view: true }), 0);
  m.update(input({ view: true, menu: true }), 50);
  assert.equal(m.update(input({ view: true }), 100).Buttons, 0);
  assert.equal(m.update(input({ view: true }), 600).Buttons, 0);
  assert.equal(m.update(input(), 650).Buttons, 0);
});

test('U12 report fields are complete and the accelerometer rests at 1 g', () => {
  const out = new Mapper().update(input(), 0);
  assert.deepEqual(Object.keys(out), [
    'Sticklx', 'Stickly', 'Stickrx', 'Stickry', 'Buttons', 'Dpad', 'Triggerl2', 'Triggerr2',
    'Touch1x', 'Touch1y', 'Touch1active', 'Touch2x', 'Touch2y', 'Touch2active',
    'Gyrox', 'Gyroy', 'Gyroz', 'Accelx', 'Accely', 'Accelz',
  ]);
  assert.equal(out.Accelz, ACCEL_Z_REST);
});

test('U12b report serialises to the 33 bytes VIIPER expects', () => {
  const { DualsenseInput } = require('viiperclient/devices/Dualsense');
  const { BinaryWriter } = require('../node_modules/viiperclient/dist/utils/binary.js');
  const out = new Mapper().update(input({ a: true, up: true }, { lx: 1, rt: 1 }), 0);
  const w = new BinaryWriter();
  new DualsenseInput(out).write(w);
  const buf = w.toBuffer();
  assert.equal(buf.length, 33);
  assert.equal(buf.readInt8(0), 127);
  assert.equal(buf.readUInt32LE(4), BUTTON.Cross | BUTTON.R2);
  assert.equal(buf.readUInt8(8), DPAD.DpadUp);
  assert.equal(buf.readUInt8(10), 255);
  assert.equal(buf.readInt16LE(31), ACCEL_Z_REST);
});

test('U13 rumble frames decode, using the newest of a batch', () => {
  assert.equal(decodeOutput(Buffer.alloc(3)), null);
  assert.deepEqual(decodeOutput(Buffer.from([10, 200, 1, 2, 3, 4])), {
    rumbleSmall: 10, rumbleLarge: 200, led: [1, 2, 3], playerLeds: 4,
  });
  const batch = Buffer.from([1, 1, 0, 0, 0, 0, 50, 60, 0, 0, 255, 4]);
  assert.equal(decodeOutput(batch).rumbleSmall, 50);
  assert.equal(decodeOutput(batch).rumbleLarge, 60);
});

test('U14 a profile with an unknown target is rejected', () => {
  const bad = structuredClone(DEFAULT_PROFILE);
  bad.buttons.a = 'Crosss';
  assert.throws(() => validateProfile(bad), /buttons\.a -> Crosss/);
  assert.doesNotThrow(() => validateProfile(structuredClone(DEFAULT_PROFILE)));
});

test('U15 two buttons mapped to one target: pressed while either is held', () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.buttons.b = 'Cross';
  const m = new Mapper(profile);
  assert.equal(m.update(input({ a: true, b: true }), 0).Buttons, BUTTON.Cross);
  assert.equal(m.update(input({ b: true }), 0).Buttons, BUTTON.Cross);
  assert.equal(m.update(input(), 0).Buttons, 0);
});

test('U16 a button mapped to L2 sends a full analog pull', () => {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.buttons.lb = 'L2';
  const m = new Mapper(profile);
  let out = m.update(input({ lb: true }), 0);
  assert.equal(out.Buttons, BUTTON.L2);
  assert.equal(out.Triggerl2, 255);
  out = m.update(input(), 0);
  assert.equal(out.Triggerl2, 0);
  out = m.update(input({}, { lt: 0.5 }), 0);
  assert.equal(out.Triggerl2, 128, 'the real trigger keeps its analog value');
});
