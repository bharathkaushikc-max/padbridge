// Pure mapping engine: Xbox controller state in, DualSense report fields out.
// No I/O and no driver dependencies, so everything here is unit-testable.

const BUTTON = {
  Square: 0x10, Cross: 0x20, Circle: 0x40, Triangle: 0x80,
  L1: 0x100, R1: 0x200, L2: 0x400, R2: 0x800,
  Create: 0x1000, Options: 0x2000, L3: 0x4000, R3: 0x8000,
  PS: 0x10000, Touchpad: 0x20000, MicMute: 0x40000,
};
const DPAD = { DpadUp: 1, DpadDown: 2, DpadLeft: 4, DpadRight: 8 };

const TOUCH_W = 1920;
const TOUCH_H = 1080;
const ACCEL_Z_REST = -8192; // controller lying flat: 1 g on Z

const DEFAULT_PROFILE = {
  name: 'Default',
  // Xbox input -> DualSense target. Targets are BUTTON or DPAD names.
  buttons: {
    a: 'Cross', b: 'Circle', x: 'Square', y: 'Triangle',
    lb: 'L1', rb: 'R1', ls: 'L3', rs: 'R3',
    menu: 'Options', guide: 'PS',
    up: 'DpadUp', down: 'DpadDown', left: 'DpadLeft', right: 'DpadRight',
  },
  // The View button is a modifier, because the Xbox pad has fewer buttons.
  view: {
    tap: 'Create',           // quick press
    hold: 'Touchpad',        // held past holdMs with nothing else pressed
    holdMs: 300,
    tapPulseMs: 80,          // how long the tap target stays pressed
    chords: { menu: 'PS', rb: 'Touchpad' }, // View + this button
    rightStickTouch: true,   // View + right stick = finger on the touchpad
    touchThreshold: 0.25,
  },
  sticks: { deadzone: 0.08 },
  triggers: { digitalThreshold: 0.1 },
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Radial deadzone, rescaled so output starts from zero at the deadzone edge.
function applyDeadzone(x, y, deadzone) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || mag === 0) return [0, 0];
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  return [(x / mag) * scaled, (y / mag) * scaled];
}

function toInt8(v) {
  return clamp(Math.round(v < 0 ? v * 128 : v * 127), -128, 127);
}

function toUint8(v) { return clamp(Math.round(v * 255), 0, 255); }

function neutralInput() {
  return {
    buttons: {},
    axes: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 },
  };
}

function validateProfile(profile) {
  const known = (t) => t in BUTTON || t in DPAD;
  const bad = [];
  for (const [src, target] of Object.entries(profile.buttons || {})) {
    if (!known(target)) bad.push(`buttons.${src} -> ${target}`);
  }
  const v = profile.view || {};
  for (const key of ['tap', 'hold']) if (v[key] && !known(v[key])) bad.push(`view.${key} -> ${v[key]}`);
  for (const [src, target] of Object.entries(v.chords || {})) {
    if (!known(target)) bad.push(`view.chords.${src} -> ${target}`);
  }
  if (bad.length) throw new Error(`Unknown mapping target(s): ${bad.join(', ')}`);
  return profile;
}

class Mapper {
  constructor(profile = DEFAULT_PROFILE) {
    this.profile = validateProfile(profile);
    this.viewDownAt = null;   // time View went down, or null
    this.viewChorded = false; // View was used as a modifier during this hold
    this.touching = false;
    this.tapUntil = 0;
    this.suppressed = new Set(); // chord partners still held after their chord
  }

