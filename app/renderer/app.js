/* global padbridge, createPad, createPlot */
// PadBridge window: status strip, Mapping, Tuning, Test, Profiles.

const api = window.padbridge;
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of kids) node.append(kid);
  return node;
};

// ---- vocabulary -------------------------------------------------------------------
const TARGETS = [
  ['Cross', 'Cross'], ['Circle', 'Circle'], ['Square', 'Square'], ['Triangle', 'Triangle'],
  ['L1', 'L1'], ['R1', 'R1'], ['L2', 'L2'], ['R2', 'R2'], ['L3', 'L3'], ['R3', 'R3'],
  ['Create', 'Create'], ['Options', 'Options'], ['PS', 'PS button'], ['Touchpad', 'Touchpad click'], ['MicMute', 'Mic mute'],
  ['DpadUp', 'D-pad up'], ['DpadDown', 'D-pad down'], ['DpadLeft', 'D-pad left'], ['DpadRight', 'D-pad right'],
];
const TARGET_NAME = Object.fromEntries(TARGETS);
const XNAME = {
  a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', ls: 'Left stick click', rs: 'Right stick click',
  menu: 'Menu', guide: 'Xbox button', up: 'D-pad up', down: 'D-pad down', left: 'D-pad left', right: 'D-pad right',
};
const OUT_BITS = {
  Square: 0x10, Cross: 0x20, Circle: 0x40, Triangle: 0x80, L1: 0x100, R1: 0x200, L2: 0x400, R2: 0x800,
  Create: 0x1000, Options: 0x2000, L3: 0x4000, R3: 0x8000, PS: 0x10000, Touchpad: 0x20000, MicMute: 0x40000,
};
const OUT_DPAD = { DpadUp: 1, DpadDown: 2, DpadLeft: 4, DpadRight: 8 };

// Callouts on the controller drawing, in the drawing's 1000 x 530 space.
const CALLOUTS = [
  { k: 'lt', left: 60, width: 210, y: 180, fixed: 'L2', x: 'LT', line: '270,180 370,180' },
  { k: 'lb', left: 60, width: 210, y: 226, line: '270,226 347,226' },
  { k: 'ls', left: 60, width: 210, y: 272, x: 'Left stick', line: '270,272 382,272' },
  { k: 'x', left: 60, width: 210, y: 318, line: '270,318 520,318 556,290' },
  { k: 'dpad', left: 60, width: 210, y: 364, fixed: 'D-pad', x: 'D-pad', line: '270,364 429,364' },
  { k: 'rt', left: 730, width: 210, y: 180, fixed: 'R2', x: 'RT', line: '730,180 630,180' },
  { k: 'rb', left: 730, width: 210, y: 218, line: '730,218 645,218' },
  { k: 'y', left: 730, width: 210, y: 256, line: '730,256 607,256' },
  { k: 'b', left: 730, width: 210, y: 296, line: '730,296 652,296 634,286' },
  { k: 'a', left: 730, width: 210, y: 338, line: '730,338 630,338 604,317' },
  { k: 'rs', left: 730, width: 210, y: 384, x: 'Right stick', line: '730,384 602,384 572,372' },
  { k: 'view', left: 296, width: 180, y: 104, fixed: 'Modifier', x: 'View', line: '476,104 476,268' },
  { k: 'guide', left: 410, width: 180, y: 48, line: '500,48 500,223', center: true },
  { k: 'menu', left: 524, width: 180, y: 104, line: '524,104 524,268' },
];

// ---- state ------------------------------------------------------------------------
let state = null;          // snapshot from the main process
let profile = null;        // working copy of the active profile
let currentTab = 'mapping';
let saveTimer = null;

function saveProfile(delay = 0) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { profile = await api.saveProfile(profile); } catch (err) { console.error(err); }
    // Rebuilding the rows drops keyboard focus; put it back on the same control.
    const focused = document.activeElement && document.activeElement.getAttribute('aria-label');
    syncMapping();
    if (focused) {
      const again = [...document.querySelectorAll('#view-mapping [aria-label]')].find((n) => n.getAttribute('aria-label') === focused);
      if (again) again.focus();
    }
  }, delay);
}

