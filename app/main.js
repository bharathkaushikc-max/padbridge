// PadBridge desktop app: Electron main process.
// Owns the bridge engine, the profile files, the window and the tray icon.
//
// Development flags:
//   --no-bridge            open the window without creating the virtual controller
//   --keep-server          leave the VIIPER server running when PadBridge quits
//   --kbm-test             keyboard/mouse capture reacts to injected input and ignores which window is in front (tests only)
//   --user-data=<dir>      keep profiles and settings somewhere else (for tests)
//   --tab=<name>           open on mapping | tuning | test | profiles
//   --screenshot=<file>    save a PNG of the window once it has rendered, then quit
//   --size=<w>x<h>         window size for that screenshot

const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync, spawn } = require('child_process');
const { Engine } = require('../src/engine');
const { ProfileStore, mergeProfile } = require('../src/profiles');
const xinput = require('../src/xinput');
const { KbmMapper } = require('../src/kbm/mapper');
const { GTAV } = require('../src/kbm/gtav');
const { InputCapture } = require('../src/kbm/capture');
const { label: keyLabel } = require('../src/kbm/keys');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const has = (name) => process.argv.includes(`--${name}`);

if (arg('user-data')) app.setPath('userData', path.resolve(arg('user-data')));
const SCREENSHOT = arg('screenshot');
const NO_BRIDGE = has('no-bridge');

