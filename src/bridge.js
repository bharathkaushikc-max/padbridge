// PadBridge, command-line edition: reads an Xbox controller and drives a
// virtual DualSense Edge through VIIPER so PS Remote Play sees a PlayStation
// controller. The desktop app (app/) runs the same engine with a window.
//
//   node src/bridge.js                 run with the default mapping
//   node src/bridge.js --verbose       print every button change
//   node src/bridge.js --stats         print the report rate every 5 s
//   node src/bridge.js --profile my.json
//   node src/bridge.js --slot 2        use the Xbox controller in slot 2 (1-4; default: first found)
//   node src/bridge.js --type dualsense   (default: dualsenseedge, the one Remote Play accepted)

const fs = require('fs');
const { Engine } = require('./engine');
const xinput = require('./xinput');
const { mergeProfile } = require('./profiles');
const { DEFAULT_PROFILE } = require('./mapping');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

const profileFile = opt('--profile', null);
const profile = profileFile ? mergeProfile(JSON.parse(fs.readFileSync(profileFile, 'utf8'))) : DEFAULT_PROFILE;

const engine = new Engine({
  host: opt('--host', 'localhost'),
  port: Number(opt('--port', 3242)),
  type: opt('--type', 'dualsenseedge'),
  slot: opt('--slot', null) === null ? null : Number(opt('--slot')) - 1,
  profile,
});

engine.on('log', log);
engine.once('ready', () => log('Bridge running. Focus PS Remote Play and play. Ctrl+C to stop.'));
if (flag('--verbose')) engine.on('press', (text) => log(`-> ${text}`));
if (flag('--stats')) setInterval(() => log(`${Math.round(engine.takeSentCount() / 5)} reports/s`), 5000);

engine.start();
if (engine.slot === null) log('No Xbox controller found yet. Plug one in or turn it on.');
if (!xinput.guideSupported()) log('Xbox button not readable on this system; use View + Menu for PS.');

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await engine.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
