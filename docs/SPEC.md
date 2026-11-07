# AI 스마트 바텐더 v3.0 — 시스템 설계 명세 (Single Source of Truth)

> 팀 홍당무 · 안양대학교 정보전기전자공학과 캡스톤디자인 Ⅱ (2026/2학기)
> 과제명: 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커
>
> 이 문서는 앱 · 펌웨어 · 백엔드 · 회로도 · 조립 가이드가 **반드시 일치해야 하는 계약(contract)** 입니다.
> 값을 바꾸려면 이 문서를 먼저 고치고, 모든 산출물을 함께 수정합니다.

---

## 0. 전체 구조

```
[앱 v3.0 — 한 소스(Vite + React + TypeScript): 웹(Chrome·Edge) · PWA · 안드로이드 APK(Capacitor) · Windows EXE(Electron)]
   │  ① 기분·맛·성향·날씨·상황 입력  + 기기에 장착된 재료(펌프 1~4) 정보 → §3.1 요청 객체를 앱 안에서 만듦
   │  ② HTTPS POST generateContent ──►  Google Gemini API (generativelanguage.googleapis.com)
   │  ③ 레시피 JSON  ◄──────────────   키 = 사용자 본인 Gemini API 키(BYOK). 그 기기에만 저장, 헤더 x-goog-api-key 로 Google 에만 보냄
   │     앱이 §3.3 규칙으로 검증·보정. 키가 없거나 실패하면 앱 내장 규칙기반(오프라인) 추천으로 자동 대체
   │
   │  ④ BLE(블루투스 저전력) — Nordic UART Service, 줄바꿈 구분 JSON
   ▼
[ESP32 DevKitC (Arduino IDE 펌웨어)] ──GPIO──► [4채널 릴레이] ──5V──► [수중 펌프 ×4] ──튜브/체크밸브──► 노즐 ──► 잔

[backend/ (Node, v2.1 서버)] = §3·§5.4 의 기준 구현(reference implementation). 앱은 호출하지 않으며 배포하지 않음.
   앱의 자동 테스트(app/tests/parity.test.ts)가 backend/lib 를 직접 불러와 같은 입력에 같은 결과가 나오는지 비교.
```

- 통신 방식: **Wi-Fi(HTTP) → BLE(블루투스)** 로 변경. 공유기/핫스팟·IP 주소가 필요 없고 전시장에서도 바로 연결됨.
- 펌프 단독 시간 제어 방식(솔레노이드 밸브 제외) 유지. 펌프별 유량(ml/s)을 캘리브레이션하여 ESP32 NVS(플래시)에 저장.
- **AI 키(v3.0)**: 팀이 운영하는 AI 서버는 없음. 사용자가 앱 설정에서 본인 Gemini API 키를 등록(§4-7)하고, 앱이 Gemini REST 를 직접 호출. 배포물(웹 dist·APK·EXE)에는 어떤 키도 넣지 않음(빌드가 `check-no-secrets` 로 검사).
- 앱 플랫폼·화면·디자인의 세부 기준은 `docs/WEBAPP_DESIGN.md`. 이 문서(SPEC)는 기기 통신(§1·§2)과 AI 요청·보정 규칙(§3·§5)의 계약.

---

## 1. 하드웨어 핀맵 (모든 문서·코드 동일)

| 기능 | ESP32 핀 | 연결 대상 | 비고 |
|---|---|---|---|
| 펌프 1 | **GPIO 26** | 릴레이 IN1 | 기존 설계 유지 |
| 펌프 2 | **GPIO 27** | 릴레이 IN2 | 기존 설계 유지 |
| 펌프 3 | **GPIO 32** | 릴레이 IN3 | 기존 설계 유지 |
| 펌프 4 | **GPIO 33** | 릴레이 IN4 | 기존 설계 유지 |
| (확장) 펌프 5~8 | GPIO 25, 13, 18, 19 | 2번째 릴레이 모듈 IN1~4 | 선택. 펌웨어 `PUMP_COUNT` 로 활성화 |
| 시작/정지 버튼 (선택) | **GPIO 4** | 버튼 → GND | `INPUT_PULLUP`, 눌림=LOW. 제조 중 누르면 비상정지 |
| 상태 LED | **GPIO 2** | **외부 LED + 220Ω 필수** (DevKitC V4에는 GPIO2 사용자 LED가 없음) | 대기=천천히 깜빡, 연결됨=켜짐, 제조중=빠르게 깜빡 |
| 부저 (선택) | **GPIO 23** | 능동 부저 모듈 ONE005 I/O | **HIGH = 울림** (`BUZZER_ON_LEVEL 1`). 완료 시 삐-삐 |
| 릴레이 로직 전원 | **3V3** (TB3 3V3 버스) | 릴레이 모듈 입력측 VCC | **A안(기본): JD-VCC 점퍼 제거** (3.3V 로직 확실한 OFF) |
| 릴레이 코일 전원 | 5V 레일 (TB1) | 릴레이 모듈 JD-VCC | A안: TB1 → JD-VCC 핀(⑨). B안: ⑨를 입력 헤더 VCC 핀으로 옮기고 점퍼 캡(2핀 점퍼라 JD-VCC 핀에는 캡만) |
| ESP32 전원 | 5V 레일 → **5V(VIN) 핀** | | USB 업로드 시에는 5V 선을 분리(이중 전원 금지) |
| 공통 GND | GND (TB2 GND 버스) | 어댑터 GND, 릴레이 GND, 펌프(−) | 모든 GND 공통 (아래 접지 방식) |