if (!SCREENSHOT && !app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let store = null;
let engine = null;
let quitting = false;
let remotePlay = false;
let kbm = null;      // keyboard and mouse mapper (GTA V preset)
let capture = null;  // Windows keyboard and mouse hooks

// ---- tray icon: a round button cap, drawn in code so there is no asset to ship ----
function capIcon(rgb) {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 15.5, y - 15.5);
      const i = (y * size + x) * 4;
      let c = null;
      if (d <= 9.5) c = rgb;                 // cap
      else if (d <= 12.5) c = [20, 22, 31];  // dark ring
      else if (d <= 14.5) c = [244, 241, 232]; // light outer ring
      if (!c) continue;
      buf[i] = c[2]; buf[i + 1] = c[1]; buf[i + 2] = c[0]; buf[i + 3] = 255; // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}
const ICONS = { ok: [47, 168, 102], warn: [247, 201, 59], off: [140, 144, 160], bad: [226, 59, 46] };

function health() {
  const s = engine.status;
  if (!s.running) return 'off';
  if (s.virtual !== 'on') return 'bad';
  if (s.xboxSlot === null) return 'warn';
  return 'ok';
}
const HEALTH_TEXT = {
  ok: 'PadBridge: running',
  warn: 'PadBridge: no Xbox controller connected',
  bad: 'PadBridge: virtual controller is not up',
  off: 'PadBridge: bridge is off',
};

function refreshTray() {
  if (!tray) return;
  const h = health();
  tray.setImage(capIcon(ICONS[h]));
  tray.setToolTip(HEALTH_TEXT[h]);
  const active = store.activeName();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open PadBridge', click: showWindow },
    { type: 'separator' },
    engine.status.running
      ? { label: 'Turn bridge off', click: () => engine.stop() }
      : { label: 'Turn bridge on', click: () => engine.start() },
    {
      label: 'Profile',
      submenu: store.list().map((name) => ({
        label: name, type: 'radio', checked: name === active, click: () => selectProfile(name),
      })),
    },
    { type: 'separator' },
    { label: 'Quit PadBridge', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---- state shared with the window ----------------------------------------------------
function snapshot() {
  const active = store.activeName();
  return {
    status: { ...engine.status, remotePlay },
    profiles: store.list(),
    active,
    profile: store.load(active),
    guideSupported: xinput.guideSupported(),
    kbm: kbmStatus(),
    kbmPreset: presetForWindow(),
    startTab: arg('tab') || 'mapping',
  };
}
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const pushState = () => { send('state', snapshot()); refreshTray(); };

// ---- keyboard and mouse ------------------------------------------------------------------------
function kbmStatus() {
  return { ...capture.state, layer: kbm.layer, layers: Object.fromEntries(Object.entries(GTAV.layers).map(([id, l]) => [id, l.name])) };
}
const sendKbm = () => send('kbm', kbmStatus());

// The preset as the window shows it: key labels resolved, nothing executable.
function presetForWindow() {
  const row = (b) => ({
    key: b.key, keyLabel: keyLabel(b.key), action: b.action, press: b.press || [], stick: b.stick || null,
    tapMs: b.tapMs || 0, minHoldMs: b.minHoldMs || 0, turbo: !!b.turbo, switchTo: b.switchTo || null,
    whenHeld: b.whenHeld ? { keyLabel: keyLabel(b.whenHeld.key), action: b.whenHeld.action, press: b.whenHeld.press } : null,
  });
  return {
    name: GTAV.name,
    layerKey: keyLabel(GTAV.layerKey),
    layers: Object.fromEntries(Object.entries(GTAV.layers).map(([id, l]) => [id, { name: l.name, rows: l.bindings.map(row) }])),
    notMapped: GTAV.notMapped,
  };
}

function applyKbm(profile) {
  kbm.setSettings(profile.kbm);
  capture.arm(!!profile.kbm.enabled && !SCREENSHOT);
  sendKbm();
}

function startKbm(profile) {
  kbm = new KbmMapper(GTAV, profile.kbm);
  const testing = has('kbm-test');
  capture = new InputCapture({ handles: (key) => kbm.handles(key), acceptInjected: testing, ignoreForeground: testing });
  capture.on('key', (name, down, t) => {
    const before = kbm.layer;
    if (down) kbm.keyDown(name, t); else kbm.keyUp(name, t);
    if (kbm.layer !== before) sendKbm();
  });
  capture.on('button', (name, down, t) => { if (down) kbm.keyDown(name, t); else kbm.keyUp(name, t); });
  capture.on('wheel', (dir, t) => kbm.wheel(dir, t));
  capture.on('move', (dx, dy, t) => kbm.mouse(dx, dy, t));
  capture.on('release', () => { kbm.reset(kbm.layer); }); // let go of everything, keep the layer
  capture.on('state', sendKbm);
  capture.on('error', (err) => console.error('[kbm]', err.message));
  engine.setOverlay((now) => (capture.locked ? kbm.update(now) : null));
  applyKbm(profile);
}

function selectProfile(name) {
  engine.setProfile(store.load(name));
  applyKbm(store.load(name));
  store.setActive(name);
  pushState();
}

function checkRemotePlay() {
  execFile('tasklist', ['/FI', 'IMAGENAME eq RemotePlay.exe', '/NH', '/FO', 'CSV'], { windowsHide: true }, (err, out) => {
    const now = !err && /RemotePlay\.exe/i.test(out);
    if (now !== remotePlay) { remotePlay = now; send('status', { ...engine.status, remotePlay }); }
  });
}

// ---- window -----------------------------------------------------------------------------
function createWindow() {
  const [w, h] = (arg('size') || '1180x780').split('x').map(Number);
  win = new BrowserWindow({
    width: w, height: h, minWidth: 980, minHeight: 660,
    useContentSize: true,
    backgroundColor: '#14161f',
    show: false,
    autoHideMenuBar: true,
    title: 'PadBridge',
    icon: capIcon(ICONS.warn),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!SCREENSHOT) win.show(); else win.showInactive(); });
  // Closing the window ends PadBridge completely: nothing is left running.
  win.on('closed', () => { win = null; if (!quitting) app.quit(); });
  if (SCREENSHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(SCREENSHOT), image.toPNG());
      quitting = true;
      app.quit();
    }, Number(arg('delay') || 1800)));
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  else { win.show(); win.focus(); }
}

