const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileStore, mergeProfile } = require('../src/profiles');
const { DEFAULT_PROFILE } = require('../src/mapping');

const tempStore = () => new ProfileStore(fs.mkdtempSync(path.join(os.tmpdir(), 'padbridge-')));

test('P1 a new store seeds the default profile and makes it active', () => {
  const store = tempStore();
  assert.deepEqual(store.list(), ['Default']);
  assert.equal(store.activeName(), 'Default');
  const { kbm, ...rest } = store.load('Default');
  assert.deepEqual(rest, DEFAULT_PROFILE);
  assert.equal(kbm.enabled, false, 'keyboard and mouse start switched off');
});

test('P2 save then load round-trips a changed profile', () => {
  const store = tempStore();
  const p = store.load('Default');
  p.name = 'Racing';
  p.buttons.a = 'R2';
  p.sticks.deadzone = 0.15;
  store.save(p);
  assert.deepEqual(store.list(), ['Default', 'Racing']);
  assert.equal(store.load('Racing').buttons.a, 'R2');
  assert.equal(store.load('Racing').sticks.deadzone, 0.15);
});

test('P3 a removed assignment stays removed after reload', () => {
  const store = tempStore();
  const p = store.load('Default');
  delete p.buttons.guide;
  store.save(p);
  assert.equal('guide' in store.load('Default').buttons, false);
});

test('P4 rename moves the file and keeps the profile active', () => {
  const store = tempStore();
  store.rename('Default', 'Travel');
  assert.deepEqual(store.list(), ['Travel']);
  assert.equal(store.activeName(), 'Travel');
  assert.throws(() => store.rename('Travel', '  '), /needs a name/);
});

test('P5 rename refuses a name that is taken', () => {
  const store = tempStore();
  store.save({ ...store.load('Default'), name: 'Other' });
  assert.throws(() => store.rename('Other', 'Default'), /already exists/);
});

test('P6 the last profile cannot be deleted; deleting the active one picks another', () => {
  const store = tempStore();
  assert.throws(() => store.remove('Default'), /last profile/);
  store.save({ ...store.load('Default'), name: 'Other' });
  store.setActive('Other');
  store.remove('Other');
  assert.equal(store.activeName(), 'Default');
});

test('P7 uniqueName avoids clashes', () => {
  const store = tempStore();
  assert.equal(store.uniqueName('Default'), 'Default 2');
  assert.equal(store.uniqueName('Fresh'), 'Fresh');
});

test('P8 a corrupt or invalid profile file is rejected, not half-loaded', () => {
  const store = tempStore();
  fs.writeFileSync(path.join(store.dir, 'Broken.json'), '{ not json');
  assert.deepEqual(store.list(), ['Default']);
  assert.throws(() => mergeProfile({ name: 'Bad', buttons: { a: 'Nope' } }), /Unknown mapping target/);
});

test('P9 a partial profile is filled in from the defaults', () => {
  const p = mergeProfile({ name: 'Thin', sticks: { deadzone: 0.2 } });
  assert.equal(p.sticks.deadzone, 0.2);
  assert.equal(p.view.holdMs, DEFAULT_PROFILE.view.holdMs);
  assert.deepEqual(p.buttons, DEFAULT_PROFILE.buttons);
});

test('P10 keyboard and mouse settings save with the profile', () => {
  const store = tempStore();
  const p = store.load('Default');
  p.kbm.enabled = true;
  p.kbm.sensitivity = 2.5;
  store.save(p);
  const back = store.load('Default');
  assert.equal(back.kbm.enabled, true);
  assert.equal(back.kbm.sensitivity, 2.5);
  assert.equal(back.kbm.antiDeadzone, 0.18, 'untouched settings keep their defaults');
});
