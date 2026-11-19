// Keyboard and mouse to DualSense: pure logic, no Windows calls, unit-testable.
// Feed it key, wheel and mouse events with timestamps (ms), then call update(now).

const { BUTTON, DPAD } = require('../mapping');

const DEFAULT_KBM_SETTINGS = {
  enabled: false,
  sensitivity: 1.0,   // mouse speed to stick deflection
  antiDeadzone: 0.18, // smallest stick output, to get past the game's own deadzone
  curve: 0.8,         // below 1 boosts small movements, above 1 softens them
  smoothingMs: 16,    // how long mouse movement is averaged over
};

const TURBO_HALF_MS = 45; // sprint taps: 45 ms down, 45 ms up
const DEFAULT_TAP_MS = 70;
// Mouse counts per millisecond that give full deflection at sensitivity 1.
// About 3 counts/ms is a quick flick on an 800 DPI mouse.
const FULL_SPEED = 3;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function unitCircle(x, y) {
  const m = Math.hypot(x, y);
  return m > 1 ? [x / m, y / m] : [x, y];
}

class KbmMapper {
  constructor(preset, settings = {}) {
    this.preset = preset;
    this.settings = { ...DEFAULT_KBM_SETTINGS, ...settings };
    this.reset();
  }

  setSettings(settings) { this.settings = { ...this.settings, ...settings }; }

  // Everything released, mouse still, back to the starting layer.
  reset(layer = this.preset.startLayer) {
    this.layer = layer;
    this.held = new Set();
    this.active = new Map();  // key -> { binding, pressedAt } chosen when it went down
    this.pulses = [];         // { press, until }
    this.samples = [];        // { t, dx, dy }
  }

  bindingFor(key, layer = this.layer) {
    return this.preset.layers[layer].bindings.find((b) => b.key === key) || null;
  }

  setLayer(layer) { if (this.preset.layers[layer]) this.layer = layer; }
  toggleLayer() {
    const names = Object.keys(this.preset.layers);
    this.layer = names[(names.indexOf(this.layer) + 1) % names.length];
  }

  // Returns true when the key is one this preset uses (the caller may then swallow it).
  handles(key) {
    if (key === this.preset.layerKey) return true;
    return Object.values(this.preset.layers).some((l) => l.bindings.some((b) => b.key === key));
  }

  keyDown(key, t) {
    if (this.held.has(key)) return; // auto-repeat
    this.held.add(key);
    if (key === this.preset.layerKey) { this.toggleLayer(); return; }
    let binding = this.bindingFor(key);
    if (!binding) return;
    if (binding.whenHeld && this.held.has(binding.whenHeld.key)) binding = binding.whenHeld;
    if (binding.tapMs) this.pulses.push({ press: binding.press, until: t + binding.tapMs });
    else this.active.set(key, { binding, pressedAt: t });
    if (binding.switchTo) this.setLayer(binding.switchTo);
  }

  keyUp(key, t) {
    this.held.delete(key);
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    const { binding, pressedAt } = entry;
    if (binding.minHoldMs && t - pressedAt < binding.minHoldMs) {
      this.pulses.push({ press: binding.press, until: pressedAt + binding.minHoldMs });
    }
  }

  wheel(direction, t) { // 'WheelUp' | 'WheelDown'
    let binding = this.bindingFor(direction);
    if (!binding) return;
    if (binding.whenHeld && this.held.has(binding.whenHeld.key)) binding = binding.whenHeld;
    this.pulses.push({ press: binding.press, until: t + (binding.tapMs || DEFAULT_TAP_MS) });
  }

  mouse(dx, dy, t) {
    this.samples.push({ t, dx, dy });
  }

  // Mouse speed over the smoothing window as a stick position.
  mouseStick(now) {
    const { smoothingMs, sensitivity, antiDeadzone, curve } = this.settings;
    const since = now - smoothingMs;
    while (this.samples.length && this.samples[0].t <= since) this.samples.shift();
    let sx = 0, sy = 0;
    for (const s of this.samples) { sx += s.dx; sy += s.dy; }
    const vx = sx / smoothingMs, vy = sy / smoothingMs; // counts per ms
    const speed = Math.hypot(vx, vy);
    if (speed === 0) return [0, 0];
    const raw = clamp((speed * sensitivity) / FULL_SPEED, 0, 1);
    const shaped = Math.pow(raw, curve);
    const mag = clamp(antiDeadzone + (1 - antiDeadzone) * shaped, 0, 1);
    return [(vx / speed) * mag, (vy / speed) * mag];
  }

  // The DualSense state this keyboard and mouse are asking for right now.
  update(now) {
    let buttons = 0, dpad = 0;
    const sticks = { left: [0, 0], right: [0, 0] };
    const apply = (press) => {
      for (const name of press || []) {
        if (name in BUTTON) buttons |= BUTTON[name];
        else if (name in DPAD) dpad |= DPAD[name];
      }
    };

    for (const { binding, pressedAt } of this.active.values()) {
      if (binding.stick) {
        sticks[binding.stick.side][0] += binding.stick.x;
        sticks[binding.stick.side][1] += binding.stick.y;
      }
      if (binding.turbo && Math.floor((now - pressedAt) / TURBO_HALF_MS) % 2 === 1) continue;
      apply(binding.press);
    }
    this.pulses = this.pulses.filter((p) => p.until > now);
    for (const p of this.pulses) apply(p.press);

    let [lx, ly] = unitCircle(clamp(sticks.left[0], -1, 1), clamp(sticks.left[1], -1, 1));
    let [rx, ry] = unitCircle(clamp(sticks.right[0], -1, 1), clamp(sticks.right[1], -1, 1));
    if (this.preset.mouse) {
      const [mx, my] = this.mouseStick(now);
      if (this.preset.mouse === 'right') [rx, ry] = unitCircle(rx + mx, ry + my);
      else [lx, ly] = unitCircle(lx + mx, ly + my);
    }

    return {
      buttons, dpad, lx, ly, rx, ry,
      l2: buttons & BUTTON.L2 ? 1 : 0,
      r2: buttons & BUTTON.R2 ? 1 : 0,
      layer: this.layer,
    };
  }
}

// Combine a keyboard/mouse frame into a DualSense report from the controller mapping.
// Buttons add together; each stick and trigger takes whichever source is pushed further.
function mergeIntoReport(report, kbm) {
  if (!kbm) return report;
  const toInt8 = (v) => clamp(Math.round(v < 0 ? v * 128 : v * 127), -128, 127);
  const pick = (ax, ay, bx, by) => (Math.hypot(bx, by) > Math.hypot(ax, ay) ? [bx, by] : [ax, ay]);
  const [lx, ly] = pick(report.Sticklx, report.Stickly, toInt8(kbm.lx), toInt8(kbm.ly));
  const [rx, ry] = pick(report.Stickrx, report.Stickry, toInt8(kbm.rx), toInt8(kbm.ry));
  return {
    ...report,
    Buttons: (report.Buttons | kbm.buttons) >>> 0,
    Dpad: report.Dpad | kbm.dpad,
    Sticklx: lx, Stickly: ly, Stickrx: rx, Stickry: ry,
    Triggerl2: Math.max(report.Triggerl2, Math.round(kbm.l2 * 255)),
    Triggerr2: Math.max(report.Triggerr2, Math.round(kbm.r2 * 255)),
  };
}

module.exports = { KbmMapper, mergeIntoReport, DEFAULT_KBM_SETTINGS, FULL_SPEED, TURBO_HALF_MS };
