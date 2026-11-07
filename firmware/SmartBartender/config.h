/*
 * config.h — 스마트 바텐더 v2 펌웨어 "설정 파일"
 * ------------------------------------------------------------------
 * 하드웨어가 바뀌거나 동작 값을 조정하고 싶을 때는 이 파일만 고치면 됩니다.
 * (모든 값은 docs/SPEC.md 와 일치해야 합니다. SPEC 을 먼저 고치고 여기를 고치세요.)
 *
 * 주의: 이 파일은 PC 단위 테스트에서도 함께 쓰이므로 Arduino 전용 매크로
 *       (HIGH, LOW 등)를 쓰지 않고 숫자 1/0 을 사용합니다.
 */
#pragma once
#include <stdint.h>

// ===================== 1. 기본 정보 =====================
#define FW_VERSION          "2.1.1"            // 펌웨어 버전 (info 이벤트의 fw). 2.1.1: BLE 혼잡 시 4초까지 다시 보내고 줄 하나만 포기 + 줄 맞춤 (TxRing.h)
#define DEVICE_NAME_PREFIX  "SmartBartender"   // 광고 이름 = 접두어 + "-" + MAC 하위 2바이트 (예: SmartBartender-A1B2)

// ===================== 2. 펌프 개수 / 핀맵 (SPEC §1) =====================
// 기본 4개. 두 번째 4채널 릴레이 모듈을 달면 5~8 로 늘릴 수 있습니다.
#ifndef PUMP_COUNT
#define PUMP_COUNT 4
#endif

#define MAX_PUMPS 8   // 펌웨어가 지원하는 최대 펌프 수 (바꾸지 마세요)

// 펌프 번호(1부터) → ESP32 GPIO 번호
//   펌프1=GPIO26(릴레이 IN1), 펌프2=GPIO27(IN2), 펌프3=GPIO32(IN3), 펌프4=GPIO33(IN4)
//   (확장) 펌프5~8 = GPIO25, 13, 18, 19 (두 번째 릴레이 모듈 IN1~IN4)
static const uint8_t PUMP_PINS[MAX_PUMPS] = {26, 27, 32, 33, 25, 13, 18, 19};

#define PIN_BUTTON  4    // 시작/정지 버튼: 버튼 한쪽 → GPIO4, 다른 쪽 → GND (내부 풀업 사용, 눌림 = LOW)
#define PIN_LED     2    // 상태 LED: 외부 LED + 220Ω 필수 (GPIO2 → 220Ω → LED(+), LED(−) → GND).
                         //   DevKitC V4 에는 GPIO2 에 연결된 사용자 LED 가 없습니다(빨간 전원 LED 만 있음).
#define PIN_BUZZER  23   // 능동 부저 모듈(ONE005) I/O 핀 (선택). HIGH = 울림

// 릴레이 모듈은 "LOW 신호 = 켜짐(Active-LOW)" 입니다.
//   A안(기본: JD-VCC 점퍼 제거, VCC=3V3) / B안(점퍼 끼움, VCC=5V, 3V3 선 제거) 모두 Active-LOW 라
//   펌웨어는 똑같습니다. 어느 쪽으로 할지는 조립 가이드 STEP2 벤치 테스트로 정합니다.
#define RELAY_ON_LEVEL   0   // LOW
#define RELAY_OFF_LEVEL  1   // HIGH

// ===================== 3. 선택 기능 =====================
// 부저: 1 = 사용(완료 시 삐-삐, 정지 시 길게 삐-), 0 = 사용 안 함
#ifndef ENABLE_BUZZER
#define ENABLE_BUZZER     1
#endif
// 부저 모듈이 어떤 신호에 울리는지: 1 = HIGH 에 울림(우리 ONE005 모듈, SPEC 기본값), 0 = LOW 에 울림(Low 트리거 모듈)
// → 다른 부저로 바꿨는데 부팅 직후 계속 울린다면 이 값을 0 으로 바꾸세요.
#ifndef BUZZER_ON_LEVEL
#define BUZZER_ON_LEVEL   1
#endif

// 버튼 길게 누르기(1.5초, 대기 상태에서) → 마지막으로 만든 레시피를 한 번 더 제조
//   1 = 사용, 0 = 사용 안 함(기본값: 잔 없이 실수로 눌러 음료가 쏟아지는 것을 막기 위해 꺼 둠)
//   다시 만든 잔은 원래 레시피 id 가 아닌 새 id "btn"+기동 후 ms 로 이벤트를 보냄(앱 재연결 판정 혼동 방지, README 7-7)
#ifndef BUTTON_REPEAT_LAST
#define BUTTON_REPEAT_LAST 0
#endif

