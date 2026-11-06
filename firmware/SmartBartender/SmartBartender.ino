/*
 * =====================================================================
 *  AI 스마트 바텐더 v2 — ESP32 펌웨어  (버전 2.1.0, docs/SPEC.md v2.1)
 *  팀 홍당무 · 안양대학교 정보전기전자공학과 캡스톤디자인 Ⅱ (2026/2학기)
 *  과제: 사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커
 * =====================================================================
 *
 *  [무엇을 하나요?]
 *   스마트폰 앱이 BLE(블루투스 저전력)로 보낸 레시피 JSON 을 받아서
 *   릴레이 → 수중펌프를 정해진 시간만큼 켜고 꺼서 음료를 배합합니다.
 *     예) {"cmd":"make","id":"r1","steps":[{"p":1,"ml":45},{"p":3,"ml":30.5}]}
 *         → 펌프1 을 45ml ÷ 20ml/s = 2.25초, 0.3초 쉬고, 펌프3 을 1.525초 구동
 *
 *  [파일 구성]
 *   - config.h         : 핀 번호, 펌프 개수, 안전 한계값 등 "설정" (여기만 고치면 됨)
 *   - BartenderCore.h  : 명령 해석·검증·펌프 상태머신 (하드웨어와 무관한 "두뇌", PC 에서 단위 테스트 가능)
 *   - SmartBartender.ino (이 파일) : ESP32 "몸통" — BLE, USB 시리얼, 릴레이 GPIO, 플래시(NVS), LED, 부저, 버튼
 *   - WatchdogRelayOff.cpp : 워치독이 걸리는 순간 릴레이를 즉시 끄는 안전 장치 (워치독 인터럽트 훅)
 *
 *  [통신] (docs/SPEC.md §2)
 *   - BLE Nordic UART Service(NUS). 모든 메시지는 "JSON 한 줄 + \n".
 *   - USB 시리얼(115200bps)로도 똑같은 JSON 명령을 받을 수 있고, 모든 이벤트가 시리얼에도 출력됩니다.
 *     → 휴대폰 없이 Arduino IDE 시리얼 모니터만으로 테스트 가능.
 *     (시리얼에서 '#' 으로 시작하는 줄은 사람이 읽는 로그, '{' 로 시작하는 줄은 이벤트 JSON)
 *
 *  [멀티태스킹 구조 — 왜 큐(Queue)를 쓰나요?]
 *   ESP32 의 BLE 콜백(onWrite 등)은 loop() 와 "다른 FreeRTOS 태스크(BT 태스크)"에서 실행됩니다.
 *   두 태스크가 같은 변수를 동시에 건드리면 데이터가 깨질 수 있으므로,
 *     BLE 콜백 : 받은 바이트를 줄 단위로 조립해서 FreeRTOS 큐에 "넣기만" 함
 *     loop()   : 큐에서 꺼내 실제 명령 처리, 펌프 제어, 알림 전송을 "모두" 담당
 *   이렇게 역할을 나누면 펌프/작업 상태는 오직 loop() 한 곳에서만 바뀌므로 안전합니다.
 *
 *  [안전 장치 요약]
 *   1) 부팅: 릴레이 핀을 "꺼짐(HIGH)" 으로 먼저 써 둔 뒤 출력으로 전환 → 부팅 순간 펌프가 튀지 않음
 *   2) 검증: 잘못된 명령은 펌프를 하나도 켜지 않고 error 응답 (BartenderCore.h)
 *   3) 소프트웨어 감시: 펌프가 (작업 상한 + 1초) 이상 켜져 있으면 전체 정지 (BartenderCore.h)
 *   4) loop() 워치독: loop() 자체가 5초 넘게 멈추면 워치독 인터럽트에서 릴레이를 즉시 끄고(HIGH) ESP32 재시작
 *      → 재부팅 후 setup() 이 다시 OFF 로 초기화. (워치독·패닉 재시작은 CPU 만 리셋하므로 핀 출력값이 그대로
 *        남습니다. 그래서 "재시작하면 저절로 꺼진다"에 기대지 않고 직접 끕니다. → WatchdogRelayOff.cpp)
 *      ※ 워치독이 아닌 다른 원인의 크래시(패닉)는 이 처리가 없어, 재부팅해 setup() 이 돌 때까지
 *        약 1초 안팎(패닉 로그·코어덤프 저장·부팅 시간, 추정) 펌프가 더 돌 수 있습니다.
 *   5) 물리 버튼: 제조 중 누르면 즉시 비상정지
 *
 *  [보드 설정] Arduino IDE → 보드: "ESP32 Dev Module" (ESP32 코어 3.x), 라이브러리: ArduinoJson 7.x
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "driver/gpio.h"
#include "esp_mac.h"
#include "esp_system.h"
#include "nvs.h"
#include "nvs_flash.h"

#include "config.h"
#include "BartenderCore.h"

// =====================================================================
//  전역 상태
// =====================================================================

// ---- BLE ----
static BLEServer* gServer = nullptr;
static BLECharacteristic* gTxChar = nullptr;      // 기기 → 앱 (Notify)
#if defined(CONFIG_BLUEDROID_ENABLED)
static BLE2902* gTxCccd = nullptr;                // TX 의 "알림 켜기" 스위치(CCCD). 앱이 구독하면 1
#endif
static volatile bool gConnected = false;          // BT 태스크가 쓰고 loop 가 읽음
static volatile uint16_t gMtu = 23;               // 협상된 MTU (기본 23 → 한 번에 20바이트)
static volatile bool gNeedAdvertise = false;      // BT 태스크: 연결 끊김 → loop 에 광고 재시작 요청
static volatile uint32_t gRxDropped = 0;          // 큐가 꽉 차서 버린 메시지 수(정상이면 0)
static volatile int gNotifyStatus = -1;           // 마지막 notify 결과(콜백에서 기록. notify() 안에서 같은 태스크로 호출됨)
static char gDeviceName[32];

// 광고 재시작 예약 (loop 전용)
static bool gAdvPending = false;
static uint32_t gAdvAt = 0;

// 이 BLE 라이브러리(코어 3.3.x)는 앱이 알림을 구독할 때마다 "휴대폰 주소별" 키를 NVS 의 이 이름공간에
// 기록합니다. 안드로이드는 연결할 때마다 주소가 바뀌는 경우가 많아 키가 계속 쌓이므로(NVS 가 가득 차면
// 유량값 저장이 실패할 수 있음) 부팅 때마다 비웁니다. 우리는 페어링(본딩)을 쓰지 않으므로 지워도 문제 없음.
#define BLE_CCCD_NVS_NS "ble_cccd"

// ---- 수신 큐: BLE 콜백(BT 태스크) → loop() ----
struct RxMsg {
  uint8_t type;                 // 0 = 완성된 한 줄, 1 = 1024바이트 초과(TOO_LONG)
  uint16_t len;
  char data[RX_MAX_LEN + 1];
};
static QueueHandle_t gRxQueue = nullptr;
static const UBaseType_t RX_QUEUE_DEPTH = 6;
static sb::LineAssembler gBleAsm;     // BT 태스크 전용
static RxMsg gBleOut;                 // BT 태스크 전용(큐에 넣기 전 임시 공간)
static RxMsg gLoopIn;                 // loop 전용(큐에서 꺼낸 메시지)
static sb::LineAssembler gSerialAsm;  // loop 전용(USB 시리얼 입력 조립)

// ---- BLE 송신 링버퍼 (loop 전용) ----
//  이벤트 줄을 모아 두었다가 (MTU-3) 바이트씩 잘라 10ms 간격으로 notify → BLE 송신 버퍼 넘침 방지
static uint8_t gTxRing[TX_RING_SIZE];
static size_t gTxHead = 0, gTxTail = 0, gTxUsed = 0;
static uint32_t gNextNotifyAt = 0;
static uint8_t gNotifyRetry = 0;

// ---- 유량값 저장(NVS) ----
static Preferences gPrefs;
static bool gPrefsOk = false;

// ---- 부저 ----
static const uint16_t BEEP_DONE[]  = {120, 90, 120, 0};   // 완료: 삐-삐 (켜짐,꺼짐,켜짐 ms, 0=끝)
static const uint16_t BEEP_STOP[]  = {600, 0};            // 중단: 삐----
static const uint16_t BEEP_SHORT[] = {60, 0};             // 부팅/버튼: 짧게 삑
#if ENABLE_BUZZER
static const uint16_t* gBeepPat = nullptr;   // 재생 중인 패턴 (nullptr = 조용)
static uint8_t gBeepIdx = 0;
static uint32_t gBeepAt = 0;
#endif

// ---- 워치독 비상정지 (WatchdogRelayOff.cpp) ----
//  워치독 인터럽트가 끌 릴레이 핀 목록을 미리 계산해 둠. setup() 에서 워치독을 켜기 전에 1번 호출.
void watchdogRelayOffBegin();

// ---- 버튼 ----
static bool gBtnStable = true;      // HIGH(안 눌림)
static bool gBtnLastRead = true;
static uint32_t gBtnChangedAt = 0;
static uint32_t gBtnPressedAt = 0;
static bool gBtnConsumed = false;   // 이번 누름이 이미 처리(정지/길게 누름)되었는가

// =====================================================================
//  BLE 송신 링버퍼
// =====================================================================
static void txClear() { gTxHead = gTxTail = gTxUsed = 0; gNotifyRetry = 0; }

// 한 줄 + '\n' 을 통째로 넣음. 공간이 부족하면 넣지 않음(줄이 중간에 잘리는 일이 없게)
static bool txPush(const char* s, size_t n) {
  if (n + 1 > TX_RING_SIZE - gTxUsed) return false;
  for (size_t i = 0; i <= n; i++) {
    gTxRing[gTxHead] = (i < n) ? (uint8_t)s[i] : (uint8_t)'\n';
    gTxHead = (gTxHead + 1) % TX_RING_SIZE;
  }
  gTxUsed += n + 1;
  return true;
}

static size_t txPeek(uint8_t* out, size_t maxLen) {
  size_t n = gTxUsed < maxLen ? gTxUsed : maxLen;
  size_t t = gTxTail;
  for (size_t i = 0; i < n; i++) { out[i] = gTxRing[t]; t = (t + 1) % TX_RING_SIZE; }
  return n;
}

static void txConsume(size_t n) {
  if (n > gTxUsed) n = gTxUsed;
  gTxTail = (gTxTail + n) % TX_RING_SIZE;
  gTxUsed -= n;
}

// 현재 줄의 나머지를 '\n' 까지 버림 (전송 실패가 반복될 때)
static void txDropLine() {
  while (gTxUsed > 0) {
    uint8_t c = gTxRing[gTxTail];
    txConsume(1);
    if (c == '\n') break;
  }
}

// loop() 에서 호출: 대기 중인 데이터를 (MTU-3) 바이트 조각으로 notify
static void txDrain(uint32_t now) {
  if (!gConnected) { if (gTxUsed) txClear(); return; }
  if (gTxUsed == 0 || (int32_t)(now - gNextNotifyAt) < 0) return;

  static uint8_t chunk[244];                       // MTU 247 - 3
  size_t maxChunk = (gMtu > 3) ? (size_t)(gMtu - 3) : 20;
  if (maxChunk > sizeof(chunk)) maxChunk = sizeof(chunk);
  const size_t n = txPeek(chunk, maxChunk);

  gNotifyStatus = -1;
  gTxChar->setValue(chunk, n);
  gTxChar->notify();                               // 결과는 TxCallbacks::onStatus 가 gNotifyStatus 에 기록
  gNextNotifyAt = now + NOTIFY_GAP_MS;

  switch (gNotifyStatus) {
    case BLECharacteristicCallbacks::Status::ERROR_GATT:     // 일시적 송신 실패(혼잡) → 잠시 후 같은 조각 재시도
      gNextNotifyAt = now + 30;
      if (++gNotifyRetry > 10) {                    // 계속 실패하면 이 줄은 포기
        txConsume(n);
        if (chunk[n - 1] != '\n') txDropLine();
        gNotifyRetry = 0;
      }
      break;
    case BLECharacteristicCallbacks::Status::ERROR_NOTIFY_DISABLED:   // 앱이 아직 알림 구독(Notify ON) 전
    case BLECharacteristicCallbacks::Status::ERROR_NO_CLIENT:
    case BLECharacteristicCallbacks::Status::ERROR_NO_SUBSCRIBER:
      txClear();                                    // 받을 사람이 없으므로 버림
      break;
    default:                                        // 성공(SUCCESS_NOTIFY) 또는 상태 미보고 → 보낸 것으로 처리
      txConsume(n);
      gNotifyRetry = 0;
      break;
  }
}

// =====================================================================
//  부저 (비차단 패턴 재생)
// =====================================================================
#if ENABLE_BUZZER
static void buzzerWrite(bool on) {
  digitalWrite(PIN_BUZZER, on ? BUZZER_ON_LEVEL : !BUZZER_ON_LEVEL);
}
#endif

static void beep(const uint16_t* pat) {
#if ENABLE_BUZZER
  gBeepPat = pat; gBeepIdx = 0; gBeepAt = millis();
  buzzerWrite(true);
#else
  (void)pat;
#endif
}

static void updateBuzzer(uint32_t now) {
#if ENABLE_BUZZER
  if (!gBeepPat) return;
  if ((uint32_t)(now - gBeepAt) < gBeepPat[gBeepIdx]) return;
  gBeepAt = now;
  gBeepIdx++;
  if (gBeepPat[gBeepIdx] == 0) { buzzerWrite(false); gBeepPat = nullptr; return; }
  buzzerWrite((gBeepIdx % 2) == 0);   // 짝수 칸 = 켜짐, 홀수 칸 = 꺼짐
#else
  (void)now;
#endif
}

// 앱이 TX 알림을 구독(Notify ON)했는가? — SPEC §2.1: 구독 전 이벤트는 BLE 로 보내지 않고 버림
static bool bleSubscribed() {
#if defined(CONFIG_BLUEDROID_ENABLED)
  return gTxCccd != nullptr && gTxCccd->getNotifications();   // 1바이트 읽기라 태스크 간 경쟁 문제 없음
#else
  return true;   // NimBLE 빌드: notify() 가 ERROR_NO_SUBSCRIBER 를 알려 주면 txDrain() 에서 버림
#endif
}

// =====================================================================
//  ESP32 하드웨어 계층 (BartenderCore 의 Hal 인터페이스 구현)
// =====================================================================
class EspHal : public sb::Hal {
 public:
  uint32_t nowMs() override { return millis(); }

  void pumpWrite(uint8_t i, bool on) override {
    if (i >= PUMP_COUNT) return;
    digitalWrite(PUMP_PINS[i], on ? RELAY_ON_LEVEL : RELAY_OFF_LEVEL);   // Active-LOW
  }

  // 이벤트 1줄 → USB 시리얼(항상) + BLE(연결돼 있고 알림을 구독했을 때만)
  void emitLine(const char* json, size_t len, bool droppable) override {
    Serial.write((const uint8_t*)json, len);
    Serial.write('\n');
    if (!gConnected || !bleSubscribed()) return;
    if (droppable && gTxUsed > TX_RING_SIZE / 4) return;   // 알림 폭주 방지: 밀려 있으면 progress 는 생략
    if (!txPush(json, len)) Serial.println(F("# [경고] BLE 송신 버퍼가 가득 차 이벤트 1개를 버렸습니다"));
  }

  // 유량값 1개를 NVS 에 저장. 이미 같은 값이 저장돼 있으면 플래시에 다시 쓰지 않음(플래시 수명 보호).
  // (setcal 을 받을 때만 호출되고, 제조 중에는 작업이 끝날 때까지 미뤄짐 → 쓰기 빈도는 매우 낮음)
  bool saveCal(uint8_t i, float mlps) override {
    if (!gPrefsOk) return false;
    char key[8];
    snprintf(key, sizeof(key), "mlps%u", (unsigned)(i + 1));
    if (gPrefs.isKey(key) && gPrefs.getFloat(key, -1.0f) == mlps) return true;
    return gPrefs.putFloat(key, mlps) == sizeof(float);
  }

  void onJobEnd(bool completed) override { beep(completed ? BEEP_DONE : BEEP_STOP); }

  void log(const char* msg) override { Serial.print(F("# ")); Serial.println(msg); }
};

static EspHal gHal;
static sb::Bartender gCore(gHal);

// =====================================================================
//  BLE 콜백 (※ BT 태스크에서 실행 — 여기서는 '기록'과 '큐에 넣기'만!)
// =====================================================================
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    (void)s;
    gBleAsm.hardReset();        // 이전 연결에서 남은 조각·상태를 모두 버림
#if defined(CONFIG_BLUEDROID_ENABLED)
    // 이 라이브러리는 연결이 끊겨도 CCCD(알림 구독) 값을 지우지 않아서, 새로 연결한 앱이 구독하기 전부터
    // "구독됨"으로 보입니다. BLE 규격(본딩 안 한 기기는 연결마다 초기화)대로 여기서 0 으로 되돌립니다.
    // BT 태스크 안에서 처리하므로 앱의 첫 구독 요청보다 항상 먼저 실행됩니다(순서 보장).
    if (gTxCccd) gTxCccd->setNotifications(false);
#endif
    gConnected = true;
  }
  void onDisconnect(BLEServer* s) override {
    (void)s;
    gConnected = false;
    gMtu = 23;
    gNeedAdvertise = true;      // loop() 에서 0.5초 뒤 광고 재시작 (진행 중 제조는 계속됨)
  }
#if defined(CONFIG_BLUEDROID_ENABLED)
  void onMtuChanged(BLEServer* s, esp_ble_gatts_cb_param_t* param) override {
    (void)s;
    gMtu = param->mtu.mtu;
  }
#elif defined(CONFIG_NIMBLE_ENABLED)
  void onMtuChanged(BLEServer* s, ble_gap_conn_desc* desc, uint16_t mtu) override {
    (void)s; (void)desc;
    gMtu = mtu;
  }
#endif
};

// 앱 → 기기: 받은 바이트를 줄 단위로 조립해 큐에 넣음
class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue();                  // 코어 3.x: Arduino String 반환
    const char* p = v.c_str();
    const size_t n = v.length();
    for (size_t i = 0; i < n; i++) {
      const sb::LineAssembler::Result r = gBleAsm.feed(p[i]);
      if (r == sb::LineAssembler::LINE) {
        gBleOut.type = 0;
        gBleOut.len = (uint16_t)gBleAsm.length();
        memcpy(gBleOut.data, gBleAsm.line(), gBleOut.len);
        gBleOut.data[gBleOut.len] = '\0';
        if (xQueueSend(gRxQueue, &gBleOut, 0) != pdTRUE) gRxDropped = gRxDropped + 1;
        gBleAsm.reset();
      } else if (r == sb::LineAssembler::TOO_LONG) {
        gBleOut.type = 1;
        gBleOut.len = 0;
        gBleOut.data[0] = '\0';
        if (xQueueSend(gRxQueue, &gBleOut, 0) != pdTRUE) gRxDropped = gRxDropped + 1;
      }
    }
  }
};

// 기기 → 앱: notify 결과 기록 (notify() 안에서 같은 태스크로 즉시 호출됨)
class TxCallbacks : public BLECharacteristicCallbacks {
  void onStatus(BLECharacteristic* c, Status s, uint32_t code) override {
    (void)c; (void)code;
    gNotifyStatus = (int)s;
  }
};

// =====================================================================
//  초기화 보조 함수
// =====================================================================

// 출력 핀을 '꺼짐' 레벨로 먼저 만든 뒤 출력 모드로 전환 (부팅 순간 펌프가 튀는 것 방지)
//  ※ ESP32 코어 3.x 에서는 pinMode() 전에 호출한 digitalWrite() 가 무시되므로,
//    ESP-IDF 의 gpio_set_level() 로 출력 레지스터를 먼저 원하는 값으로 써 둡니다.
//    → pinMode(OUTPUT) 순간 바로 그 값(HIGH = 릴레이 OFF)이 출력됩니다.
static void safeOutput(uint8_t pin, int offLevel) {
  gpio_set_level((gpio_num_t)pin, offLevel);
  pinMode(pin, OUTPUT);
  digitalWrite(pin, offLevel);
}

static const char* resetReasonText(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:  return "전원 켜짐";
    case ESP_RST_SW:       return "소프트웨어 재시작";
    case ESP_RST_PANIC:    return "오류(패닉)로 재시작";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "워치독 재시작";
    case ESP_RST_BROWNOUT: return "브라운아웃(전압 강하)! 펌프 전원/커패시터/배선 확인";
    case ESP_RST_EXT:      return "EN(리셋) 버튼";
    default:               return "기타";
  }
}

// NVS 에서 펌프별 유량값을 읽음. 반환값 = calSet 비트(키가 있고 값이 정상인 펌프만 1)
static uint16_t loadCalibration(float* cal) {
  uint16_t setMask = 0;
  gPrefsOk = gPrefs.begin(NVS_NAMESPACE, false);
  for (uint8_t i = 0; i < PUMP_COUNT; i++) {
    cal[i] = DEFAULT_MLPS;
    if (!gPrefsOk) continue;
    char key[8];
    snprintf(key, sizeof(key), "mlps%u", (unsigned)(i + 1));
    if (gPrefs.isKey(key)) {
      const float v = gPrefs.getFloat(key, DEFAULT_MLPS);
      if (v >= MIN_MLPS && v <= MAX_MLPS) { cal[i] = v; setMask |= (uint16_t)(1u << i); }
    }
  }
  if (!gPrefsOk) Serial.println(F("# [경고] NVS(Preferences) 열기 실패 — 유량값은 기본값 20ml/s 사용"));
  return setMask;
}

// BLE 라이브러리가 쌓아 둔 "휴대폰별 알림 구독 기록"(NVS) 비우기. 비어 있으면 아무것도 쓰지 않음.
static void clearBleCccdStore() {
  nvs_iterator_t it = nullptr;
  const esp_err_t e = nvs_entry_find(NVS_DEFAULT_PART_NAME, BLE_CCCD_NVS_NS, NVS_TYPE_ANY, &it);
  if (it) nvs_release_iterator(it);
  if (e != ESP_OK) return;                    // 기록 없음 → 플래시 쓰기 없이 끝
  Preferences p;
  if (p.begin(BLE_CCCD_NVS_NS, false)) {
    p.clear();
    p.end();
    Serial.println(F("# BLE 구독 기록(NVS) 정리 완료"));
  }
}

static void setupBle() {
  BLEDevice::init(gDeviceName);
  BLEDevice::setMTU(BLE_MTU_WANTED);
#if defined(CONFIG_BLUEDROID_ENABLED) && defined(CONFIG_IDF_TARGET_ESP32)
  BLEDevice::setPower(ESP_PWR_LVL_P9);   // 송신 출력 최대(+9dBm): 사람 많은 전시장에서도 연결 안정
#endif

  gServer = BLEDevice::createServer();
  gServer->setCallbacks(new ServerCallbacks());

  BLEService* svc = gServer->createService(NUS_SERVICE_UUID);

  gTxChar = svc->createCharacteristic(NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  gTxCccd = new BLE2902();                 // 앱이 "알림 켜기"를 할 수 있게 하는 CCCD 디스크립터
  gTxChar->addDescriptor(gTxCccd);
#endif
  gTxChar->setCallbacks(new TxCallbacks());

  BLECharacteristic* rx = svc->createCharacteristic(
      NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());

  svc->start();

  // 광고: 패킷 본체에는 NUS 서비스 UUID, 스캔 응답에는 장치 이름이 실림(코어가 자동 배치)
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

// =====================================================================
//  loop() 보조 함수
// =====================================================================
static void logRx(const char* src, const char* line, size_t len) {
  Serial.print(F("# <- "));
  Serial.print(src);
  Serial.print(F(": "));
  if (len > 120) { Serial.write((const uint8_t*)line, 120); Serial.println(F("...")); }
  else { Serial.write((const uint8_t*)line, len); Serial.println(); }
}

// USB 시리얼 입력 → 줄 조립 → 명령 처리
static void pollSerial() {
  int budget = 512;   // 한 번에 너무 오래 붙잡지 않도록 loop 1회당 최대 512바이트
  while (budget-- > 0 && Serial.available() > 0) {
    const char ch = (char)Serial.read();
    const sb::LineAssembler::Result r = gSerialAsm.feed(ch);
    if (r == sb::LineAssembler::LINE) {
      logRx("USB", gSerialAsm.line(), gSerialAsm.length());
      gCore.handleLine(gSerialAsm.line(), gSerialAsm.length());
      gSerialAsm.reset();
    } else if (r == sb::LineAssembler::TOO_LONG) {
      gCore.reportTooLong();
    }
  }
}

// BLE 수신 큐 → 명령 처리
static void pollBleQueue() {
  while (xQueueReceive(gRxQueue, &gLoopIn, 0) == pdTRUE) {
    if (gLoopIn.type == 1) { gCore.reportTooLong(); continue; }
    logRx("BLE", gLoopIn.data, gLoopIn.len);
    gCore.handleLine(gLoopIn.data, gLoopIn.len);
  }
  static uint32_t reported = 0;
  if (gRxDropped != reported) {
    reported = gRxDropped;
    Serial.printf("# [경고] BLE 수신 큐가 가득 차 명령을 버렸습니다 (누적 %lu개)\n", (unsigned long)reported);
  }
}

// 버튼: 제조 중 누르면 즉시 비상정지 / 대기 중 짧게 = 상태 출력 / (옵션) 길게 = 마지막 레시피 다시
static void updateButton(uint32_t now) {
  const bool r = digitalRead(PIN_BUTTON) == HIGH;
  if (r != gBtnLastRead) { gBtnLastRead = r; gBtnChangedAt = now; }

  if (r != gBtnStable && (uint32_t)(now - gBtnChangedAt) >= BUTTON_DEBOUNCE_MS) {
    gBtnStable = r;
    if (!r) {                                   // 눌림 (HIGH → LOW)
      gBtnPressedAt = now;
      gBtnConsumed = false;
      if (gCore.busy()) {                       // 제조 중이면 비상정지!
        gCore.stop("button");
        gBtnConsumed = true;
      }
    } else if (!gBtnConsumed) {                 // 짧게 눌렀다 뗌 (대기 중)
      beep(BEEP_SHORT);
      gCore.emitStatus();
    }
  }

#if BUTTON_REPEAT_LAST
  if (!gBtnStable && !gBtnConsumed && !gCore.busy() && (uint32_t)(now - gBtnPressedAt) >= BUTTON_LONG_PRESS_MS) {
    gBtnConsumed = true;
    gHal.log("버튼 길게 누름 → 마지막 레시피 다시 제조");
    gCore.repeatLast();
  }
#endif
}

// 상태 LED: 대기(미연결)=1초 주기로 천천히 깜빡 / 앱 연결됨=계속 켜짐 / 제조 중=빠르게 깜빡
static void updateLed(uint32_t now) {
  bool on;
  if (gCore.busy())    on = ((now / 100) % 2) == 0;
  else if (gConnected) on = true;
  else                 on = ((now / 500) % 2) == 0;
  digitalWrite(PIN_LED, on ? HIGH : LOW);
}

// 연결/해제 감지(로그, 송신 버퍼 정리) + 연결이 끊기면 0.5초 뒤 광고 재시작(실패하면 2초마다 재시도)
static void updateConnection(uint32_t now) {
  static bool was = false;
  const bool is = gConnected;
  if (is != was) {
    was = is;
    txClear();
    gNextNotifyAt = now + 200;   // 연결 직후 앱이 알림 구독할 시간을 조금 줌
    if (is) Serial.println(F("# BLE 연결됨"));
    else Serial.println(F("# BLE 연결 끊김 (진행 중인 제조는 끝까지 계속합니다)"));
  }
  if (gNeedAdvertise) {          // BT 태스크의 요청을 loop 전용 예약으로 옮김
    gNeedAdvertise = false;
    gAdvPending = true;
    gAdvAt = now + 500;
  }
  if (gConnected) { gAdvPending = false; return; }   // 이미 다시 연결됨 → 광고 불필요
  if (gAdvPending && (int32_t)(now - gAdvAt) >= 0) {
    if (BLEDevice::getAdvertising()->start()) {
      gAdvPending = false;
      Serial.println(F("# BLE 광고 재시작 — 앱에서 다시 연결할 수 있습니다"));
    } else {
      gAdvAt = now + 2000;
      Serial.println(F("# [경고] BLE 광고 재시작 실패 — 2초 뒤 다시 시도합니다"));
    }
  }
}

// =====================================================================
//  setup()
// =====================================================================
void setup() {
  // (1) 가장 먼저 릴레이 핀을 OFF(HIGH) 로 고정 — 부팅 중 펌프 오작동 방지
  for (uint8_t i = 0; i < PUMP_COUNT; i++) safeOutput(PUMP_PINS[i], RELAY_OFF_LEVEL);
  watchdogRelayOffBegin();   // 워치독이 걸리면 끌 릴레이 핀 목록 준비 (워치독을 켜기 전에)
  safeOutput(PIN_LED, LOW);
#if ENABLE_BUZZER
  safeOutput(PIN_BUZZER, !BUZZER_ON_LEVEL);
#endif
  pinMode(PIN_BUTTON, INPUT_PULLUP);

  // (2) USB 시리얼 (버퍼를 키워 이벤트 출력 때문에 펌프 타이밍이 밀리지 않게)
  Serial.setRxBufferSize(1024);
  Serial.setTxBufferSize(2048);
  Serial.begin(SERIAL_BAUD);

  // (3) 장치 이름: SmartBartender-XXXX (블루투스 MAC 주소 하위 2바이트)
  uint8_t mac[6] = {0};
  esp_read_mac(mac, ESP_MAC_BT);
  snprintf(gDeviceName, sizeof(gDeviceName), "%s-%02X%02X", DEVICE_NAME_PREFIX, mac[4], mac[5]);

  // (4) 유량 캘리브레이션 불러오기 → 두뇌(core) 시작 (+ BLE 구독 기록 정리: BLE 시작 전에)
  float cal[MAX_PUMPS];
  const uint16_t calSetMask = loadCalibration(cal);
  gCore.begin(gDeviceName, cal, calSetMask);
  clearBleCccdStore();

  // (5) BLE 수신 큐 + BLE 시작
  gRxQueue = xQueueCreate(RX_QUEUE_DEPTH, sizeof(RxMsg));
  setupBle();

  Serial.println();
  Serial.println(F("# ==========================================="));
  Serial.printf("# AI 스마트 바텐더 펌웨어 v%s\n", FW_VERSION);
  Serial.printf("# 장치 이름: %s / 펌프 %d개\n", gDeviceName, PUMP_COUNT);
  Serial.printf("# 리셋 원인: %s\n", resetReasonText(esp_reset_reason()));
  for (uint8_t i = 0; i < PUMP_COUNT; i++) {
    Serial.printf("# 펌프 %u 유량 %.2f ml/s %s\n", (unsigned)(i + 1), (double)cal[i],
                  (calSetMask & (1u << i)) ? "(캘리브레이션 완료)" : "(기본값 - 캘리브레이션 전, 실제보다 적게 나올 수 있음)");
  }
  Serial.println(F("# BLE 광고 시작. 시리얼 모니터(115200, 줄바꿈 'Newline')에서도 명령 가능:"));
  Serial.println(F("#   {\"cmd\":\"hello\"}   {\"cmd\":\"run\",\"p\":1,\"ms\":3000}   {\"cmd\":\"stop\"}"));
  Serial.println(F("# ==========================================="));
  gCore.emitInfo();
  beep(BEEP_SHORT);

#if ENABLE_LOOP_WDT
  // (6) loop() 워치독 켜기 (5초 동안 loop() 가 한 바퀴도 못 돌면 재시작 — 코어 설정 CONFIG_ESP_TASK_WDT_PANIC)
  //     시간이 초과되면 WatchdogRelayOff.cpp 의 esp_task_wdt_isr_user_handler() 가 릴레이를 먼저 끈 뒤 재시작합니다.
  //     setup() 의 BLE 초기화처럼 오래 걸리는 일이 모두 끝난 뒤에 켭니다.
  enableLoopWDT();
#endif
}

// =====================================================================
//  loop() — 절대 멈추지(delay) 않고 빠르게 계속 돈다
// =====================================================================
void loop() {
  const uint32_t now = millis();

  gCore.update();          // ① 펌프 타이밍 (가장 먼저 — 정확한 양을 위해)
  updateButton(now);       // ② 비상정지 버튼
  pollBleQueue();          // ③ BLE 로 들어온 명령
  pollSerial();            // ④ USB 시리얼로 들어온 명령 (make 를 받으면 그 자리에서 첫 펌프 ON)
  updateConnection(now);   // ⑤ 연결 상태 / 광고 재시작
  txDrain(now);            // ⑥ BLE 알림 전송 (MTU 크기 조각, 10ms 간격)
  updateLed(now);          // ⑦ 상태 LED
  updateBuzzer(now);       // ⑧ 부저
}