- 릴레이는 **LOW 신호 = ON (Active-LOW)**. 부팅 시 오작동 방지를 위해 **출력 레지스터를 먼저 HIGH로 설정(`gpio_set_level`) → `pinMode(OUTPUT)` → `digitalWrite(HIGH)`** 순서로 초기화 (코어 3.x는 pinMode 전 digitalWrite를 무시함).
- **릴레이 연결 B안(공식 대체안)**: A안에서 3.3V로 릴레이가 켜지지 않으면(입력 LED 직렬 구조라 입력전류 약 0.3~0.7mA로 추정) **USB·어댑터를 모두 분리한 상태에서** ① 입력 헤더 VCC ← 3V3 선(⑪)을 **먼저** 뽑음 → ② 5V 선(⑨)을 JD-VCC 핀에서 빼서 입력 헤더 VCC 핀(⑪ 자리)에 꽂음 → ③ 점퍼 캡을 끼움(VCC = JD-VCC = 5V, JD-VCC 핀에는 캡만). IN은 그대로 GPIO 직결. **B안에서는 릴레이 VCC를 절대 3V3에 연결하지 않음**(⑪과 점퍼가 한순간이라도 함께 연결되면 5V가 ESP32 3V3로 역류). 두 안 모두 Active-LOW라 펌웨어는 동일. 조립 STEP의 벤치 테스트로 결정.
- 릴레이 단자 순서(NO/COM/NC)는 조립 전 **멀티미터로 확인**(COM–NC 도통 삐, COM–NO 무음).
- 각 펌프에 **1N4007 역기전력(플라이백) 다이오드** 병렬 연결: 띠(캐소드) → 펌프(+), 반대쪽(애노드) → 펌프(−). 위치는 펌프 리드선 이음부 또는 연장선의 박스 쪽 끝(전기적으로 동일).
- 5V 레일에 **1000µF 16V 전해 커패시터** (펌프 기동 시 전압강하로 인한 ESP32 리셋 방지).
- 전원: 5V 4A 어댑터(보유) → **SW1 로커 스위치 → F1 3A 퓨즈** → TB1(+5V 버스, 레버 커넥터 PCT-418). TB2 = GND 버스, TB3 = 3V3 분배. 펌프는 기본 **순차 구동**(정확도·전압 안정), 선택적으로 병렬 구동(0.1초 간격 기동).
- 접지 방식(별형): 어댑터(−) 나사에서 ⑤ → TB2(펌프 측), ⑦ → ESP32 GND로 따로 분기. 릴레이 GND → ESP32 GND(⑯). 이 릴레이 보드는 코일 GND 핀이 따로 없어 코일 전류는 릴레이 GND → ESP32 GND → ⑦ → 어댑터(−)로 돌아옴. 전기적으로는 모두 공통 GND.
- 액체 경로: 용기(펌프 잠김, **뚜껑에 Ø3 공기 구멍**) → 펌프 출수구(외경 7.5/내경 4.9) → **내경5/외경7 실리콘 튜브** → (내경4 튜브 3cm 슬리브로 이음) → **체크밸브**(노즐 바로 앞, 화살표가 노즐 쪽) → 노즐. **노즐 출구는 모든 용기의 최대 액면보다 높게** 설치(사이펀 현상 방지).
- 예상 유량: 체크밸브 포함 약 **3~6 ml/s**(추정, 캘리브레이션 필수). 기본값 20 ml/s는 실제보다 커서 **덜 나오는 쪽(안전)** 이므로 유지하고, 앱이 "캘리브레이션 전" 안내를 띄움. 캘리브레이션은 용기를 반쯤 채운 상태에서.

---

## 2. BLE 통신 프로토콜

### 2.1 GATT
- 장치 이름(광고): `SmartBartender` (펌웨어에서 MAC 하위 2바이트를 붙여 `SmartBartender-A1B2` 형태로 광고)
- Service: **Nordic UART Service (NUS)** `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
  - RX (앱 → 기기, Write / Write Without Response): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
  - TX (기기 → 앱, Notify): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`
- NUS를 쓰는 이유: 'nRF Connect', 'Serial Bluetooth Terminal' 같은 무료 앱으로도 JSON을 직접 보내 테스트 가능.
- 광고 패킷에 NUS 서비스 UUID, 스캔 응답에 이름(`SmartBartender-` 접두어). 앱은 **이름 접두어 또는 NUS UUID** 로 기기를 거름.
- 앱은 연결 직후 **TX 알림 구독을 먼저** 하고 그다음 `hello`를 보냄. 구독 전 이벤트는 BLE로 보내지 않고 버림(USB 시리얼에는 항상 출력).

### 2.2 프레이밍
- 모든 메시지는 **UTF-8 JSON 한 줄 + `\n`** (줄바꿈으로 메시지 구분).
- BLE 패킷(MTU) 크기에 따라 나뉘어 도착할 수 있으므로 **양쪽 모두 `\n`이 나올 때까지 버퍼에 누적** 후 파싱.
- 앱은 쓰기를 최대 **180바이트 단위**로 분할 전송(안드로이드는 연결 직후 MTU 247 요청; 웹은 자동 협상). 기기 → 앱 알림도 (MTU−3) 단위로 분할.
- 블루투스 혼잡으로 알림이 계속 실패하면 기기는 30→60→120→240ms 로 쉬며 4초까지 다시 보내고, 그래도 안 되면 **맨 앞 줄 하나만** 포기함. 그 줄의 앞부분이 이미 나갔다면 다음 전송 맨 앞에 `\n` 을 붙여 받는 쪽의 반쪽 줄을 끝냄(펌웨어 v2.1.1, `firmware/README.md` 7-8). 받는 쪽은 JSON 이 아닌 줄을 버림(앱은 예전 펌웨어를 위해 줄 안의 마지막 `{"ev":` 부터 다시 읽어 봄).
- 기기의 수신 버퍼 최대 1024바이트. 초과 시 버퍼 폐기 후 `error/TOO_LONG` 1회(다음 `\n`까지 무시 후 정상 복귀).
- 편의 기능: `{`로 시작한 객체의 괄호가 모두 닫히면 `\n` 없이도 한 메시지로 처리(nRF Connect 수동 테스트용). `\n` 방식과 충돌 없음.
- USB 시리얼(115200)로도 같은 JSON 명령을 받고 같은 이벤트를 출력.
- 펌프 번호는 **1부터 시작** (pump 1 = 릴레이 CH1 = GPIO26).

### 2.3 명령 (앱 → 기기)

