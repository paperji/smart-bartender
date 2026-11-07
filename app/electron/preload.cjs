/**
 * Windows 앱(EXE) preload — 화면(웹 코드)에 window.sbElectron 만 열어 줌 (contextIsolation·sandbox 켜짐)
 * 화면 쪽 타입: src/platform/detect.ts 의 SbElectronBridge
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let version = '';
try {
  version = String(ipcRenderer.sendSync('sb:get-version') || '');
} catch {
  version = '';
}

function subscribe(channel, cb) {
  const handler = (_event, payload) => {
    try {
      cb(payload);
    } catch {
      /* 화면 쪽 오류는 무시 */
    }
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('sbElectron', {
  isElectron: true,
  version,
  platform: process.platform,
  /** requestDevice 중 찾은 기기 목록 (여러 번 옴) */
  onBleDevices: (cb) => subscribe('sb:ble-devices', (list) => cb(Array.isArray(list) ? list : [])),
  /** 선택 요청이 끝남 (골랐거나 취소·새로고침) */
  onBleRequestEnd: (cb) => subscribe('sb:ble-end', () => cb()),
  chooseBleDevice: (deviceId) => ipcRenderer.send('sb:ble-choose', String(deviceId || '')),
  cancelBle: () => ipcRenderer.send('sb:ble-cancel'),
  /** requestDevice 직전: 앞 요청의 "취소 예약"을 지움 */
  bleRequestStart: () => ipcRenderer.send('sb:ble-start'),
  /** Windows 알림 + 작업 표시줄 깜빡임 → 띄웠으면 true */
  notify: (title, body) => ipcRenderer.invoke('sb:notify', String(title || ''), String(body || '')),
});
