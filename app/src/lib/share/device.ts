/**
 * 공유 레시피용 기기 번호 — 이 앱(브라우저·APK·EXE)마다 한 번 만드는 무작위 UUID
 *  - 쓰는 곳: 같은 기기가 같은 레시피를 여러 번 만들어도 사용 횟수는 1번 · 내가 올린 레시피만 지우기 · 신고는 기기당 1번
 *  - 이름·전화번호·하드웨어 정보와 무관한 무작위 값이고, 화면에 보이거나 다른 사람에게 돌려주지 않아요
 *  - 앱 데이터를 지우면 새 번호가 생김 (그 전에 올린 레시피는 이 기기에서 더는 지울 수 없음)
 */
import { kv } from '@/platform/storage';

export const SHARE_DEVICE_KEY = 'sb3.shareDevice';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 무작위 UUID v4 (crypto.randomUUID 가 없으면 getRandomValues 로) */
export function newUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 이 기기의 공유용 번호 (없으면 만들어 저장) */
export function shareDeviceId(): string {
  const saved = kv.getItem(SHARE_DEVICE_KEY);
  if (saved && UUID_RE.test(saved)) return saved;
  const id = newUuid();
  kv.setItem(SHARE_DEVICE_KEY, id);
  return id;
}