| cmd | 예시 | 설명 |
|---|---|---|
| `hello` | `{"cmd":"hello"}` | 연결 직후 1회. 기기 정보(`info`) 응답 |
| `status` | `{"cmd":"status"}` | 현재 상태(`status`) 응답 |
| `ping` | `{"cmd":"ping"}` | `{"ev":"pong"}` 응답 (연결 확인) |
| `make` | `{"cmd":"make","id":"r1730000000","mode":"seq","steps":[{"p":1,"ml":45},{"p":3,"ml":30.5}]}` | 레시피 제조. `mode`: `"seq"`(기본, 순차) / `"par"`(동시) |
| `stop` | `{"cmd":"stop"}` | 즉시 모든 펌프 정지 (비상정지) |
| `run` | `{"cmd":"run","p":2,"ms":10000}` | 지정 펌프를 지정 시간 구동 (캘리브레이션 측정·프라이밍용). 최대 60000ms |
| `clean` | `{"cmd":"clean","ms":5000}` | 모든 펌프를 차례로 ms 동안 구동(세척/물 빼기). 0 < ms ≤ 30000 |
| `setcal` | `{"cmd":"setcal","p":2,"mlps":18.5}` | 펌프 유량(ml/초) 저장(NVS). 허용 0.5~100 |
| `getcal` | `{"cmd":"getcal"}` | `cal` 이벤트로 모든 펌프 유량 응답 |

- `make` 검증 규칙(펌웨어·앱·데모 기기 동일, 위에서부터 차례로 검사):
  1. `mode`가 `"seq"`/`"par"`/생략(`null` 포함) 외의 값 → `BAD_JSON`. `steps` 누락·빈 배열 → `BAD_AMOUNT`. steps 9개 이상 → `LIMIT`.
  2. 각 step: `p`가 정수 1..PUMP_COUNT가 아니면 `BAD_PUMP`. `ml`이 숫자가 아니거나 ≤ 0 → `BAD_AMOUNT`, ml > 300 → `LIMIT`.
  3. 같은 펌프가 여러 번 나오면 합산. **합산 후 펌프별 ≤ 300ml**, 총합 ≤ 500ml, **한 펌프 구동시간 ≤ 120초**(v2.1에서 60→120초: 체크밸브 유량 3~6ml/s 고려). 위반 → `LIMIT`.
  - 위반 시 `error` 응답 후 실행 안 함. `id`는 최대 40바이트(UTF-8 글자 경계 유지)로 자르고, 없거나 빈 문자열이면 `"make"`. 제어문자(U+0001~U+001F, 탭·줄바꿈 포함)는 `?`로 바꾸고(1바이트→1바이트, 이벤트 JSON이 깨지지 않게), U+0000이 있으면 그 앞까지만 씀(펌웨어 C 문자열과 같게 — 앱 가상 기기 `normalizeJobId`도 동일).
  - ml 비교 전 0.0001ml 단위로 정리(부동소수 오차로 150.1+149.9가 300 초과로 판정되지 않게).
- `run`: 검사 순서 p(정수 1..PUMP_COUNT 아니면 `BAD_PUMP`) → ms(숫자가 아니거나 ≤ 0 → `BAD_AMOUNT`, > 60000 → `LIMIT`). `clean`: ms ≤ 0 또는 비숫자 → `BAD_AMOUNT`, > 30000 → `LIMIT`.
- 실행 중(`running`)에 `make`/`run`/`clean` 이 오면 `error/BUSY` (진행 중 작업은 계속).
- 대기 중 `stop` → `status`(idle) 응답. `setcal` → `cal` 이벤트로 응답(제조 중이면 NVS 저장은 작업 종료 후).
- 구동시간(ms) = ml / mlps × 1000 (펌웨어가 계산). 순차 모드에서는 펌프 사이에 300ms 휴지. 병렬 모드는 펌프를 **0.1초 간격**(`PAR_STAGGER_MS`)으로 차례로 켬(돌입전류 분산), 각 펌프 구동시간은 동일.
- 안전 감시: 어떤 펌프든 (최대 구동시간 + 1초) 이상 켜져 있으면 전체 정지 후 `stopped`(reason `"error"`) + `error/LIMIT`.

### 2.4 이벤트 (기기 → 앱)

| ev | 예시 | 설명 |
|---|---|---|
| `info` | `{"ev":"info","fw":"2.1.2","name":"SmartBartender-A1B2","pumps":4,"cal":[20,20,20,20],"calSet":[0,1,0,0],"maxMl":500,"maxStepMl":300,"maxPumpMs":120000,"state":"idle"}` | hello 응답. `calSet`: 펌프별 캘리브레이션 저장 여부(1=NVS 저장값, 0=기본값) |
| `status` | `{"ev":"status","state":"idle","job":null,"last":{"id":"r1","kind":"make","result":"done","dispensed":[{"p":1,"ml":45}]}}` / `{"ev":"status","state":"running","job":{"id":"r1","kind":"make","pct":42},"last":null}` | state: `idle` \| `running`. `last` = 부팅 후 **마지막으로 끝난 작업**(없으면 `null`). `result`: `done` \| `stopped`, stopped면 `reason` 포함. `dispensed`는 그 작업의 done/stopped 이벤트와 같은 값 |
| `ack` | `{"ev":"ack","id":"r1","kind":"make","totalMs":5250}` | 명령 수락, 예상 소요시간 |
| `progress` | `{"ev":"progress","id":"r1","p":1,"ml":45,"doneMl":22.4,"pct":31}` | 약 250ms 간격. `pct`=Σ나온 양/Σ목표량(완료 전 최대 99), `doneMl`=현재 펌프 누적. 병렬 모드는 켜진 펌프를 돌아가며 1개씩 |
| `step` | `{"ev":"step","id":"r1","p":1,"ml":45}` | 한 펌프 완료 |
| `done` | `{"ev":"done","id":"r1","kind":"make","ms":5310,"dispensed":[{"p":1,"ml":45},{"p":3,"ml":30.5}]}` | 전체 완료. dispensed = 목표량 |
| `stopped` | `{"ev":"stopped","id":"r1","reason":"user"\|"button"\|"error","dispensed":[{"p":1,"ml":12.3}]}` | 중단됨. dispensed = 구동시간 비율로 추정한 양(0ml 펌프 생략) |
| `cal` | `{"ev":"cal","cal":[20,18.5,20,20],"calSet":[0,1,0,0]}` | 유량표(ml/s), 펌프 순서. getcal·setcal 응답 |
| `pong` | `{"ev":"pong","up":123456}` | up = 기동 후 ms |
| `error` | `{"ev":"error","code":"BUSY","msg":"이미 제조 중입니다"}` | code: `BAD_JSON`, `UNKNOWN_CMD`, `BAD_PUMP`, `BAD_AMOUNT`, `LIMIT`, `BUSY`, `TOO_LONG` |

