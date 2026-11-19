// Live keyboard-and-mouse test against a real PS Remote Play session.
//
//   node e2e/kbm-live.js
//
// Needs: PS Remote Play connected and sitting on the PS5 home screen, the
// VIIPER server installed, and no other PadBridge running. Starts the app with
// Keyboard & mouse on (separate test settings), brings Remote Play to the front,
// clicks its picture, presses Right then Left (the PS5 selection moves and comes
// back), moves the mouse, and releases with F12. Reads back what the virtual
// DualSense sends and saves screenshots of Remote Play before and after.
//
// Only Right, Left, mouse movement and F12 are pressed: nothing that confirms,
// launches or opens anything on the PS5.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const koffi = require('koffi');
const HID = require('node-hid');

const ROOT = path.join(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'padbridge-kbm-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Windows ----
const user32 = koffi.load('user32.dll');
const RECT = koffi.struct('L_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
const POINT = koffi.struct('L_POINT', { x: 'int32_t', y: 'int32_t' });
const KI = koffi.struct('L_KEYBDINPUT', { wVk: 'uint16_t', wScan: 'uint16_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
const MI = koffi.struct('L_MOUSEINPUT', { dx: 'int32_t', dy: 'int32_t', mouseData: 'uint32_t', dwFlags: 'uint32_t', time: 'uint32_t', dwExtraInfo: 'uintptr_t' });
const INPUT = koffi.struct('L_INPUT', { type: 'uint32_t', u: koffi.union({ mi: MI, ki: KI, pad: koffi.array('uint8_t', 32) }) });
const FindWindowW = user32.func('void* __stdcall FindWindowW(str16, str16)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(void*)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(void*, int)');
const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void*, _Out_ L_RECT*)');
const GetCursorPos = user32.func('bool __stdcall GetCursorPos(_Out_ L_POINT*)');
const SetCursorPos = user32.func('bool __stdcall SetCursorPos(int, int)');
const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t, L_INPUT*, int)');

const send = (inputs) => SendInput(inputs.length, inputs, koffi.sizeof(INPUT));
const keyEv = (vk, up) => ({ type: 1, u: { ki: { wVk: vk, wScan: 0, dwFlags: (up ? 2 : 0) | (vk >= 0x21 && vk <= 0x28 ? 1 : 0), time: 0, dwExtraInfo: 0 } } });
const mouseEv = (flags, dx = 0, dy = 0) => ({ type: 0, u: { mi: { dx, dy, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } });
async function tap(vk, holdMs = 120) { send([keyEv(vk, false)]); await sleep(holdMs); send([keyEv(vk, true)]); }
const cursor = () => { const p = {}; GetCursorPos(p); return p; };
const rectOf = (hwnd) => { const r = {}; GetWindowRect(hwnd, r); return r; };

function screenshot(hwnd, file) {
  const r = rectOf(hwnd);
  const ps = `Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap ${r.right - r.left}, ${r.bottom - r.top}; ` +
    `$g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${r.left}, ${r.top}, 0, 0, $b.Size); $b.Save('${file}'); $g.Dispose(); $b.Dispose()`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
  return file;
}

// ---- results ----
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`); };

async function main() {
  const rp = FindWindowW(null, 'PS Remote Play');
  if (!rp) { console.error('PS Remote Play is not open.'); process.exit(2); }

  // Test settings: Keyboard & mouse switched on, nothing else changed.
  const userData = path.join(OUT, 'user-data');
  fs.mkdirSync(path.join(userData, 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'profiles', 'Default.json'), JSON.stringify({ name: 'Default', kbm: { enabled: true } }));

  let log = '';
  const app = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'), [ROOT, '--kbm-test', `--user-data=${userData}`, '--tab=kbm'], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  app.stdout.on('data', (d) => { log += d; });
  app.stderr.on('data', () => {});
  const waitFor = async (re, ms) => { for (let t = 0; t < ms; t += 100) { if (re.test(log)) return true; await sleep(100); } return false; };
  const quit = async () => {
    app.stdin.write('quit');
    for (let t = 0; t < 8000 && app.exitCode === null; t += 100) await sleep(100);
    if (app.exitCode === null) app.kill();
  };

  try {
    check('Virtual DualSense Edge created', await waitFor(/\[engine\] Virtual dualsenseedge ready/, 20000), '');
    await sleep(2500); // let Remote Play pick up the controller

    // Bring Remote Play to the front (a tap of an unused key lets this process take focus).
    ShowWindow(rp, 9);
    send([keyEv(0x87, false), keyEv(0x87, true)]); // F24
    SetForegroundWindow(rp);
    await sleep(600);
    const front = koffi.address(GetForegroundWindow()) === koffi.address(rp);
    check('Remote Play in front', front, front ? '' : 'could not bring it forward');
    check('Hooks installed while Remote Play is in front', await waitFor(/"hooked":true/, 3000), '');

    const hid = HID.devices().find((d) => d.vendorId === 0x054c);
    const reports = [];
    const dev = new HID.HID(hid.path);
    dev.on('data', (r) => { if (r[0] === 0x01) reports.push({ t: Date.now(), r: Buffer.from(r) }); });
    dev.on('error', () => {});
    const since = (t0) => reports.filter((x) => x.t >= t0).map((x) => x.r);

    // Click the middle of the picture: starts capture, must not reach Remote Play.
    const r = rectOf(rp);
    const cx = Math.round((r.left + r.right) / 2), cy = Math.round(r.top + (r.bottom - r.top) * 0.45);
    SetCursorPos(cx, cy);
    await sleep(100);
    send([mouseEv(0x0002)]); await sleep(60); send([mouseEv(0x0004)]);
    check('Click on the picture starts capture', await waitFor(/"locked":true/, 2000), '');

    const before = screenshot(rp, path.join(OUT, '1-before.png'));
    let t0 = Date.now();
    await tap(0x27, 150); // Right arrow: D-pad right
    await sleep(80);
    const hats = since(t0).map((x) => x[8] & 0x0f);
    check('Right arrow sends D-pad right', hats.includes(2), `D-pad values seen: ${[...new Set(hats)].join(',')}`);
    check('...and lets go afterwards', (reports.at(-1).r[8] & 0x0f) === 8, '');
    await sleep(900);
    const moved = screenshot(rp, path.join(OUT, '2-after-right.png'));
    await tap(0x25, 150); // Left arrow: back again
    await sleep(900);
    const back = screenshot(rp, path.join(OUT, '3-after-left.png'));

    // Mouse: 12 nudges of 15 counts, 8 ms apart. Right stick should swing right; cursor must not move.
    const c0 = cursor();
    t0 = Date.now();
    for (let i = 0; i < 12; i++) { send([mouseEv(0x0001, 15, 0)]); await sleep(8); }
    await sleep(40);
    const rxs = since(t0).map((x) => x[3]);
    const c1 = cursor();
    check('Mouse movement swings the right stick right', Math.max(...rxs) > 200, `right stick X peaked at ${Math.max(...rxs)} (centre 128)`);
    check('...and the cursor stays still', c0.x === c1.x && c0.y === c1.y, `cursor ${c0.x},${c0.y} -> ${c1.x},${c1.y}`);
    await sleep(100);
    check('Right stick recentres when the mouse stops', Math.abs(reports.at(-1).r[3] - 128) <= 1, `X now ${reports.at(-1).r[3]}`);

    // Release.
    await tap(0x7b, 60); // F12
    check('F12 releases capture', await waitFor(/"locked":false/, 2000), '');
    const after = reports.at(-1).r;
    check('Nothing is held after release', after[8] === 0x08 && after[9] === 0 && after[10] === 0, `buttons ${after.subarray(8, 11).toString('hex')}`);

    dev.close();
    console.log(`\nScreenshots: ${before}\n             ${moved}\n             ${back}`);
  } finally {
    await quit();
  }
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(2); });