function targetSelect(value, onChange, { none = 'Nothing', label }) {
  const select = el('select');
  if (label) select.setAttribute('aria-label', label);
  for (const [id, name] of TARGETS) select.append(el('option', { value: id, textContent: name }));
  select.append(el('option', { value: '', textContent: none }));
  select.value = value || '';
  select.addEventListener('change', () => onChange(select.value || null));
  return select;
}

// ---- status strip -----------------------------------------------------------------
function setLink(id, cls, text) {
  const node = $(id);
  node.className = `link ${cls}`;
  $('span', node).textContent = text;
}

function renderStatus() {
  const s = state.status;
  setLink('#st-xbox', s.xboxSlot === null ? 'bad' : '', s.xboxSlot === null ? 'Not connected' : `Connected, slot ${s.xboxSlot + 1}`);
  if (!s.running) setLink('#st-bridge', 'idle', 'Off');
  else if (s.virtual === 'on') setLink('#st-bridge', '', 'Virtual DualSense is up');
  else if (s.server === 'down') setLink('#st-bridge', 'bad', 'VIIPER server is not running');
  else if (s.virtual === 'starting') setLink('#st-bridge', 'busy', 'Starting');
  else setLink('#st-bridge', 'bad', s.error || 'Virtual controller is down');
  setLink('#st-rp', s.remotePlay ? '' : 'idle', s.remotePlay ? 'Running' : 'Not running');

  const sw = $('#bridge-switch');
  sw.setAttribute('aria-checked', String(!!s.running));
  $('.switch-label', sw).textContent = s.running ? 'Bridge on' : 'Bridge off';
}

$('#bridge-switch').addEventListener('click', () => {
  if (state.status.running) api.stopBridge(); else api.startBridge();
});

// ---- tabs -------------------------------------------------------------------------
const tabButtons = [...document.querySelectorAll('[role="tab"]')];
function showTab(name) {
  currentTab = name;
  for (const b of tabButtons) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    $(`#view-${b.dataset.tab}`).hidden = !on;
  }
  $('main').scrollTop = 0;
}
tabButtons.forEach((b, i) => {
  b.addEventListener('click', () => showTab(b.dataset.tab));
  b.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabButtons[(i + step + tabButtons.length) % tabButtons.length];
    next.focus();
    showTab(next.dataset.tab);
  });
});

// ---- Mapping ----------------------------------------------------------------------
const calloutEls = {};
const leadEls = {};
let updateDiagramPad = null;

function buildMapping() {
  const host = $('#diagram');
  const leads = CALLOUTS.map((c) => `<polyline class="lead" data-lead="${c.k}" points="${c.line}"/>`).join('');
  updateDiagramPad = createPad(host, { extra: leads });
  host.querySelectorAll('[data-lead]').forEach((n) => { leadEls[n.dataset.lead] = n; });

  for (const c of CALLOUTS) {
    const node = el('div', { className: `callout${c.center ? ' center' : ''}` });
    node.style.left = `${c.left / 10}%`;
    node.style.width = `${c.width / 10}%`;
    node.style.top = `${(c.y / 530) * 100}%`;
    host.append(node);
    calloutEls[c.k] = node;
  }
}