- `run`/`clean` 의 id 는 각각 `"run"`, `"clean"` 이며 kind 도 동일. 같은 `ack/progress/done/stopped` 이벤트를 사용.
- BLE 연결이 끊겨도 진행 중인 작업은 끝까지 수행(정해진 양만큼만 나오므로 안전). 재연결 후 `status`로 확인. 물리 버튼으로 언제든 정지 가능.
- 물리 버튼: 제조 중 누르면 비상정지(`stopped`, reason `button`), **대기 중 짧게 누르면 `status` 이벤트**(시리얼·BLE 모두, 앱 가상 기기도 동일). 길게(1.5초) 눌러 마지막 레시피 다시 만들기는 `BUTTON_REPEAT_LAST=1` 빌드에서만(기본 0). 이때 작업 id는 매번 새로 만든 `btn`+부팅 후 ms(예 `btn103500`)로, 앱이 보낸 원래 id와 다름 → 앱은 모르는 작업으로 받아 기록함(레시피 이름은 앱이 알 수 없어 지금 화면의 레시피로 기록될 수 있음 — 데모·기본 빌드에서는 쓰지 않음).
- 앱의 재연결 후 판정: `state=running`이고 `job.id`가 같으면 진행 화면 복귀 → `idle`이고 `last.id`가 같으면 `last`의 결과(완료/중단·양)를 그대로 기록·잔량 차감 → `last`가 없거나 id가 다르고 `pong.up`이 작업 시작 후 경과시간보다 짧으면 "재부팅으로 중단(양 모름)" → 그 밖은 "결과 확인 필요".
- **연결된 채로 결과를 놓친 경우**(앱 v3.0.1): 아래 중 하나면 앱이 `{"cmd":"status"}` 를 보내(ping 주기 5초마다) 위와 같은 판정(`last`)으로 확정 — ① 끝날 시각(`ack` 받은 시각 + `totalMs`)이 3초 지남 ② 앱이 `stop` 을 보낸 지 1.5초가 지나도 `stopped` 없음 ③ 진행 중인데 기기 줄(`ack`·`progress`·`step`·`status running`)이 3초 넘게 없음(물리 버튼 정지 뒤 `stopped` 를 놓친 경우 등) ④ ack 를 못 받은 작업(계속), ack 없이 `status running` 으로 되살린 작업(확인 뒤 3초부터 계속). 결과가 오면 묻지 않음. `run`/`clean` 은 id 가 늘 같아 ack 를 받았거나 기기가 그 작업을 하는 것을 본(`status running`·`progress`) 경우에만 `last` 를 그 작업의 결과로 씀.

---

## 3. AI 레시피 요청·응답·보정 (앱 ↔ Gemini, 기준 구현 = 백엔드)

> **v3.0 참고**: 앱은 서버를 거치지 않습니다. 앱은 아래 §3.1 요청 객체를 **앱 안에서** 만들어 Gemini 프롬프트·응답 스키마(`responseJsonSchema`, JSON 모드)의 입력으로 쓰고,
> Gemini 응답(`{recipe, explore}`)을 §3.2 모양으로 정리한 뒤 §3.3·§5.4 규칙으로 검증·보정합니다(앱 `src/lib/ai/recommend.ts`·`normalize.ts`·`explore.ts`).
> 호출: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, 헤더 `x-goog-api-key: <사용자 키>`, 기본 모델 `gemini-3.6-flash`, 시간 한도 25초.
> 키가 없거나(앱 안 `NO_API_KEY` 와 같은 뜻) Gemini 가 실패하면 §3.2 `warningCode` 와 같은 분류로 안내하고 앱 내장 규칙기반(오프라인) 추천으로 대체합니다.
> 아래의 `POST {AI_SERVER}/api`·서버 시간 한도·HTTP 상태 코드는 기준 구현(`backend/`, v2.1 서버)의 동작이며, 앱과 백엔드의 보정 결과는 `app/tests/parity.test.ts` 가 같음을 확인합니다.

### 3.1 요청: `POST {AI_SERVER}/api` (Content-Type: application/json) — v3.0 앱에서는 같은 객체를 앱 안에서 사용
```json
{
  "version": 2,
  "user": {
    "moods": ["피곤함", "설렘"],
    "taste": { "sweet": 3, "sour": 2, "bitter": 1, "fizzy": 4 },
    "strength": "none | light | medium | strong",
    "weather": { "condition": "맑음", "tempC": 18.5, "humidity": 60 },
    "situation": "혼술 | 파티 | 데이트 | 휴식 | 운동 후 | 공부/작업 | ... (자유)",
    "preference": "자유 텍스트 (성향, 좋아하는 맛, 알레르기 등)",
    "cupMl": 200,
    "adultVerified": false
  },
  "ingredients": [
    { "pump": 1, "name": "보드카", "category": "spirit", "abv": 40, "remainingMl": 650, "notes": "" },
    { "pump": 2, "name": "오렌지주스", "category": "juice", "abv": 0, "remainingMl": 900, "notes": "" }
  ],
  "history": [ { "name": "선셋 피즈", "liked": true, "rejected": false, "ingredients": [{ "name": "오렌지주스", "ml": 120 }] } ],
  "mode": "normal | explore"
}
```
- `user` 생략 가능. `user.strength` 생략 시 `none`. `cupMl` 범위(30~500) 밖 → 400. `history`는 **최신 기록부터** 최대 10개(서버는 앞에서 10개 사용). `mode` 생략 시 `normal`, 그 외 값 → 400.
- `user.adultVerified`(선택, boolean, 생략 시 `false`): 앱에서 만 19세 이상 확인을 마쳤는지. `false`면 탐색(explore) 제안(§5.4)과 레시피 `suggestions`(§3.2)에서 **술(abv>0) 장착 제안을 하지 않음**. 실제 주류 제조는 앱이 제조 직전에 따로 확인.
- normal 모드에서 `ingredients`가 빈 배열 → 400, 재료는 있으나 쓸 수 있는 재료가 없음(무알콜 요청에 술만, 잔량 0, 성향으로 모두 제외, **도수 상한을 맞출 무알콜 재료가 없음**(규칙 8) 등) → 422. explore 모드는 모두 200(§5.4). 서버는 이 경우를 AI 호출 전에 판정(AI 호출 생략).
- 시간 한도: **v3.0 앱이 Gemini를 직접 부를 때 25초**(넘으면 오프라인 추천). 기준 구현(서버)의 Gemini 호출은 1회 14초, 재시도 포함 전체 20초이고, v2.1 앱은 서버 응답을 **50초**까지 기다렸음(서버 전체 한도 + 네트워크·콜드스타트 여유 < 앱 대기 — 서버를 다시 쓸 때만 해당).
- **재료 이름 비교(모든 곳 공통 `normName`)**: 소문자화 후 공백과 기호 `_ - · . , ( ) [ ] ' "` 제거. 규칙 1 매칭, explore의 installed/pump 판정, fallback 후보 제외, 거절 조합 비교 모두 이 함수 사용.
- `category`: `spirit`(증류주) · `liqueur`(리큐르) · `wine`(와인/맥주 등 발효주) · `syrup`(시럽) · `juice`(주스) · `soda`(탄산) · `dairy`(유제품) · `water`(물) · `other`
- taste 값은 0~5 정수. `strength=none` 이면 abv>0 재료 사용 금지.
- 하위호환: `version`이 없고 `prompt`만 있으면 기존 방식(텍스트 응답 `{result}`)으로 처리.

