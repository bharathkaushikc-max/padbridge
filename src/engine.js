// The bridge engine: Xbox controller in, virtual DualSense out.
// Used by both the command-line bridge and the desktop app.
//
// Events:
//   'status' (status)            whenever any link in the chain changes
//   'frame'  ({input, output})   live state for a UI, about 30 times a second
//   'press'  (text)              the pressed PlayStation buttons changed
//   'log'    (text)              human-readable progress
//
// setOverlay(fn): fn(now) returns a keyboard-and-mouse frame (see kbm/mapper.js)
// that is merged into every report, or null.

const { EventEmitter } = require('events');
const { ViiperClient } = require('viiperclient');
const { DualsenseInput } = require('viiperclient/devices/Dualsense');
const xinput = require('./xinput');
const { Mapper, DEFAULT_PROFILE, BUTTON, DPAD, neutralInput, decodeOutput } = require('./mapping');
const { mergeIntoReport } = require('./kbm/mapper');

const TICK_MS = 2;
const KEEPALIVE_MS = 8;
const FRAME_MS = 33;
const RETRY_MS = 2000;

// Windows timers default to ~15 ms steps, which would cap the loop near 65 Hz.
let timerUsers = 0;
let endPeriod = null;
function raiseTimerResolution() {
  if (timerUsers++ > 0) return;
  try {
    const koffi = require('koffi');
    const winmm = koffi.load('winmm.dll');
    winmm.func('uint32_t timeBeginPeriod(uint32_t)')(1);
    endPeriod = winmm.func('uint32_t timeEndPeriod(uint32_t)');
  } catch {}
}
function restoreTimerResolution() {
  if (--timerUsers > 0 || !endPeriod) return;
  try { endPeriod(1); } catch {}
  endPeriod = null;
}

function describe(state) {
  const parts = Object.entries(BUTTON).filter(([, bit]) => state.Buttons & bit).map(([name]) => name);
  for (const [name, bit] of Object.entries(DPAD)) if (state.Dpad & bit) parts.push(name);
  if (state.Touch1active) parts.push(`Touch(${state.Touch1x},${state.Touch1y})`);
  return parts.length ? parts.join(' + ') : '(released)';
}

class Engine extends EventEmitter {
  constructor({ host = 'localhost', port = 3242, type = 'dualsenseedge', slot = null, profile = DEFAULT_PROFILE } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.type = type;
    this.forcedSlot = slot;          // 0-3, or null for "first connected"
    this.mapper = new Mapper(profile);
    this.profile = profile;

    this.slot = null;                // Xbox controller in use
    this.wanted = false;             // the user wants the virtual controller up
    this.client = null;
    this.device = null;              // VIIPER stream of the virtual controller
    this.deviceInfo = null;
    this.createdBus = null;
    this.connecting = false;
    this.rumble = { small: 0, large: 0 };
    this.status = { server: 'unknown', serverVersion: null, virtual: 'off', virtualInfo: null, xboxSlot: null, running: false, error: null };

    this.lastKey = '';
    this.lastPressKey = '';
    this.lastSend = 0;
    this.lastFrame = 0;
    this.sent = 0;
    this.loop = null;
    this.padTimer = null;
    this.retryTimer = null;
    this.rumbleTestTimer = null;
  }

  // ---- lifecycle ---------------------------------------------------------------

