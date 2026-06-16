const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('newsAPI', {
  fetchNews: () => ipcRenderer.invoke('news:fetch'),
  openLink: (url) => ipcRenderer.invoke('news:openLink', url)
});
