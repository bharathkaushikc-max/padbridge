// The controller drawing: a line-art Xbox pad whose parts light up live.
// Coordinates are in a 1000 x 530 space shared with the callouts on the Mapping page.

const PAD = {
  sticks: { ls: [412, 280], rs: [546, 358] },
  face: { y: [594, 252, 'Y'], b: [622, 280, 'B'], a: [594, 308, 'A'], x: [566, 280, 'X'] },
  small: { view: [476, 276], menu: [524, 276] },
  guide: [500, 236],
  dpad: [456, 364],
  triggers: { lt: [370, 166], rt: [570, 166] },
};

function padMarkup() {
  const [dx, dy] = PAD.dpad;
  const arm = (key, x, y, w, h) => `<rect class="part" data-k="${key}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>`;
  const stick = (key) => {
    const [x, y] = PAD.sticks[key];
    return `<g data-k="${key}"><circle class="part ring" cx="${x}" cy="${y}" r="30"/><circle class="cap" data-cap="${key}" cx="${x}" cy="${y}" r="17"/></g>`;
  };
  const face = Object.entries(PAD.face).map(([k, [x, y, t]]) =>
    `<circle class="part" data-k="${k}" cx="${x}" cy="${y}" r="13"/><text class="glyph" x="${x}" y="${y + 0.5}">${t}</text>`).join('');
  const trigger = (key) => {
    const [x, y] = PAD.triggers[key];
    return `<rect class="part" x="${x}" y="${y}" width="60" height="34" rx="9"/>` +
      `<clipPath id="clip-${key}"><rect x="${x}" y="${y}" width="60" height="34" rx="9"/></clipPath>` +
      `<rect class="level" data-level="${key}" clip-path="url(#clip-${key})" x="${x}" y="${y + 34}" width="60" height="0"/>`;
  };
  return `<g class="pad">
    ${trigger('lt')}${trigger('rt')}
    <path class="body" d="M392 206C420 190 460 188 500 188C540 188 580 190 608 206C642 214 660 240 672 280C692 350 710 430 696 478C688 508 652 514 632 486C610 454 594 420 560 410L440 410C406 420 390 454 368 486C348 514 312 508 304 478C290 430 308 350 328 280C340 240 358 214 392 206Z"/>
    <path class="bumper" data-k="lb" d="M402 201C364 206 343 233 333 266"/>
    <path class="bumper" data-k="rb" d="M598 201C636 206 657 233 667 266"/>
    ${stick('ls')}${stick('rs')}
    ${arm('up', dx - 9, dy - 27, 18, 20)}${arm('down', dx - 9, dy + 7, 18, 20)}${arm('left', dx - 27, dy - 9, 20, 18)}${arm('right', dx + 7, dy - 9, 20, 18)}
    <rect class="cap" x="${dx - 7}" y="${dy - 7}" width="14" height="14"/>
    ${face}
    <circle class="part" data-k="view" cx="${PAD.small.view[0]}" cy="${PAD.small.view[1]}" r="7.5"/>
    <circle class="part" data-k="menu" cx="${PAD.small.menu[0]}" cy="${PAD.small.menu[1]}" r="7.5"/>
    <circle class="part" data-k="guide" cx="${PAD.guide[0]}" cy="${PAD.guide[1]}" r="13"/>
  </g>`;
}

// Builds the drawing into `host` and returns update(input) for live state.
// viewBox lets the Test page crop to just the controller.
function createPad(host, { viewBox = '0 0 1000 530', extra = '' } = {}) {
  host.insertAdjacentHTML('afterbegin',
    `<svg viewBox="${viewBox}" role="img" aria-label="Xbox controller drawing">${padMarkup()}${extra}</svg>`);
  const svg = host.querySelector('svg');
  const parts = {};
  svg.querySelectorAll('[data-k]').forEach((el) => { (parts[el.dataset.k] ||= []).push(el); });
  const caps = { ls: svg.querySelector('[data-cap="ls"]'), rs: svg.querySelector('[data-cap="rs"]') };
  const levels = { lt: svg.querySelector('[data-level="lt"]'), rt: svg.querySelector('[data-level="rt"]') };

  return function update(input) {
    const b = input.buttons || {};
    const a = input.axes || {};
    for (const [key, els] of Object.entries(parts)) {
      const on = !!b[key];
      for (const el of els) el.classList.toggle('live', on);
    }
    caps.ls.setAttribute('transform', `translate(${(a.lx || 0) * 10} ${(a.ly || 0) * 10})`);
    caps.rs.setAttribute('transform', `translate(${(a.rx || 0) * 10} ${(a.ry || 0) * 10})`);
    for (const [key, value] of [['lt', a.lt || 0], ['rt', a.rt || 0]]) {
      const h = 34 * value;
      levels[key].setAttribute('y', PAD.triggers[key][1] + 34 - h);
      levels[key].setAttribute('height', h);
    }
  };
}

// A stick plot: outer ring, deadzone disc, raw position (ring) and sent position (dot).
function createPlot(svg, { showRaw = true } = {}) {
  svg.innerHTML = `<circle class="plot-ring" r="52"/><circle class="plot-dead" r="0"/>
    <line class="plot-axis" x1="-52" x2="52"/><line class="plot-axis" y1="-52" y2="52"/>
    ${showRaw ? '<circle class="plot-raw" r="6"/>' : ''}<circle class="plot-out" r="5"/>`;
  const dead = svg.querySelector('.plot-dead');
  const raw = svg.querySelector('.plot-raw');
  const out = svg.querySelector('.plot-out');
  const clampUnit = (x, y) => { const m = Math.hypot(x, y); return m > 1 ? [x / m, y / m] : [x, y]; };
  return {
    setDeadzone(fraction) { dead.setAttribute('r', 52 * fraction); },
    set(rawXY, outXY) {
      if (raw && rawXY) { const [x, y] = clampUnit(...rawXY); raw.setAttribute('cx', x * 52); raw.setAttribute('cy', y * 52); }
      const [ox, oy] = clampUnit(...outXY); out.setAttribute('cx', ox * 52); out.setAttribute('cy', oy * 52);
    },
  };
}
