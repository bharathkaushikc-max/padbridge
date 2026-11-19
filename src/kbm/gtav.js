// GTA V preset: the game's default PC keyboard and mouse keys, each sent as the
// PlayStation input that does the same thing in GTA V on PS4/PS5.
//
// Sources: community control tables (gtaboom.com, "GTA 5 controls: PC keyboard,
// PlayStation and Xbox"). Rockstar publishes no official cross-platform chart.
//
// Binding shape:
//   key:       a key name from keys.js, or LMB / RMB / MMB / WheelUp / WheelDown
//   action:    what GTA V does with it (shown in the app)
//   press:     PlayStation inputs held while the key is held (BUTTON or DPAD names)
//   stick:     { side: 'left', x, y } stick direction while held (y -1 is up)
//   tapMs:     send a short press of this length instead of holding
//   minHoldMs: keep the press down at least this long (for PS "hold" actions)
//   turbo:     tap the button repeatedly while held (PS sprint is "tap X")
//   switchTo:  change layer when pressed (entering or leaving a vehicle)
//   whenHeld:  { key, ...binding } alternative used while another key is held

const ALWAYS = [
  { key: 'P', action: 'Pause', press: ['Options'] },
  { key: 'Escape', action: 'Pause', press: ['Options'] },
  { key: 'V', action: 'Change camera view', press: ['Create'], tapMs: 80 },
  { key: 'M', action: 'Interaction menu', press: ['Create'], minHoldMs: 700 },
  { key: 'CapsLock', action: 'Special ability', press: ['L3', 'R3'] },
  { key: 'LAlt', action: 'Character wheel (hold)', press: ['DpadDown'] },
  { key: 'Z', action: 'Radar zoom', press: ['DpadDown'], tapMs: 80 },
  { key: 'Up', action: 'Phone, phone up', press: ['DpadUp'] },
  { key: 'Down', action: 'Phone down', press: ['DpadDown'] },
  { key: 'Left', action: 'Phone left', press: ['DpadLeft'] },
  { key: 'Right', action: 'Phone right', press: ['DpadRight'] },
  { key: 'MMB', action: 'Phone', press: ['DpadUp'] },
  { key: 'Enter', action: 'Phone select', press: ['Cross'] },
  { key: 'Backspace', action: 'Phone back', press: ['Circle'] },
];

const FOOT = [
  { key: 'W', action: 'Move forward', stick: { side: 'left', x: 0, y: -1 } },
  { key: 'S', action: 'Move back', stick: { side: 'left', x: 0, y: 1 } },
  { key: 'A', action: 'Move left', stick: { side: 'left', x: -1, y: 0 } },
  { key: 'D', action: 'Move right', stick: { side: 'left', x: 1, y: 0 } },
  { key: 'LShift', action: 'Sprint', press: ['Cross'], turbo: true },
  { key: 'Space', action: 'Jump', press: ['Square'] },
  { key: 'F', action: 'Enter vehicle', press: ['Triangle'], switchTo: 'vehicle' },
  { key: 'LCtrl', action: 'Stealth', press: ['L3'] },
  { key: 'C', action: 'Look behind', press: ['R3'] },
  { key: 'RMB', action: 'Aim', press: ['L2'] },
  { key: 'LMB', action: 'Fire', press: ['R2'] },
  { key: 'Q', action: 'Take cover', press: ['R1'] },
  { key: 'R', action: 'Reload, light melee', press: ['Circle'] },
  { key: 'E', action: 'Context action, weapon accessory', press: ['DpadRight'] },
  { key: 'Tab', action: 'Weapon wheel (hold)', press: ['L1'] },
  {
    key: 'WheelUp', action: 'Next weapon', press: ['DpadRight'], tapMs: 70,
    whenHeld: { key: 'RMB', action: 'Zoom in while aiming', press: ['DpadUp'], tapMs: 70 },
  },
  {
    key: 'WheelDown', action: 'Previous weapon', press: ['DpadLeft'], tapMs: 70,
    whenHeld: { key: 'RMB', action: 'Zoom out while aiming', press: ['DpadDown'], tapMs: 70 },
  },
];

const VEHICLE = [
  { key: 'W', action: 'Accelerate', press: ['R2'] },
  { key: 'S', action: 'Brake, reverse', press: ['L2'] },
  { key: 'A', action: 'Steer left', stick: { side: 'left', x: -1, y: 0 } },
  { key: 'D', action: 'Steer right', stick: { side: 'left', x: 1, y: 0 } },
  { key: 'LShift', action: 'Lean forward', stick: { side: 'left', x: 0, y: -1 } },
  { key: 'LCtrl', action: 'Lean back', stick: { side: 'left', x: 0, y: 1 } },
  { key: 'Space', action: 'Handbrake', press: ['R1'] },
  { key: 'F', action: 'Exit vehicle', press: ['Triangle'], switchTo: 'foot' },
  { key: 'E', action: 'Horn', press: ['L3'] },
  { key: 'H', action: 'Headlights', press: ['DpadRight'] },
  { key: 'C', action: 'Look behind', press: ['R3'] },
  { key: 'R', action: 'Cinematic camera', press: ['Circle'] },
  { key: 'X', action: 'Duck', press: ['Cross'] },
  { key: 'RMB', action: 'Aim drive-by', press: ['L1'] },
  { key: 'LMB', action: 'Fire drive-by', press: ['L1', 'R1'] },
  { key: 'Q', action: 'Radio wheel (hold)', press: ['DpadLeft'] },
  { key: 'Period', action: 'Next radio station', press: ['DpadLeft'], tapMs: 80 },
  { key: 'WheelUp', action: 'Next vehicle weapon', press: ['Square'], tapMs: 70 },
  { key: 'WheelDown', action: 'Next radio station', press: ['DpadLeft'], tapMs: 70 },
];

// Keys bound in a layer win over the same key in ALWAYS.
const layer = (own) => [...own, ...ALWAYS.filter((b) => !own.some((o) => o.key === b.key))];

const GTAV = {
  id: 'gtav',
  name: 'GTA V (PC default keys)',
  layers: {
    foot: { name: 'On foot', bindings: layer(FOOT) },
    vehicle: { name: 'In vehicle', bindings: layer(VEHICLE) },
  },
  startLayer: 'foot',
  layerKey: 'Backquote', // swaps layers by hand if they get out of step with the game
  mouse: 'right',        // mouse movement drives this stick
  notMapped: [
    'G (grenade): its PlayStation equivalent is not documented clearly enough to map.',
    '1 to 9 (pick a weapon class): PlayStation has no direct equivalent; use Tab for the weapon wheel.',
    'F9 and F10 (drop weapon or ammo), B (point), T and Y (chat), N (push to talk).',
    'Aircraft and helicopter controls: use the controller, or the vehicle layer for the basics.',
  ],
};

module.exports = { GTAV };
