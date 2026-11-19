// Keyboard and mouse capture for PS Remote Play, using Windows low-level hooks.
//
// Runs in the Electron main process: its thread pumps Windows messages, which is
// what makes low-level hook callbacks fire. (A plain Node process does not.)
//
// Safety rules:
//   - Hooks are installed only while capture is armed AND PS Remote Play is the
//     foreground window. Everywhere else your keyboard and mouse are untouched.
//   - Input is only taken over after you click inside the Remote Play picture
//     (not its bottom toolbar). That click itself is swallowed.
//   - F12 (unused by GTA V's PC keys), switching to another window, or disarming
//     gives everything back. A combo such as Shift+Esc would leak Shift's own
//     binding (sprint = Cross, which confirms in menus) before the Esc arrived.
//   - Only keys the preset uses are swallowed; the Windows keys never are.
//
// Events: 'state' ({ armed, hooked, locked }), 'key' (name, down, t),
//         'button' (LMB|RMB|MMB, down, t), 'wheel' (WheelUp|WheelDown, t),
//         'move' (dx, dy, t), 'release'.

const { EventEmitter } = require('events');
const { NAME_BY_VK, NEVER_BLOCK, VK } = require('./keys');

const WH_KEYBOARD_LL = 13;
const WH_MOUSE_LL = 14;
const WM = {
  KEYDOWN: 0x100, KEYUP: 0x101, SYSKEYDOWN: 0x104, SYSKEYUP: 0x105,
  MOUSEMOVE: 0x200, LBUTTONDOWN: 0x201, LBUTTONUP: 0x202, RBUTTONDOWN: 0x204, RBUTTONUP: 0x205,
  MBUTTONDOWN: 0x207, MBUTTONUP: 0x208, MOUSEWHEEL: 0x20a, XBUTTONDOWN: 0x20b, XBUTTONUP: 0x20c,
};
const LLKHF_INJECTED = 0x10;
const LLMHF_INJECTED = 0x01;
const TOOLBAR_PX = 130;
const RELEASE_VK = VK.F12; // gives the keyboard and mouse back // Remote Play's control bar along the bottom of its window

