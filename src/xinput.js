// Xbox controller access through Windows' XInput API (xinput1_4.dll).
// Polled, exact values, no event loop: buttons, sticks, triggers, rumble.

const koffi = require('koffi');

const XINPUT_GAMEPAD = koffi.struct('XINPUT_GAMEPAD', {
  wButtons: 'uint16_t',
  bLeftTrigger: 'uint8_t',
  bRightTrigger: 'uint8_t',
  sThumbLX: 'int16_t',
  sThumbLY: 'int16_t',
  sThumbRX: 'int16_t',
  sThumbRY: 'int16_t',
});
const XINPUT_STATE = koffi.struct('XINPUT_STATE', {
  dwPacketNumber: 'uint32_t',
  Gamepad: XINPUT_GAMEPAD,
});
koffi.struct('XINPUT_VIBRATION', { wLeftMotorSpeed: 'uint16_t', wRightMotorSpeed: 'uint16_t' });

const lib = koffi.load('xinput1_4.dll');
const XInputGetState = lib.func('uint32_t XInputGetState(uint32_t index, _Out_ XINPUT_STATE *state)');
const XInputSetState = lib.func('uint32_t XInputSetState(uint32_t index, XINPUT_VIBRATION *vibration)');

// The documented call hides the Xbox (Guide) button. The same DLL exports an
// undocumented twin at ordinal 100 that reports it; use it when it resolves.
let getState = XInputGetState;
let guideSupported = false;
try {
  const kernel32 = koffi.load('kernel32.dll');
  const GetModuleHandleW = kernel32.func('void* GetModuleHandleW(str16 name)');
  const GetProcAddress = kernel32.func('void* GetProcAddress(void* module, uintptr_t ordinal)');
  const address = GetProcAddress(GetModuleHandleW('xinput1_4.dll'), 100);
  if (address) {
    const proto = koffi.proto('uint32_t XInputGetStateEx(uint32_t index, _Out_ XINPUT_STATE *state)');
    getState = (index, state) => koffi.call(address, proto, index, state);
    getState(0, {}); // throws here, not mid-game, if the call shape is wrong
    guideSupported = true;
  }
} catch {
  getState = XInputGetState;
  guideSupported = false;
}

const BITS = {
  up: 0x0001, down: 0x0002, left: 0x0004, right: 0x0008,
  menu: 0x0010, view: 0x0020, ls: 0x0040, rs: 0x0080,
  lb: 0x0100, rb: 0x0200, guide: 0x0400,
  a: 0x1000, b: 0x2000, x: 0x4000, y: 0x8000,
};
const MAX_SLOTS = 4;

const stick = (v) => (v < 0 ? v / 32768 : v / 32767);

// Returns null when no controller is in that slot, otherwise the normalised
// state the mapping engine expects. Stick Y is flipped so that down is positive.
function read(slot) {
  const state = {};
  if (getState(slot, state) !== 0) return null;
  const g = state.Gamepad;
  const buttons = {};
  for (const [name, bit] of Object.entries(BITS)) buttons[name] = (g.wButtons & bit) !== 0;
  return {
    buttons,
    axes: {
      lx: stick(g.sThumbLX), ly: -stick(g.sThumbLY),
      rx: stick(g.sThumbRX), ry: -stick(g.sThumbRY),
      lt: g.bLeftTrigger / 255, rt: g.bRightTrigger / 255,
    },
  };
}

function connectedSlots() {
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) if (getState(i, {}) === 0) slots.push(i);
  return slots;
}

// large / small: 0..255, the DualSense's heavy and light motors.
function rumble(slot, large, small) {
  try {
    XInputSetState(slot, { wLeftMotorSpeed: Math.round(large * 257), wRightMotorSpeed: Math.round(small * 257) });
  } catch {}
}

module.exports = { read, connectedSlots, rumble, guideSupported: () => guideSupported, MAX_SLOTS };