### 3.2 응답
```json
{
  "ok": true,
  "source": "gemini | fallback",
  "model": "gemini-3.6-flash  (서버 환경변수 GEMINI_MODEL 로 변경 가능)",
  "recipe": {
    "name": "미드나잇 시트러스",
    "description": "상큼한 오렌지에 탄산을 더한 가벼운 하이볼",
    "reason": "피곤하다고 하셔서 비타민C가 풍부한 오렌지와 청량한 탄산으로 기분 전환을... (2~3문장)",
    "ingredients": [ { "pump": 2, "name": "오렌지주스", "ml": 90 }, { "pump": 4, "name": "사이다", "ml": 110 } ],
    "totalMl": 200,
    "estimatedAbv": 0,
    "flavor": { "sweet": 3, "sour": 2, "bitter": 0, "fizzy": 4, "strength": 0 },
    "garnish": "얼음 + 레몬 슬라이스 (선택)",
    "tips": "잔에 얼음을 먼저 채우고 제조를 시작하세요.",
    "suggestions": [
      { "type": "add_ingredient", "ingredient": "토닉워터", "message": "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." },
      { "type": "low_stock", "pump": 2, "message": "오렌지주스가 120ml 남았어요. 곧 보충이 필요해요." }
    ]
  }
}
```
- `suggestions.type`: `add_ingredient`(미보유 재료 추가 장착 유도 — BM 특허 핵심 아이디어) · `substitute`(대체 재료 사용 안내) · `low_stock`(재고 부족) · `info`
- `strength=none`이면 술(술 이름·장착된 술 재료가 대상이거나 문구에 술 이름이 들어간) `add_ingredient`/`substitute` 제안은 지움(백엔드·앱 동일).
- `user.adultVerified`가 `true`가 아니면 **같은 판정으로 술 `add_ingredient`/`substitute` 제안을 지움**(백엔드·앱 동일, AI·fallback·오프라인 모두). 규칙기반 문구도 술 장착을 권하지 않음(예: 술이 없어 무알콜로 만든 경우 "장착된 주류가 없어 무알콜로 만들었어요."까지만).
- 항상 포함: `mode`(요청 모드 그대로), `explore`(배열, 없으면 `[]`).
- 선택 필드: `recipe.nameEn`, 최상위 `adjustments`(보정 내용 한국어 설명 배열), `notice`(사용자 안내 문구, 예: 빈 기기 explore), `warning`/`warningCode`(fallback 사유).
- `warningCode`: `NO_API_KEY`, `TIMEOUT`, `RATE_LIMIT`, `BILLING`(크레딧 소진, 재시도 안 함), `AUTH`(키 오류), `MODEL`(모델 없음), `BAD_REQUEST`, `BAD_RESPONSE`(JSON 아님/스키마 위반), `BLOCKED`(안전 필터), `NETWORK`, `UPSTREAM`(그 밖의 5xx).
- `GET {AI_SERVER}/api` → `{ok, service:"smart-bartender-ai", version, model, keyConfigured}` (상태 확인용).
- 오류: `{ "ok": false, "error": "메시지" }` (HTTP 4xx/5xx). 사용 가능한 재료가 없으면 422 (단 explore 모드는 §5.4).

### 3.3 레시피 검증·보정 규칙 (백엔드와 앱 **양쪽** 에서 동일 적용)
1. 장착되지 않은 펌프/재료는 제거(이름 정확 일치 우선, 다음 펌프 번호로 매칭). 같은 펌프 중복은 합산(합산 전 음수는 0). **성향(`preference`)에서 알레르기·싫어하는 재료로 판정된 장착 재료도 제거**(`excludedByPreference`: 문장을 마침표·'지만'·'는데' 등으로 절 단위로 나누고, 같은 절에서 재료 이름 바로 뒤 10글자 안에 부정 표현(싫·빼·제외·알레르기·없이·별로 …)이 긍정 표현(좋·최고·원해·넣어 …)보다 먼저 오거나, 이름 앞 12글자 안에 '알레르기/알러지/제외'가 있고 뒤에 긍정 표현이 없으면 제외. 쉼표로는 나누지 않음. 판정 전에 성향 문장을 `cleanText(…, 300)`(제어문자 제거, 줄바꿈·탭·연속 공백 → 공백 1개, 앞뒤 공백 제거, 300자)로 정리하며, 앱도 서버로 보내는 문장과 자기 판정 문장을 이 정리 결과로 통일. 기준 구현: `backend/lib/fallback.js`·`backend/lib/recipe.js`).
2. `strength=none` → abv>0 재료 제거. 
3. ml < 0 → 0, 소수점 1자리 반올림. 0ml 재료 제거.
4. 총량을 `cupMl`(기본 200, 허용 30~500)에 맞게 비례 보정. 반올림 나머지는 가장 많은 재료에 더함.
5. 재료별 `remainingMl` 초과 시 해당 재료를 잔량까지만(내림) 사용하고 `low_stock` 제안 추가. 이때 `totalMl`은 `cupMl`보다 작아질 수 있음.
6. **재료당 최대 300ml**(펌웨어 `maxStepMl`). 초과분은 300으로 자름.
7. 재료가 하나도 남지 않으면 오류.
8. **도수 상한**(`capStrength`): light ≤ 5%, medium ≤ 12%, strong ≤ 20%. 초과 시 알코올 재료를 줄이고 비알코올 재료를 늘려 총량 유지(레시피에 비알코올 재료가 없으면 장착된 비알코올 재료 1개 추가, 규칙 1로 제외된 재료는 고르지 않음). 비알코올 재료가 잔량·300ml 제한에 걸리면 총량이 줄어드는 대신 술을 더 줄여 상한 유지. **섞을 비알코올 재료가 하나도 없으면 실패(`NO_MIXER`)** → normal 422, explore는 `recipe:null` + 무알콜 재료 explore 제안(AI 결과 포함, **무알콜 재료를 새로 하나도 더하지 않는 카드는 버림**(판정 `addsSoftIngredient`: `installed:false` 줄 중 이름이 술 이름 목록(§5.4)에 없고, 그 줄이 `addIngredient`라면 항목 abv 0이고 category가 spirit·liqueur·wine이 아닌 줄이 하나라도 있으면 통과), 0개가 되면 AI 재호출 없이 규칙기반 후보로 채움 — 백엔드·앱 동일). 반올림 나머지는 도수가 오르지 않는 쪽으로 정리해 합계가 보정 전 총량을 넘지 않게 함(남으면 가장 많은 술에서 빼고, 모자라면 가장 많은 비알코올 재료에 더함).
9. `estimatedAbv` = Σ(ml×abv)/총ml 로 다시 계산(소수 1자리). `flavor.strength` = ABV 0→0, ≤5→1, ≤10→2, ≤15→3, ≤20→4, 그 이상→5.