function syncMapping() {
  if (!profile) return;
  for (const c of CALLOUTS) {
    const node = calloutEls[c.k];
    node.replaceChildren();
    const xname = c.x || XNAME[c.k];
    if (c.fixed) {
      const custom = c.k === 'dpad' && ['up', 'down', 'left', 'right'].some((d) => profile.buttons[d] !== `Dpad${d[0].toUpperCase()}${d.slice(1)}`);
      node.append(el('span', { className: 'name', textContent: custom ? 'Custom' : c.fixed }));
    } else {
      node.append(targetSelect(profile.buttons[c.k], (v) => {
        if (v) profile.buttons[c.k] = v; else delete profile.buttons[c.k];
        saveProfile();
      }, { label: `${xname} sends` }));
    }
    node.append(el('span', { className: 'x', textContent: xname }));
  }

  // View button block
  const view = profile.view;
  const rows = $('#view-rows');
  rows.replaceChildren();
  const row = (label, control, extra) => {
    const end = el('div', { className: 'end' }, control);
    if (extra) end.append(extra);
    return el('div', { className: 'row' }, el('span', { className: 'x', textContent: label }), end);
  };
  rows.append(row('Tap View', targetSelect(view.tap, (v) => { view.tap = v; saveProfile(); }, { label: 'Tap View sends' })));
  rows.append(row('Hold View', targetSelect(view.hold, (v) => { view.hold = v; saveProfile(); }, { label: 'Hold View sends' })));
  for (const key of Object.keys(view.chords)) {
    const remove = el('button', { className: 'icon-btn', textContent: 'Remove' });
    remove.setAttribute('aria-label', `Remove View + ${XNAME[key]}`);
    remove.addEventListener('click', () => { delete view.chords[key]; saveProfile(); });
    rows.append(row(`View + ${XNAME[key]}`, targetSelect(view.chords[key], (v) => {
      if (v) view.chords[key] = v; else delete view.chords[key];
      saveProfile();
    }, { label: `View + ${XNAME[key]} sends` }), remove));
  }
  const free = Object.keys(XNAME).filter((k) => !(k in view.chords));
  if (free.length) {
    const add = el('select');
    add.setAttribute('aria-label', 'Add a View combo');
    add.append(el('option', { value: '', textContent: 'Add a combo: View + …' }));
    for (const k of free) add.append(el('option', { value: k, textContent: `View + ${XNAME[k]}` }));
    add.addEventListener('change', () => { if (add.value) { view.chords[add.value] = 'PS'; saveProfile(); } });
    rows.append(el('div', { className: 'row add' }, add));
  }
  const check = el('input', { type: 'checkbox', checked: !!view.rightStickTouch });
  check.addEventListener('change', () => { view.rightStickTouch = check.checked; saveProfile(); });
  rows.append(el('label', { className: 'check' }, check, el('span', { textContent: 'View + right stick swipes the touchpad' })));

  // D-pad block
  const dpad = $('#dpad-rows');
  dpad.replaceChildren();
  for (const d of ['up', 'down', 'left', 'right']) {
    dpad.append(row(XNAME[d], targetSelect(profile.buttons[d], (v) => {
      if (v) profile.buttons[d] = v; else delete profile.buttons[d];
      saveProfile();
    }, { label: `${XNAME[d]} sends` })));
  }

  // Core PlayStation buttons nothing can reach
  const reachable = new Set([...Object.values(profile.buttons), view.tap, view.hold, ...Object.values(view.chords), 'L2', 'R2']);
  const missing = TARGETS.filter(([id]) => id !== 'MicMute' && !reachable.has(id)).map(([, name]) => name);
  const notice = $('#unreachable');
  notice.hidden = missing.length === 0;
  notice.textContent = missing.length ? `Nothing on the Xbox controller sends: ${missing.join(', ')}.` : '';

  $('#rail-profile').replaceChildren('Profile in use', el('b', { textContent: state.active }));
}

function frameMapping({ input }) {
  updateDiagramPad(input);
  const b = input.buttons;
  const a = input.axes;
  const live = {
    lt: a.lt > 0.05, rt: a.rt > 0.05,
    dpad: !!(b.up || b.down || b.left || b.right),
  };
  for (const c of CALLOUTS) {
    const on = c.k in live ? live[c.k] : !!b[c.k];
    calloutEls[c.k].classList.toggle('live', on);
    leadEls[c.k].classList.toggle('live', on);
  }
}

// ---- Tuning -----------------------------------------------------------------------
const plots = {};
let viewDownAt = null;
let holdTextUntil = 0;

function buildTuning() {
  plots.l = createPlot($('#plot-l'));
  plots.r = createPlot($('#plot-r'));
  const bind = (id, read, write, format) => {
    const input = $(id);
    const out = $(`${id}-out`);
    input.addEventListener('input', () => {
      write(Number(input.value));
      out.textContent = format(Number(input.value));
      syncTuningFigures();
      saveProfile(200);
    });
    return () => { input.value = read(); out.textContent = format(Number(input.value)); };
  };
  syncSliders = [
    bind('#t-deadzone', () => Math.round(profile.sticks.deadzone * 100), (v) => { profile.sticks.deadzone = v / 100; }, (v) => `${v}%`),
    bind('#t-trigger', () => Math.round(profile.triggers.digitalThreshold * 100), (v) => { profile.triggers.digitalThreshold = v / 100; }, (v) => `${v}%`),
    bind('#t-hold', () => profile.view.holdMs, (v) => { profile.view.holdMs = v; }, (v) => `${(v / 1000).toFixed(2)} s`),
  ];
}
let syncSliders = [];

