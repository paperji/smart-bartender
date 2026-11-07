# 앱 v3.0 설계 — 웹앱(PWA) 하나로 PC·안드로이드 모두 (2026-11-07)

> 사용자 요청(2026-11-07): ① AI 는 **사용자가 본인 Gemini API 키를 앱에 직접 등록**해서 사용 ② 앱 디자인은 **밝은 톤**
> ③ Expo 고집 없음 — **웹으로 PC·폰에서 동작** + **PC·안드로이드에서 파일로 받아 설치**도 가능한 형태가 이상적.
> 이 문서는 v3.0 앱을 만드는 모든 작업자가 따르는 기준입니다. 기기 통신·AI 보정 규칙은 그대로 `docs/SPEC.md` 를 따릅니다.

## 1. 결과물과 동작 환경

| 형태 | 만드는 방법 | 블루투스(BLE) | 비고 |
|---|---|---|---|
| **웹 (PC·안드로이드 브라우저)** | Vite 정적 빌드 → HTTPS 호스팅: GitHub Pages `https://paperji.github.io/smart-bartender/` (`.github/workflows/pages.yml`, 처음 한 번 저장소 Settings → Pages → Source: GitHub Actions) | Web Bluetooth (Chrome·Edge) | 아이폰 Safari 는 BLE 불가(데모·AI만) |
| **웹앱 설치 (PWA)** | 같은 웹을 Chrome/Edge 의 "앱 설치"·"홈 화면에 추가" | Web Bluetooth | 오프라인 실행(서비스 워커), 바탕화면/홈 아이콘 |
| **안드로이드 APK 파일** | Capacitor 로 같은 웹 빌드를 감싸 APK | 네이티브 BLE 플러그인(`@capacitor-community/bluetooth-le`) | 인터넷 없이 실행, 자동 재연결 가능, "출처를 알 수 없는 앱" 허용 필요 |
| **Windows EXE 파일** | Electron 으로 같은 웹 빌드를 감싸 portable exe | Electron(Chromium) Web Bluetooth + 앱 안 기기 선택 창 | 코드 서명 없음 → SmartScreen "알 수 없는 게시자" 경고 |

한 소스(`smart-bartender/app/`)에서 네 가지를 모두 만듭니다. 화면·로직은 100% 공유하고, 플랫폼마다 다른 것은 `src/platform/` 의 어댑터(통신·알림·진동·저장·위치)뿐입니다.

## 2. 기술 스택
- Vite + React 19 + TypeScript(strict). 라우팅은 **HashRouter**(GitHub Pages 새로고침·`file://`·Capacitor·Electron 모두 동작).
- 상태: zustand + persist(localStorage). 기존 스토어 구조(settings·slots·history·draft·device·toast·demoCal) 유지.
  저장값을 읽을 때 스토어마다 검사(sanitize)해서 깨진 칸만 기본값으로 바꿈. 화면 오류는 오류 경계(`components/ErrorBoundary.tsx` — 앱 전체 + 라우트 + 화면)가 복구 카드로 보여 줌.
  localStorage 에 쓰지 못할 때(사생활 보호 모드 등)만 메모리에 두고, 정상일 때는 늘 localStorage 값을 따름(다른 창의 변경 반영).
- 스타일: 일반 CSS + CSS 변수(디자인 토큰, 3장). UI 라이브러리 없이 자체 컴포넌트(`src/ui/`). 아이콘 `lucide-react`.
- 글꼴: Pretendard(OFL, npm `pretendard`, 동적 서브셋) — 오프라인에서도 같은 모양.
- PWA: `vite-plugin-pwa`(generateSW, 자동 업데이트), manifest(이름 "AI 스마트 바텐더", short_name "바텐더", 아이콘 192/512/maskable).
- 테스트: 기존처럼 `node:test` + `tsx` (`npm test`), 타입 검사 `npm run typecheck`, 린트 없이 시작.
- Node.js 22 이상 (PC 에 설치된 Node 가 낮으면 포터블 Node 22 를 PATH 앞에 두고 사용).

