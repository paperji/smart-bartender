/**
 * 현재 날씨 불러오기 — 위치(navigator.geolocation) + Open-Meteo (API 키 불필요, 무료). v2.1 weather.ts 와 같은 요청·같은 변환
 *  - APK 도 WebView 의 navigator.geolocation 그대로: Capacitor(BridgeWebChromeClient)가 위치 권한을 대신 물어보고,
 *    안드로이드 12+ 에서는 "대략적 위치"만 허용해도 동작 (AndroidManifest 의 ACCESS_COARSE_LOCATION). 필요하면 registerPositionProvider 로 교체
 */
import type { WeatherInfo } from '@/lib/types';

export function wmoToKorean(code: number): string {
  if (code === 0) return '맑음';
  if (code === 1 || code === 2) return '구름 조금';
  if (code === 3) return '흐림';
  if (code === 45 || code === 48) return '안개';
  if (code >= 51 && code <= 67) return '비';
  if (code >= 71 && code <= 77) return '눈';
  if (code >= 80 && code <= 82) return '소나기';
  if (code === 85 || code === 86) return '눈';
  if (code >= 95) return '뇌우';
  return '흐림';
}

function timeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => {
      t = setTimeout(() => rej(new Error(msg)), ms);
    }),
  ]).finally(() => {
    if (t) clearTimeout(t);
  });
}

export interface Coords {
  latitude: number;
  longitude: number;
}

export type PositionProvider = () => Promise<Coords>;

let provider: PositionProvider | null = null;

/** 위치 구현 교체 (예: @capacitor/geolocation) — 지금은 쓰지 않음 */
export function registerPositionProvider(p: PositionProvider | null): void {
  provider = p;
}

const PERMISSION_MSG = '위치 권한이 없어 날씨를 불러올 수 없어요. 아래에서 직접 선택해 주세요.';

/** 브라우저 위치 (v2.1 의 Balanced 정확도에 해당: 고정밀 끔, 10초, 10분 이내 캐시 허용) */
function browserPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    const geo: Geolocation | undefined = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      reject(new Error('이 환경에서는 위치를 확인할 수 없어요. 아래에서 직접 선택해 주세요.'));
      return;
    }
    geo.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => {
        if (err && err.code === 1) reject(new Error(PERMISSION_MSG));
        else if (err && err.code === 3) reject(new Error('위치 확인 시간이 초과됐어요'));
        else reject(new Error('현재 위치를 확인하지 못했어요. 아래에서 직접 선택해 주세요.'));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/** Open-Meteo 요청 주소 (v2.1 과 같음) */
export function openMeteoUrl(latitude: number, longitude: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto'
  );
}

export async function fetchCurrentWeather(): Promise<WeatherInfo> {
  const { latitude, longitude } = await timeout(provider ? provider() : browserPosition(), 12000, '위치 확인 시간이 초과됐어요');
  const res = await timeout(fetch(openMeteoUrl(latitude, longitude)), 10000, '날씨 서버 응답이 늦어요');
  if (!res.ok) throw new Error(`날씨 서버 오류 (HTTP ${res.status})`);
  const data = await res.json();
  const cur = data?.current;
  if (!cur) throw new Error('날씨 정보를 읽지 못했어요');
  return {
    condition: wmoToKorean(Number(cur.weather_code)),
    tempC: Math.round(Number(cur.temperature_2m) * 10) / 10,
    humidity: Math.round(Number(cur.relative_humidity_2m)),
    source: 'auto',
  };
}
