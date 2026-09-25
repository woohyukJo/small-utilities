import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("breakdown", {
  action: (name: string, args: unknown = {}) => ipcRenderer.invoke("action", name, args),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("state", listener);
    return () => ipcRenderer.removeListener("state", listener);
  }
});
