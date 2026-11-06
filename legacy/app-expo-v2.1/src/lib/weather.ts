/**
 * 현재 날씨 불러오기 — 위치 권한(expo-location) + Open-Meteo (API 키 불필요, 무료)
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { WeatherInfo } from './types';

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
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}

export async function fetchCurrentWeather(): Promise<WeatherInfo> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') {
    throw new Error('위치 권한이 없어 날씨를 불러올 수 없어요. 아래에서 직접 선택해 주세요.');
  }
  let pos: Location.LocationObject | null = null;
  try {
    pos = await timeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      10000,
      '위치 확인 시간이 초과됐어요',
    );
  } catch (e) {
    if (Platform.OS !== 'web') pos = await Location.getLastKnownPositionAsync().catch(() => null);
    if (!pos) throw e;
  }
  const { latitude, longitude } = pos.coords;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(3)}&longitude=${longitude.toFixed(3)}` +
    '&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto';
  const res = await timeout(fetch(url), 10000, '날씨 서버 응답이 늦어요');
  if (!res.ok) throw new Error(`날씨 서버 오류 (HTTP ${res.status})`);
  const data = await res.json();
  const cur = data?.current;
  if (!cur) throw new Error('날씨 정보를 읽지 못했어요');
  let place: string | undefined;
  if (Platform.OS !== 'web') {
    try {
      const [addr] = await timeout(Location.reverseGeocodeAsync({ latitude, longitude }), 4000, 'geocode timeout');
      place = addr?.district || addr?.city || addr?.subregion || addr?.region || undefined;
    } catch {
      /* 주소는 선택 사항 */
    }
  }
  return {
    condition: wmoToKorean(Number(cur.weather_code)),
    tempC: Math.round(Number(cur.temperature_2m) * 10) / 10,
    humidity: Math.round(Number(cur.relative_humidity_2m)),
    source: 'auto',
    place,
  };
}