let win32 = null;
function loadWin32() {
  if (win32) return win32;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const POINT = koffi.struct('PB_POINT', { x: 'int32_t', y: 'int32_t' });
  const RECT = koffi.struct('PB_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const KBD = koffi.struct('PB_KBDLLHOOKSTRUCT', { vkCode: 'uint32_t', scanCode: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
  const MSL = koffi.struct('PB_MSLLHOOKSTRUCT', { pt: POINT, mouseData: 'uint32_t', flags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
  const HOOKPROC = koffi.proto('intptr_t __stdcall PB_HOOKPROC(int nCode, uintptr_t wParam, intptr_t lParam)');
  win32 = {
    koffi, KBD, MSL, HOOKPROC,
    SetWindowsHookExW: user32.func('void* __stdcall SetWindowsHookExW(int, PB_HOOKPROC*, void*, uint32_t)'),
    CallNextHookEx: user32.func('intptr_t __stdcall CallNextHookEx(void*, int, uintptr_t, intptr_t)'),
    UnhookWindowsHookEx: user32.func('bool __stdcall UnhookWindowsHookEx(void*)'),
    GetModuleHandleW: kernel32.func('void* __stdcall GetModuleHandleW(str16)'),
    GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void*, _Out_ uint16_t*, int)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(void*, _Out_ PB_RECT*)'),
    GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ PB_POINT*)'),
  };
  return win32;
}

class InputCapture extends EventEmitter {
  // handles(name) -> true for keys the current preset uses (those get swallowed while locked)
  constructor({ handles, windowTitle = 'PS Remote Play', acceptInjected = false, ignoreForeground = false } = {}) {
    super();
    this.handles = handles || (() => false);
    this.windowTitle = windowTitle;
    this.acceptInjected = acceptInjected;   // tests only: react to SendInput events
    this.ignoreForeground = ignoreForeground; // tests only: act as if Remote Play were in front
    this.armed = false;
    this.locked = false;
    this.hooks = null;
    this.down = new Set(); // VK codes currently held, as the hook saw them
    this.watch = null;
    this.lastHwnd = null;
    this.lastHwndIsTarget = false;
  }

  get state() { return { armed: this.armed, hooked: !!this.hooks, locked: this.locked }; }
  emitState() { this.emit('state', this.state); }

  arm(on) {
    if (on === this.armed) return;
    this.armed = on;
    if (on) {
      this.watch = setInterval(() => this.sync(), 200);
      this.sync();
    } else {
      clearInterval(this.watch);
      this.watch = null;
      this.release();
      this.unhook();
    }
    this.emitState();
  }

  // Remote Play is the window in front?
  targetInFront() {
    if (this.ignoreForeground) return true;
    const w = loadWin32();
    const hwnd = w.GetForegroundWindow();
    const addr = hwnd ? w.koffi.address(hwnd) : 0n;
    if (addr !== this.lastHwnd) {
      this.lastHwnd = addr;
      const buf = Buffer.alloc(512);
      const n = hwnd ? w.GetWindowTextW(hwnd, buf, 255) : 0;
      this.lastHwndIsTarget = buf.toString('utf16le', 0, Math.max(0, n) * 2).startsWith(this.windowTitle);
      this.targetHwnd = this.lastHwndIsTarget ? hwnd : null;
    }
    return this.lastHwndIsTarget;
  }

  sync() {
    if (!this.armed) return;
    const front = this.targetInFront();
    if (front && !this.hooks) this.hook();
    else if (!front && this.hooks) { this.release(); this.unhook(); }
  }

  hook() {
    const w = loadWin32();
    const kproc = w.koffi.register((n, wp, lp) => this.onKey(n, wp, lp), w.koffi.pointer(w.HOOKPROC));
    const mproc = w.koffi.register((n, wp, lp) => this.onMouse(n, wp, lp), w.koffi.pointer(w.HOOKPROC));
    const mod = w.GetModuleHandleW(null);
    const kh = w.SetWindowsHookExW(WH_KEYBOARD_LL, kproc, mod, 0);
    const mh = w.SetWindowsHookExW(WH_MOUSE_LL, mproc, mod, 0);
    if (!kh || !mh) {
      if (kh) w.UnhookWindowsHookEx(kh);
      if (mh) w.UnhookWindowsHookEx(mh);
      w.koffi.unregister(kproc); w.koffi.unregister(mproc);
      this.emit('error', new Error('Windows refused the keyboard and mouse hooks.'));
      return;
    }
    this.hooks = { kh, mh, kproc, mproc };
    this.down.clear();
    this.emitState();
  }

  unhook() {
    if (!this.hooks) return;
    const w = loadWin32();
    const { kh, mh, kproc, mproc } = this.hooks;
    this.hooks = null;
    w.UnhookWindowsHookEx(kh); w.UnhookWindowsHookEx(mh);
    w.koffi.unregister(kproc); w.koffi.unregister(mproc);
    this.down.clear();
    this.emitState();
  }

  lock() {
    if (this.locked) return;
    this.locked = true;
    this.emitState();
  }

  release() {
    if (!this.locked) return;
    this.locked = false;
    this.emit('release');
    this.emitState();
  }

  close() { this.arm(false); }

  pass(n, wp, lp) { return loadWin32().CallNextHookEx(null, n, wp, lp); }

  onKey(n, wp, lp) {
    try {
      if (n < 0) return this.pass(n, wp, lp);
      const w = loadWin32();
      const s = w.koffi.decode(lp, w.KBD);
      return this.handleKey(wp, s.vkCode, s.flags, performance.now()) ? 1 : this.pass(n, wp, lp);
    } catch (err) {
      this.emit('error', err);
      return this.pass(n, wp, lp);
    }
  }

  // Decide what to do with one key event. Returns true to swallow it.
  handleKey(wp, vk, flags, t) {
    if ((flags & LLKHF_INJECTED) && !this.acceptInjected) return false;
    const down = wp === WM.KEYDOWN || wp === WM.SYSKEYDOWN;
    if (down) this.down.add(vk); else this.down.delete(vk);
    if (!this.locked) return false;
    if (vk === RELEASE_VK) {
      if (down) this.release();
      return true; // the release key only gives the mouse back; it never reaches the game
    }
    const name = NAME_BY_VK[vk];
    if (!name || NEVER_BLOCK.has(vk) || !this.handles(name)) return false;
    this.emit('key', name, down, t);
    return true;
  }

  // Decide what to do with one mouse event. Returns true to swallow it.
  handleMouse(wp, pt, mouseData, flags, t) {
    if ((flags & LLMHF_INJECTED) && !this.acceptInjected) return false;
    if (!this.locked) {
      if (wp === WM.LBUTTONDOWN && this.clickIsOnPicture(pt)) { this.lock(); return true; }
      return false;
    }
    switch (wp) {
      case WM.MOUSEMOVE: {
        const cur = this.cursorPos();
        const dx = pt.x - cur.x, dy = pt.y - cur.y;
        if (dx || dy) this.emit('move', dx, dy, t);
        return true; // the cursor stays put: nothing wanders off Remote Play
      }
      case WM.LBUTTONDOWN: this.emit('button', 'LMB', true, t); return true;
      case WM.LBUTTONUP: this.emit('button', 'LMB', false, t); return true;
      case WM.RBUTTONDOWN: this.emit('button', 'RMB', true, t); return true;
      case WM.RBUTTONUP: this.emit('button', 'RMB', false, t); return true;
      case WM.MBUTTONDOWN: this.emit('button', 'MMB', true, t); return true;
      case WM.MBUTTONUP: this.emit('button', 'MMB', false, t); return true;
      case WM.MOUSEWHEEL: {
        const delta = (mouseData >>> 16) << 16 >> 16; // signed high word
        if (delta) this.emit('wheel', delta > 0 ? 'WheelUp' : 'WheelDown', t);
        return true;
      }
      default: return true; // side buttons and anything else stay away from Remote Play too
    }
  }

  cursorPos() {
    const cur = {};
    loadWin32().GetCursorPos(cur);
    return cur;
  }

  onMouse(n, wp, lp) {
    try {
      if (n < 0) return this.pass(n, wp, lp);
      const w = loadWin32();
      const s = w.koffi.decode(lp, w.MSL);
      return this.handleMouse(wp, s.pt, s.mouseData, s.flags, performance.now()) ? 1 : this.pass(n, wp, lp);
    } catch (err) {
      this.emit('error', err);
      return this.pass(n, wp, lp);
    }
  }

  // A click on Remote Play's picture, not on its bottom control bar?
  clickIsOnPicture(pt) {
    if (this.ignoreForeground) return true;
    if (!this.targetInFront() || !this.targetHwnd) return false;
    const r = {};
    loadWin32().GetWindowRect(this.targetHwnd, r);
    return pt.x >= r.left && pt.x < r.right && pt.y >= r.top && pt.y < r.bottom - TOOLBAR_PX;
  }
}

module.exports = { InputCapture, WM, RELEASE_KEY: 'F12' };