## 3. 디자인 — 밝은 톤
팀 이름(홍당무)에 맞춘 **당근 오렌지 포인트 + 흰 카드 + 아주 옅은 웜그레이 바탕**. 어둡게 보이는 큰 면은 쓰지 않습니다.

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--bg` | `#F7F6F3` | 화면 바탕 |
| `--surface` | `#FFFFFF` | 카드·시트 |
| `--surface-2` | `#FBFAF8` | 카드 안 구역, 입력칸 |
| `--border` | `#ECE9E4` | 구분선·테두리 |
| `--border-strong` | `#DDD8D0` | 진한 테두리 |
| `--text` | `#1F2328` | 본문 |
| `--text-2` | `#545A63` | 보조 글 (흰 6.95:1) |
| `--text-3` | `#646A73` | 힌트·안내 (흰 5.45 · `--bg` 5.05) |
| `--text-decor` | `#9AA0A8` | 꾸밈 전용 회색(장식 아이콘·색 없는 펌프 점) — **글자 색 X** |
| `--accent` | `#FF7A2F` | 주 버튼 채움·선택 테두리·아이콘 (당근) — **채움·아이콘 전용, 글자 색 X** |
| `--accent-hover` | `#F36C22` | 주 버튼 hover 채움 |
| `--on-accent` | `#1F2328` | 당근색 채움 위 글자 (6.08:1 — 흰 글자는 2.6:1 이라 쓰지 않음) |
| `--accent-strong` | `#BF4500` | 오렌지 글자(선택 표시·링크·강조) — 흰 5.16 · `--bg` 4.78 · `--accent-soft` 4.64 |
| `--accent-soft` / `--accent-border` | `#FFF0E6` / `#FFD2B5` | 선택 칩 배경·강조 카드 배경 / 그 테두리 |
| `--green` / `--green-soft` | `#157A52` / `#E7F7EF` | 완료·연결됨 |
| `--yellow` / `--yellow-soft` | `#D99100` / `#FFF6DB` | 주의 채움·아이콘(위 글자는 `--text`) |
| `--yellow-strong` | `#956300` | 노란 계열 글자·주의 아이콘 (흰 5.17 · `--yellow-soft` 4.79) |
| `--red` / `--red-hover` / `--red-soft` | `#CC2A30` / `#B3191F` / `#FDECEC` | 비상정지·오류 (흰 글자 5.33 / 6.83) |
| `--blue` / `--blue-soft` | `#1B5FD9` / `#EAF1FE` | 정보·AI 배지 |
| `--focus-color` | `#BF4500` | 키보드 초점 표시 |
- **글자 색 규칙 (WCAG AA 4.5:1)**: 글자에는 `--text`·`--text-2`·`--text-3`·`--accent-strong`·`--green`·`--red`·`--blue`·`--yellow-strong` 만 써요. `--accent`·`--yellow`·`--text-decor` 는 채움·아이콘·테두리 전용이에요. 채움 위 글자: 당근색 위 `--on-accent`, 노랑 위 `--text`, 빨강·초록·파랑 위 흰색. `tests/ui-fixes.test.ts` 가 이 짝들의 대비를 계산해 검사해요.
  - 주 버튼을 다시 흰 글자로 바꾸고 싶으면 `--on-accent:#fff` 와 함께 주 버튼 채움을 `#C2410C`(5.18:1) 같은 진한 오렌지로 바꿔야 AA 를 지켜요.
- **초점**: 모든 조작 요소는 `:focus-visible` 에 2px outline `--focus-color`(offset 2px). 입력칸처럼 감싸는 칸만 `--focus-ring`(box-shadow) — `outline:none` 은 대신 링을 그리는 곳에서만.
- 모서리 16px(카드)·12px(입력)·999px(칩), 그림자 `0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.05)`.
- 글자: 본문 15px, 제목 22~28px 굵게, 숫자는 tabular-nums.
- 레이아웃: **모바일 우선**. 폭 < 900px → 위 상단바 + 하단 탭바(바텐더·재료·기록·기기). 폭 ≥ 900px(PC) → 왼쪽 세로 내비게이션 + 본문 최대 폭 1120px. 홈·재료 편집의 2열은 **1080px 이상**(900~1079px 은 1열, 홈 요약 카드 고정도 1080px 이상).
- 360px 폭에서도 가로 스크롤 없음(상단바 기기 칩은 줄어들고 이름이 잘림 — 전체 문구는 aria-label·기기 화면).
- 토스트: 모바일은 화면 아래(탭바·아래 버튼 줄 위), **모바일 제조 화면은 화면 위**(아래의 비상 정지·피드백·'기록 저장하고 닫기'를 가리지 않게), PC 는 아래 24px.
- 터치 영역 최소 44px(세그먼트·칩·맛 단계 포함), 대비 WCAG AA, `prefers-reduced-motion` 존중. 다크 모드는 만들지 않음(밝은 톤 고정, `color-scheme: light`).
- 창(Modal): 제목·설명을 `aria-labelledby`·`aria-describedby` 로 연결, 확인창·성인 확인은 `role="alertdialog"`.