function syncTuningFigures() {
  plots.l.setDeadzone(profile.sticks.deadzone);
  plots.r.setDeadzone(profile.sticks.deadzone);
  for (const id of ['#bar-l', '#bar-r']) $(`${id} .mark`).style.left = `${profile.triggers.digitalThreshold * 100}%`;
  $('#hold-fig .mark').style.left = '62.5%';
}
function syncTuning() { syncSliders.forEach((f) => f()); syncTuningFigures(); }

function frameTuning({ input, output }) {
  const a = input.axes;
  plots.l.set([a.lx, a.ly], [output.Sticklx / 127, output.Stickly / 127]);
  plots.r.set([a.rx, a.ry], [output.Stickrx / 127, output.Stickry / 127]);
  for (const [id, v] of [['#bar-l', a.lt], ['#bar-r', a.rt]]) {
    const bar = $(id);
    $('.fill', bar).style.width = `${v * 100}%`;
    bar.classList.toggle('pressed', v > profile.triggers.digitalThreshold);
  }
  // View hold demonstration
  const now = performance.now();
  const fig = $('#hold-fig');
  const text = $('#hold-text');
  const name = (id) => (id ? TARGET_NAME[id] : 'nothing');
  if (input.buttons.view) {
    if (viewDownAt === null) viewDownAt = now;
    const held = now - viewDownAt;
    const isHold = held >= profile.view.holdMs;
    $('.fill', fig).style.width = `${Math.min(1, held / (profile.view.holdMs * 1.6)) * 100}%`;
    fig.classList.toggle('held', isHold);
    fig.classList.add('active');
    text.textContent = isHold ? `Hold: sends ${name(profile.view.hold)}` : `Tap so far: would send ${name(profile.view.tap)}`;
    holdTextUntil = now + 1500;
  } else {
    viewDownAt = null;
    if (now > holdTextUntil) {
      $('.fill', fig).style.width = '0';
      fig.classList.remove('held', 'active');
      text.textContent = 'Waiting for View';
    }
  }
}

// ---- Test -------------------------------------------------------------------------
const ICON = {
  Cross: '<svg viewBox="0 0 18 18"><path d="M3 3l12 12M15 3L3 15"/></svg>',
  Circle: '<svg viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5"/></svg>',
  Square: '<svg viewBox="0 0 18 18"><rect x="3" y="3" width="12" height="12"/></svg>',
  Triangle: '<svg viewBox="0 0 18 18"><path d="M9 2.5l7 12.5H2z"/></svg>',
  Create: '<svg viewBox="0 0 18 18"><path d="M5 4v10M9 2v14M13 4v10"/></svg>',
  Options: '<svg viewBox="0 0 18 18"><path d="M3 5h12M3 9h12M3 13h12"/></svg>',
  Touchpad: '<svg viewBox="0 0 18 18"><rect x="2" y="4" width="14" height="10" rx="3"/></svg>',
  MicMute: '<svg viewBox="0 0 18 18"><rect x="6.5" y="2" width="5" height="9" rx="2.5"/><path d="M4 9a5 5 0 0010 0M9 14v2.5"/></svg>',
  DpadUp: '<svg viewBox="0 0 18 18"><path d="M4 11l5-5 5 5"/></svg>',
  DpadDown: '<svg viewBox="0 0 18 18"><path d="M4 7l5 5 5-5"/></svg>',
  DpadLeft: '<svg viewBox="0 0 18 18"><path d="M11 4L6 9l5 5"/></svg>',
  DpadRight: '<svg viewBox="0 0 18 18"><path d="M7 4l5 5-5 5"/></svg>',
};
const CAP_ORDER = ['Cross', 'Circle', 'Square', 'Triangle', 'PS', 'L1', 'R1', 'L2', 'R2', 'Touchpad',
  'L3', 'R3', 'Create', 'Options', 'MicMute', 'DpadUp', 'DpadDown', 'DpadLeft', 'DpadRight'];
const capEls = {};
let updateTestPad = null;

