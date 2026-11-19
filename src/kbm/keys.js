// Windows virtual-key codes, named the way presets refer to them.
// Low-level hooks report left and right modifier keys separately (LShift, RShift...).

const VK = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0d, Pause: 0x13, CapsLock: 0x14, Escape: 0x1b, Space: 0x20,
  PageUp: 0x21, PageDown: 0x22, End: 0x23, Home: 0x24,
  Left: 0x25, Up: 0x26, Right: 0x27, Down: 0x28, Insert: 0x2d, Delete: 0x2e,
  LWin: 0x5b, RWin: 0x5c, Apps: 0x5d,
  LShift: 0xa0, RShift: 0xa1, LCtrl: 0xa2, RCtrl: 0xa3, LAlt: 0xa4, RAlt: 0xa5,
  Semicolon: 0xba, Equals: 0xbb, Comma: 0xbc, Minus: 0xbd, Period: 0xbe, Slash: 0xbf, Backquote: 0xc0,
  BracketLeft: 0xdb, Backslash: 0xdc, BracketRight: 0xdd, Quote: 0xde,
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(65 + i)] = 65 + i;          // A-Z
for (let i = 0; i <= 9; i++) { VK[`Digit${i}`] = 0x30 + i; VK[`Numpad${i}`] = 0x60 + i; }
for (let i = 1; i <= 24; i++) VK[`F${i}`] = 0x6f + i;                             // F1-F24

const NAME_BY_VK = Object.fromEntries(Object.entries(VK).map(([name, code]) => [code, name]));

// How the app shows a key name to people.
const LABEL = {
  LShift: 'Left Shift', RShift: 'Right Shift', LCtrl: 'Left Ctrl', RCtrl: 'Right Ctrl', LAlt: 'Left Alt', RAlt: 'Right Alt',
  CapsLock: 'Caps Lock', Escape: 'Esc', Backquote: '`', Period: '.', Comma: ',', Up: '↑', Down: '↓', Left: '←', Right: '→',
  LMB: 'Left click', RMB: 'Right click', MMB: 'Middle click', WheelUp: 'Wheel up', WheelDown: 'Wheel down',
};
const label = (name) => LABEL[name] || name.replace(/^Digit/, '');

// Never swallowed, so Windows itself always stays reachable.
const NEVER_BLOCK = new Set([VK.LWin, VK.RWin]);

module.exports = { VK, NAME_BY_VK, label, NEVER_BLOCK };