## 4. AI — 사용자 본인 키(BYOK)
- **서버 모드 제거.** AI 방식은 두 가지: `gemini`(사용자 키로 Gemini REST 직접 호출, 기존 `recommend.ts` 의 direct 경로) / `offline`(규칙기반). 키가 없으면 자동으로 offline.
- 호출: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, 헤더 `x-goog-api-key`. 브라우저 CORS 허용 확인함(2026-11-07). 기존 JSON 스키마·프롬프트·앱 보정(SPEC §3.3) 그대로.
- 기본 모델 `gemini-3.6-flash`(실측 8~11초). 설정에서 모델 목록(키로 `GET /v1beta/models` 조회, generateContent 지원하는 gemini 텍스트 모델만) 중 선택 가능.
- **키 등록 화면**(설정 > AI): 붙여넣기 칸 + [키 확인] + [저장]/[삭제], 마지막 4자리만 표시, "키 발급 방법"(Google AI Studio `https://aistudio.google.com/apikey`, 3단계 그림 설명) 링크.
  - [키 확인] = 모델 목록 조회(무료)로 키 유효성 + 선택 모델 존재 확인. 결과 문구: 성공 / 키가 올바르지 않음(400·401·403 API_KEY_INVALID) / 권한 없음(403) / 사용량 한도·크레딧 소진(429 RESOURCE_EXHAUSTED) / 인터넷 연결 없음.
  - 200 이어도 모델 목록이 아니면 성공이 아님: HTML·빈 응답 = '인터넷 연결 없음' + "Gemini 대신 다른 페이지가 응답했어요…"(와이파이 로그인·네트워크 차단 안내), `models` 배열이 없는 JSON = '확인하지 못했어요'. 둘 다 [이 키 저장] 버튼 없음.
  - 키 형식: 20자 이상, 빈칸 없음, **보이는 ASCII(`[\x21-\x7E]`)만**. 보이지 않는 문자(U+200B 등)나 한글이 섞이면 [키 확인]·[저장]을 막고, 이미 저장된 깨진 키는 요청을 보내지 않고 AUTH(키 오류)로 안내(`lib/ai/apiKey.ts`).
  - 키 가리기: Google 오류 원문에 들어 있는 키 값(넘긴 키 그대로·`AIza…`·`AQ.…`·`key=…`)은 화면·임시 저장 전에 `••••` 로 가림. 오류 분류는 원문으로 함(백엔드와 같은 규칙).
  - 추천 중 Gemini 오류도 같은 분류로 안내하고 오프라인 추천으로 이어감(기존 동작).
- 키 저장: 브라우저/PWA·Electron = localStorage(`sb.secret.geminiKey`), APK = `@capacitor/preferences`. 키는 기기 밖으로 보내지 않음(Google 외).
  다른 창(탭)에서 키를 저장·삭제하면 `storage` 이벤트로 받아 열린 창의 힌트·'Gemini 사용 중' 표시를 바로 맞춤(App 시작 처리에서 구독, APK 는 해당 없음).
- 첫 실행 안내 카드: "AI 키를 등록하면 Gemini 가 레시피를 만들어요. 없어도 오프라인 추천으로 바로 쓸 수 있어요."
- **개발용 테스트 키**: `app/.env.development.local` 의 `VITE_DEV_GEMINI_KEY` — `npm run dev` 에서만 읽음(`import.meta.env.DEV` 로 감싸 배포 빌드에서 제거). 키가 비어 있을 때 설정 화면에 "개발용 테스트 키 사용" 버튼만 보임. **배포·APK·EXE 에는 절대 넣지 않음** — `npm run build` 뒤 `scripts/check-no-secrets.mjs` 가 dist·APK·EXE 안에 `AQ.`/`AIza` 형태 키나 .env 값이 있으면 실패시킴. 작업자는 키 값을 출력·복사·로그에 남기지 않음.
- 백엔드(`smart-bartender/backend/`)는 앱이 쓰지 않음. SPEC §3.3 보정 규칙의 **기준 구현**으로 남기고, 앱↔백엔드 결과 비교 테스트(parity)는 유지.