---

## 4. 앱 기능 요구사항 (요약 — v3.0, 세부는 `docs/WEBAPP_DESIGN.md`·`app/README.md`)
1. **기기 연결**: BLE 스캔/연결/자동 재연결, 연결 상태 표시. 같은 소스에서 플랫폼별 통신 어댑터(모두 같은 `Transport` 인터페이스):
   안드로이드 APK = 네이티브 BLE(`@capacitor-community/bluetooth-le`, 앱 안 검색 목록·신호 세기, 마지막 기기 자동 재연결) /
   웹·PWA = Web Bluetooth(Chrome·Edge, 연결할 때마다 브라우저 기기 선택 창, 아이폰 불가) /
   Windows EXE = Electron(Chromium) Web Bluetooth + 앱 안 기기 선택 창 / **데모 모드(가상 기기)** — 하드웨어 없이 전체 흐름.
2. **재료(펌프) 관리**: 펌프 1~4(최대 8) 슬롯에 재료 이름/종류/도수/잔량/용기 용량/색상 저장·수정·비우기. 제조 후 잔량 자동 차감, 부족 경고. 앱 재시작 후에도 유지(앱 저장소 — 브라우저·WebView localStorage, 키 `sb3.*`).
3. **AI 추천**: 기분(복수 선택), 맛(단/신/쓴/탄산 0~5), 도수(무알콜/약/중/강), 날씨(현재 위치 자동 불러오기 + 수동), 상황, 성향 자유입력, 잔 용량. → 레시피 카드(비율 막대, ml, 도수, 추천 이유, 가니시, 팁, 제안).
   AI 방식: `gemini`(사용자 키로 Gemini 직접 호출, 기본) / `offline`(앱 내장 규칙기반). 키가 없으면 `gemini` 를 골라도 실제로는 `offline`.
4. **레시피 조정 & 제조**: ml 미세조정(±), 총량 재조정 → 기기로 전송 → 진행 화면(펌프별 진행률, 비상정지). 웹은 제조 중 화면 꺼짐 방지(Wake Lock).
5. **기록/즐겨찾기**: 제조 기록, 👍/👎 피드백(다음 AI 추천에 반영), 즐겨찾기 재제조.
6. **기기 설정**: 캘리브레이션 마법사(펌프 10초 구동 → 실제 ml 입력 → mlps 계산·저장), 프라이밍/세척, 배출 모드(순차/동시), 데모 모드·자동 재연결, 성인 인증(주류 사용 시 만 19세 이상 확인).
7. **AI 키 등록(BYOK)**: 설정 > Gemini API 키 — 붙여넣기 칸 + **[키 확인]**(무료 모델 목록 조회 `GET /v1beta/models` 로 키 유효성·선택 모델 존재 확인) + **[저장]/[삭제]**, 저장 후에는 마지막 4자리만 표시, "키 발급 방법"(Google AI Studio `https://aistudio.google.com/apikey`) 안내, 모델 선택(기본 `gemini-3.6-flash`).
   - [키 확인]·추천 실패 안내 분류: 성공 / 키가 올바르지 않음(400·401·403 `API_KEY_INVALID`) / 권한 없음(403) / 사용량 한도·크레딧 소진(429 `RESOURCE_EXHAUSTED`) / 인터넷 연결 없음. 추천 중 실패는 같은 분류로 안내하고 오프라인 추천으로 이어감.
   - 저장 위치: 웹·PWA·EXE = 그 브라우저/앱의 localStorage(`sb.secret.geminiKey`), APK = `@capacitor/preferences`(앱 전용 저장소, `allowBackup=false`). 키는 Google(Gemini) 외 어디에도 보내지 않고, 화면·알림·로그에 값을 남기지 않음.
   - 배포물(웹 dist·APK·EXE)에는 키를 넣지 않음. 개발용 테스트 키는 개발 서버(`npm run dev`)에서만 읽고 빌드가 키 모양을 검사해 실패시킴(`app/scripts/check-no-secrets.mjs`).
   - 첫 실행 안내: "AI 키를 등록하면 Gemini 가 레시피를 만들어요. 없어도 오프라인 추천으로 바로 쓸 수 있어요."