function buildTest() {
  updateTestPad = createPad($('#test-pad'), { viewBox: '280 140 440 380' });
  plots.ol = createPlot($('#out-l'), { showRaw: false });
  plots.or = createPlot($('#out-r'), { showRaw: false });
  const host = $('#out-caps');
  for (const id of CAP_ORDER) {
    const face = el('i');
    if (ICON[id]) face.innerHTML = ICON[id]; else face.textContent = id;
    const cell = el('div', { className: 'capcell' }, face, TARGET_NAME[id]);
    host.append(cell);
    capEls[id] = cell;
  }
  $('#rumble-btn').addEventListener('click', async () => {
    const ok = await api.testRumble();
    $('#rumble-note').textContent = ok ? 'Sent. Did the controller buzz?' : 'No Xbox controller is connected.';
  });
  renderLog();
}

function frameTest({ input, output }) {
  updateTestPad(input);
  for (const id of CAP_ORDER) {
    const on = id in OUT_BITS ? (output.Buttons & OUT_BITS[id]) !== 0 : (output.Dpad & OUT_DPAD[id]) !== 0;
    capEls[id].classList.toggle('live', on);
  }
  plots.ol.set(null, [output.Sticklx / 127, output.Stickly / 127]);
  plots.or.set(null, [output.Stickrx / 127, output.Stickry / 127]);
  $('#out-l2 .fill').style.width = `${(output.Triggerl2 / 255) * 100}%`;
  $('#out-r2 .fill').style.width = `${(output.Triggerr2 / 255) * 100}%`;
  $('#out-l2').classList.toggle('pressed', (output.Buttons & OUT_BITS.L2) !== 0);
  $('#out-r2').classList.toggle('pressed', (output.Buttons & OUT_BITS.R2) !== 0);
  const pad = $('#out-touch');
  pad.classList.toggle('on', !!output.Touch1active);
  if (output.Touch1active) {
    const dot = $('i', pad);
    dot.style.left = `${(output.Touch1x / 1920) * 100}%`;
    dot.style.top = `${(output.Touch1y / 1080) * 100}%`;
  }
}

const logEntries = [];
function renderLog() {
  const list = $('#log');
  list.replaceChildren();
  if (!logEntries.length) { list.append(el('li', { className: 'empty', textContent: 'Nothing pressed yet.' })); return; }
  for (const entry of logEntries) list.append(el('li', {}, el('time', { textContent: entry.time }), entry.text));
}
function onPress(text) {
  if (text === '(released)') return;
  const pretty = text.split(' + ').map((t) => TARGET_NAME[t] || (t.startsWith('Touch(') ? 'Touchpad swipe' : t)).join(' + ');
  if (logEntries[0] && logEntries[0].text === pretty) return;
  logEntries.unshift({ time: new Date().toLocaleTimeString([], { hour12: false }), text: pretty });
  logEntries.length = Math.min(logEntries.length, 7);
  if (currentTab === 'test') renderLog();
}

// ---- Keyboard & mouse ---------------------------------------------------------------
const kbmKeycaps = { foot: {}, vehicle: {} };
let kbmPlot = null;
let kbmBuilt = false;

function psText(row) {
  if (row.stick) {
    const dir = row.stick.y < 0 ? 'up' : row.stick.y > 0 ? 'down' : row.stick.x < 0 ? 'left' : 'right';
    return `${row.stick.side === 'left' ? 'Left' : 'Right'} stick ${dir}`;
  }
  return row.press.map((p) => TARGET_NAME[p] || p).join(' + ');
}
function psNote(row) {
  if (row.turbo) return 'tapped repeatedly';
  if (row.tapMs) return 'tap';
  if (row.minHoldMs) return 'held';
  return '';
}

function buildKbm() {
  kbmPlot = createPlot($('#kbm-plot'), { showRaw: false });
  kbmPlot.setDeadzone(0);
  const bind = (id, read, write, format) => {
    const input = $(id);
    const out = $(`${id}-out`);
    input.addEventListener('input', () => {
      write(Number(input.value));
      out.textContent = format(Number(input.value));
      saveProfile(250);
    });
    return () => { input.value = read(); out.textContent = format(Number(input.value)); };
  };
  syncKbmSliders = [
    bind('#k-sens', () => profile.kbm.sensitivity, (v) => { profile.kbm.sensitivity = v; }, (v) => `${v.toFixed(1)}×`),
    bind('#k-dz', () => Math.round(profile.kbm.antiDeadzone * 100), (v) => { profile.kbm.antiDeadzone = v / 100; }, (v) => `${v}%`),
    bind('#k-smooth', () => profile.kbm.smoothingMs, (v) => { profile.kbm.smoothingMs = v; }, (v) => `${v} ms`),
  ];
  $('#kbm-switch').addEventListener('click', () => {
    profile.kbm.enabled = !profile.kbm.enabled;
    renderKbmStatus();
    saveProfile();
  });
}
let syncKbmSliders = [];