// ===================== 4. 안전 한계값 (SPEC §2.3) =====================
#define MAX_STEPS        8         // 레시피 한 번에 재료(steps) 최대 8개
#define MAX_STEP_ML      300.0     // 재료 1개 최대 300ml (0 < ml <= 300)
#define MAX_TOTAL_ML     500.0     // 레시피 총량 최대 500ml
#define MAX_PUMP_MS      120000UL  // make: (같은 펌프 합산 후) 펌프 1개 구동시간 최대 120초 (v2.1, info 의 maxPumpMs)
                                   //   체크밸브를 달면 유량이 3~6ml/s 로 낮아져 300ml 에 50~100초가 걸리기 때문
#define MAX_RUN_MS       60000UL   // run(캘리브레이션 측정·프라이밍): 최대 60초
#define CLEAN_MAX_MS     30000UL   // clean(세척): 펌프당 최대 30초
#define SAFETY_MARGIN_MS 1000UL    // 안전 감시: 펌프가 (해당 작업 상한 + 1초) 이상 켜져 있으면 무조건 강제 정지
                                   //   make 121초 / run 61초 / clean 31초

// ===================== 5. 동작 타이밍 =====================
#define SEQ_GAP_MS            300UL  // 순차(seq) 모드: 펌프와 펌프 사이 휴지 시간 (전압 안정화)
#define PAR_STAGGER_MS        100UL  // 병렬(par) 모드: 펌프를 0.1초 간격으로 차례로 켬(기동 돌입전류 분산).
                                     //   각 펌프의 '구동 시간'은 그대로이므로 양은 정확합니다. 0 이면 완전 동시.
#define PROGRESS_INTERVAL_MS  250UL  // progress(진행률) 이벤트 전송 간격
#define BUTTON_DEBOUNCE_MS    30UL   // 버튼 채터링(떨림) 제거 시간
#define BUTTON_LONG_PRESS_MS  1500UL // 길게 누르기 판정 시간

// loop() 워치독: loop() 가 5초 넘게 멈추면(펌웨어가 어딘가에서 멈춤) ESP32 를 자동 재시작합니다.
//   워치독·패닉 재시작은 CPU 만 리셋하므로 핀 출력값(릴레이 LOW=켜짐)이 그대로 남습니다.
//   그래서 펌웨어가 워치독 인터럽트에서 릴레이를 즉시 끄고(WatchdogRelayOff.cpp),
//   재부팅 후 setup() 에서 다시 OFF 로 초기화해 "멈춘 채 펌프가 계속 도는" 일을 막습니다.
//   (전원 투입·EN 버튼 리셋은 칩 전체가 리셋되어 핀이 입력(꺼짐)이 됨. 워치독이 아닌 다른 원인의
//    크래시는 setup() 까지 약 1초 안팎 펌프가 더 돌 수 있음)
//   1 = 사용(기본), 0 = 사용 안 함(디버깅할 때만)
#ifndef ENABLE_LOOP_WDT
#define ENABLE_LOOP_WDT 1
#endif

// ===================== 6. 유량 캘리브레이션 (NVS 저장) =====================
#define DEFAULT_MLPS   20.0f   // 기본 유량 (ml/초). 캘리브레이션 전 초기값.
                               //   실제(체크밸브 포함 약 3~6ml/s)보다 커서 "덜 나오는 쪽(안전)" 이므로 그대로 둡니다.
#define MIN_MLPS       0.5f    // setcal 허용 최소값
#define MAX_MLPS       100.0f  // setcal 허용 최대값
#define NVS_NAMESPACE  "bartender"  // Preferences(NVS) 네임스페이스. 키 = "mlps1" ~ "mlps8"
                                    //   키가 있으면 info/cal 의 calSet = 1 (캘리브레이션 완료), 없으면 0 (기본값 사용 중)

// ===================== 7. 통신 (SPEC §2) =====================
#define SERIAL_BAUD    115200
#define RX_MAX_LEN     1024    // 수신 1줄 최대 길이(바이트). 초과 시 버리고 error/TOO_LONG
#define ID_MAX_LEN     40      // 레시피 id 최대 길이(넘으면 잘라서 사용)

// Nordic UART Service (NUS) — nRF Connect, Serial Bluetooth Terminal 등 무료 앱으로도 테스트 가능
#define NUS_SERVICE_UUID  "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID       "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // 앱 → 기기 (Write / Write Without Response)
#define NUS_TX_UUID       "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // 기기 → 앱 (Notify)

#define BLE_MTU_WANTED   247    // 기기 쪽 최대 MTU. 안드로이드 앱이 247 을 요청하면 그대로 협상됨
#define NOTIFY_GAP_MS    10UL   // 알림(notify) 조각 사이 최소 간격 — BLE 송신 버퍼 넘침 방지
#define NOTIFY_RETRY_MS  30UL   // 혼잡(ERROR_GATT)으로 notify 가 실패하면 다시 보내기까지 쉬는 시간: 30 → 60 → 120 → 240ms
#define NOTIFY_GIVEUP_MS 4000UL // 이 시간 동안 한 번도 못 보내면 맨 앞 줄 하나만 포기 (TxRing.h). 진짜 끊김은 연결 끊김으로 따로 처리
#define TX_RING_SIZE     4096   // BLE 송신 대기 버퍼 크기(바이트)