8. **앱 업데이트**(v3.0.3): APK·EXE 는 앱을 켤 때(6시간에 1번까지) GitHub 최신 릴리스(`api.github.com/repos/paperji/smart-bartender/releases/latest`)를 확인해 더 높은 버전이고 이 플랫폼 파일과 SHA-256(`assets[].digest`)이 있으면 추천 → [업데이트] 시 이 저장소 릴리스 주소의 파일만 내려받아 SHA-256 이 같을 때만 설치 (APK = 받은 APK 가 같은 패키지의 더 높은 versionCode 인지 확인 → 안드로이드 설치 창에서 사용자가 "업데이트"(또는 "설치"), 처음 1번 설정의 "이 출처 허용" / EXE = 지금보다 높은 버전만, 새 EXE 가 실행된 뒤 지금 창 닫기). 기기 작업 중·다른 창이 열려 있을 때는 업데이트 창을 띄우지 않고, 기기 작업 중에는 시작·설치도 안 함(다 받았는데 창을 닫았거나·작업 중·다른 창·앱이 화면 뒤면 "받아 둠"으로 나중에 물어봄). 태그는 `vX.Y.Z` 만. [나중에] 하루, [이 버전 건너뛰기]. 웹·PWA 는 서비스 워커가 자동 적용.

---

## 5. v2.1 추가 요구사항 (1학기 과제계획서의 앱 워크플로우 반영)

1. **제조 완료 알림**: 완료 시 로컬 알림(v3.0: APK = `@capacitor/local-notifications`, 안드로이드 채널 `brew` "제조 알림" / 웹·PWA = Notification API(서비스 워커 알림) / EXE = Windows 알림, 권한이 없으면 화면 토스트) + 진동(APK `@capacitor/haptics`, 웹 `navigator.vibrate`). 앱이 백그라운드여도 표시(권한 요청 포함 — APK 는 백그라운드에서 화면 JS 가 멈추므로 제조 시작 때 끝 시각의 예비 알림을 예약해 두고 실제 결과가 오면 같은 알림을 결과로 바꿈). 중단(stopped)·오류·연결 끊김 시에도 알림.
2. **"한 잔 더?" 루프**: 완료 화면에서 피드백 후 "한 잔 더 만들까요?" → [예] 같은 입력으로 추천 단계 복귀 / [아니요, 다른 걸 원해요] → **탐색(explore) 모드** 요청.
3. **추천 거절 처리**: 레시피 화면의 "다른 추천"은 거절로 간주해 해당 레시피를 `history`에 `liked:false, rejected:true`로 넣어 다음 요청에서 피하도록 함(백엔드 프롬프트·fallback 모두 거절 레시피와 같은 재료 조합을 피함). 연속 2회 거절 시 "새 재료를 장착해 볼까요?" 배너로 탐색 모드 유도.
4. **탐색 모드 API** — 요청에 `"mode": "explore"` (기본 `"normal"`). 응답에 `explore` 배열(1~3개) 추가. 각 항목의 미장착 재료는 1개(최대 2개), ml 합은 cupMl 근처. explore 모드에서 사용 가능한 재료가 없으면 `recipe: null` + explore 1~3개로 200 응답(빈 기기에서도 동작):
   ```json
   "explore": [
     { "addIngredient": "토닉워터", "category": "soda", "abv": 0,
       "recipeName": "시트러스 토닉", "description": "쌉싸름하고 청량한…",
       "ingredients": [ { "name": "레몬즙", "ml": 20, "installed": true, "pump": 3 },
                        { "name": "토닉워터", "ml": 160, "installed": false } ],
       "message": "토닉워터를 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요." }
   ]
   ```
   - normal 모드에서도 `explore`는 선택적으로 0~1개 포함 가능. `recipe`는 항상 현재 장착 재료만으로 구성(제조 가능해야 함).
   - 앱: explore 카드 → "펌프 N에 장착하기" 버튼(재료 편집 화면에 이름·카테고리·도수 미리 채움, 빈 펌프 또는 가장 적게 쓰인 펌프 추천) → 장착 후 해당 레시피 재요청.
   - 백엔드 fallback 도 explore 1개 이상 생성(카테고리 보완 규칙: 탄산 없으면 탄산수/토닉, 산미 없으면 레몬즙, 단맛 없으면 시럽 등).
   - **fallback 후보 목록(백엔드·앱 오프라인 공통, 위에서부터 우선)**: 장착된 재료와 이름이 같거나 거절 기록에 반복 등장한 후보는 제외.
     | 후보 | category | abv | 고르는 조건 |
     |---|---|---|---|
     | 탄산수 | soda | 0 | soda 미장착 + fizzy ≥ 2 |
     | 토닉워터 | soda | 0 | soda 미장착 또는 bitter ≥ 2 |
     | 레몬즙 | juice | 0 | 산미 재료(레몬·라임·자몽 등) 없음 + sour ≥ 2 |
     | 설탕시럽 | syrup | 0 | syrup 미장착 + sweet ≥ 2 |
     | 그레나딘 시럽 | syrup | 0 | syrup 미장착 (색감) |
     | 크랜베리주스 | juice | 0 | juice 1개 이하 |
     | 우유 | dairy | 0 | dairy 미장착 + 휴식/디저트 상황 |
     | 진 · 보드카 · 화이트 럼 | spirit | 40 | strength ≠ none 이고 spirit 미장착 이고 `user.adultVerified` |
     | 트리플섹 | liqueur | 30 | strength ≠ none 이고 liqueur 미장착 이고 `user.adultVerified` |
     - 산미 재료 판정 정규식 `/레몬|라임|자몽|유자|깔라만시|매실|lemon|lime|grapefruit/i`, 휴식/디저트 상황 판정 `/휴식|디저트|릴랙스|편안|차분|힐링/`(situation·preference 대상). 성향으로 제외된 재료(§3.3 규칙 1과 같은 판정)는 후보에서도 제외.
     - `user.adultVerified`가 false면 AI explore 결과에서도 **술을 새로 장착하라는 항목은 버림**(백엔드·앱 동일). 판정: `addIngredient`의 abv > 0, 또는 category가 spirit·liqueur·wine, 또는 `installed:false` 재료 이름이 술 이름 목록(백엔드 `lib/alcohol.js`의 `ALCOHOL_NAME_RE` — 앱 `alcohol.ts`와 같은 문자열. 럼·진은 문장 속('럼을 장착하면…')에서도 잡고 '처럼'·'진저'·'진토닉'·'럼주스'는 제외)에 해당.
     - AI explore 결과에도 성향 제외(§3.3 규칙 1)를 적용(백엔드·앱 동일): `addIngredient`가 제외 재료면 항목을 버리고, 제외된 장착 재료(펌프)·미장착 재료 줄은 줄만 지움(남은 줄로 도수 상한을 맞출 수 없으면 항목 제거). 미장착 줄의 도수는 `addIngredient` = 항목 abv, 그 밖은 앱 재료 프리셋과 이름이 정확히 같으면 그 도수, 아니면 술 이름 목록에 있으면 40, 없으면 0(백엔드 `uninstalledLineAbv` — 앱 프리셋 도수표를 복제하므로 `presets.ts`를 바꾸면 같이 바꿈).
     조건을 만족하는 후보가 **0개일 때만** 탄산수 → 레몬즙 → 설탕시럽 순으로 채움. `installed`·`pump`는 `normName`(§3.1) 일치로 판정. "진 · 보드카 · 화이트 럼"은 한 후보로 보고 제외되지 않은 것 중 첫 번째(진 → 보드카 → 화이트 럼). "거절 기록에 반복 등장" = 거절(rejected) 기록 2회 이상에 등장. 채우기는 normal·explore 모두 적용하고, 그래도 0개면 조건 무시 → 거절 기록 무시 순으로 다시 골라 1개 이상을 만듦(장착 재료·성향 제외·성인 확인 전 술은 끝까지 제외 — 이 경우에만 0개 가능). 짝 재료 고르기 순서, 짝이 모두 술인 술 후보에 무알콜 재료 추가, 빈 기기 짝 재료 표(`EXPLORE_PARTNERS`), 새 재료 한 가지 카드 등 세부는 기준 구현 `backend/lib/fallback.js`를 따름(앱 `offline-explore.ts`는 `tests/parity.test.ts`로 같음을 확인).
   - 빈 기기(장착 재료로 만들 수 없음)에서는 항목 하나에 미장착 재료 2개(예: 탄산수 + 레몬즙)를 함께 제안해 레시피가 성립하게 함.
