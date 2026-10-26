const { contextBridge, ipcRenderer } = require("electron");

function storageCall(operation, key, value) {
  const response = ipcRenderer.sendSync("clipforge:settings", operation, key, value);
  if (response.error) throw new Error(response.error);
  return response.value;
}

contextBridge.exposeInMainWorld("clipforgeStorage", {
  getItem: (key) => storageCall("getItem", key),
  setItem: (key, value) => storageCall("setItem", key, value),
  removeItem: (key) => storageCall("removeItem", key),
});
