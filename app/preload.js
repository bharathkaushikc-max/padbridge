// The only bridge between the window and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('padbridge', {
  getState: call('state:get'),
  startBridge: call('bridge:start'),
  stopBridge: call('bridge:stop'),
  testRumble: call('rumble:test'),
  saveProfile: call('profile:save'),
  selectProfile: call('profile:select'),
  createProfile: call('profile:create'),
  duplicateProfile: call('profile:duplicate'),
  renameProfile: call('profile:rename'),
  deleteProfile: call('profile:delete'),
  exportProfile: call('profile:export'),
  importProfile: call('profile:import'),
  // on('state' | 'status' | 'frame' | 'press', handler)
  on: (channel, handler) => {
    if (!['state', 'status', 'frame', 'press'].includes(channel)) return;
    ipcRenderer.on(channel, (_event, payload) => handler(payload));
  },
});