5. **기기 변경**: 기기 탭에서 스캔된 여러 기기(이름·신호세기) 중 선택 연결, 마지막 연결 기기 기억(앱 저장소)·앱 시작 시 자동 재연결, "다른 기기로 변경"(연결 해제 → 재스캔). 웹·EXE 는 브라우저 기기 선택 창(EXE 는 앱 안 선택 창)에서 고르며, 브라우저가 예전에 허락한 기기 목록(`navigator.bluetooth.getDevices`)을 지원할 때만 앱 시작 시 자동 연결.
6. **캘리브레이션 안내**: `calSet`이 0인 펌프가 있으면 바텐더/기기 탭에 "캘리브레이션 전 — 실제보다 적게 나올 수 있어요" 배너와 마법사 바로가기.

---

## 6. 버전
- v2.0 (2026-11-06): BLE 전환, 상태머신 펌웨어, 앱 v2, 백엔드 v2, 회로 v3.
- v2.1 (2026-11-06): 펌프당 최대 구동 120초, `calSet`, 검증 순서 명확화, 릴레이 B안·전원 스위치/퓨즈/버스·별형 접지·튜브 규격, AI 보정 규칙 8~9, 탐색 모드·알림·한 잔 더·거절·기기 변경.
- v2.1 교차검증 반영 (2026-11-06): status `last`(재연결 후 결과 확인), 규칙 1 성향 제외, 규칙 8 `NO_MIXER`·반올림 정리, `user.adultVerified`, 무알콜 시 술 제안 제거, 시간 한도 관계(서버 20초 < 앱 50초), §5.4 정규식 명시, 릴레이 B안 절차(⑪ 먼저 → ⑨ 이동 → 점퍼).
- v2.1 마무리 (2026-11-07): 성인 확인 전 술 장착 제안 제거를 레시피 `suggestions`까지 확대, `NO_MIXER` explore 카드는 무알콜 재료를 더하는 것만, 성향 문장 정리(`cleanText`) 명시, fallback 채우기·안전장치 기준 구현 명시, 대기 중 버튼 = `status`.
- v2.1 마무리 검토 반영 (2026-11-07): `id` 제어문자 → `?`(§2.3), 버튼 다시 만들기 id = `btn`+ms(§2.4), 술 이름 목록 확장(럼·진 문장 속 판정, 리큐어·샴페인·동동주 등), AI explore 카드에도 성향 제외·미장착 줄 도수 규칙(§5.4), 규칙 8 `addsSoftIngredient` 정의 명시.
- v3.0 (2026-11-07): 앱을 웹앱(PWA)·안드로이드 APK(Capacitor)·Windows EXE(Electron) 한 소스(Vite + React)로 다시 만듦(`docs/WEBAPP_DESIGN.md`). AI 서버 모드 제거 → 사용자 본인 Gemini 키(BYOK)로 앱이 직접 호출(§0·§3 참고·§4-7), 키 없거나 실패 시 오프라인 추천. `backend/` 는 §3.3·§5.4 의 기준 구현(배포 안 함, 앱↔백엔드 parity 테스트). 펌웨어·BLE 프로토콜(§1·§2)·보정 규칙(§3.3)·탐색(§5.4)·v2.1 추가 요구사항(§5)은 그대로.
- v3.0.1 · 펌웨어 2.1.1 (2026-11-07, 실제 ESP32 ↔ PC 블루투스·Windows 앱 연결 시험 뒤): 기기 송신 혼잡 처리(§2.2 — 맨 앞 줄 하나만 포기 + `\n` 줄 맞춤), 앱이 연결된 채 결과를 놓치면 `status` 로 확인(§2.4), Windows 앱 기기 선택 창을 검색 시작과 함께 열고 기기를 못 찾아도 취소 가능·못 찾음/블루투스 꺼짐 안내. 명령·이벤트 형식은 그대로(`info.fw` 만 `"2.1.1"`).
- v3.0.3 · 펌웨어 2.1.2 (2026-11-07, 실제 갤럭시 S20 Ultra(안드로이드 13) ↔ ESP32 연결 시험 뒤): 앱이 연결 단계 실패(안드로이드 GATT 133 / HCI 0x3E — 기기가 첫 연결 패킷을 놓침)면 4번까지 자동으로 다시 연결(APK·웹), 펌웨어는 블루투스 컨트롤러를 BLE 전용으로 시작(`BLE_ONLY_CONTROLLER`). 프로토콜은 그대로(`info.fw` 만 `"2.1.2"`). 앱 업데이트 추천·내려받기·설치(§4-8) 추가(APK·EXE).