function buildKbmBindings(preset) {
  if (kbmBuilt) return;
  kbmBuilt = true;
  const host = $('#kbm-blocks');
  for (const [id, layer] of Object.entries(preset.layers)) {
    const block = el('div', { className: 'block' });
    block.dataset.layer = id;
    block.append(el('h2', { textContent: layer.name }));
    for (const row of layer.rows) {
      const cap = el('span', { className: 'keycap', textContent: row.keyLabel });
      kbmKeycaps[id][row.key] = cap;
      const act = el('span', { className: 'act', textContent: row.action });
      if (row.switchTo) act.append(el('small', { textContent: `Switches to ${preset.layers[row.switchTo].name.toLowerCase()}` }));
      if (row.whenHeld) act.append(el('small', { textContent: `With ${row.whenHeld.keyLabel} held: ${row.whenHeld.action.toLowerCase()}, ${row.whenHeld.press.map((p) => TARGET_NAME[p] || p).join(' + ')}` }));
      const ps = el('span', { className: 'ps', textContent: psText(row) });
      const note = psNote(row);
      if (note) ps.append(el('small', { textContent: note }));
      block.append(el('div', { className: 'krow' }, el('span', {}, cap), act, ps));
    }
    host.append(block);
  }
  const list = $('#kbm-missing');
  const layerItem = el('li');
  layerItem.append(el('code', { textContent: preset.layerKey }), ` switches between ${Object.values(preset.layers).map((l) => l.name.toLowerCase()).join(' and ')} by hand, if the game and PadBridge disagree about whether you are in a vehicle.`);
  list.append(layerItem);
  for (const line of preset.notMapped) list.append(el('li', { textContent: line }));
}

function renderKbmStatus() {
  const k = state.kbm;
  const enabled = !!profile.kbm.enabled;
  const sw = $('#kbm-switch');
  sw.setAttribute('aria-checked', String(enabled));
  $('.switch-label', sw).textContent = enabled ? 'On' : 'Off';

  const box = $('.kbm-state');
  let cls = 'idle', title = 'Off', text = 'Turn it on to play with your keyboard and mouse.';
  if (enabled && !state.status.running) {
    cls = 'bad'; title = 'Waiting for the bridge'; text = 'Turn the bridge on (top right) so the PS5 receives the keys.';
  } else if (enabled && k.locked) {
    cls = 'live'; title = 'Playing'; text = 'Your keyboard and mouse are going to the PS5. Shift+Esc gives the mouse back.';
  } else if (enabled && k.hooked) {
    cls = 'wait'; title = 'Click to start'; text = 'Click inside the PS Remote Play picture to take over the keyboard and mouse.';
  } else if (enabled) {
    cls = 'wait'; title = 'Ready'; text = 'Switch to PS Remote Play, then click inside its picture to start. Nothing is captured until you do.';
  }
  box.className = `kbm-state ${cls}`;
  $('#kbm-title').textContent = title;
  $('#kbm-text').textContent = text;

  const picker = $('#kbm-layers');
  if (!picker.childElementCount) {
    for (const [id, name] of Object.entries(k.layers)) {
      const b = el('button', { textContent: name });
      b.setAttribute('role', 'radio');
      b.dataset.layer = id;
      b.addEventListener('click', () => api.setKbmLayer(id));
      picker.append(b);
    }
  }
  for (const b of picker.children) b.setAttribute('aria-checked', String(b.dataset.layer === k.layer));
  for (const block of document.querySelectorAll('#kbm-blocks .block')) {
    const h = $('h2', block);
    const on = block.dataset.layer === k.layer;
    const tag = $('.tag', h);
    if (on && !tag) h.append(el('span', { className: 'tag', textContent: 'In use' }));
    if (!on && tag) tag.remove();
  }
}

