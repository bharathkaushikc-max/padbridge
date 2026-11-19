// Profile storage: one JSON file per profile in a folder, plus which one is active.

const fs = require('fs');
const path = require('path');
const { DEFAULT_PROFILE, validateProfile } = require('./mapping');

// Fill any missing section from the defaults, so old or hand-written files keep working.
function mergeProfile(user) {
  const merged = structuredClone(DEFAULT_PROFILE);
  for (const section of ['view', 'sticks', 'triggers']) {
    if (user && user[section]) merged[section] = { ...merged[section], ...user[section] };
  }
  // buttons and chords are replaced whole: a removed assignment must stay removed.
  if (user && user.buttons) merged.buttons = { ...user.buttons };
  if (user && user.view && user.view.chords) merged.view.chords = { ...user.view.chords };
  if (user && typeof user.name === 'string' && user.name.trim()) merged.name = user.name.trim();
  return validateProfile(merged);
}

const fileSafe = (name) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 60) || 'Profile';

class ProfileStore {
  constructor(dir) {
    this.dir = dir;
    this.stateFile = path.join(dir, '_active.json');
    fs.mkdirSync(dir, { recursive: true });
    if (this.list().length === 0) this.save(structuredClone(DEFAULT_PROFILE));
  }

  fileFor(name) { return path.join(this.dir, `${fileSafe(name)}.json`); }

  list() {
    return fs.readdirSync(this.dir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => {
        try { return mergeProfile(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))).name; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  load(name) {
    return mergeProfile(JSON.parse(fs.readFileSync(this.fileFor(name), 'utf8')));
  }

  save(profile) {
    const clean = mergeProfile(profile);
    fs.writeFileSync(this.fileFor(clean.name), JSON.stringify(clean, null, 2));
    return clean;
  }

  exists(name) { return fs.existsSync(this.fileFor(name)); }

  // A name not yet taken: "Racing", "Racing 2", "Racing 3"...
  uniqueName(base) {
    const root = (base || 'Profile').trim() || 'Profile';
    if (!this.exists(root)) return root;
    for (let i = 2; ; i++) if (!this.exists(`${root} ${i}`)) return `${root} ${i}`;
  }

  rename(oldName, newName) {
    const target = newName.trim();
    if (!target) throw new Error('A profile needs a name.');
    if (fileSafe(target).toLowerCase() === fileSafe(oldName).toLowerCase()) {
      const p = this.load(oldName); p.name = target; return this.save(p);
    }
    if (this.exists(target)) throw new Error(`A profile called "${target}" already exists.`);
    const profile = this.load(oldName);
    profile.name = target;
    const saved = this.save(profile);
    fs.unlinkSync(this.fileFor(oldName));
    if (this.activeName() === oldName) this.setActive(saved.name);
    return saved;
  }

  remove(name) {
    if (this.list().length <= 1) throw new Error('The last profile cannot be deleted.');
    fs.unlinkSync(this.fileFor(name));
    if (this.activeName() === name) this.setActive(this.list()[0]);
  }

  activeName() {
    try {
      const { active } = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (active && this.exists(active)) return active;
    } catch {}
    return this.list()[0];
  }

  setActive(name) {
    fs.writeFileSync(this.stateFile, JSON.stringify({ active: name }));
  }
}

module.exports = { ProfileStore, mergeProfile, fileSafe };