  // input: { buttons: {a,b,x,y,lb,rb,ls,rs,view,menu,guide,up,down,left,right}, axes: {lx,ly,rx,ry,lt,rt} }
  // now: milliseconds, monotonic. Returns the DualsenseInput field set.
  update(input, now) {
    const p = this.profile;
    const view = p.view || {};
    const btn = input.buttons || {};
    const ax = input.axes || {};
    let buttons = 0;
    let dpad = 0;
    const press = (target) => {
      if (target in BUTTON) buttons |= BUTTON[target];
      else if (target in DPAD) dpad |= DPAD[target];
    };

    // A chord partner stays swallowed until it is physically released, so
    // letting go of View first never leaks the partner's normal mapping.
    for (const key of this.suppressed) if (!btn[key]) this.suppressed.delete(key);

    const viewHeld = !!btn.view;
    if (viewHeld && this.viewDownAt === null) {
      this.viewDownAt = now;
      this.viewChorded = false;
      this.touching = false;
    }

    let [rx, ry] = applyDeadzone(ax.rx || 0, ax.ry || 0, p.sticks.deadzone);
    let touchActive = false;
    let touchX = 0;
    let touchY = 0;

    if (viewHeld) {
      for (const [key, target] of Object.entries(view.chords || {})) {
        if (btn[key]) {
          this.viewChorded = true;
          this.suppressed.add(key);
          press(target);
        }
      }
      if (view.rightStickTouch) {
        const mag = Math.hypot(ax.rx || 0, ax.ry || 0);
        if (mag > (view.touchThreshold ?? 0.25)) { this.touching = true; this.viewChorded = true; }
        if (this.touching) {
          touchActive = true;
          touchX = clamp(Math.round(TOUCH_W / 2 + (ax.rx || 0) * (TOUCH_W / 2)), 0, TOUCH_W - 1);
          touchY = clamp(Math.round(TOUCH_H / 2 + (ax.ry || 0) * (TOUCH_H / 2)), 0, TOUCH_H - 1);
          rx = 0; ry = 0; // the stick is acting as a finger, not as a stick
        }
      }
      if (!this.viewChorded && view.hold && now - this.viewDownAt >= view.holdMs) press(view.hold);
    } else if (this.viewDownAt !== null) {
      if (!this.viewChorded && view.tap && now - this.viewDownAt < view.holdMs) {
        this.tapUntil = now + (view.tapPulseMs ?? 80);
      }
      this.viewDownAt = null;
      this.touching = false;
    }
    if (now < this.tapUntil && view.tap) press(view.tap);

    for (const [key, target] of Object.entries(p.buttons)) {
      if (btn[key] && !this.suppressed.has(key)) press(target);
    }

    const [lx, ly] = applyDeadzone(ax.lx || 0, ax.ly || 0, p.sticks.deadzone);
    const lt = clamp(ax.lt || 0, 0, 1);
    const rt = clamp(ax.rt || 0, 0, 1);
    if (lt > p.triggers.digitalThreshold) buttons |= BUTTON.L2;
    if (rt > p.triggers.digitalThreshold) buttons |= BUTTON.R2;

    return {
      Sticklx: toInt8(lx), Stickly: toInt8(ly), Stickrx: toInt8(rx), Stickry: toInt8(ry),
      Buttons: buttons >>> 0,
      Dpad: dpad,
      // A button mapped to L2/R2 has no analog travel, so it counts as a full pull.
      Triggerl2: Math.max(toUint8(lt), buttons & BUTTON.L2 && lt <= p.triggers.digitalThreshold ? 255 : 0),
      Triggerr2: Math.max(toUint8(rt), buttons & BUTTON.R2 && rt <= p.triggers.digitalThreshold ? 255 : 0),
      Touch1x: touchX, Touch1y: touchY, Touch1active: touchActive ? 1 : 0,
      Touch2x: 0, Touch2y: 0, Touch2active: 0,
      Gyrox: 0, Gyroy: 0, Gyroz: 0,
      Accelx: 0, Accely: 0, Accelz: ACCEL_Z_REST,
    };
  }
}

// Remote Play -> controller feedback. The stream delivers 6-byte frames
// (rumbleSmall, rumbleLarge, r, g, b, playerLeds) and may batch several.
function decodeOutput(buf) {
  if (!buf || buf.length < 6) return null;
  const start = buf.length - 6 - (buf.length % 6);
  const b = buf.subarray(start, start + 6);
  return {
    rumbleSmall: b[0], rumbleLarge: b[1],
    led: [b[2], b[3], b[4]], playerLeds: b[5],
  };
}

module.exports = {
  BUTTON, DPAD, DEFAULT_PROFILE, ACCEL_Z_REST,
  Mapper, applyDeadzone, toInt8, toUint8, neutralInput, validateProfile, decodeOutput,
};