function frameKbm(frame) {
  const extra = frame.extra;
  kbmPlot.set(null, extra ? [extra.rx, extra.ry] : [0, 0]);
  const held = new Set(frame.kbmHeld || []);
  const layer = state.kbm.layer;
  for (const [id, caps] of Object.entries(kbmKeycaps)) {
    for (const [key, cap] of Object.entries(caps)) cap.classList.toggle('live', id === layer && held.has(key));
  }
}

// ---- Profiles ---------------------------------------------------------------------
let editing = null;   // { name, mode: 'rename' | 'delete' }

function showProfileError(err) {
  const box = $('#p-error');
  const message = err ? String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
  box.hidden = !message;
  box.textContent = message;
}
async function act(fn) {
  showProfileError(null);
  try { await fn(); } catch (err) { showProfileError(err); }
}

function renderProfiles() {
  const list = $('#profile-list');
  list.replaceChildren();
  const btn = (text, onClick, cls = '') => {
    const b = el('button', { className: `btn small ${cls}`, textContent: text });
    b.addEventListener('click', onClick);
    return b;
  };
  for (const name of state.profiles) {
    const active = name === state.active;
    const li = el('li');
    const grow = el('div', { className: 'grow' });
    const acts = el('div', { className: 'acts' });

    if (editing && editing.name === name && editing.mode === 'rename') {
      const input = el('input', { type: 'text', value: name, maxLength: 40 });
      input.setAttribute('aria-label', 'Profile name');
      const commit = () => act(async () => { const to = input.value; editing = null; await api.renameProfile({ from: name, to }); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { editing = null; renderProfiles(); }
      });
      grow.append(input);
      acts.append(btn('Save name', commit, 'primary'), btn('Cancel', () => { editing = null; renderProfiles(); }));
      queueMicrotask(() => { input.focus(); input.select(); });
    } else if (editing && editing.name === name && editing.mode === 'delete') {
      grow.append(el('span', { className: 'pname', textContent: `Delete "${name}"?` }));
      acts.append(
        btn('Delete it', () => act(async () => { editing = null; await api.deleteProfile(name); }), 'danger solid'),
        btn('Keep it', () => { editing = null; renderProfiles(); }),
      );
    } else {
      grow.append(el('span', { className: 'pname', textContent: name }));
      if (active) grow.append(el('span', { className: 'tag', textContent: 'In use' }));
      if (!active) acts.append(btn('Use', () => act(() => api.selectProfile(name)), 'primary'));
      acts.append(
        btn('Rename', () => { editing = { name, mode: 'rename' }; renderProfiles(); }),
        btn('Duplicate', () => act(() => api.duplicateProfile(name))),
        btn('Export', () => act(() => api.exportProfile(name))),
      );
      const del = btn('Delete', () => { editing = { name, mode: 'delete' }; renderProfiles(); }, 'danger');
      del.disabled = state.profiles.length <= 1;
      if (del.disabled) del.title = 'The last profile cannot be deleted';
      acts.append(del);
    }
    li.append(grow, acts);
    list.append(li);
  }
}
$('#p-new').addEventListener('click', () => act(() => api.createProfile('New profile')));
$('#p-import').addEventListener('click', () => act(() => api.importProfile()));

// ---- wiring -----------------------------------------------------------------------
function applyState(next) {
  state = next;
  profile = structuredClone(next.profile);
  renderStatus();
  syncMapping();
  syncTuning();
  renderProfiles();
  buildKbmBindings(next.kbmPreset);
  syncKbmSliders.forEach((f) => f());
  renderKbmStatus();
}

async function init() {
  buildMapping();
  buildTuning();
  buildTest();
  buildKbm();
  applyState(await api.getState());
  showTab(state.startTab);

  api.on('state', applyState);
  api.on('status', (status) => { state.status = status; renderStatus(); renderKbmStatus(); });
  api.on('press', onPress);
  api.on('kbm', (k) => { state.kbm = k; renderKbmStatus(); });
  api.on('frame', (frame) => {
    if (currentTab === 'mapping') frameMapping(frame);
    else if (currentTab === 'tuning') frameTuning(frame);
    else if (currentTab === 'test') frameTest(frame);
    else if (currentTab === 'kbm') frameKbm(frame);
  });
}
init();
