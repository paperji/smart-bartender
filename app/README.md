# AI 스마트 바텐더 앱 v3.0 (웹앱 · PWA · APK · EXE 공용 소스)

> 팀 **홍당무** · 안양대학교 정보전기전자공학과 캡스톤디자인 Ⅱ (2026-2학기)
> 과제: 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커

| 바로 쓰기 | 주소 |
|---|---|
| 웹앱 (PC·안드로이드 Chrome·Edge) | https://paperji.github.io/smart-bartender/ |
| APK · EXE 내려받기 | https://github.com/paperji/smart-bartender/releases/latest |

설계 기준: [`../docs/WEBAPP_DESIGN.md`](../docs/WEBAPP_DESIGN.md) (플랫폼·스택·밝은 톤·BYOK AI·화면·플랫폼 어댑터).
기기 통신·AI 보정 규칙: [`../docs/SPEC.md`](../docs/SPEC.md). SPEC 과 코드가 다르면 SPEC 이 정답이에요.

---

## 0. 개요

기분·맛·도수·날씨·상황·성향을 고르면 AI(Gemini)가 **기기 펌프에 실제로 장착된 재료만으로** 레시피를 만들고,
블루투스(BLE)로 ESP32 칵테일 메이커에 보내 음료를 배합해요. 하드웨어가 없어도 **데모 모드(가상 기기)** 로 전체 흐름을 쓸 수 있어요.

| 형태 | 만드는 방법 | 블루투스 | 비고 |
|---|---|---|---|
| 웹 (PC·안드로이드 브라우저) | `npm run build` → GitHub Pages | Web Bluetooth (Chrome·Edge) | 아이폰 사파리는 블루투스 불가(데모·AI 만) |
| 설치형 웹앱 (PWA) | 같은 웹을 "앱 설치"·"홈 화면에 추가" | Web Bluetooth | 인터넷 없이도 열림(AI·날씨는 인터넷 필요) |
| 안드로이드 APK | `npm run build:android` (Capacitor) | 네이티브 BLE | 앱 안 검색 목록, 자동 재연결 |
| Windows EXE | `npm run build:exe` (Electron, portable) | Chromium Web Bluetooth + 앱 안 기기 선택 창 | 설치 없이 실행, 코드 서명 없음 |

- **한 소스·한 빌드**: 화면·로직은 100% 같고, 다른 것은 `src/platform/` 의 어댑터(통신·알림·진동·저장)뿐이에요.
- **AI = 내 키(BYOK)**: 팀 서버 없이, 사용자가 등록한 본인 Gemini API 키로 앱이 Gemini 를 직접 불러요(5장).
  키가 없거나 실패하면 **앱 내장 오프라인 추천**으로 자동 대체돼요. 결과는 앱이 SPEC §3.3 규칙으로 다시 검증·보정해요.
- **v2.1(Expo)에서 바뀐 것**: 서버 모드·AI 서버 주소 설정 제거, 키 등록 화면, 밝은 톤 디자인, PC 화면(왼쪽 메뉴·2열), PWA·APK·EXE.
  기능과 문구는 v2.1 그대로예요(이전 앱: `../legacy/app-expo-v2.1/`, 참고용).

---

## 1. 화면별 기능

폭 900px 미만(휴대폰)은 위 상단바(기기 연결 칩·설정 ⚙) + **아래 탭 4개(바텐더·재료·기록·기기)**, 900px 이상(PC)은 **왼쪽 메뉴**(아래쪽 "설정") + 넓은 화면 2열이에요.
(900~1079px 창에서는 바텐더·재료 편집이 1열이라 "AI 레시피 만들기" 버튼이 입력 칸 아래에 있어요. 2열은 1080px 이상.)

| 탭/화면 | 기능 |
|---|---|
| **바텐더(홈)** `#/` | 첫 실행 안내 카드("AI 키를 등록하면…", 닫을 수 있음), 캘리브레이션 전 안내, 장착된 재료 요약, 기분(여러 개 + 직접 입력), 맛 0~5(단·신·쓴·탄산), 도수(주류가 없으면 무알콜만), 날씨(현재 위치로 불러오기 또는 직접 고르기), 상황, 성향·요청 사항, 잔 용량 → **AI 레시피 만들기** / **새 재료 탐색** / 초기화. PC 는 오른쪽에 "지금 고른 조건" 요약 카드 |
| **추천 레시피** `#/recipe` | 출처 배지(Gemini AI 추천 / 오프라인 추천), 오프라인으로 바뀐 이유 + [설정] 버튼, 재료 비율 막대, 재료별 ml ±5 조정·잔 용량 맞추기, 총량·예상 도수·예상 시간, 추천 이유, 맛 프로필, 가니시·팁, 바텐더의 제안(재료 장착·잔량 채우기 바로가기), 새 재료 카드(0~1개), 즐겨찾기, **다른 추천(거절)**, **기기로 제조 시작** |
| **제조 진행** `#/brewing` | 전체 화면. 진행 원(%·남은 시간), 펌프별 진행 막대, 큰 **비상 정지**, 연결 끊김·재연결 안내, 완료 후 좋아요/별로예요 → "한 잔 더 만들까요?" [예, 같은 취향으로 한 잔 더] / [아니요, 다른 걸 원해요]. 첫 제조 때 알림 권한 요청, 웹은 제조 중 화면 꺼짐 방지 |
| **새 재료 탐색** `#/explore` | 탐색 카드 1~3개(레시피 이름·설명·재료 — 아직 없는 재료 강조·메시지 + **펌프 N에 장착하기**), 지금 재료로 만들 수 있는 레시피 바로가기, 다시 탐색 |
| **재료** `#/ingredients` | 펌프 1~4(최대 8) 카드: 이름·종류·도수·잔량/용량·색상, 요약(장착·잔량 부족·주류), 제안받은 재료 장착 안내 + 추천 펌프 |
| **재료 편집** `#/ingredients/:pump` | 빠른 선택(프리셋, 이름 칸으로 검색), 이름·종류·도수·용기 용량·남은 양(가득 채움·비우기)·표시 색상·메모, 재료 빼기. 탐색 카드에서 오면 이름·종류·도수가 미리 채워지고 **저장하고 추천받기** |
| **기록** `#/history` | "지금까지 N잔을 만들었어요 · 좋아요 N개", [제조 기록 \| 즐겨찾기] 전환, 기록 카드(완성·중단됨·결과 확인 필요·도수·오프라인 배지, 즐겨찾기·삭제), **다시 만들기** |
| **기기** `#/device` | 연결 카드(이름·상태·펌웨어·펌프 수·캘리브레이션 수, 검색·연결·해제·**다른 기기로 변경**·검색 중지·연결 취소, 기억한 기기·지우기), 데모 모드·자동 재연결 스위치, 가상 기기 유량 초기화, 연결 방식 안내(실행 환경별), 기기 정보(최대 제조량·펌프당 최대 구동·작동 시간·펌프별 유량/측정 여부), 작업 카드(진행 중·결과 확인 필요), **캘리브레이션 마법사**, 프라이밍(길게 누르기), 세척(펌프당 3/5/10초), 배출 모드(순차/동시), 모든 펌프 즉시 정지, 앱 설정 바로가기 |
| **캘리브레이션** `#/calibrate` | 펌프 선택 → 튜브 채우기(3초) → 5/10(권장)/15초 구동 → 나온 양 입력 → 유량 계산 → **기기에 저장** → 결과표. 재료로 측정했으면 잔량에서 빼기 |
| **앱 설정** `#/settings` | **AI 추천 방식**(Gemini(내 키) / 오프라인), **Gemini API 키**(키 확인·저장·삭제, 마지막 4자리만 표시), 모델 선택, 키 발급 방법, 기기 연결(데모 모드·자동 재연결·기억한 기기), 배출 모드, 성인 인증 상태·초기화, 모든 데이터 초기화, **앱 정보**(버전·실행 환경·팀·웹앱 주소·APK·EXE 내려받기·브라우저면 "앱 설치"·개인정보 안내·오픈소스 라이선스) |

