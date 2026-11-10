# 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커 (팀 홍당무)

> 앱 v3.1 · 앱 화면 이름 "AI 스마트 바텐더"
> 안양대학교 정보전기전자공학과 캡스톤디자인Ⅱ (2026/2학기) · 팀 **홍당무**

앱에서 기분·맛·도수·날씨·상황·성향을 고르면, AI(내가 고른 Gemini·ChatGPT·Claude 등)가 **기기에 장착된 재료만으로** 레시피를 만들어
블루투스(BLE)로 ESP32에 보내고, ESP32가 펌프 4개를 시간 제어해 한 잔을 배합해요.

| 바로 쓰기 | 주소 |
|---|---|
| **웹앱 (PC·안드로이드 Chrome·Edge)** | https://paperji.github.io/smart-bartender/ |
| **안드로이드 APK · Windows EXE 내려받기** | https://github.com/paperji/smart-bartender/releases/latest |

> 웹 주소와 Releases 는 저장소를 공개하고 처음 배포한 뒤부터 열려요(아래 [3장](#3-웹앱-배포--릴리스-팀이-한-번만)).
> 하드웨어가 없어도 **데모 모드(가상 기기)** 로 추천 → 제조 → 기록까지 전체 흐름을 체험할 수 있어요.

```
[앱 v3.1 — 한 소스(app/)에서 네 가지 형태]
  웹(Chrome·Edge) · 설치형 웹앱(PWA) · 안드로이드 APK(Capacitor) · Windows EXE(Electron)
      │
      ├─ HTTPS ──► 고른 AI API (Gemini·ChatGPT·Claude·Grok·DeepSeek·Mistral·Groq·OpenRouter)
      │             ← 사용자 본인 키(BYOK). 키는 그 기기에 AI 마다 따로 저장, 그 키의 회사에만 보냄
      │             (키가 없거나 실패하면 앱 내장 오프라인 규칙기반 추천으로 자동 대체)
      │             앱이 결과를 SPEC §3.3 규칙으로 다시 검증·보정(장착 재료만, 잔량·재료당 300ml·도수 상한)
      │
      ├─ HTTPS ──► 모두의 레시피 서버(Supabase, 공개용 키·정해진 함수만) ← 공유 레시피 올리기·인기 TOP 5·검색·사용 횟수
      │
      └─ BLE(블루투스, Nordic UART, 줄바꿈 JSON) ──► [ESP32] → [4채널 릴레이] → [펌프 ×4] → 체크밸브 → 노즐 → 잔
```

팀이 운영하는 AI 서버는 없어요(공유 레시피만 무료 Supabase 에 모아요 — [`docs/shared-recipes.sql`](docs/shared-recipes.sql)). v2.1 까지 쓰던 Vercel 서버(`backend/`)는 **보정 규칙의 기준 구현**으로만 남겨 두고,
앱과 결과가 같은지 자동 테스트로 비교하는 데 써요(배포하지 않음 — [`backend/README.md`](backend/README.md)).

---

## 1. 무엇이 어디에 있나

| 폴더 / 파일 | 내용 | 먼저 볼 문서 |
|---|---|---|
| `app/` | **앱 v3.0** — Vite + React 19 + TypeScript. 같은 빌드로 웹·PWA·APK·EXE. 데모 모드 포함 | [`app/README.md`](app/README.md) |
| `docs/SPEC.md` | **모든 산출물이 따르는 설계 명세(계약)** — 핀맵, BLE 명령, AI 요청·보정 규칙 | — |
| `docs/WEBAPP_DESIGN.md` | 앱 v3.0 설계 기준 — 플랫폼·스택·밝은 톤 디자인·BYOK AI·화면·플랫폼 어댑터 | — |
| `docs/프로젝트_정리.md` | 과제 자료 정리(진행 이력, 구매 부품, 발견한 문제점, 진행 결과) | — |
| `firmware/` | ESP32 펌웨어 v2.1.0(Arduino IDE), PC 단위 테스트 | [`firmware/README.md`](firmware/README.md) |
| `hardware/circuit/` | 회로도(정식 회로도 + 초보자용 실물 배선도), 연결표 ①~㊱ | `hardware/circuit/회로도.html` |
| `hardware/BOM.xlsx` / `BOM.md` | **통합 BOM**(2026-11-10) — 납땜·무납땜 두 기준을 한 표로 비교(부품마다 적용 기준·기준별 수량·금액), **주문_링크** 시트(앞으로 살 부품만, 누르면 상품 페이지), 예산 비교. 11-06 원본은 `hardware/research/BOM_원본_20261106.xlsx/.md`로 보관 | [`BOM.md`](hardware/BOM.md) |
| `hardware/BOM_납땜기준.xlsx` / `BOM_무납땜기준.xlsx` (+ `.md`) | 2026-11-10 최신화 BOM 두 벌 — 출력 부품·새 용기·이미 결제한 돈 반영. 납땜 기준(학교 공구 대여) / 무납땜 기준(레버 커넥터·선 달린 스위치·퓨즈홀더) | [`BOM_납땜기준.md`](hardware/BOM_납땜기준.md) · [`BOM_무납땜기준.md`](hardware/BOM_무납땜기준.md) |
| `hardware/guide/` | **초보자용 제작가이드 두 벌**(2026-11-10, 970ml 용기·3D 출력 부품·최신 BOM 반영 — STEP 1~12, 그림, 체크박스, 학교 실습실 방문 계획, 기본 손기술, 용어 사전): 납땜 기준 / 무납땜 기준. 한 원본 `src/제작가이드.src.md`에서 `python src/build_guides.py`로 만듦. 예전 `조립가이드`(2026-11-06)는 비교용 | [`제작가이드_납땜기준.html`](hardware/guide/제작가이드_납땜기준.html) · [`제작가이드_무납땜기준.html`](hardware/guide/제작가이드_무납땜기준.html) |
| `hardware/3dprint/` | 3D 프린팅 부품 7종(모서리 브래킷·노즐 블록·앞면 베젤·그로밋·상판 캡·튜브 부싱) STL·모델 코드·출력 조건 | `hardware/3dprint/README.md` |
| `hardware/research/` | 부품 사양 조사, 재단표(포맥스 외형) | `parts_research.md` |
| `backend/` | SPEC §3.3 보정 규칙의 **기준 구현**(Node). 앱은 쓰지 않음, 앱↔백엔드 결과 비교 테스트용 | [`backend/README.md`](backend/README.md) |
| `legacy/app-expo-v2.1/` | 이전 앱 v2.1(Expo / React Native) — 참고용 보관, 고치거나 배포하지 않음 | `legacy/app-expo-v2.1/README.md` |
| `.github/workflows/pages.yml` | `main` 에 `app/` 변경이 올라오면 테스트 → 빌드 → GitHub Pages 배포 | 3장 |

---

## 2. 빠른 시작

### 2-1. 사용자 — 설치 없이 / 설치해서

| 형태 | 받는 곳 | 블루투스 |
|---|---|---|
| 웹앱 | 위 웹 주소를 **Chrome·Edge** 로 열기 | Web Bluetooth — 연결할 때마다 브라우저 기기 선택 창. **아이폰(사파리)은 블루투스 불가**(데모·AI 추천만) |
| 설치형 웹앱(PWA) | 웹앱에서 **설정 → 앱 정보 → 앱 설치** (또는 Chrome 메뉴 "앱 설치"·"홈 화면에 추가") | 웹앱과 같음. 인터넷 없이도 열림(AI·날씨만 인터넷 필요) |
| 안드로이드 APK | Releases 의 `SmartBartender-3.1.0.apk` → 휴대폰에서 열어 설치("출처를 알 수 없는 앱" 허용) | 네이티브 BLE, 앱 안 검색 목록, 마지막 기기 자동 재연결 |
| Windows EXE | Releases 의 `SmartBartender-3.1.0-portable.exe` → 더블클릭(설치 없음). SmartScreen 경고 → "추가 정보" → "실행" | PC 블루투스(4.0 이상) 어댑터 필요, 앱 안 기기 선택 창 |

처음 켜면 데모 모드(가상 기기)가 켜져 있어요. 실제 기기는 **기기 탭 → 데모 모드 끄기 → 기기 검색(선택)** 으로 연결해요
([`app/README.md`](app/README.md) 4-2).

**AI 키 (선택)**: **설정 → AI 고르기** 에서 AI 를 고르고 그 AI 의 API 키를 붙여 넣은 뒤 **[키 확인] → [저장]** 하면 그 AI 가 레시피를 만들어요.
Gemini(Google AI Studio https://aistudio.google.com/apikey)·Groq 는 무료로 발급받을 수 있고(사용량 한도 있음), ChatGPT·Claude·Grok·DeepSeek·Mistral 은 각 회사에 충전한 만큼 써요.
회사별 발급 방법은 앱 **설정 → 키 발급 방법**에서 AI 를 누르면 나와요. 키는 **그 기기에만 저장**돼요.

**모두의 레시피 (v3.1)**: **기록** 탭에서 만든 잔을 **공유**하면, 다른 사람이 아래 **공유** 탭에서 **실제로 많이 만든 순 TOP 5** 와 검색으로 찾아 자기 기기로 만들 수 있어요([`app/README.md`](app/README.md) 4-8).
키가 없거나 한도·인터넷 문제로 실패하면 앱에 내장된 **오프라인 추천**으로 이어서 만들어요. 자세한 내용은 [`app/README.md`](app/README.md) 5장.

### 2-2. 개발자 — 하드웨어 없이 바로 실행 (Node.js 22 이상)

```bash
cd app
npm ci
npm run dev            # http://localhost:5173 — 데모 기기(가상 ESP32)에 자동 연결
npm test               # 자동 테스트 (실제 AI·공유 서버 호출 없음, 가짜 fetch)
npm run typecheck      # 타입 검사
npm run build          # 타입 검사 → vite build(dist/, PWA) → 키 검사(check-no-secrets)
npm run build:android  # release/SmartBartender-3.1.0.apk  (Windows · JDK 21 · Android SDK — app/README.md 3-3)
npm run build:exe      # release/SmartBartender-3.1.0-portable.exe (app/README.md 3-4)
```

---

## 3. 웹앱 배포 · 릴리스 (팀이 한 번만)

1. **GitHub Pages 한 번 설정**: 저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   이 설정 전에는 배포 작업의 `configure-pages` 단계가 실패해요("Get Pages site failed").
2. 그다음 `main` 에 `app/` 변경을 push 하거나, **Actions → "Deploy web app to GitHub Pages" → Run workflow** 를 눌러요.
   워크플로가 `npm ci` → `npm test` → `npm run build`(키 검사 포함) → 배포까지 해요. 빌드에는 API 키가 들어가지 않아요.
3. **APK·EXE**: 팀 PC 에서 `npm run build:android`, `npm run build:exe` 로 만든 `app/release/` 의 두 파일을
   GitHub **Releases**(예: 태그 `v3.1.0`)에 올려요. 깃에는 올리지 않아요(`.gitignore`).
   APK 서명 키(`app/android/keystore/`)는 커밋되지 않으니 **팀 드라이브에 따로 백업**하세요 — 잃어버리면 기존 앱 위에 업데이트 설치가 안 돼요.

---

## 4. 지금 상태 (2026-11-08)

| 항목 | 검증된 것 | 아직 안 된 것 |
|---|---|---|
| 앱 v3.1.0 | **v3.1 실기 시험**: 모두의 레시피 공유(EXE) → 다른 기기에서 그 레시피로 실제 제조(APK·휴대폰 크롬·PC 크롬) → 만든 수 1·2·3·TOP 1, 여러 AI 키(가짜 키 거절·Gemini 실제 호출), 설정 톱니바퀴 문제 해결 (`docs/프로젝트_정리.md` 10장). `npm test` **383개** 통과(Windows 기준 — Linux CI 에서는 PowerShell 빌드 스크립트 시험 1개를 건너뜀)(가짜 AI·가짜 공유 서버·가짜 BLE, 앱↔백엔드 보정 규칙 비교 포함), `npm run typecheck` 0 오류, 웹·PWA 빌드와 키 검사 통과, APK(약 6MB)·EXE(약 108MB, 창 없이 실행 점검 통과) 빌드, **Windows 앱·휴대폰 APK ↔ 실제 ESP32** 연결·제조·비상 정지·재부팅 뒤 자동 재연결(2026-11-07, 갤럭시 S20 Ultra(안드로이드 13)), **v3.0.3 실기 시험**: 앱 안 업데이트 3.0.2 → 3.0.3(APK·EXE)·웹 자동 업데이트(PC·휴대폰 크롬), 페어링 PC 크롬 5/5·휴대폰 크롬 6/6·APK 8/8(모두 첫 시도)·EXE 5/5 (`docs/프로젝트_정리.md` 9.1) | 휴대폰 첫 연결이 가끔 실패할 수 있음(앱이 4번까지 자동으로 다시 시도 — v3.0.3 시험에서는 0번) |
| 펌웨어 v2.1.2 | PC 단위 테스트 **213/213**(펌프 4개 180 + 8개 11 + BLE 송신 링버퍼·연결 감지 22), 컴파일 경고 0, **실제 보드(ESP32-D0WD-V3)에 업로드**, PC 블루투스 자동 시험 **32/32**(`firmware/test/ble_e2e.py`) | 릴레이·펌프를 단 실물 구동, 캘리브레이션 실측 |
| 백엔드(기준 구현) v2.1 | 로컬 테스트 **68/68**(가짜 Gemini 응답, 2026-11-07 다시 실행) | 배포하지 않음(앱이 쓰지 않음) |
| 회로·BOM·가이드 | BOM 검증 **78/0**·엑셀 수식 오류 0(2026-11-07 다시 실행), 문서 간 교차 검증, 연결 36개 일치 | 실물 조립, 릴레이 3.3V 동작(A안/B안) 확인 |

펌웨어와 앱의 데모 기기는 같은 명령 스크립트 1,900여 개로 출력을 비교해 확인했어요(소수 셋째 자리 `setcal` 반올림 1건만 다름).
진행 결과 요약은 [`docs/프로젝트_정리.md`](docs/프로젝트_정리.md) 7~10장에 있어요(9장 = 실제 ESP32 연결 시험, 10장 = v3.1).

---

## 5. 다음에 할 일 (순서대로)

1. **예전 키 정리**: 예전(v2.1)에 쓰던 Gemini 키는 Google AI Studio 에서 **삭제(폐기)**해요. 예전 Vercel 서버 프로젝트는 그대로 둬도 되고(앱이 쓰지 않음), 키를 폐기하면 그 서버는 AI 를 부르지 못해요.
2. ~~저장소 공개 + 웹앱·릴리스 배포~~ → 2026-11-07 v3.0.0 공개. 고친 판(v3.0.1·펌웨어 2.1.1)은 저장소에 올리면 웹앱이 자동 배포되고, Releases 에 v3.0.1 APK·EXE 를 올려요(3장).
3. **부품 주문**: `hardware/BOM_납땜기준.xlsx` 또는 `BOM_무납땜기준.xlsx`(2026-11-10 최신)의 **`주문_링크`** 시트(링크를 누르며 주문)와 `추가구매_의뢰서용` 시트(학교 의뢰서 형식). 두 기준 비교는 통합판 `BOM.xlsx`. 팀장 이름·연락처는 **제출 전에 직접 기입**(공개 저장소라 비워 둠).
   용기는 폭 95mm 이하를 먼저 고르세요(본체 폭이 정해짐).
4. ~~펌웨어 업로드 + 시리얼·블루투스 테스트~~ → 2026-11-07 완료(펌웨어 2.1.2, PC 블루투스 32/32, Windows 앱·휴대폰 APK 연결·제조 확인 — `docs/프로젝트_정리.md` 9장). 다시 할 때는 `firmware/README.md` 3~5장.
5. **브레드보드 벤치 테스트**: 제작가이드(납땜 기준 또는 무납땜 기준) STEP 2. 여기서 **릴레이 A안(3.3V)/B안(5V)** 중 동작하는 쪽을 정해요.
6. **조립**: 제작가이드 STEP 3~12 (펌프 모듈 → 전원부 → 전장 박스 → 배관 → 외형 → 최종 조립 → 캘리브레이션). 집에 납땜 도구가 없으면 무납땜 기준.
7. **앱 설치·연결**: Releases 의 APK(안드로이드) 또는 Chrome 웹앱 → 기기 탭에서 연결(`app/README.md` 4-2).
8. **캘리브레이션**: 기기 탭 → 캘리브레이션 마법사(펌프마다 10초 측정). 하지 않으면 레시피보다 적게 나와요.
9. **AI 키 등록·실측**: 시연 폰에 본인 AI 키(무료면 Gemini·Groq) 등록 → [키 확인]. 실제 AI 호출은 필요한 만큼만(무료 등급 한도·유료 회사는 충전금).
10. **공유 레시피 서버**: Supabase 무료 프로젝트 "smart-bartender"(서울)는 1주일 동안 아무도 쓰지 않으면 쉬어요. 시연 전에 대시보드에서 켜져 있는지 확인(쉬면 **Restore project**).

---

## 6. 핵심 설계 결정 (왜 이렇게 했나)

- **웹앱 하나로 네 가지 형태(v3.0)**: 같은 소스·같은 빌드(`dist/`)로 웹·PWA·APK·EXE 를 만들어 화면·로직을 한 번만 고쳐요. 플랫폼마다 다른 것은 `app/src/platform/` 어댑터(통신·알림·진동·저장)뿐이에요.
- **AI 는 사용자 본인 키(BYOK, v3.0)**: 팀 서버를 운영·결제하지 않아도 되고, 키는 그 기기에만 저장돼 Google 외에는 어디로도 보내지 않아요. 키가 없거나 실패해도 오프라인 추천으로 항상 동작해요.
- **이중 검증**: AI 응답은 앱이 SPEC §3.3 규칙(장착 재료만, 잔량·재료당 300ml·도수 상한)으로 다시 보정하고, 같은 규칙의 기준 구현(`backend/lib`)과 결과가 같은지 자동 테스트로 확인해요.
- **Wi-Fi → 블루투스(BLE)**: 공유기·IP 주소 설정 없이 어디서나 바로 연결. 테스트용 무료 앱(nRF Connect 등)으로도 명령을 보낼 수 있어요.
- **펌프 단독 시간 제어 + 펌프별 유량 캘리브레이션**: 밸브 없이 구조 단순화(특허 H/W 아이디어). 유량(ml/초)은 ESP32 플래시에 저장해요.
- **릴레이 JD-VCC 분리(A안)**: ESP32 의 3.3V 신호로도 릴레이가 확실히 꺼지게. 켜지지 않으면 B안(5V)으로 전환해요.
- **안전**: 부팅 시 릴레이 OFF 고정, 펌프당 최대 120초 감시, 앱·버튼 비상정지, 퓨즈 3A, 1000µF 커패시터, 플라이백 다이오드, 주류는 성인 확인(만 19세) 후 제조.
- **재고 연동 + 새 재료 장착 유도(탐색 모드)**: 추천을 거절하면 "이 재료를 장착하면 이런 걸 만들 수 있어요"를 제안해요(특허 BM 아이디어).

이전 버전(앱 v2.1 — Expo, 서버 경유 AI)의 설명은 [`legacy/app-expo-v2.1/README.md`](legacy/app-expo-v2.1/README.md) 에 그대로 있어요(참고용).