  // Begin reading the Xbox controller. Safe to call without ever starting output.
  open() {
    if (this.loop) return;
    raiseTimerResolution();
    this.findPad();
    this.padTimer = setInterval(() => { if (this.slot === null) this.findPad(); }, 1000);
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  // Create the virtual controller (and keep it up, retrying if the server drops).
  start() {
    this.open();
    this.wanted = true;
    this.setStatus({ running: true });
    this.connect();
  }

  async stop() {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    await this.teardown();
    this.setStatus({ running: false, virtual: 'off', virtualInfo: null, error: null });
  }

  async close() {
    await this.stop();
    clearInterval(this.loop);
    clearInterval(this.padTimer);
    clearTimeout(this.rumbleTestTimer);
    this.loop = null;
    if (this.slot !== null) xinput.rumble(this.slot, 0, 0);
    restoreTimerResolution();
  }

  setOverlay(fn) { this.overlay = fn || null; }

  setProfile(profile) {
    this.mapper = new Mapper(profile); // throws on an invalid profile, leaving the old one active
    this.profile = profile;
  }

  setStatus(patch) {
    const next = { ...this.status, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    this.emit('status', next);
  }

  // ---- Xbox controller -----------------------------------------------------------

  findPad() {
    const slots = xinput.connectedSlots();
    const next = this.forcedSlot !== null ? (slots.includes(this.forcedSlot) ? this.forcedSlot : null) : (slots[0] ?? null);
    if (next === null) return;
    this.slot = next;
    this.setStatus({ xboxSlot: next });
    this.emit('log', `Xbox controller connected (slot ${next + 1}).`);
    this.applyRumble();
  }

  readInput() {
    if (this.slot === null) return neutralInput();
    const state = xinput.read(this.slot);
    if (!state) {
      this.slot = null;
      this.setStatus({ xboxSlot: null });
      this.emit('log', 'Controller disconnected. Output held neutral.');
      return neutralInput();
    }
    return state;
  }

  applyRumble() {
    if (this.slot !== null && !this.rumbleTestTimer) xinput.rumble(this.slot, this.rumble.large, this.rumble.small);
  }

  // Buzz the Xbox controller briefly so the user can confirm vibration works.
  testRumble(ms = 600) {
    if (this.slot === null) return false;
    clearTimeout(this.rumbleTestTimer);
    xinput.rumble(this.slot, 200, 200);
    this.rumbleTestTimer = setTimeout(() => { this.rumbleTestTimer = null; this.applyRumble(); }, ms);
    return true;
  }

  // ---- virtual DualSense -----------------------------------------------------------

  async connect() {
    if (this.connecting || this.device || !this.wanted) return;
    this.connecting = true;
    this.setStatus({ virtual: 'starting' });
    try {
      const client = new ViiperClient(this.host, this.port);
      let ping;
      try {
        ping = await client.ping();
      } catch (err) {
        this.setStatus({ server: 'down', serverVersion: null, virtual: 'off', error: `VIIPER server not reachable at ${this.host}:${this.port}` });
        throw new Error(`Cannot reach the VIIPER server at ${this.host}:${this.port} (${err.code || err.message}).`);
      }
      this.setStatus({ server: 'up', serverVersion: ping.version, error: null });

      const { buses } = await client.buslist();
      const made = buses.length === 0;
      const busId = made ? (await client.buscreate()).busId : Math.min(...buses);
      const { device, response } = await client.addDeviceAndConnect(busId, { type: this.type });
      if (!this.wanted) { // stopped while we were connecting
        try { device.close(); await client.busdeviceremove(response.busId, response.devId); } catch {}
        return;
      }
      this.client = client;
      this.device = device;
      this.deviceInfo = response;
      this.createdBus = made ? busId : null;
      this.lastKey = '';

      device.on('output', (buf) => {
        const out = decodeOutput(buf);
        if (!out) return;
        if (out.rumbleSmall !== this.rumble.small || out.rumbleLarge !== this.rumble.large) {
          this.rumble = { small: out.rumbleSmall, large: out.rumbleLarge };
          this.applyRumble();
        }
      });
      const lost = (why) => {
        if (this.device !== device) return;
        this.device = null;
        this.emit('log', why);
        this.setStatus({ virtual: 'off', virtualInfo: null, error: why });
        this.scheduleRetry();
      };
      device.on('error', (err) => lost(`VIIPER stream error: ${err.message}`));
      device.on('end', () => lost('VIIPER server closed the stream.'));

      this.setStatus({ virtual: 'on', virtualInfo: { type: response.type, vid: response.vid, pid: response.pid }, error: null });
      this.emit('log', `Virtual ${response.type} ready (USB ${response.vid}:${response.pid}), profile "${this.profile.name}"`);
      this.emit('ready');
    } catch (err) {
      this.emit('log', err.message);
      if (this.status.server !== 'down') this.setStatus({ virtual: 'off', error: err.message });
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (this.wanted) this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
  }

  async teardown() {
    const { device, client, deviceInfo, createdBus } = this;
    this.device = null;
    this.client = null;
    this.deviceInfo = null;
    this.createdBus = null;
    this.rumble = { small: 0, large: 0 };
    this.applyRumble();
    if (!device) return;
    try { device.close(); } catch {}
    try { await client.busdeviceremove(deviceInfo.busId, deviceInfo.devId); } catch {}
    if (createdBus !== null) { try { await client.busremove(createdBus); } catch {} }
    this.emit('log', 'Virtual controller removed.');
  }

  // ---- the loop ----------------------------------------------------------------------

  tick() {
    const now = performance.now();
    const input = this.readInput();
    let state = this.mapper.update(input, now);
    // Another input source (keyboard and mouse) can add to what the controller sends.
    const extra = this.overlay ? this.overlay(now) : null;
    if (extra) state = mergeIntoReport(state, extra);

    if (this.device) {
      const key = `${state.Buttons},${state.Dpad},${state.Sticklx},${state.Stickly},${state.Stickrx},${state.Stickry},${state.Triggerl2},${state.Triggerr2},${state.Touch1active},${state.Touch1x},${state.Touch1y}`;
      if (key !== this.lastKey || now - this.lastSend >= KEEPALIVE_MS) {
        this.lastKey = key;
        this.lastSend = now;
        this.sent++;
        const device = this.device;
        device.send(new DualsenseInput(state)).catch((err) => device.emit('error', err));
      }
    }

    const pressKey = `${state.Buttons},${state.Dpad},${state.Touch1active}`;
    if (pressKey !== this.lastPressKey) {
      this.lastPressKey = pressKey;
      this.emit('press', describe(state));
    }

    if (now - this.lastFrame >= FRAME_MS && this.listenerCount('frame') > 0) {
      this.lastFrame = now;
      this.emit('frame', { input, output: state, extra });
    }
  }

  // Reports sent since the last call; lets a caller compute a rate.
  takeSentCount() {
    const n = this.sent;
    this.sent = 0;
    return n;
  }
}

module.exports = { Engine, describe };