- **데모 모드(처음엔 켜짐)**: 가상 기기 2대(`SmartBartender-DEMO`, `SmartBartender-DEMO2`)가 펌웨어 v2.1 과 같은 규칙(검증 순서·`calSet`·펌프당 120초·0.1초 간격 동시 기동)으로 동작해요. 가상 펌프의 "실제" 유량은 3.7~5.2ml/초라 캘리브레이션 체험이 실제와 비슷하고, 측정한 유량은 이 기기에 저장돼요.
- **오프라인 추천**: 키가 없거나 Gemini 가 실패하면 앱 내장 규칙기반 추천기로 자동 대체("오프라인 추천" 배지). 탐색도 SPEC §5.4 후보(탄산수·토닉워터·레몬즙·설탕시럽·그레나딘 시럽·크랜베리주스·우유·진/보드카/화이트 럼·트리플섹)로 만들어요.
- **성인 인증**: 주류(도수 > 0) 레시피를 처음 제조할 때 만 19세 이상 확인 + 음주운전 경고. 확인 전에는 AI·오프라인 모두 "술을 새로 장착하세요" 카드와 술 장착·대체 제안을 빼요(SPEC §3.2·§5.4).
- **성향(알레르기·싫어하는 재료)**: "우유 알레르기", "사이다는 빼 주세요" 처럼 적으면 그 재료는 어떤 결과에서도 빠지고 도수를 낮출 때 섞는 재료로도 쓰지 않아요(SPEC §3.3 규칙 1).
- **다른 추천 = 거절**: 거절한 레시피는 기록에 남겨 다음 추천에서 같은 재료 조합을 피하고, 2번 연속이면 "새 재료를 장착해 볼까요?" 안내가 떠요(SPEC §5.3).
- **알림**: 완료·중단·기기 안전장치·제조 중 연결 끊김 때 알림 + 진동. APK 는 안드로이드 알림 채널 "제조 알림", 웹은 브라우저 알림(허용 시, 아니면 화면 토스트, 알림을 누르면 열린 앱 창으로), EXE 는 Windows 알림 + 작업 표시줄 깜빡임.
  첫 제조 때 알림 권한을 1번 묻지만 답을 기다리지 않고(최대 1.5초) 제조를 시작해요. 나중에 거부하면 "알림이 꺼져 있어요…" 안내가 떠요.
  APK 는 앱이 백그라운드로 가면 화면 쪽 코드가 거의 멈춰요. 그래서 제조가 시작되면 끝날 시각(예상 시간 + 조금 여유)에 휴대폰이 직접 띄우는 **예비 알림**("제조가 끝났을 거예요")을 예약해 두고, 앱이 실제 결과를 받으면 같은 알림을 "완성됐어요"·"멈췄어요" 로 바꿔요. 예비 알림은 몇 초 늦게 뜰 수 있어요. 제조 중 백그라운드에서 연결이 끊긴 경우는 앱을 다시 열 때 알려 줘요.
- **뒤로가기**: 탐색의 "지금 재료로", 장착 후 저장, "한 잔 더", "다른 걸 원해요"는 v2.1 `dismissTo` 처럼 앞 기록의 그 화면으로 돌아가요(기록이 없으면 지금 자리를 바꿈). 제조 중에는 뒤로가기를 막아요.
  **안드로이드 APK 뒤로 버튼**: 열린 창 닫기 → 이전 화면 → 탭 첫 화면이면 바텐더 → 바텐더면 앱을 내림(종료 아님). 제조 중에는 "제조 중이에요. 멈추려면 비상 정지를 누르세요." 로 막아요.
- **깨진 저장값**: 저장된 값이 깨져 있으면 그 칸만 기본값으로 바꾸고, 화면을 그리다 오류가 나면 하얀 화면 대신 복구 카드([다시 시도]·[입력 초기화 후 다시 열기] — `sb3.draft` 만 지움, 기기 작동 중이면 [비상 정지])가 떠요.

---

## 2. 준비물 — Node.js 22 이상

- **Node.js 22 이상**(`package.json` 의 `engines`). 확인: `node -v`. 낮으면 Node 22 LTS 를 설치하고 터미널을 새로 여세요.
- Windows 10/11 에서 개발·빌드를 확인했어요. APK·EXE 빌드 도구는 3-1.