// ---- requests from the window -------------------------------------------------------------
function wire() {
  ipcMain.handle('state:get', () => snapshot());
  ipcMain.handle('bridge:start', () => { engine.start(); });
  ipcMain.handle('bridge:stop', () => engine.stop());
  ipcMain.handle('rumble:test', () => engine.testRumble());
  ipcMain.handle('kbm:layer', (_e, layer) => { kbm.setLayer(layer); sendKbm(); });

  // Save edits to the active profile and apply them at once.
  ipcMain.handle('profile:save', (_e, profile) => {
    const clean = mergeProfile({ ...profile, name: store.activeName() });
    engine.setProfile(clean);
    store.save(clean);
    applyKbm(clean);
    return clean;
  });
  ipcMain.handle('profile:select', (_e, name) => { selectProfile(name); });
  ipcMain.handle('profile:create', (_e, name) => {
    const { DEFAULT_PROFILE } = require('../src/mapping');
    const saved = store.save({ ...structuredClone(DEFAULT_PROFILE), name: store.uniqueName(name || 'New profile') });
    selectProfile(saved.name);
  });
  ipcMain.handle('profile:duplicate', (_e, name) => {
    const saved = store.save({ ...store.load(name), name: store.uniqueName(`${name} copy`) });
    selectProfile(saved.name);
  });
  ipcMain.handle('profile:rename', (_e, { from, to }) => {
    const saved = store.rename(from, to);
    if (store.activeName() === saved.name) engine.setProfile(saved);
    pushState();
  });
  ipcMain.handle('profile:delete', (_e, name) => {
    store.remove(name);
    engine.setProfile(store.load(store.activeName()));
    pushState();
  });
  ipcMain.handle('profile:export', async (_e, name) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export profile', defaultPath: `${name}.padbridge.json`, filters: [{ name: 'PadBridge profile', extensions: ['json'] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, JSON.stringify(store.load(name), null, 2));
    return filePath;
  });
  ipcMain.handle('profile:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import profile', properties: ['openFile'], filters: [{ name: 'PadBridge profile', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return null;
    const incoming = mergeProfile(JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))); // throws on a bad file
    const saved = store.save({ ...incoming, name: store.uniqueName(incoming.name) });
    selectProfile(saved.name);
    return saved.name;
  });
}

// ---- VIIPER server: runs only while PadBridge is open ------------------------------------------
const VIIPER_EXE = path.join(process.env.LOCALAPPDATA || '', 'VIIPER', 'viiper.exe');
let serverChild = null;

async function ensureServer() {
  const { ViiperClient } = require('viiperclient');
  try { await new ViiperClient('localhost', 3242).ping(); return; } catch {} // already up
  if (!fs.existsSync(VIIPER_EXE)) return; // the status strip will say the server is not running
  serverChild = spawn(VIIPER_EXE, ['server', '--no-tray', '--update-notify=none'], { windowsHide: true, stdio: 'ignore' });
  serverChild.on('exit', () => { serverChild = null; });
}

// Stop the server on the way out, whoever started it: PadBridge is its only user here.
function stopServer() {
  if (SCREENSHOT || has('keep-server')) return;
  try { if (serverChild) serverChild.kill(); } catch {}
  try { execFileSync('taskkill', ['/IM', 'viiper.exe', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
}

// ---- start ----------------------------------------------------------------------------------
app.whenReady().then(() => {
  store = new ProfileStore(path.join(app.getPath('userData'), 'profiles'));
  engine = new Engine({ profile: store.load(store.activeName()) });
  engine.on('status', (status) => { send('status', { ...status, remotePlay }); refreshTray(); });
  engine.on('frame', (frame) => {
    if (win && win.isVisible()) send('frame', { ...frame, kbmHeld: capture && capture.locked ? [...kbm.held] : [] });
  });
  engine.on('press', (text) => send('press', text));
  startKbm(store.load(store.activeName()));
  engine.open();
  if (!NO_BRIDGE) ensureServer().finally(() => engine.start());

  wire();
  createWindow();
  if (!SCREENSHOT) {
    tray = new Tray(capIcon(ICONS.off));
    tray.on('click', showWindow);
    refreshTray();
  }
  checkRemotePlay();
  setInterval(checkRemotePlay, 4000);
});

app.on('second-instance', showWindow);
app.on('window-all-closed', () => { if (!quitting) app.quit(); });
app.on('before-quit', (e) => {
  if (!engine || engine.closed) return;
  e.preventDefault(); // remove the virtual controller cleanly before leaving
  engine.closed = true;
  quitting = true;
  if (capture) capture.close(); // give the keyboard and mouse back first
  engine.close().finally(() => { stopServer(); app.quit(); });
});
