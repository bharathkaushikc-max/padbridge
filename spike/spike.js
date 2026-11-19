// Phase 0 spike: does PS Remote Play accept a VIIPER virtual DualSense?
//
// Creates a virtual USB DualSense through a running VIIPER server, keeps it
// alive with neutral reports at 250 Hz, and lets you press buttons from the
// keyboard. Anything the host sends back (rumble, lightbar) is logged.
//
//   node spike/spike.js           interactive (keyboard presses buttons)
//   node spike/spike.js --auto        also taps Cross every 2 s, hands-free
//   node spike/spike.js --edge    emulate a DualSense Edge instead (the one Remote Play accepts)
//   node spike/spike.js --ds4     emulate a DualShock 4
//   node spike/spike.js --host H --port N

const { ViiperClient } = require('viiperclient');
const { DualsenseInput, DualsenseOutput, Button, D, Default } =
  require('viiperclient/devices/Dualsense');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const HOST = opt('--host', 'localhost');
const PORT = Number(opt('--port', 3242));
const DS4 = flag('--ds4');
const TYPE = DS4 ? 'dualshock4' : flag('--edge') ? 'dualsenseedge' : 'dualsense';
const Ds4 = require('viiperclient/devices/Dualshock4');
const AUTO = flag('--auto');
const REPORT_INTERVAL_MS = 4; // 250 Hz
const TAP_MS = 120;

// key -> { button } or { dpad }
const KEYS = {
  x: { button: Button.Cross, label: 'Cross' },
  c: { button: Button.Circle, label: 'Circle' },
  s: { button: Button.Square, label: 'Square' },
  t: { button: Button.Triangle, label: 'Triangle' },
  p: { button: Button.PS, label: 'PS' },
  o: { button: Button.Options, label: 'Options' },
  r: { button: Button.Create, label: 'Create' },
  m: { button: Button.Touchpad, label: 'Touchpad click' },
  '1': { button: Button.L1, label: 'L1' },
  '2': { button: Button.R1, label: 'R1' },
  '\u001b[A': { dpad: D.PadUp, label: 'D-pad up' },
  '\u001b[B': { dpad: D.PadDown, label: 'D-pad down' },
  '\u001b[D': { dpad: D.PadLeft, label: 'D-pad left' },
  '\u001b[C': { dpad: D.PadRight, label: 'D-pad right' },
};

const held = { buttons: 0, dpad: 0 };

function buildDs4Report() {
  // DS4 uses a hat value for the D-pad (8 = neutral) and puts PS/touchpad in the low bits.
  const d = held.dpad;
  const hat = d & D.PadUp ? 0 : d & D.PadRight ? 2 : d & D.PadDown ? 4 : d & D.PadLeft ? 6 : 8;
  let b = held.buttons & 0xffff;
  if (held.buttons & Button.PS) b |= Ds4.Button.PS;
  if (held.buttons & Button.Touchpad) b |= Ds4.Button.TouchpadClick;
  return new Ds4.Dualshock4Input({
    Sticklx: 0, Stickly: 0, Stickrx: 0, Stickry: 0,
    Buttons: b, Dpad: hat, Triggerl2: 0, Triggerr2: 0,
    Touch1x: 0, Touch1y: 0, Touch1active: 0, Touch2x: 0, Touch2y: 0, Touch2active: 0,
    Gyrox: 0, Gyroy: 0, Gyroz: 0,
    Accelx: 0, Accely: 0, Accelz: Ds4.Default.AccelZRaw,
  });
}

function buildReport() {
  if (DS4) return buildDs4Report();
  return new DualsenseInput({
    Sticklx: 0, Stickly: 0, Stickrx: 0, Stickry: 0,
    Buttons: held.buttons >>> 0,
    Dpad: held.dpad,
    Triggerl2: 0, Triggerr2: 0,
    Touch1x: 0, Touch1y: 0, Touch1active: 0,
    Touch2x: 0, Touch2y: 0, Touch2active: 0,
    Gyrox: 0, Gyroy: 0, Gyroz: 0,
    // A controller lying flat on a table: gravity on Z only.
    Accelx: Default.AccelXRaw, Accely: Default.AccelYRaw, Accelz: Default.AccelZRaw,
  });
}

function tap(entry) {
  if (entry.button) held.buttons |= entry.button; else held.dpad |= entry.dpad;
  console.log(`-> ${entry.label}`);
  setTimeout(() => {
    if (entry.button) held.buttons &= ~entry.button; else held.dpad &= ~entry.dpad;
  }, TAP_MS);
}

function describeOutput(buf) {
  if (DS4 || buf.length < 6) return `raw ${buf.toString('hex')}`;
  // The stream may deliver several 6-byte frames at once; the last one is current.
  const b = buf.subarray(buf.length - 6);
  const led = [b[2], b[3], b[4]].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `rumble small=${b[0]} large=${b[1]}  lightbar=#${led}  playerLeds=0b${b[5].toString(2).padStart(5, '0')}`;
}

async function main() {
  const client = new ViiperClient(HOST, PORT);

  let ping;
  try {
    ping = await client.ping();
  } catch (err) {
    console.error(`Cannot reach a VIIPER server at ${HOST}:${PORT} (${err.code || err.message}).`);
    console.error('Start it in another terminal with:  viiper server');
    process.exit(1);
  }
  console.log(`VIIPER ${ping.server} ${ping.version} at ${HOST}:${PORT}`);

  const { buses } = await client.buslist();
  let busId;
  let createdBus = false;
  if (buses.length > 0) {
    busId = Math.min(...buses);
  } else {
    busId = (await client.buscreate()).busId;
    createdBus = true;
  }

  const { device, response } = await client.addDeviceAndConnect(busId, { type: TYPE });
  console.log(`Virtual ${response.type} on bus ${response.busId}, device ${response.devId}, USB ${response.vid}:${response.pid}`);

  let lastOutput = '';
  device.on('output', (buf) => {
    const text = describeOutput(buf);
    if (text !== lastOutput) { console.log(`<- ${text}`); lastOutput = text; }
  });

  let closing = false;
  async function shutdown(code) {
    if (closing) return;
    closing = true;
    clearInterval(reportTimer);
    clearInterval(autoTimer);
    try { device.close(); } catch {}
    try { await client.busdeviceremove(response.busId, response.devId); } catch {}
    if (createdBus) { try { await client.busremove(busId); } catch {} }
    console.log('Virtual controller removed.');
    process.exit(code);
  }

  device.on('error', (err) => { console.error(`Stream error: ${err.message}`); shutdown(1); });
  device.on('end', () => { console.error('VIIPER server closed the stream.'); shutdown(1); });

  let sending = false;
  const reportTimer = setInterval(async () => {
    if (sending || closing) return;
    sending = true;
    try { await device.send(buildReport()); }
    catch (err) { console.error(`Send failed: ${err.message}`); shutdown(1); }
    finally { sending = false; }
  }, REPORT_INTERVAL_MS);

  const autoTimer = AUTO ? setInterval(() => tap(KEYS.x), 2000) : null;

  console.log('');
  console.log('Keys: x Cross  c Circle  s Square  t Triangle  arrows D-pad');
  console.log('      p PS  o Options  r Create  m Touchpad  1 L1  2 R1  q quit');
  if (AUTO) console.log('Auto mode: tapping Cross every 2 s.');
  console.log('');

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      if (key === 'q' || key === '\u0003') return shutdown(0);
      const entry = KEYS[key] || KEYS[key.toLowerCase()];
      if (entry) tap(entry);
    });
  }
  process.on('SIGINT', () => shutdown(0));
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { buildReport, describeOutput, held, KEYS };