| 명령 (app 폴더에서) | 하는 일 |
|---|---|
| `npm ci` | 의존성 설치(package-lock.json 그대로) |
| `npm run dev` | 개발 서버 http://localhost:5173 (데모 기기에 자동 연결) |
| `npm run build` | 타입 검사 → `vite build`(dist/, PWA 서비스 워커 포함) → `scripts/check-no-secrets.mjs`(dist 에 키가 없는지) |
| `npm run preview` | 빌드 결과 미리 보기 http://localhost:4173 |
| `npm test` | `node:test` + `tsx` 테스트 (실제 Gemini 호출 없음, `../backend` 와 결과 비교 포함) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build:android` / `npm run build:exe` | APK / EXE 만들기 (3-3·3-4) |
| `npm run electron:dev` | 개발 서버를 Electron 창으로 열기 (3-4) |
| `npm run icons` | 아이콘 다시 만들기 (`public/icons`, `public/favicon.svg`, 안드로이드·Electron 아이콘) |
| `npm run check:secrets -- <파일…>` | 지정한 파일(dist·APK·EXE)에 키 모양이 없는지 검사 |

**지킬 것**
- 개발용 테스트 키(선택): `app/.env.development.local` 의 `VITE_DEV_GEMINI_KEY` — `npm run dev` 에서만 읽고, 키가 없을 때 설정 화면에 "개발용 테스트 키 사용" 버튼만 보여요. 이 파일은 **출력·복사·커밋 금지**(`.gitignore`), 배포물에는 절대 들어가지 않아요(빌드가 검사).
- 테스트는 가짜 fetch 만 써요. 실제 Gemini·예전 운영 서버를 부르는 테스트를 만들지 마세요.
- 새 파일은 UTF-8(BOM 없음)·LF, 화면 문구는 쉬운 해요체.

---

## 3. 설치 파일 만들기

같은 웹 빌드(`dist/`) 하나로 웹앱(PWA)·안드로이드 APK·Windows EXE 를 만들어요. 화면·로직은 모두 같고, 다른 것은 `src/platform/` 의 어댑터뿐이에요.

| 결과물 | 명령 | 나오는 곳 |
|---|---|---|
| 웹앱(PWA) | `npm run build` | `dist/` (HTTPS 로 올리면 "앱 설치" 가능) |
| 안드로이드 APK | `npm run build:android` | `release/SmartBartender-3.0.3.apk` |
| Windows EXE | `npm run build:exe` | `release/SmartBartender-3.0.3-portable.exe` |

### 3-1. 준비물 (한 번만)

- Node.js 22 이상, Windows 10/11.
- 빌드 도구 묶음 `%USERPROFILE%\sb-tools\` — JDK 21(Temurin)·Android SDK(build-tools 36)·Gradle/Electron 내려받기 캐시. 스크립트가 `sb-tools\env.ps1` 을 자동으로 읽어요. 다른 PC 라면 같은 구성으로 만들고 `-ToolsDir D:\sb-tools` 처럼 경로를 넘기세요.
- 안드로이드 빌드 도구(AGP)는 **한글이 들어간 경로를 거부**해요(프로젝트가 한글이 들어간 폴더 안에 있으면 문제). 그래서 두 스크립트 모두 앱 폴더를 영문 경로 `sb-tools\build\app` 으로 복사(robocopy, `node_modules`·`dist`·`release`·`.env*` 는 빼고)해서 그곳에서 빌드한 뒤, 결과물만 `release\` 로 가져와요.
- 개발용 키 파일(`.env.development.local`)은 복사하지 않고, 배포 빌드는 읽지도 않아요. 빌드 중에 `scripts/check-no-secrets.mjs` 가 dist·APK(안의 파일을 하나씩 풀어서)·EXE 묶음(app.asar)을 검사하고, 키 모양이 보이면 멈춰요.

### 3-2. 웹앱(PWA)으로 설치

- `npm run build` 결과(`dist/`)를 HTTPS 주소에 올리면(이 저장소는 GitHub Pages 자동 배포 — 3-5) Chrome·Edge 에서 "앱 설치"·"홈 화면에 추가" 가 돼요. 서비스 워커가 앱 전체와 글꼴을 미리 받아 두어 **인터넷 없이도 열려요**(AI·날씨는 인터넷 필요).
- 앱 이름 "AI 스마트 바텐더", 짧은 이름 "바텐더", 밝은 바탕색(#F7F6F3), 아이콘 192/512 + maskable(안드로이드 둥근 아이콘용). 아이콘은 `npm run icons` 가 한 그림에서 웹·APK·EXE 용을 모두 만들어요.
- **설정 > 앱 정보 > 앱 설치**: 웹에서만 보여요. 브라우저가 설치를 허락하면 **[앱 설치]** 버튼, 아니면 `installHint()` 안내(브라우저 메뉴 → "앱 설치" 등). Chrome 의 자동 설치 배너 대신 이 버튼을 써요.
  다른 화면에 버튼을 만들 때: `import { usePwaInstall, installHint } from '@/platform/install'` → `const { canInstall, installed, install } = usePwaInstall()`. `canInstall` 일 때만 버튼을 보이고, 누르면 `install()` (결과 `'accepted' | 'dismissed' | 'unavailable'`).
- 서비스 워커는 웹(https·localhost)에서만 등록해요. APK·EXE 안에서는 등록하지 않고, 혹시 남은 것은 시작할 때 지워요(예전 화면이 남지 않게).
- 새 버전은 **기기 작업(제조·캘리브레이션 등)·AI 추천·실제 기기 연결이 없을 때** 적용돼요(새로고침 1번, `src/platform/swUpdate.ts`). 제조 알림을 누르면 열린 앱 창으로 가요(`public/sw-notify.js`).

### 3-3. 휴대폰 설치용 APK 만들기

**만들기** (앱 폴더에서, PowerShell 또는 Git Bash):

```
npm run build:android
```

스크립트(`scripts/build-android.ps1`)가 하는 일 — 단계마다 걸린 시간을 마지막에 보여 줘요:

1. 영문 경로로 복사 → `npm ci`(package-lock.json 이 바뀌었을 때만, 강제로 하려면 `-CleanInstall`)
2. 타입 검사 → `vite build` → 비밀값 검사(dist)
3. `npx cap sync android` (웹 파일을 `android/app/src/main/assets/public` 으로) → 다시 비밀값 검사
4. `gradlew assembleRelease` — 릴리스 서명 키로 서명(아래)
5. `release/SmartBartender-3.0.3.apk` 로 복사 → `apksigner verify`(서명 확인)·`aapt2 dump permissions`(권한 목록) 출력
6. APK 를 임시 폴더에 풀어서 비밀값 검사 → Gradle 데몬 종료(`gradlew --stop`)

옵션: `npm run build:android -- -SkipTypecheck` (다른 화면 작업 중 타입 오류가 있을 때 임시로), `-CleanInstall`, `-NewKeystore`(맨 처음 릴리스 때만 — 아래).
처음 한 번은 Gradle 이 라이브러리를 받느라 몇 분 걸리고, 그다음부터는 약 1~2분이에요.

**서명 키** — `android/keystore/release.keystore` + `keystore.properties`(무작위 비밀번호). 없으면 **빌드가 멈춰요**. 팀 드라이브 백업의 두 파일을 `app/android/keystore/` 에 넣으세요. 맨 처음 릴리스 때만 `npm run build:android -- -NewKeystore`(또는 `npm run keystore`)로 새로 만들어요. 두 파일 중 하나만 있으면 `-NewKeystore` 를 줘도 멈춰요(반쪽 키로 덮어쓰지 않게).

> ⚠️ **서명 키 백업 필수**: 두 파일은 커밋되지 않아요(`android/.gitignore` 의 `keystore/`). 처음 만든 직후 **팀 드라이브 등 안전한 곳에 두 파일을 함께 백업**하세요.
> 키를 잃어버리거나 다른 PC 에서 새 키로 만들면, 새 APK 를 기존 앱 위에 **업데이트 설치할 수 없어요**(지우고 다시 설치 → 앱에 저장된 재료·기록·AI 키도 사라짐).
> 다른 PC 에서 빌드할 때는 백업한 `keystore/` 폴더를 같은 자리(`app/android/keystore/`)에 넣고 빌드하세요. 비밀번호는 채팅·문서·저장소에 옮겨 적지 마세요.

**휴대폰에 설치**

1. APK 파일을 휴대폰으로 옮겨요(GitHub Releases 에서 바로 내려받기·USB·카카오톡 나에게 보내기·구글 드라이브 등).
2. 파일을 눌러 설치 → "출처를 알 수 없는 앱" 허용(그 앱—예: 내 파일·Chrome·카카오톡—에 대해서만) → 설치. Play 프로텍트 경고가 나오면 "무시하고 설치".
3. PC 에 USB 디버깅으로 연결돼 있으면 `adb install -r release/SmartBartender-3.0.3.apk` 도 돼요.
4. 처음 연결할 때 "근처 기기" 권한(안드로이드 12 이상), 안드로이드 11 이하는 위치 권한을 허용해 주세요. 첫 제조 때 알림 권한을 물어봐요. 홈 화면 날씨 자동 채우기는 "대략적 위치"만 허용해도 돼요.

**연결이 가끔 첫 시도에 실패하면** — 실제 갤럭시 S20 Ultra(안드로이드 13) ↔ ESP32 시험에서 연결 요청을 보내도 기기가 첫 연결 패킷을 놓쳐 0.3초 만에 실패(안드로이드 GATT 133, HCI 0x3E)하는 일이 있었어요(첫 시도 연결: 펌웨어 2.1.1 이중 모드 14번 중 7번, 2.1.2 BLE 전용 26번 중 22번 — 같은 펌웨어도 시험할 때마다 달라 휴대폰 쪽 무선 상황 영향이 큼). 그래서 3.0.3 부터 앱이 이 오류면 0.4초 쉬고 **4번까지 자동으로 다시 시도**해요(15초 시간 초과는 다시 시도하지 않음). 연결이 끊긴 뒤의 자동 재연결은 원래부터 계속 다시 시도해요.

**APK 안의 구성** — 앱 ID `kr.ac.anyang.hongdangmu.bartender`, 버전 3.0.3(versionCode 30003), 안드로이드 7.0(API 24) 이상, 대상 API 36.

| 권한 | 왜 |
|---|---|
| `BLUETOOTH_SCAN`(neverForLocation)·`BLUETOOTH_CONNECT` | 안드로이드 12+ 칵테일 메이커 검색·연결 ("근처 기기") — 검색 결과로 위치를 추정하지 않음 |
| `BLUETOOTH`·`BLUETOOTH_ADMIN`·`ACCESS_FINE_LOCATION` (모두 API 30 까지만) | 안드로이드 11 이하 BLE 검색(운영체제가 위치 권한을 요구) |
| `ACCESS_COARSE_LOCATION` (모든 버전) | 홈 화면 날씨 자동 채우기(대략적 위치, 누를 때만 물어봄). 블루투스와는 무관 |
| `POST_NOTIFICATIONS`·`VIBRATE` | 제조 완료·중단·연결 끊김 알림과 진동 |
| `INTERNET` | Gemini AI·날씨(Open-Meteo)·새 버전 확인과 내려받기(GitHub 릴리스, 4-7) |
| `REQUEST_INSTALL_PACKAGES` | 앱 업데이트 — 내려받은 새 APK 의 안드로이드 설치 창 띄우기(4-7). 처음 한 번 설정의 "이 출처 허용"을 켜야 하고, 설치는 늘 사용자가 "업데이트"(또는 "설치")를 눌러야 해요 |

`SCHEDULE_EXACT_ALARM` 은 받지 않아요(예비 완료 알림은 정확한 시각 알람 없이 예약 — 몇 초 늦을 수 있음). 백업 허용은 껐어요(`allowBackup=false` — 휴대폰 백업에 AI 키가 실리지 않게).

**APK 에서만 다른 것** (`src/platform/capacitor/`, `src/platform/transport/capacitor-ble.ts`)
- 블루투스: 네이티브 BLE(`@capacitor-community/bluetooth-le`) — 앱 안 "주변 기기 검색" 목록, 마지막 기기 **자동 재연결**, 블루투스를 껐다 켜면 다시 연결, MTU 를 크게 잡아 180바이트씩 전송.
- AI 키: 앱 전용 저장소(`@capacitor/preferences`), 알림: 안드로이드 알림 채널 "제조 알림"(`@capacitor/local-notifications`), 진동: `@capacitor/haptics`, 뒤로 버튼: `@capacitor/app`(1장 "뒤로가기").
- 네이티브 응답이 없을 때를 대비해 시간 제한이 있어요: 키 저장소·알림 호출 5초, 알림 띄우기 2.5초(넘으면 화면 토스트), 알림 권한 확인 3초.
- 시작 화면: 밝은 바탕 + 당근색 원 안의 마크, 상태 표시줄은 밝은 바탕에 어두운 아이콘.

### 3-4. PC용 EXE 만들기

**만들기** (앱 폴더에서):

```
npm run build:exe
```

스크립트(`scripts/build-exe.ps1`)가 하는 일:

1. 영문 경로로 복사 → `npm ci`(바뀌었을 때만) → 타입 검사 → `vite build` → 비밀값 검사
2. `scripts/build-exe.mjs` — 실행에 필요한 것만 모아(`dist/` + `electron/main.cjs`·`preload.cjs`·`updater.cjs`·아이콘, node_modules 없음) electron-builder 로 **portable x64** EXE 를 만듦
3. 묶음(`win-unpacked/resources/app.asar`)·dist 비밀값 검사
4. 자동 점검: 창을 띄우지 않고 앱을 실행해(`SmartBartender.exe --smoke-test`) 화면이 그려지는지, `navigator.bluetooth`·보안 컨텍스트·`window.sbElectron` 이 있는지 확인 후 종료 (`-SkipSmoke` 로 건너뛰기)
5. `release/SmartBartender-3.0.3-portable.exe` 로 복사

**사용** — 설치 없이 EXE 를 더블클릭하면 바로 열려요(처음엔 압축을 푸느라 몇 초 걸림). 설정·AI 키는 이 PC 의 `%APPDATA%\AI 스마트 바텐더` 에 저장돼요.
- **코드 서명이 없어서** 처음 실행 때 Windows SmartScreen 이 "Windows의 PC 보호" 를 띄울 수 있어요 → "추가 정보" → "실행".
- 블루투스: PC 에 블루투스(4.0 이상, BLE) 어댑터가 있어야 해요. "기기 선택"을 누르면 **앱 안의 기기 선택 창**에 주변 SmartBartender 가 나타나요(Electron 에는 브라우저 같은 선택 창이 없어서 앱이 직접 그림). 웹과 같이 연결할 때마다 골라야 해요. 선택 창은 "기기 선택"을 누르자마자 열려서 기기를 찾기 전에도 **취소**할 수 있고, 기기를 하나도 못 찾은 채 끝나면(PC 블루투스가 꺼져 있음·기기 전원 꺼짐·다른 휴대폰에 이미 연결됨) 그 안내를 띄워요(v3.0.1). 쓰는 중에 끊기면 자동으로 다시 연결하지만, 앱을 껐다 켜면 Electron 이 예전에 고른 기기를 기억하지 못해(navigator.bluetooth.getDevices 없음) 다시 골라야 해요.
- 창 1200×820(최소 380×640), 메뉴 막대 없음. 단축키: F5·Ctrl+R 새로고침, Ctrl+＋/－/0 확대·축소, F12 개발자 도구. 바깥 링크(예: Google AI Studio 키 발급)는 기본 브라우저로 열려요.
- 제조 알림은 Windows 알림 + 작업 표시줄 아이콘 깜빡임으로 알려 줘요.
- 보안: 배포 EXE 는 `--dev-url`·`SB_DEV_URL` 을 무시하고, 화면(html)에 CSP 를 붙여요(스크립트는 앱 파일만, 외부 연결은 Gemini·`api.open-meteo.com`·새 버전 확인용 `api.github.com` 만 — 새 EXE 파일은 화면이 아니라 메인 프로세스가 받음). 외부 연결 주소를 새로 쓰려면 `electron/main.cjs` 의 `connect-src` 에 추가하세요.

**개발 중 EXE 창으로 보기**: `npm run electron:dev` (개발 서버를 띄우고 Electron 창으로 엶, 창을 닫으면 서버도 꺼짐), `npm run electron:dev -- --dist` (빌드한 `dist/` 를 EXE 와 같은 방식으로 엶).

> 참고: APK·EXE 를 만든 뒤에는 `release/` 의 파일을 GitHub Releases 에 올려 공유하세요(깃에는 올리지 않음 — 3-5). 웹 폴더를 고친 뒤에는 APK·EXE 도 다시 만들어야 바뀐 화면이 들어가요. 문제가 생기면 `npm run build:android -- -CleanInstall` 처럼 의존성부터 새로 받아 보세요.

### 3-5. 공개 배포 — GitHub Pages(웹앱) · Releases(APK·EXE)

**웹앱 (자동)** — `.github/workflows/pages.yml`
- **처음 한 번만**: GitHub 저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions** 로 바꿔요.
  이걸 하지 않으면 첫 실행의 `actions/configure-pages` 단계가 "Get Pages site failed" 로 실패해요(기본 토큰으로는 Pages 를 켤 수 없음).
- 그다음 `main` 에 `app/**`(또는 `backend/lib/**`, 워크플로 파일) 변경을 push 하면 자동으로, 또는 **Actions → "Deploy web app to GitHub Pages" → Run workflow** 로 직접 실행해요.
- 워크플로: Node 22 → `npm ci` → `npm test` → `npm run build`(타입 검사 + 키 검사) → `dist/` 를 https://paperji.github.io/smart-bartender/ 에 배포. 빌드에는 API 키가 들어가지 않아요.
- `base: './'` + HashRouter(`#/…`)라 하위 경로·새로고침에서도 그대로 동작하고, 새 버전이 올라가면 서비스 워커가 자동으로 바꿔요(열려 있던 창은 기기 작업·AI 추천·실제 기기 연결이 없을 때 새로고침 한 번).

**APK·EXE (사람이 직접)**
1. 3-3·3-4 로 `release/SmartBartender-3.0.3.apk`, `release/SmartBartender-3.0.3-portable.exe` 를 만들어요(서명 키 백업 확인).
2. `node scripts/check-no-secrets.mjs release/SmartBartender-3.0.3.apk release/SmartBartender-3.0.3-portable.exe` 로 한 번 더 검사해요.
3. GitHub → **Releases → Draft a new release** → 태그 `v3.0.3` → 두 파일을 올리고 **Publish release**. 앱의 "APK·EXE 내려받기" 링크가 `releases/latest` 를 가리켜요.
   (GitHub CLI 를 쓰면 `gh release create v3.0.3 release/SmartBartender-3.0.3.apk release/SmartBartender-3.0.3-portable.exe --title "v3.0.3"`.)
4. 버전을 올릴 때는 `package.json` 의 `version`, `src/lib/appInfo.ts` 의 `APP_VERSION`, `android/app/build.gradle` 의 `versionCode`/`versionName` 을 함께 바꿔요(파일 이름도 바뀜).
5. **앱 업데이트(4-7)가 새 버전을 찾게 하려면** 릴리스가 이 규칙을 지켜야 해요:
   - 태그 `vX.Y.Z`(앱 버전과 같게), **초안·시험판(pre-release) 아님** — 앱은 `releases/latest` 만 봐요.
   - 파일 이름 그대로 `SmartBartender-X.Y.Z.apk`, `SmartBartender-X.Y.Z-portable.exe` (GitHub 가 파일마다 SHA-256 을 적어 줌 — 앱이 이것과 비교).
   - APK 는 **같은 서명 키**로(다르면 안드로이드가 덮어 설치를 거절), `versionCode` 는 늘 올려요.
   - 릴리스 설명에 `## 바뀐 점` 제목과 그 아래 `- ` 글머리표를 두면 처음 3줄이 추천 창에 보여요.

---

## 4. 사용 방법

### 4-1. 처음 켰을 때
- **데모 모드가 켜져 있고** 가상 기기 `SmartBartender-DEMO` 에 자동 연결돼요. 펌프 1~4 에는 무알콜 예시(사이다·오렌지주스·레몬즙·콜라)가 등록돼 있어요.
- 바텐더 탭 위에 "처음 오셨나요? AI 키를 등록하면 Gemini 가 레시피를 만들어요. 없어도 오프라인 추천으로 바로 쓸 수 있어요." 카드가 보여요. **AI 키 등록하러 가기** → 5장. 닫으면 다시 보이지 않아요.
- 실제 기기를 쓰려면 **기기 탭 → 데모 모드 끄기**, **재료 탭**에서 실제로 넣은 음료로 바꾸세요.

### 4-2. 기기 연결 · 기기 변경
1. 칵테일 메이커 전원을 켜요(상태 LED 가 천천히 깜빡이면 연결 대기 중). 휴대폰·PC 의 블루투스를 켜고 기기와 2m 이내에 두세요.
   휴대폰 **블루투스 설정 화면에서 "페어링"하지 마세요** — 앱에서 직접 연결해요.
2. **기기 탭 → "데모 모드 (가상 기기)" 끄기** → 실행 환경에 따라:
   - **안드로이드 APK**: **주변 기기 검색** → 목록에서 이름(`SmartBartender-A1B2` 형태)과 **신호 세기(강함/보통/약함)** 를 보고 눌러 연결. 기기가 여러 대면 신호가 강한 쪽이 가까운 기기예요.
     처음엔 "근처 기기"(안드로이드 11 이하는 위치) 권한을 허용해 주세요. 이름이 안 보이면 **모든 블루투스 기기 보기** 를 켜 보세요.
   - **웹·PWA (Chrome·Edge)**: **기기 선택 (브라우저 창)** → 브라우저가 띄운 창에서 `SmartBartender-…` 를 고르고 [페어링]. 연결할 때마다 이 창에서 골라야 해요(HTTPS 주소 또는 localhost 에서만 동작).
   - **Windows EXE**: **기기 선택** → 앱 안의 기기 선택 창에서 고르기.
3. 연결되면 상태 LED 가 **계속 켜짐**으로 바뀌고, 기기 탭에 펌웨어 버전·펌프 수·캘리브레이션 수와 기기 정보가 보여요.
4. 연결한 기기는 **기억해 두었다가 앱을 다시 켜면 자동 연결**하고, 연결이 끊기면 자동으로 다시 연결해요(설정의 "자동 재연결" — 1초부터 30초 간격까지 10번, 약 2분).
   웹은 브라우저가 예전에 허락한 기기 목록을 지원할 때만 다시 열 때 자동 연결되고, 아니면 다시 골라야 해요(기기 탭 "연결 방식"에 안내). EXE 는 앱을 다시 켜면 다시 골라요.
5. 다른 기기를 쓰려면 **다른 기기로 변경**(연결 해제 → 다시 검색·선택). 기억을 지우려면 "기억한 기기: … · **지우기**".
6. 안 보이면: ① 칵테일 메이커 전원(파란 LED 깜빡임) ② 2m 이내 ③ 다른 휴대폰·PC 에 이미 연결돼 있지 않은지 확인 → 다시 검색. 블루투스를 쓸 수 없는 환경이면 기기 탭에 이유와 **데모 모드 켜기** 버튼이 나와요.

### 4-3. 캘리브레이션(정확도 맞추기) — 처음 한 번 + 재료를 바꿀 때마다
기기 펌웨어는 측정 전(`calSet`=0) 펌프를 기본 유량 20ml/초로 계산하는데, 실제 유량은 체크밸브 때문에 약 3~6ml/초라 **레시피보다 적게** 나와요.
바텐더/기기 탭에 "캘리브레이션 전" 안내가 보이면:
1. 기기 탭 → **캘리브레이션 마법사** → 펌프 선택 → 용기에 액체를 넣고 **튜브 채우기(3초)**
2. 계량컵(또는 저울, 물 1g ≈ 1ml)을 노즐 아래에 → 시간 선택(10초 권장) → **구동 시작** (이상하면 **정지**)
3. 실제로 나온 양(ml)을 입력 → 유량 자동 계산 → **기기에 저장**(ESP32 플래시, 전원을 꺼도 유지)
4. 펌프에 재료가 등록돼 있으면 "잔량에서 뺄까요?"를 물어봐요. 실제 재료로 측정했으면 **잔량에서 빼기**, 물로 측정했으면 **아니요**.

### 4-4. 추천 → 제조 → 한 잔 더
1. 바텐더 탭에서 입력 → **AI 레시피 만들기** (키가 있으면 Gemini, 없으면 오프라인 추천. 레시피 화면 배지로 구분)
2. 마음에 안 들면 **다른 추천**(거절로 기록돼 같은 조합은 다시 안 나옴). 2번 연속이면 **새 재료 추천 받기** 안내가 떠요.
   ml 은 재료마다 ±5ml, **잔 용량 맞추기**로 총량을 다시 맞출 수 있어요(재료당 300ml·한 잔 500ml 한도).
3. **기기로 제조 시작** → 주류가 들어가면 처음 한 번 성인 확인 → 진행 화면. 이상하면 **비상 정지**(또는 기기의 정지 버튼).
   휴대폰을 내려놓아도 완료·중단 때 **알림 + 진동**이 와요. 웹은 제조 중 화면을 켜 둔 채로 두세요(앱이 화면 꺼짐을 막아 줘요).
   - 제조 중 블루투스가 끊겨도 기기는 정해진 양까지만 붓고 멈춰요. 앱은 자동으로 다시 연결하고, 다시 연결되면 기기가 알려 주는 "마지막으로 끝난 작업"(`status.last`, SPEC §2.4)으로 실제 결과를 확인해 기록·잔량을 고쳐요.
   - 다시 연결하지 못하면 "연결이 끊겨 결과를 확인하지 못했어요" 안내와 **기기 탭에서 다시 연결**·**제조 화면 닫기** 버튼이 나와요. 닫아도 앱이 그 제조를 기억했다가 나중에 결과가 오면 기록을 고쳐요(잔량은 처음에 뺀 양과의 **차이만** 더 빼요).
4. 완료 후 **좋아요/별로예요** → "한 잔 더 만들까요?" → [예, 같은 취향으로 한 잔 더] 새 레시피 / [아니요, 다른 걸 원해요] 새 재료 탐색.

### 4-5. 새 재료 탐색
1. 바텐더 탭 **새 재료 탐색** (또는 완료 화면의 "아니요, 다른 걸 원해요", 레시피 화면의 새 재료 카드)
2. 카드에서 강조된 재료 = 아직 없는 재료. **펌프 N에 장착하기** 를 누르면 비어 있는 펌프(없으면 기록상 가장 적게 쓰인 펌프)가 선택돼요.
3. 실제 용기를 바꿔 끼우고 **저장하고 추천받기** → 그 재료를 살린 레시피가 바로 나와요. (재료를 바꿨다면 프라이밍·캘리브레이션 권장)
4. 빈 기기처럼 새 재료가 **2개**인 카드(예: 탄산수 + 레몬즙)는 첫 재료를 저장하면 두 번째 재료 장착 화면이 이어서 열리고, 둘 다 장착한 뒤에 레시피를 추천해요.

### 4-6. 프라이밍 · 세척
- 프라이밍(튜브 채우기): 기기 탭에서 펌프 버튼을 **길게 누르고 있는 동안** 펌프가 돌아요(최대 20초). 나온 양은 재료 잔량에서 자동으로 빼요.
- 세척: 용기에 깨끗한 물 → 기기 탭 → 세척(펌프당 3/5/10초) → **세척 시작**. 끝나면 재료 탭에서 잔량을 다시 확인해 주세요(물로 세척하므로 자동 차감 안 함).
- 모든 펌프를 바로 멈추려면 기기 탭의 **모든 펌프 즉시 정지**.


### 4-7. 앱 업데이트 (APK·EXE — v3.0.3 부터)
- 앱을 켤 때(그리고 다시 앞으로 올 때, 6시간에 1번까지) GitHub Releases 의 최신 버전을 확인해서 지금보다 새 버전이면 **"새 버전이 나왔어요"** 창을 띄워요.
  설정 › 앱 정보의 **업데이트 확인**으로 언제든 직접 확인할 수 있어요(결과 "최신 버전이에요"·"이 기기용 파일이 아직 없어요"·"확인하지 못했어요"가 그 아래 보임).
- **제조·세척·구동 중에는 어떤 업데이트 창도 띄우지 않고**(비상 정지 버튼을 가리지 않게) 업데이트도 시작·설치하지 않아요. 끝나면 다시 보여요.
  다른 창(확인 창·성인 확인·기기 찾기 등)이 열려 있으면 업데이트 창은 그 창이 닫힌 뒤에 떠요(내려받기는 계속). 창이 겹쳐도 Esc·뒤로 버튼은 맨 위 창 하나만 닫아요.
- **업데이트** → 앱이 새 파일을 내려받고, 릴리스에 적힌 **SHA-256 과 같은지 확인**한 뒤에만 설치해요. 이 저장소(`paperji/smart-bartender`)의 릴리스 파일만, 지금보다 높은 버전만 받아요.
  내려받는 중에 창을 닫아도 계속 받고, 다 받으면 **"새 버전을 받아 두었어요 — 지금 설치"** 로 다시 물어봐요(그사이 제조를 시작했거나 다른 창이 열려 있으면 끝난 뒤에, 앱이 화면 뒤에 있었으면 돌아왔을 때).
  내려받기는 데이터가 한동안(APK 90초·EXE 60초) 오지 않으면 시간 초과로 멈추고 **다시 시도**할 수 있어요. 실패 안내는 원인별(파일 없음·저장 공간 부족·백신 등이 파일 사용 중·인터넷).
  - **안드로이드(APK)**: 안드로이드 설치 창에서 **"업데이트"(안드로이드 버전에 따라 "설치")를 눌러 주세요.** 안드로이드는 Play 스토어 밖 앱을 사용자 확인 없이 설치할 수 없어요.
    처음 한 번은 설정 화면에서 이 앱의 **"이 출처 허용"** 을 켜야 해요(갤럭시는 "출처를 알 수 없는 앱 설치" 목록이 열려요 — 목록에서 **AI 스마트 바텐더**를 눌러 켜요). 앱이 그 화면을 열어 주고, 켜고 돌아오면 바로 이어서 진행해요
    (그사이 안드로이드가 앱을 다시 켰어도 "설정 열기"를 누른 뒤 30분 안이면 고른 업데이트 정보로 인터넷 확인 없이 이어서. 창이 떠 있는데 이어지지 않으면 **"허용했어요, 계속"**).
    앱은 받은 APK 가 **이 앱(같은 패키지)의 더 높은 버전**인지 확인한 뒤에만 설치 창을 띄우고, 안드로이드는 **같은 서명 키**로 만든 파일만 덮어 설치해요. 기록·설정은 그대로예요.
  - **Windows(EXE)**: 새 EXE(`SmartBartender-X.Y.Z-portable.exe`)를 지금 EXE 와 같은 폴더(실제로 써 보고 안 되면 다운로드 폴더)에 받아 켜고, 새 EXE 가 실행된 뒤에 지금 창이 닫혀요. 기록·설정은 그대로예요.
    **바탕화면 바로 가기·시작 메뉴 고정은 예전 EXE 를 가리키니** 새 EXE 로 다시 만들어 주세요(예전 EXE 를 다시 열면 곧바로 새 버전을 다시 알려 줘요). 예전 EXE 파일은 지워도 돼요.
  - **웹·설치한 웹앱(PWA)**: 새 버전이 올라가면 다음에 열 때 자동으로 바뀌어요(제조 중이면 끝난 뒤).
- **나중에** = 하루 동안 다시 묻지 않음(받아 둔 파일은 남겨 둠), **이 버전 건너뛰기** = 그 버전은 자동으로 다시 묻지 않음(직접 확인하면 다시 보임).
- **3.0.2 이하**에는 이 기능이 없어서 3.0.3 은 한 번만 직접 받아 설치해야 해요(3-5). 그다음부터는 앱이 알려 줘요.
- 코드: `src/lib/update.ts`(확인·순서), `src/components/UpdatePrompt.tsx`(창), `src/platform/capacitor/updater.ts` + `android/.../AppUpdaterPlugin.java`(APK),
  `src/platform/electron/updater.ts` + `electron/updater.cjs`·`main.cjs`(EXE). 테스트 `tests/app-update.test.ts`.

---

## 5. AI 키 등록 (내 Gemini API 키 · BYOK)

AI 추천은 **내 Google 계정의 Gemini API 키**로 앱이 Gemini 를 직접 불러요. 팀 서버는 없어요. 키가 없어도 오프라인 추천으로 모든 기능을 쓸 수 있어요.

**키 받기 (무료)** — 설정 → "키 발급 방법" 에도 같은 안내가 있어요.
1. https://aistudio.google.com/apikey 를 열고 Google 계정으로 로그인
2. **Create API key** → 프로젝트를 고르라고 하면 기본 프로젝트를 고르거나 새로 만들기
3. 만들어진 키를 복사

**등록**
1. 앱 **설정**(휴대폰: 오른쪽 위 ⚙ / PC: 왼쪽 메뉴 아래 "설정") → **Gemini API 키** 칸에 붙여 넣기(👁 로 본인만 확인 가능)
2. **[키 확인]** — 무료 모델 목록 조회로 키와 선택한 모델을 확인해요(레시피를 만들지 않아 사용량을 거의 쓰지 않아요). 결과:

| 결과 | 뜻 · 할 일 |
|---|---|
| 성공 — 이 키로 AI 추천을 쓸 수 있어요 | **[저장]** (또는 결과의 **이 키 저장**) |
| 키는 정상이에요 — 모델을 바꿔 주세요 | 아래 **모델** 목록에서 다른 모델을 골라요 |
| 키가 올바르지 않아요 | 복사한 키 전체를 다시 붙여 넣기(빈칸·보이지 않는 문자·한글이 섞이면 안 됨) |
| 권한 없음 | 그 키의 프로젝트에서 Gemini API 를 쓸 수 없음 — 새 키 발급 |
| 사용량 한도·크레딧 소진 | 무료 등급은 분당·하루 한도가 있어요. 잠시 뒤 다시 하거나, 결제 연결 키라면 AI Studio 에서 결제 상태 확인 |
| 인터넷 연결 없음 | 인터넷 확인 후 다시. "Gemini 대신 다른 페이지가 응답했어요" 가 함께 나오면 와이파이 로그인 화면·회사/학교 네트워크 차단 확인 |
| 확인하지 못했어요 | Google 응답 형식이 달라요 — 잠시 뒤 다시 |

3. 저장하면 **마지막 4자리만** 보여요. 바꾸려면 새 키를 넣고 [저장], 지우려면 **삭제**. **AI 추천 방식**이 "Gemini(내 키)" 인지 확인하세요("오프라인" 이면 키가 있어도 쓰지 않아요).
4. **모델**: 기본 `gemini-3.6-flash`. [키 확인] 뒤에는 그 키로 쓸 수 있는 Gemini 텍스트 모델 목록에서 고를 수 있어요(직접 입력도 가능).

**키는 어디에 저장되고 어디로 가나요?**
- 저장: 웹·PWA 는 **그 브라우저**, EXE 는 그 PC 의 앱 저장소(`%APPDATA%\AI 스마트 바텐더`), APK 는 **앱 전용 저장소**(`@capacitor/preferences`, 휴대폰 백업 제외). 다른 기기·다른 브라우저로 옮겨지지 않아요.
- 전송: 레시피를 만들 때 **Google(Gemini)에만** `x-goog-api-key` 헤더로 보내요. 팀 서버나 다른 곳으로 보내지 않고, 화면·알림·로그에 키 값을 남기지 않아요(Google 오류 문구에 키가 들어 있어도 `••••` 로 가려요).
- 형식: 20자 이상, 빈칸 없음, 보이는 영문·숫자·기호만. 보이지 않는 문자나 한글이 섞이면 [키 확인]·[저장]을 막고, 이미 저장된 깨진 키는 요청을 보내지 않고 "키 오류"로 안내해요.
- 다른 탭·창에서 키를 저장·삭제하면 열려 있는 창에도 바로 반영돼요(웹·PWA·EXE).
- Gemini 로 가는 내용: 입력한 기분·맛·상황·요청, 장착한 재료 목록, 최근 제조 기록 요약(최대 10개). 오프라인 추천은 아무것도 보내지 않아요. 날씨를 불러올 때만 대략적인 위치가 날씨 서비스(Open-Meteo)로 가요.
- **공용 PC·전시용 기기**에서는 키를 입력하지 않거나, 쓴 뒤 꼭 **삭제**하세요. 설정 → **모든 데이터 초기화**도 저장된 키를 지워요.
- 비용: 무료 등급으로 충분해요(한도를 넘으면 그동안은 오프라인 추천). 결제를 연결한 키는 쓴 만큼 요금이 나갈 수 있어요.

**추천 중 실패하면** — 레시피 화면 위에 "AI 대신 오프라인 추천을 사용했어요" 와 이유(키 오류·사용량 한도·크레딧 없음·모델 없음·응답 지연·인터넷)가 나오고, 고칠 수 있는 이유면 **설정에서 키 확인** 버튼이 함께 나와요. Gemini 는 최대 25초까지 기다려요.

---

## 6. 폴더 구조

```
app/
├─ index.html · vite.config.ts(base './', PWA) · tsconfig.json · capacitor.config.ts · package.json
├─ src/
│  ├─ main.tsx · App.tsx(라우트·화면 틀·전역 창) · appTabs.ts(탭 4개) · app.css
│  ├─ screens/        화면 — home · recipe · brewing · explore · history · ingredients · device(기기·캘리브레이션) · settings
│  ├─ components/     레시피 비율 막대·맛 막대·탐색 카드·펌프 카드·캘리브레이션 배너 (README.md)
│  ├─ ui/             밝은 톤 UI 키트 + 디자인 토큰(theme.css), 확인창(dialog/), 모아 보기 `#/ui` (README.md)
│  ├─ lib/
│  │  ├─ ai/          recommend(요청 만들기·Gemini 호출·오프라인 대체) · gemini(키 확인·모델 목록) · prompt · normalize(SPEC §3.3)
│  │  │               · explore(§5.4) · offline · offline-explore(규칙기반) · preference(성향 제외) · alcohol · flavor · mode
│  │  ├─ transport/   types(Transport 인터페이스) · web-ble(Web Bluetooth) · demo · virtual-device(가상 기기 = 펌웨어 규칙)
│  │  ├─ device/      client.ts — 연결·자동 재연결·작업 상태·재연결 뒤 status.last 판정
│  │  └─ protocol.ts(SPEC §2 명령·검증) · brew.ts(제조 흐름·잔량·기록·알림) · flow.ts · nav.ts · presets.ts · types.ts · format.ts · appInfo.ts …
│  ├─ store/          zustand 스토어(저장 키 `sb3.*`) — settings · slots · history · draft · device · demoCal · adultGate · toast · aiBusy
│  └─ platform/       환경별 어댑터 — detect · storage · secrets(AI 키) · devKey · notify · haptics · weather · wakeLock · install(PWA) · swUpdate · appState · boot
│     ├─ capacitor/   APK 전용(plugins.ts 플러그인 불러오기 · backends.ts Preferences·LocalNotifications·Haptics 끼우기 · backButton.ts 뒤로 버튼)
│     ├─ electron/    EXE 앱 안 기기 선택 창(BlePickerHost)
│     └─ transport/   factory(통신 방식 고르기) · capacitor-ble(네이티브 BLE)
├─ electron/          main.cjs · preload.cjs · icons/   (EXE)
├─ android/           Capacitor 안드로이드 프로젝트 (keystore/ 는 커밋 안 함)
├─ public/            favicon.svg · icons/ · sw-notify.js(알림 누르면 앱 창으로)
├─ scripts/           build-android.ps1 · build-exe.ps1 · build-exe.mjs · lib-build.ps1 · check-no-secrets.mjs · make-keystore.mjs · gen-icons.mjs · electron-dev.mjs
└─ tests/             *.test.ts (node:test + tsx) · stubs/(화면 이동·확인창·알림·document 대역)
```

빌드 결과 `dist/`·`dev-dist/`·`release/`·`android/app/build/` 와 `.env*` 는 깃에 올리지 않아요(`.gitignore`).

---

## 7. 검증 명령

```bash
npm test             # 자동 테스트 (2026-11-07 기준 323개 통과) — 실제 Gemini·기기 호출 없음(가짜 fetch·가짜 BLE)
                     #  보정 규칙 1~9(normalize) · 탐색·오프라인 후보·거절 회피(explore·offline) · 성인 확인 전 제안·NO_MIXER(adult-nomixer)
                     #  · 백엔드 JS 와 결과 비교(parity: ../backend/lib 를 직접 불러옴) · 프로토콜·데모 기기 = 펌웨어 규칙(device)
                     #  · 연결 끊김·재연결 뒤 status.last 판정(device-client) · 제조 결과 처리(brew-effects) · 화면 계산(recipe·brewing·explore·history·ingredients)
                     #  · 내 키(BYOK) 저장·키 확인·Gemini 오류 분류·개발용 키가 배포물에 없음(v3-byok·ai-key-safety) · 웹 이식 서비스(v3-services)
                     #  · 화면 이동(nav-dismiss) · 화면 켜 두기(wakelock) · 저장값 검사·장착 후 재추천(flow-store-fixes)
                     #  · APK 플러그인·뒤로 버튼·키 저장 시간 제한(platform-capacitor) · 기기 문구·연결 오류(platform-device)
                     #  · 첫 제조 알림 권한(platform-brew-notify) · 백그라운드 예비 완료 알림(brew-reminder) · 서명 키·SW·EXE 보안(platform-packaging)
                     #  · UI 접근성·글자 대비(ui-fixes) · 화면 CSS 색·초점·App 배선(integrate) · 리뷰 회귀(fixes)
                     #  · 실제 ESP32 연결 시험 뒤 고친 것(ble-hardware-fixes): 결과 줄을 놓치면 status 로 확인(jobOverdue)·반쪽 줄 뒤 이벤트 살리기(parseEvent)
                     #    ·EXE 검색 취소·못 찾음/블루투스 꺼짐 안내(web-ble)·메인의 취소 예약(main.cjs)
                     #  · 앱 업데이트(app-update): 릴리스 검사·확인 간격·나중에/건너뛰기·제조 중 숨김·한 번만 내려받기·받아 둠·설치 허용 뒤 이어서
                     #    ·창 겹침·화면 뒤·시간 초과·태그 규칙·버전 세 곳 일치
                     #    ·EXE 메인(주소·버전 검사, SHA-256, 같은 파일 재사용·한 번만 받기, 권한 오류 시 다운로드 폴더, 파일 잠금 재시도, 실행 확인 뒤 종료)
npm run typecheck    # tsc --noEmit (0 오류)
npm run build        # 타입 검사 → dist/ → 키 검사
node scripts/check-no-secrets.mjs release/SmartBartender-3.0.3.apk release/SmartBartender-3.0.3-portable.exe   # APK·EXE 를 만든 뒤
node ../backend/test/local-test.js                                                                             # 기준 구현(백엔드) 테스트 68개
```

- APK 빌드는 마지막에 `apksigner verify`·권한 목록을, EXE 빌드는 창 없이 실행 점검(`--smoke-test`)을 보여 줘요(3-3·3-4).
- 수동 확인: `npm run dev` → 데모 모드로 추천 → 레시피 → 제조 → 좋아요 → 한 잔 더/탐색 → 장착 후 재추천 → 기록 → 다시 만들기까지 눌러 보기. 폭 360px(휴대폰)·768px·1280px(PC). 제조 화면 토스트가 아래 버튼을 가리지 않는지, Tab 키로 초점 테두리가 보이는지도.

---

## 8. 문제 해결

| 증상 | 해결 |
|---|---|
| `npm run dev`·`npm ci` 가 Node 버전 오류 | Node 22 이상 설치 (2장), 터미널 새로 열기 |
| 기기 탭에 "블루투스를 사용할 수 없어요" | 웹은 **Chrome·Edge** + **https 주소(또는 localhost)** 에서만 돼요. 아이폰·사파리는 안 돼요. PC 는 블루투스 어댑터가 켜져 있는지 확인. 안 되면 APK 를 쓰거나 **데모 모드 켜기** |
| 웹에서 "기기 선택" 창에 아무것도 안 보임 | 기기 전원(LED 천천히 깜빡임)·2m 이내·다른 폰에 연결돼 있지 않은지 확인, 데모 모드가 꺼져 있는지 확인 |
| APK 에서 검색해도 기기가 안 보임 | 앱 권한 "근처 기기"(안드로이드 11 이하는 위치) 허용, 휴대폰 블루투스 켜기, **모든 블루투스 기기 보기** 켜기 |
| 앱을 켰더니 "마지막 기기에 자동으로 연결하지 못했어요" | 기기 전원을 켜고 기기 탭에서 다시 검색 → 연결 |
| 웹·EXE 를 다시 열 때마다 기기를 골라야 함 | 정상이에요(브라우저·Electron 제약). APK 는 자동 연결 |
| 연결 직후 "기기 정보(info)를 받지 못했어요" | ESP32 에 v2 이상(BLE) 펌웨어가 올라가 있는지 확인 (`../firmware/README.md`) |
| "기기 안전장치가 작동했어요" | 펌프가 너무 오래 켜짐 → 튜브 막힘·꺾임, 용기가 비었는지 확인 후 다시 |
| 양이 레시피보다 적게 나옴 | 캘리브레이션(4-3), 튜브에 공기가 없는지(프라이밍) 확인 |
| 늘 "오프라인 추천" 배지 | 설정 → **AI 추천 방식**이 "Gemini(내 키)" 인지, 키가 저장돼 있는지 → **[키 확인]** 결과대로(5장 표). 레시피 화면 위 안내에 이유가 나와요 |
| "사용량 한도·크레딧 소진" | 무료 등급 한도 — 잠시 뒤 다시. 그동안은 오프라인 추천으로 이어서 만들어요 |
| 알림이 안 옴 | APK: 첫 제조 때 알림 권한 허용(갤럭시: 설정 > 애플리케이션 > AI 스마트 바텐더 > 알림). 웹: 사이트 알림 허용(진행 화면의 "완료 알림을 켤까요?" 버튼) |
| APK 설치 때 "앱이 설치되지 않았습니다" | 이미 설치된 앱과 서명 키가 달라요(다른 PC·새 키로 빌드). 예전 앱을 지우고 설치하거나, 백업한 키로 다시 빌드(3-3) |
| EXE 실행 때 "Windows의 PC 보호" | 코드 서명이 없어서예요 → "추가 정보" → "실행" |
| 설치한 웹앱(PWA)에 예전 화면이 보임 | 새 버전은 자동으로 받아요(제조·AI 추천·실제 기기 연결 중에는 끝날 때까지 미룸). 앱을 한 번 닫았다 열거나 새로고침 |
| "화면을 여는 중 문제가 생겼어요" 카드 | [다시 시도] → 그래도 같으면 [입력 초기화 후 다시 열기](홈 입력값만 지움, 재료·기록·설정은 그대로) |
| `build:android` 가 "Release signing key not found"(또는 "…is incomplete") 로 멈춤 | 팀 드라이브 백업의 `keystore/` 두 파일을 `app/android/keystore/` 에 넣기. 맨 처음이면 `-NewKeystore` (3-3) |
| `npm run build:android` 실패 | 3-1 도구 확인(`sb-tools`), `npm run build:android -- -CleanInstall`. 한글 경로 문제는 스크립트가 영문 경로로 복사해서 피해요 |
| GitHub Actions 배포가 "Get Pages site failed" | 저장소 Settings → Pages → Source 를 **GitHub Actions** 로 (3-5) |

---

## 9. 프로토콜 요약 (SPEC §2, v2.1 — v3.0 앱도 그대로)
- BLE Nordic UART: Service `6E400001-…`, RX(앱→기기) `6E400002-…`, TX(기기→앱, Notify) `6E400003-…`. 기기 이름 `SmartBartender-XXXX`.
- 메시지 = UTF-8 JSON 한 줄 + `\n`. 앱은 180바이트씩 나눠 쓰고, 받은 조각은 `\n` 까지 모아서 해석. 연결 직후 TX 알림 구독 → `hello`.
- 명령: `hello` `status` `ping` `make` `stop` `run` `clean` `setcal` `getcal`
- 이벤트: `info`(`calSet`, `maxPumpMs`) `status`(`last` = 부팅 후 마지막으로 끝난 작업 `{id, kind, result:"done"|"stopped", reason, dispensed}`, 없으면 `null`) `ack` `progress` `step` `done` `stopped`(reason `user`/`button`/`error`) `cal` `pong` `error`
- `make` 검증 순서: ① mode 이상 → `BAD_JSON`, steps 없음 → `BAD_AMOUNT`, 9개 이상 → `LIMIT` ② 각 재료: 펌프 번호 → `BAD_PUMP`, ml ≤ 0 → `BAD_AMOUNT`, 300 초과 → `LIMIT` ③ 같은 펌프 합산 후 300ml·총 500ml·펌프당 120초 → `LIMIT`
- 예전 v2.0 펌웨어(`calSet`/`maxPumpMs`/`status.last` 없음)와도 동작해요 — 이 값들은 "알 수 없음"으로 표시하고 60초 한도로 계산.
- nRF Connect·Serial Bluetooth Terminal 같은 무료 앱으로 `{"cmd":"hello"}` 를 보내 펌웨어만 따로 시험할 수도 있어요(`../firmware/README.md` 5장).
