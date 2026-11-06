/**
 * 앱 정보 — 이름·버전·배포 주소·만든 사람·오픈소스 고지 (설정 > 앱 정보에서 씀)
 * WEB_URL·RELEASES_URL 은 GitHub Pages·릴리스를 만든 뒤 채움 (그 전에는 null → 화면에서 링크를 숨김)
 */

export const APP_VERSION = '3.0.0';
export const APP_NAME = 'AI 스마트 바텐더';
export const APP_SHORT_NAME = '바텐더';
/** v2.1 설정 화면의 한 줄 소개 그대로 */
export const APP_DESCRIPTION = '사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커';

/** 웹앱 주소 (GitHub Pages) */
export const WEB_URL: string | null = 'https://paperji.github.io/smart-bartender/';
/** APK·EXE 내려받기 페이지 (GitHub Releases) */
export const RELEASES_URL: string | null = 'https://github.com/paperji/smart-bartender/releases/latest';

/** 설정 > 앱 정보의 정보 줄 (팀·소속·과목·통신). 공개 저장소라 개인 이름·학번은 넣지 않음(팀 결정 2026-11-07) */
export const APP_INFO_LINES: readonly { label: string; value: string }[] = [
  { label: '팀', value: '홍당무' },
  { label: '소속', value: '안양대학교 정보전기전자공학과' },
  { label: '과목', value: '캡스톤디자인 Ⅱ (2026-2학기)' },
  { label: '통신', value: 'BLE Nordic UART · JSON 프로토콜 v2.1' },
];

export interface OssNotice {
  /** 이름 (npm 패키지 이름) */
  name: string;
  /** 하는 일 (한 줄) */
  usage: string;
  /** SPDX 라이선스 */
  license: string;
  copyright: string;
  url: string;
}

/** 앱에 들어가는 오픈소스 (설정 > 앱 정보 > 오픈소스 라이선스) */
export const OSS_NOTICES: readonly OssNotice[] = [
  {
    name: 'Pretendard',
    usage: '글꼴',
    license: 'OFL-1.1',
    copyright: 'Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard), with Reserved Font Name Pretendard.',
    url: 'https://github.com/orioncactus/pretendard',
  },
  {
    name: 'lucide-react',
    usage: '아이콘',
    license: 'ISC',
    copyright: 'Copyright (c) 2026 Lucide Icons and Contributors. Copyright (c) 2013-present Cole Bemis (Feather, MIT).',
    url: 'https://lucide.dev',
  },
  {
    name: 'React (react, react-dom)',
    usage: '화면 구성',
    license: 'MIT',
    copyright: 'Copyright (c) Meta Platforms, Inc. and affiliates.',
    url: 'https://react.dev',
  },
  {
    name: 'zustand',
    usage: '앱 상태 저장',
    license: 'MIT',
    copyright: 'Copyright (c) 2019 Paul Henschel',
    url: 'https://github.com/pmndrs/zustand',
  },
  {
    name: 'react-router',
    usage: '화면 이동',
    license: 'MIT',
    copyright: 'Copyright (c) React Training LLC 2015-2019, Copyright (c) Remix Software Inc. 2020-2021, Copyright (c) Shopify Inc. 2022-2023',
    url: 'https://reactrouter.com',
  },
  {
    name: 'Workbox (workbox-window)',
    usage: '오프라인 실행·자동 업데이트(서비스 워커)',
    license: 'MIT',
    copyright: 'Copyright 2018 Google LLC',
    url: 'https://github.com/GoogleChrome/workbox',
  },
  {
    name: 'Capacitor (@capacitor/core·android·app·preferences·local-notifications·haptics)',
    usage: '안드로이드 앱(APK) 포장·저장·알림·진동·뒤로 버튼',
    license: 'MIT',
    copyright: 'Copyright (c) 2017-present Drifty Co. · Copyright 2020-present Ionic',
    url: 'https://capacitorjs.com',
  },
  {
    name: '@capacitor-community/bluetooth-le',
    usage: '안드로이드 앱(APK) 블루투스 연결',
    license: 'MIT',
    copyright: 'Copyright (c) 2021 Capacitor plugin for Bluetooth Low Energy',
    url: 'https://github.com/capacitor-community/bluetooth-le',
  },
  {
    name: 'Electron',
    usage: 'Windows 프로그램(EXE) 포장 — Chromium 등 포함 라이선스는 EXE 안의 LICENSES.chromium.html',
    license: 'MIT',
    copyright: 'Copyright (c) Electron contributors · Copyright (c) 2013-2020 GitHub Inc.',
    url: 'https://www.electronjs.org',
  },
];
