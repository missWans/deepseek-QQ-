const { contextBridge, ipcRenderer } = require('electron');

const channel = (name) => `plugin:qq-bridge:${name}`;

contextBridge.exposeInMainWorld('qqBridge', {
  status: () => ipcRenderer.invoke(channel('status')),
  testNapcat: () => ipcRenderer.invoke(channel('test-napcat')),
  testLlm: () => ipcRenderer.invoke(channel('test-llm')),
  openWizard: () => ipcRenderer.invoke(channel('open-wizard')),
  onActivity: (callback) => {
    ipcRenderer.on(channel('activity'), (_event, payload) => callback(payload));
  }
});

contextBridge.exposeInMainWorld('qqWizard', {
  get: () => ipcRenderer.invoke(channel('wizard:get')),
  save: (patch) => ipcRenderer.invoke(channel('wizard:save'), patch),
  preview: (patch) => ipcRenderer.invoke(channel('wizard:preview'), patch),
  selfTest: (payload) => ipcRenderer.invoke(channel('wizard:selftest'), payload),
  testNapcat: () => ipcRenderer.invoke(channel('test-napcat')),
  testLlm: () => ipcRenderer.invoke(channel('test-llm')),
  restartNapcat: () => ipcRenderer.invoke(channel('restart-napcat')),
  openStatus: () => ipcRenderer.invoke(channel('status'))
});
