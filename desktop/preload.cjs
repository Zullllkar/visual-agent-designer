const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vadDesktop", {
  runtime: "electron",
  getInfo: () => ipcRenderer.invoke("desktop:getInfo"),
  window: (action) => ipcRenderer.send("desktop:window", action),
  isMaximized: () => ipcRenderer.invoke("desktop:isMaximized"),
  popupMenu: (payload) => ipcRenderer.send("desktop:popup-menu", payload),
  openPath: (which) => ipcRenderer.send("desktop:open-path", which),
  openProjectDir: (projectId) => ipcRenderer.send("desktop:open-project", projectId),
  openExternal: (url) => ipcRenderer.send("desktop:open-external", url),
  setTitleBarTheme: (theme) => ipcRenderer.send("desktop:titlebar-theme", theme),
  setRecents: (items) => ipcRenderer.send("desktop:set-recents", items),
  saveFile: (input) => ipcRenderer.invoke("desktop:save-file", input),
  openFile: (input) => ipcRenderer.invoke("desktop:open-file", input ?? {}),
  pickDirectory: () => ipcRenderer.invoke("desktop:pick-directory"),
  onCommand: (handler) => {
    const listen = (_event, detail) => handler(detail);
    ipcRenderer.on("desktop:command", listen);
    return () => ipcRenderer.removeListener("desktop:command", listen);
  },
});