## 5. 재사용 (legacy → 새 앱)
옛 Expo 앱은 `smart-bartender/legacy/app-expo-v2.1/` (읽기 전용 참고, 고치지 않음).
- **그대로 복사**(RN 의존 없음): `src/lib/ai/*`(server 경로만 제거), `protocol.ts`, `presets.ts`, `types.ts`, `utf8.ts`, `history-hints.ts`, `transport/{types,demo,virtual-device,web-ble}.ts`, `device/client.ts`(AppState → `document.visibilitychange` 어댑터로).
- **웹용으로 다시 작성**: `brew.ts`·`flow.ts`(expo-router → react-router `navigate`), `ui.ts`(haptics → `navigator.vibrate`/Capacitor Haptics), `weather.ts`(expo-location → `navigator.geolocation`, open-meteo 그대로), `secrets.ts`, `notify.ts`(Notification API / Capacitor LocalNotifications), `store/storage.ts`(localStorage).
- **테스트 복사·이식**: `tests/*.test.ts` 전부. 서버 모드만 다루는 테스트는 제거하되, 그 안의 앱 보정 검증(서버 응답 재검증 등)이 직접 Gemini 경로로도 같은 의미면 그쪽으로 옮김. parity 테스트의 `../../backend/` 경로는 새 위치에서도 같음. 목표: 기존 143개가 지키던 성질을 잃지 않기.
- 화면은 legacy `src/app/**`·`src/components/**` 의 **기능과 문구를 그대로** 옮기고 모양만 새 디자인으로. (화면 목록 6장)

## 6. 화면 (legacy 파일 → 새 파일)
| 화면 | legacy | 새 위치 |
|---|---|---|
| 바텐더(입력) 홈 | `src/app/(tabs)/index.tsx` | `src/screens/home/` |
| 추천 레시피 | `src/app/recipe.tsx`, `components/RecipeBar·FlavorBars·ExploreCard` | `src/screens/recipe/` |
| 제조 진행·완료·한 잔 더 | `src/app/brewing.tsx` | `src/screens/brewing/` |
| 새 재료 탐색 | `src/app/explore.tsx` | `src/screens/explore/` |
| 기록·즐겨찾기·다시 만들기 | `src/app/(tabs)/history.tsx` | `src/screens/history/` |
| 재료 목록·재료 편집(펌프 추천) | `src/app/(tabs)/ingredients.tsx`, `ingredient-edit.tsx`, `components/PumpCard` | `src/screens/ingredients/` |
| 기기(연결·기기 변경·데모·작업 카드·프라이밍·세척) + 캘리브레이션 마법사 | `src/app/(tabs)/device.tsx`, `calibrate.tsx`, `components/DeviceChip·CalibrationBanner` | `src/screens/device/` |
| 설정(AI 키·모델·성인 인증·배출 모드·초기화·앱 정보) | `src/app/settings.tsx`, `components/AdultGate` | `src/screens/settings/` |
라우트(HashRouter): `/`, `/recipe`, `/brewing`, `/explore`, `/history`, `/ingredients`, `/ingredients/:pump`, `/device`, `/calibrate`, `/settings`.

