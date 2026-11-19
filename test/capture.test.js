// The capture's decisions, tested without installing any Windows hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const { InputCapture, WM } = require('../src/kbm/capture');
const { VK } = require('../src/kbm/keys');
const { KbmMapper } = require('../src/kbm/mapper');
const { GTAV } = require('../src/kbm/gtav');

const INJECTED_KEY = 0x10;
const INJECTED_MOUSE = 0x01;

function make() {
  const mapper = new KbmMapper(GTAV);
  const cap = new InputCapture({ handles: (k) => mapper.handles(k), ignoreForeground: true });
  cap.cursorPos = () => ({ x: 500, y: 300 }); // where the frozen cursor sits
  const events = [];
  for (const name of ['key', 'button', 'wheel', 'move', 'release']) cap.on(name, (...a) => events.push([name, ...a]));
  return { cap, events };
}
const key = (cap, vk, down = true, flags = 0) => cap.handleKey(down ? WM.KEYDOWN : WM.KEYUP, vk, flags, 0);
const click = (cap, flags = 0) => cap.handleMouse(WM.LBUTTONDOWN, { x: 500, y: 300 }, 0, flags, 0);

test('C1 nothing is taken before the click that starts capture', () => {
  const { cap, events } = make();
  assert.equal(key(cap, VK.W), false, 'W passes through');
  assert.equal(cap.handleMouse(WM.MOUSEMOVE, { x: 510, y: 300 }, 0, 0, 0), false, 'mouse moves normally');
  assert.equal(events.length, 0);
});

test('C2 the starting click is swallowed and locks capture', () => {
  const { cap } = make();
  assert.equal(click(cap), true);
  assert.equal(cap.locked, true);
});

test('C3 once locked: preset keys are swallowed and reported, other keys pass', () => {
  const { cap, events } = make();
  click(cap);
  assert.equal(key(cap, VK.W), true);
  assert.equal(key(cap, VK.W, false), true);
  assert.deepEqual(events.slice(0, 2).map((e) => e.slice(0, 3)), [['key', 'W', true], ['key', 'W', false]]);
  assert.equal(key(cap, VK.K), false, 'K is not in the preset');
  assert.equal(key(cap, VK.F11), false);
});

test('C4 the Windows keys are never swallowed', () => {
  const { cap } = make();
  cap.handles = () => true; // even if a preset claimed them
  click(cap);
  assert.equal(key(cap, VK.LWin), false);
  assert.equal(key(cap, VK.RWin), false);
});

test('C5 F12 gives everything back and sends nothing to the game', () => {
  const { cap, events } = make();
  click(cap);
  assert.equal(key(cap, VK.F12), true);
  assert.equal(cap.locked, false);
  assert.ok(events.some((e) => e[0] === 'release'));
  assert.ok(!events.some((e) => e[0] === 'key'), 'no button press leaked on the way out');
  assert.equal(key(cap, VK.F12, false), false, 'its key-up passes once released');
  assert.equal(key(cap, VK.W), false, 'keys pass again after release');
});

test('C5b the release key is not used by the GTA V preset', () => {
  const { KbmMapper } = require('../src/kbm/mapper');
  assert.equal(new KbmMapper(GTAV).handles('F12'), false);
});

test('C6 Esc on its own is the pause button', () => {
  const { cap, events } = make();
  click(cap);
  assert.equal(key(cap, VK.Escape), true);
  assert.equal(cap.locked, true);
  assert.deepEqual(events[0].slice(0, 3), ['key', 'Escape', true]);
});

test('C7 mouse movement is reported as a delta and the cursor is held still', () => {
  const { cap, events } = make();
  click(cap);
  assert.equal(cap.handleMouse(WM.MOUSEMOVE, { x: 507, y: 296 }, 0, 0, 5), true);
  assert.deepEqual(events.at(-1), ['move', 7, -4, 5]);
});

test('C8 mouse buttons and the wheel are reported and swallowed', () => {
  const { cap, events } = make();
  click(cap);
  assert.equal(cap.handleMouse(WM.RBUTTONDOWN, { x: 500, y: 300 }, 0, 0, 1), true);
  assert.equal(cap.handleMouse(WM.LBUTTONDOWN, { x: 500, y: 300 }, 0, 0, 2), true);
  assert.equal(cap.handleMouse(WM.MOUSEWHEEL, { x: 500, y: 300 }, (120 << 16) >>> 0, 0, 3), true);
  assert.equal(cap.handleMouse(WM.MOUSEWHEEL, { x: 500, y: 300 }, (-120 << 16) >>> 0, 0, 4), true);
  assert.deepEqual(events.map((e) => e.slice(0, 3)), [
    ['button', 'RMB', true], ['button', 'LMB', true], ['wheel', 'WheelUp', 3], ['wheel', 'WheelDown', 4],
  ]);
});

test('C9 injected input is ignored unless testing', () => {
  const { cap, events } = make();
  assert.equal(click(cap, INJECTED_MOUSE), false);
  assert.equal(cap.locked, false, 'a program cannot start capture');
  click(cap);
  assert.equal(key(cap, VK.W, true, INJECTED_KEY), false);
  assert.equal(events.length, 0);
});

test('C10 releasing while locked sends one release; disarming releases', () => {
  const { cap, events } = make();
  click(cap);
  cap.release();
  cap.release();
  assert.equal(events.filter((e) => e[0] === 'release').length, 1);
  // Never install real hooks in a test process: stand in for them.
  cap.hook = () => { cap.hooks = {}; };
  cap.unhook = () => { cap.hooks = null; };
  cap.arm(true);
  assert.equal(cap.state.hooked, true);
  click(cap);
  cap.arm(false);
  assert.equal(cap.locked, false);
  assert.equal(cap.state.hooked, false);
  assert.equal(events.filter((e) => e[0] === 'release').length, 2);
});