## 7. 플랫폼 어댑터 (`src/platform/`)
- `detect.ts`: `isCapacitor`(window.Capacitor?.isNativePlatform()), `isElectron`(preload 가 넣는 `window.sbElectron`), 그 밖 = web.
- 통신 선택: Capacitor → `capacitor-ble.ts`(BleClient, NUS UUID, 180바이트 분할 쓰기, MTU 요청, 자동 재연결 지원) / Electron → `web-ble.ts` + 앱 안 기기 선택 창(메인 프로세스 `select-bluetooth-device` → IPC → 목록 → 선택) / web → `web-ble.ts` / 데모 → `demo.ts`. 모두 `transport/types.ts` 의 `Transport` 인터페이스.
- Web Bluetooth 제약 안내 문구: Chrome·Edge 필요, 아이폰 불가, 연결할 때마다 브라우저 기기 선택 창, PC 는 블루투스 어댑터 필요, 제조 중 화면을 켜 두기(Wake Lock API 사용). http 주소면 "브라우저 미지원" 대신 HTTPS 안내, EXE 는 EXE 전용 문구(`screens/device/deviceText.ts`).
- APK 플러그인: `@capacitor-community/bluetooth-le`, `@capacitor/preferences`(키), `@capacitor/local-notifications`(알림 채널 "제조 알림"), `@capacitor/haptics`(진동), `@capacitor/app`(뒤로 버튼). 플러그인은 `capacitor/plugins.ts` 의 `pluginLoader` 로 `{ plugin }` 상자에 담아 받음 — Capacitor 플러그인 Proxy 는 thenable 이라 Promise 로 바로 돌려주면 끝나지 않음. 네이티브 응답이 없을 때를 대비해 키 저장소·알림 5초, 알림 띄우기 2.5초(넘으면 토스트), 알림 권한 확인 3초 제한. 첫 제조 알림 권한은 최대 1.5초만 기다리고 제조 시작. 앱이 백그라운드면 WebView JS 가 거의 멈추므로, 제조가 시작되면(ack) `ack 시각 + 예상 시간 + max(5초, 10%)` 에 OS 가 띄우는 **예비 알림**("제조가 끝났을 거예요")을 작업마다 1번 예약하고(`schedule.at`·`allowWhileIdle`), 실제 결과를 처리하면 같은 id 로 결과 알림을 띄워 바꾸거나 취소(`notify.ts` `scheduleReminder`·`notify({replaces})`·`cancelReminder`, `brew.ts`). 정확한 시각 알람 권한은 받지 않아 몇 초 늦게 뜰 수 있음. 백그라운드에서 연결이 끊긴 경우는 앱으로 돌아올 때 알림.
- 안드로이드 뒤로 버튼(`capacitor/backButton.ts`): 열린 창 닫기(닫을 수 없는 창이면 무시) → 이전 화면 → 탭 첫 화면이면 바텐더 → 바텐더면 앱 내리기(종료 아님). 제조 중에는 "제조 중이에요. 멈추려면 비상 정지를 누르세요." 로 막음.
- 화면 이동: `lib/nav.ts` 의 `dismissTo(path)` = v2.1 `router.dismissTo`(앞 기록에서 path 칸까지 뒤로, 탭 첫 화면·모르는 칸을 만나면 지금 자리를 바꿈). 탐색 "지금 재료로", 장착 후 저장, "한 잔 더", "다른 걸 원해요" 가 씀.
- 앱 업데이트(APK·EXE, v3.0.3): `lib/update.ts` 가 GitHub 최신 릴리스를 확인하고 순서를 정함 → APK 는 앱 안 플러그인 `AppUpdaterPlugin.java`(이 저장소 릴리스 파일만 캐시에 받아 SHA-256 확인, `REQUEST_INSTALL_PACKAGES`, FileProvider 로 안드로이드 설치 창), EXE 는 메인 프로세스 `electron/updater.cjs`(받아서 SHA-256 확인, 새 EXE 실행 뒤 종료 — CSP `connect-src` 에 `api.github.com` 추가). 웹은 아래 서비스 워커가 자동 적용.
- 웹 서비스 워커: 새 버전은 기기 작업·AI 추천·실제 기기 연결이 없을 때 적용(`platform/swUpdate.ts`). 제조 알림을 누르면 열린 앱 창으로(`public/sw-notify.js`).
- 패키징: `capacitor.config.ts`(appId `kr.ac.anyang.hongdangmu.bartender`, appName "AI 스마트 바텐더", webDir `dist`), `electron/main.cjs`·`preload.cjs`, electron-builder portable. 안드로이드 빌드는 한글 경로 문제를 피해 ASCII 경로 사본에서 수행(`scripts/build-android.ps1`). 도구(JDK 21·Android SDK)는 `%USERPROFILE%\sb-tools\`.
  - APK 서명 키가 없으면 빌드가 멈춤(팀 드라이브 백업을 `app/android/keystore/` 에). 새 키는 맨 처음 릴리스 때만 `-NewKeystore`.
  - EXE: 배포본(`app.isPackaged`)은 `--dev-url`·`SB_DEV_URL` 무시, html 응답에 CSP(스크립트는 앱 파일만, `connect-src` 는 Gemini·`api.open-meteo.com`·새 버전 확인용 `api.github.com` 만) + `nosniff`, 권한 요청은 앱 주소에서 온 것만 허락. 외부 주소를 새로 쓰면 `electron/main.cjs` 의 `connect-src` 에 추가.
- 산출물 이름: `release/SmartBartender-3.0.3.apk`, `release/SmartBartender-3.0.3-portable.exe`, 웹은 `dist/`. APK·EXE 는 깃이 아니라 GitHub Releases(`https://github.com/paperji/smart-bartender/releases/latest`)에 올림.

## 8. 작업 규칙
- 새 파일은 UTF-8(BOM 없음)·LF. legacy·firmware·backend·hardware 는 수정 금지(이 작업 범위 밖) — 필요하면 보고만.
- 실제 Gemini 호출 금지(테스트는 가짜 fetch). 실측은 총괄 1명이 몇 번만. 예전 v2.1 운영 서버(Vercel 배포) 호출 금지.
- 자기가 띄운 프로세스만 종료. 배포·로그인·외부 게시 금지(사용자 허락 필요).
- 문구는 기존 앱과 같은 쉬운 해요체. 사용자에게 보이는 영어 약어는 처음 나올 때 풀어서.
