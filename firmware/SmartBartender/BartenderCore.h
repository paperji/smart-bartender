/*
 * BartenderCore.h — 스마트 바텐더 v2 의 "두뇌" (하드웨어와 무관한 순수 로직)
 * ------------------------------------------------------------------------
 * 이 파일에는 다음이 들어 있습니다.
 *   1) LineAssembler : 조각조각 들어오는 바이트를 '한 줄(JSON 1개)'로 조립
 *   2) Bartender     : 명령(JSON) 해석 → 검증 → 펌프 작업 상태머신 → 이벤트(JSON) 생성
 *
 * 왜 따로 분리했나요?
 *   - ESP32 전용 코드(BLE, GPIO, 플래시)는 SmartBartender.ino 에만 있고,
 *     이 파일은 "시간(ms) 읽기 / 펌프 켜고 끄기 / 이벤트 내보내기" 같은 최소한의 기능을
 *     Hal(하드웨어 추상화 계층) 인터페이스로만 요청합니다.
 *   - 그래서 같은 코드를 PC 에서도 컴파일해 '가짜 시계'로 수천 번 시험(단위 테스트)할 수 있고,
 *     실제 기기에서도 똑같이 동작합니다. (논문/발표: "하드웨어 추상화를 통한 검증 가능한 설계")
 *
 * 핵심 설계 원칙
 *   - delay() 를 전혀 쓰지 않는 millis() 기반 비차단 상태머신:
 *       loop() 가 돌 때마다 update() 가 "지금 시각"을 보고 켤 펌프는 켜고 끌 펌프는 끕니다.
 *       → 제조 중에도 정지 명령·버튼·BLE 통신을 즉시 처리할 수 있습니다.
 *   - 펌프 구동시간(ms) = 양(ml) ÷ 유량(ml/s) × 1000  (펌프별 유량은 캘리브레이션 값)
 *   - 안전: 검증 실패 시 아무 펌프도 켜지 않음. 펌프 1개 최대 make 120초 / run 60초 / clean 30초,
 *           (그 상한 + 1초) 이상 켜져 있으면 강제 정지.
 *   - 시간 비교는 모두 (uint32_t)(지금 - 시작) 형태 → millis() 가 49.7일 뒤 0 으로 돌아가도(오버플로) 정상 동작.
 */
#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <cmath>
#include <ArduinoJson.h>
#include "config.h"

#if (PUMP_COUNT < 1) || (PUMP_COUNT > MAX_PUMPS)
#error "PUMP_COUNT 는 1 ~ 8 사이여야 합니다 (config.h)"
#endif

namespace sb {

// =====================================================================
//  하드웨어 추상화 인터페이스 (ESP32 에서는 .ino 가, PC 테스트에서는 가짜 객체가 구현)
// =====================================================================
class Hal {
 public:
  virtual ~Hal() {}
  virtual uint32_t nowMs() = 0;                                  // 부팅 후 경과 시간(ms) = millis()
  virtual void pumpWrite(uint8_t index0, bool on) = 0;           // 펌프(0부터) 릴레이 켜기/끄기
  virtual void emitLine(const char* json, size_t len, bool droppable) = 0;  // 이벤트 1줄 송신(시리얼+BLE)
  virtual bool saveCal(uint8_t index0, float mlps) = 0;          // 유량값 플래시(NVS) 저장
  virtual void onJobEnd(bool completed) { (void)completed; }     // 작업 종료 알림(부저 등). completed=false 면 중단
  virtual void log(const char* msg) { (void)msg; }               // 사람이 읽는 로그(시리얼에 "# ..." 로 출력)
};

// 소수 첫째/둘째 자리 반올림 (JSON 출력용. 음수는 들어오지 않음)
inline double round1(double x) { return std::floor(x * 10.0 + 0.5) / 10.0; }
inline double round2(double x) { return std::floor(x * 100.0 + 0.5) / 100.0; }

// =====================================================================
//  1) LineAssembler — 줄 단위 메시지 조립기 (SPEC §2.2 프레이밍)
// =====================================================================
//  - BLE 는 한 번에 20~244 바이트씩 나뉘어 도착하므로, '\n'(줄바꿈)이 나올 때까지 모아서 한 메시지로 만듭니다.
//  - 최대 RX_MAX_LEN(1024) 바이트. 넘으면 그 메시지는 끝('\n')까지 통째로 버리고 TOO_LONG 을 1번 알립니다.
//  - 편의 기능: '{' 로 시작한 JSON 의 괄호가 완전히 닫히면 '\n' 이 없어도 한 메시지로 인정합니다.
//      (nRF Connect 처럼 줄바꿈 입력이 불편한 테스트 앱 대응. 문자열 "..." 안의 괄호는 무시)
//      앱이 '\n' 을 붙여 보내면 그 '\n' 은 빈 줄로 처리되어 무시되므로 SPEC 과 충돌하지 않습니다.
//  - 괄호가 닫혀 메시지가 끝난 직후에는, 다음 '{' 또는 줄바꿈이 올 때까지 들어오는 글자를 버립니다.
//      예) 오타로 {"cmd":"ping"}} 처럼 '}' 를 하나 더 보내도, 남은 '}' 는 버려지고
//          그 뒤에 줄바꿈 없이 보낸 {"cmd":"stop"} 이 정상적으로 처리됩니다.
//      (이 규칙이 없으면 남은 '}' 가 '객체가 아닌 메시지'로 취급되어 '\n' 이 올 때까지 이후 명령이 모두 무시됨)
class LineAssembler {
 public:
  enum Result : uint8_t { NONE = 0, LINE = 1, TOO_LONG = 2 };

  LineAssembler() { hardReset(); }

  // 1바이트 입력. LINE 이 반환되면 line()/length() 로 꺼낸 뒤 반드시 reset() 을 호출합니다.
  Result feed(char c) {
    if (c == '\n' || c == '\r') {            // 줄 끝
      afterClose_ = false;                    // 줄바꿈 = 확실한 메시지 경계 → 쓰레기 버리기 모드 해제
      if (skipping_) { reset(); return NONE; }   // 너무 긴 메시지의 끝 → 버리기 완료
      if (len_ == 0) { reset(); return NONE; }   // 빈 줄은 무시
      buf_[len_] = '\0';
      return LINE;
    }
    if (afterClose_ && !skipping_ && shape_ == 0 && len_ == 0) {
      if (c != '{') return NONE;              // 괄호로 끝난 메시지 뒤에 남은 글자(오타 '}' 등) → 버림
      afterClose_ = false;                    // 새 JSON 객체 시작
    }
    const bool closed = trackBraces(c);       // JSON 괄호 추적 (버리는 중에도 계속 추적)
    if (skipping_) {
      if (closed) { reset(); afterClose_ = true; }   // 너무 긴 JSON 객체가 닫힘 → 버리기 완료
      return NONE;
    }
    if (shape_ == 0 && isSpace(c)) return NONE;  // 메시지 앞쪽 공백은 저장하지 않음
    if (len_ >= RX_MAX_LEN) {                 // 1024 바이트 초과!
      len_ = 0;
      skipping_ = true;                       // 이 메시지의 나머지는 끝까지 버림
      if (closed) { reset(); afterClose_ = true; }
      return TOO_LONG;
    }
    buf_[len_++] = c;
    if (closed) { buf_[len_] = '\0'; afterClose_ = true; return LINE; }
    return NONE;
  }

  const char* line() const { return buf_; }
  size_t length() const { return len_; }

  // 다음 메시지를 받을 준비 (LINE 처리 후 호출). '괄호로 끝난 직후' 표시(afterClose_)는 유지합니다.
  void reset() {
    len_ = 0; skipping_ = false; shape_ = 0; depth_ = 0; inStr_ = false; esc_ = false;
    buf_[0] = '\0';
  }

  // 완전 초기화 (생성 시 / 새 BLE 연결 시): 이전 연결의 상태를 하나도 남기지 않음
  void hardReset() { reset(); afterClose_ = false; }

 private:
  static bool isSpace(char c) { return c == ' ' || c == '\t'; }

  // '{' 로 시작하는 메시지의 괄호 깊이를 추적. 가장 바깥 '}' 가 닫히는 순간 true.
  bool trackBraces(char c) {
    if (shape_ == 0) {                        // 아직 첫 글자 전
      if (c == '{') { shape_ = 1; depth_ = 1; }
      else if (!isSpace(c)) shape_ = 2;       // 객체가 아닌 메시지 → '\n' 까지 기다림(파싱 시 BAD_JSON)
      return false;
    }
    if (shape_ != 1) return false;
    if (inStr_) {                             // "문자열" 안: 괄호 무시, \" 이스케이프 처리
      if (esc_) esc_ = false;
      else if (c == '\\') esc_ = true;
      else if (c == '"') inStr_ = false;
      return false;
    }
    if (c == '"') { inStr_ = true; return false; }
    if (c == '{') { depth_++; return false; }
    if (c == '}') { depth_--; return depth_ == 0; }
    return false;
  }

  char buf_[RX_MAX_LEN + 1];
  size_t len_;
  bool skipping_;   // 1024 초과 메시지를 버리는 중
  uint8_t shape_;   // 0=판단 전, 1=JSON 객체, 2=기타
  int16_t depth_;
  bool inStr_;
  bool esc_;
  bool afterClose_;   // 직전 메시지가 '\n' 이 아니라 괄호 닫힘으로 끝났음 → 다음 '{' 전의 글자는 버림
};

// =====================================================================
//  2) 작업(Job) 자료구조
// =====================================================================
enum class Kind : uint8_t { None = 0, Make, Run, Clean };   // 작업 종류: 제조 / 단일 펌프 구동 / 세척

inline const char* kindName(Kind k) {
  switch (k) {
    case Kind::Make:  return "make";
    case Kind::Run:   return "run";
    case Kind::Clean: return "clean";
    default:          return "none";
  }
}

enum class SlotState : uint8_t { Wait = 0, On, Done };      // 펌프 슬롯 상태: 대기 / 구동 중 / 완료

// "슬롯" = 작업 안에서 펌프 1개가 맡은 일 (몇 번 펌프를, 몇 ms 동안, 몇 ml)
struct Slot {
  uint8_t pump;        // 펌프 번호(1부터)
  double targetMl;     // 목표량(ml)
  uint32_t targetMs;   // 목표 구동시간(ms) = targetMl / 유량 × 1000
  uint32_t offsetMs;   // 병렬 모드: 작업 시작 후 이 시각에 켬(지연 기동)
  uint32_t startAt;    // 실제로 켠 시각(millis)
  uint32_t ranMs;      // 실제 구동한 시간(완료 시 기록)
  SlotState state;
};

struct PumpMl { uint8_t p; double ml; };   // 검증·합산이 끝난 (펌프, 양) 쌍

// 끝난 작업 1개의 결과 = status 이벤트의 "last" (SPEC §2.4)
//   앱이 BLE 가 끊긴 동안 끝난 작업의 결과(완료/중단·나온 양)를 재연결 후 status 로 확인하는 데 씁니다.
//   부팅 직후에는 kind = None → "last":null. 전원이 꺼지면 사라집니다(플래시에 저장하지 않음).
struct JobResult {
  Kind kind;                     // None = 아직 끝난 작업 없음
  char id[ID_MAX_LEN + 1];       // 작업 id (make 의 레시피 id / 버튼 다시 만들기 "btn…" / "run" / "clean")
  bool stopped;                  // false = done(완료), true = stopped(중단)
  char reason[8];                // stopped 일 때만: "user" | "button" | "error"
  uint8_t n;                     // dispensed 개수
  PumpMl dispensed[MAX_PUMPS];   // done/stopped 이벤트에 보낸 것과 똑같은 값(소수 1자리 반올림이 끝난 값)
};

struct Job {
  Kind kind;                   // None 이면 대기(idle)
  char id[ID_MAX_LEN + 1];     // 레시피 id ("r1730000000" / 버튼 다시 만들기 "btn123456" / "run" / "clean")
  bool parallel;               // false=순차(seq), true=병렬(par)
  uint8_t count;               // 슬롯 개수
  Slot slots[MAX_PUMPS];
  // ---- 실행 중 상태 ----
  uint8_t cur;                 // 순차 모드: 현재 슬롯 번호
  bool inGap;                  // 순차 모드: 펌프 사이 300ms 휴지 중인가?
  uint32_t gapStart;
  uint32_t startedAt;          // 작업 시작 시각
  uint32_t totalMs;            // 예상 소요시간(ack 의 totalMs)
  uint32_t lastProgressAt;     // 마지막 progress 전송 시각
  uint8_t rr;                  // 병렬 모드 progress 순번(라운드로빈)
};

// =====================================================================
//  3) Bartender — 명령 처리 + 상태머신
// =====================================================================
class Bartender {
 public:
  explicit Bartender(Hal& hal) : hal_(hal) {
    memset(&job_, 0, sizeof(job_));
    memset(&last_, 0, sizeof(last_));
    memset(&result_, 0, sizeof(result_));   // kind = None → status 의 "last":null
    for (uint8_t i = 0; i < MAX_PUMPS; i++) { cal_[i] = DEFAULT_MLPS; pumpOn_[i] = false; pumpOnSince_[i] = 0; }
    strncpy(name_, DEVICE_NAME_PREFIX, sizeof(name_) - 1);
    name_[sizeof(name_) - 1] = '\0';
  }

  // 부팅 시 1회: 장치 이름, 저장돼 있던 유량값(PUMP_COUNT 개), 그리고
  // calSetMask = 플래시(NVS)에 캘리브레이션 값이 저장돼 있는 펌프 표시(비트 0 = 펌프1, 비트 1 = 펌프2 ...)
  void begin(const char* deviceName, const float* cal, uint16_t calSetMask = 0) {
    strncpy(name_, deviceName, sizeof(name_) - 1);
    name_[sizeof(name_) - 1] = '\0';
    calSet_ = 0;
    for (uint8_t i = 0; i < PUMP_COUNT; i++) {
      const float v = cal ? cal[i] : DEFAULT_MLPS;
      if (v >= MIN_MLPS && v <= MAX_MLPS) {
        cal_[i] = v;
        if (cal && (calSetMask & (1u << i))) calSet_ |= (uint16_t)(1u << i);
      } else {
        cal_[i] = DEFAULT_MLPS;      // 이상한 값이면 기본값 + "캘리브레이션 전"(calSet 0) 으로 취급
      }
    }
    allOff();
  }

  bool busy() const { return job_.kind != Kind::None; }
  const float* cal() const { return cal_; }
  bool calSet(uint8_t index0) const { return ((calSet_ >> index0) & 1u) != 0; }   // 펌프(0부터) 캘리브레이션 완료?

  // ---------------- 수신한 1줄(JSON) 처리 ----------------
  void handleLine(const char* line, size_t len) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, line, len);
    if (err) { sendError("BAD_JSON", "JSON 형식이 올바르지 않습니다"); return; }
    if (!doc.is<JsonObjectConst>()) { sendError("BAD_JSON", "JSON 객체({...}) 형식이어야 합니다"); return; }
    JsonObjectConst o = doc.as<JsonObjectConst>();

    JsonVariantConst c = o["cmd"];
    if (!c.is<const char*>()) { sendError("UNKNOWN_CMD", "cmd 항목이 없습니다"); return; }
    const char* cmd = c.as<const char*>();

    if      (strcmp(cmd, "hello")  == 0) emitInfo();
    else if (strcmp(cmd, "status") == 0) emitStatus();
    else if (strcmp(cmd, "ping")   == 0) emitPong();
    else if (strcmp(cmd, "make")   == 0) cmdMake(o);
    else if (strcmp(cmd, "stop")   == 0) stop("user");
    else if (strcmp(cmd, "run")    == 0) cmdRun(o);
    else if (strcmp(cmd, "clean")  == 0) cmdClean(o);
    else if (strcmp(cmd, "setcal") == 0) cmdSetCal(o);
    else if (strcmp(cmd, "getcal") == 0) emitCal();
    else {
      char shown[24 + 1];               // 받은 cmd 를 최대 24바이트만 보여 줌(한글이 글자 중간에서 잘리지 않게, 제어문자는 '?')
      copyUtf8(shown, cmd, sizeof(shown) - 1);
      char msg[80];
      snprintf(msg, sizeof(msg), "알 수 없는 명령입니다: %s", shown);
      sendError("UNKNOWN_CMD", msg);
    }
  }

  // 1024 바이트를 넘는 메시지를 받았을 때 (LineAssembler 가 TOO_LONG 반환)
  void reportTooLong() { sendError("TOO_LONG", "명령이 너무 깁니다 (최대 1024바이트)"); }

  // ---------------- loop() 마다 호출: 펌프 타이밍 처리 ----------------
  void update() {
    const uint32_t now = hal_.nowMs();
    if (safetyCheck(now)) return;            // 안전 감시 (작업 상한 + 1초 이상 켜짐 → 강제 정지)
    if (busy()) {
      advance(now);                          // 켤 펌프 켜고, 끌 펌프 끄기
      if (busy() && (uint32_t)(now - job_.lastProgressAt) >= PROGRESS_INTERVAL_MS) {
        job_.lastProgressAt = now;
        emitProgress(now);                   // 약 250ms 마다 진행률 알림
      }
    }
    if (!busy() && calDirty_) flushCal();    // 제조 중 받은 유량값은 작업이 끝난 뒤 플래시에 저장
  }

  // ---------------- 정지 (앱의 stop 명령 / 물리 버튼) ----------------
  // reason: "user"(앱) | "button"(버튼) | "error"(안전 감시)
  void stop(const char* reason) {
    allOff();                                // 무엇보다 먼저 모든 펌프 OFF
    if (!busy()) { emitStatus(); return; }   // 진행 중 작업이 없으면 현재 상태만 응답
    abortJob(reason, hal_.nowMs());
  }

  // ---------------- 버튼 길게 누르기: 마지막 레시피 다시 만들기 (BUTTON_REPEAT_LAST) ----------------
  //   다시 만든 잔은 앱이 보낸 원래 작업과 '다른 작업'이므로 새 id = "btn" + 기동 후 ms (예: "btn123456") 를 씁니다.
  //   원래 id 를 다시 쓰면, BLE 가 끊긴 사이 원래 작업이 버튼으로 중단되고 다시 만든 잔이 끝났을 때
  //   status.last(id 같음)를 앱이 '원래 작업의 결과'로 잘못 확정합니다(SPEC §2.4 재연결 판정 ②).
  //   항상 ASCII 13바이트 이하라 id 40바이트 제한·UTF-8 경계와 무관합니다.
  bool repeatLast() {
    if (busy()) { sendError("BUSY", "이미 제조 중입니다"); return false; }
    if (!hasLast_) { hal_.log("다시 만들 레시피가 없습니다 (앱에서 먼저 1번 제조하세요)"); return false; }
    char id[ID_MAX_LEN + 1];
    snprintf(id, sizeof(id), "btn%lu", (unsigned long)hal_.nowMs());
    if (!buildMakeJob(last_.list, last_.n, last_.parallel, id)) return false;
    startJob();
    return true;
  }

  // ---------------- 이벤트 송신 ----------------
  void emitInfo() {
    JsonDocument d;
    d["ev"] = "info";
    d["fw"] = FW_VERSION;
    d["name"] = (const char*)name_;
    d["pumps"] = PUMP_COUNT;
    addCalArrays(d);                         // "cal":[...], "calSet":[...]
    d["maxMl"] = (int)MAX_TOTAL_ML;
    d["maxStepMl"] = (int)MAX_STEP_ML;
    d["maxPumpMs"] = (uint32_t)MAX_PUMP_MS;
    d["state"] = busy() ? "running" : "idle";
    send(d);
  }

  // status: 현재 상태 + 부팅 후 마지막으로 끝난 작업(last). SPEC §2.4
  //   {"ev":"status","state":"idle","job":null,"last":{"id":"r1","kind":"make","result":"done","dispensed":[{"p":1,"ml":45}]}}
  //   {"ev":"status","state":"running","job":{"id":"r2","kind":"make","pct":42},"last":null}
  //   제조 중(running)일 때의 last 는 '지금 작업 바로 전에' 끝난 작업입니다.
  void emitStatus() {
    JsonDocument d;
    d["ev"] = "status";
    if (busy()) {
      d["state"] = "running";
      JsonObject j = d["job"].to<JsonObject>();
      j["id"] = (const char*)job_.id;
      j["kind"] = kindName(job_.kind);
      j["pct"] = pct(hal_.nowMs());
    } else {
      d["state"] = "idle";
      d["job"] = nullptr;
    }
    if (result_.kind == Kind::None) {
      d["last"] = nullptr;                   // 부팅 후 아직 끝난 작업이 없음
    } else {
      JsonObject l = d["last"].to<JsonObject>();
      l["id"] = (const char*)result_.id;
      l["kind"] = kindName(result_.kind);
      l["result"] = result_.stopped ? "stopped" : "done";
      if (result_.stopped) l["reason"] = (const char*)result_.reason;
      addDispensed(l["dispensed"].to<JsonArray>(), result_);
    }
    send(d);
  }

  // 이벤트 출력 버퍼 크기(바이트). 이벤트 1줄은 최대 OUT_BUF_SIZE-1 바이트('\n' 제외)이고,
  // 더 길면 잘라서 보내지 않고 통째로 버립니다(로그만 남김 → 앱이 깨진 JSON 을 받는 일은 없음).
  //   가장 긴 이벤트 = 제조 중 status(job + last). 펌프 8개 · id 40바이트 기준 이론상 최댓값:
  //     고정 글자 157 ({"ev":"status","state":"running","job":{"id":"…","kind":"clean","pct":99},
  //                    "last":{"id":"…","kind":"clean","result":"stopped","reason":"button","dispensed":[…]}})
  //     + id 2개 160 (각 40바이트. " \ 처럼 이스케이프되는 글자로만 채워도 2배 = 80. 제어문자는 copyUtf8 이 '?' 로 바꿈)
  //     + dispensed 8개 199 ({"p":8,"ml":숫자} 각 최대 24바이트(숫자는 ArduinoJson 출력 최대 11글자) + 쉼표 7)
  //     = 516 바이트 < 639  → 640 으로 충분 (test/host_test_8.cpp 가 펌프 8개로 직접 재서 확인)
  static constexpr size_t OUT_BUF_SIZE = 640;

 private:
  // ======================= 명령별 처리 =======================

  // make: {"cmd":"make","id":"r1","mode":"seq","steps":[{"p":1,"ml":45},{"p":3,"ml":30.5}]}
  // 검증 순서는 SPEC §2.3 과 똑같이 "위에서부터 차례로" (앱·데모 기기와 같은 오류 코드가 나오도록):
  //   ① mode → ② steps 누락/빈 배열 → ③ steps 9개 이상
  //   ④ step 마다 (앞에서부터) p → ml          ⑤ 같은 펌프 합산
  //   ⑥ 펌프별 합계 ≤ 300ml → ⑦ 총합 ≤ 500ml → ⑧ 펌프별 구동시간 ≤ 120초
  void cmdMake(JsonObjectConst o) {
    if (busy()) { sendError("BUSY", "이미 제조 중입니다"); return; }

    // ① 모드: 생략(또는 null) 시 seq(순차). 그 밖의 값은 BAD_JSON
    bool par = false;
    JsonVariantConst m = o["mode"];
    if (!m.isNull()) {
      const char* ms = m.is<const char*>() ? m.as<const char*>() : nullptr;
      if (ms && strcmp(ms, "par") == 0) par = true;
      else if (!ms || strcmp(ms, "seq") != 0) { sendError("BAD_JSON", "mode 는 \"seq\" 또는 \"par\" 만 가능합니다"); return; }
    }

    // ②③ 재료 목록 개수: 1 ~ 8 (배열이 아니면 '누락'으로 봄)
    JsonArrayConst steps = o["steps"].as<JsonArrayConst>();
    if (steps.isNull() || steps.size() == 0) { sendError("BAD_AMOUNT", "steps(재료 목록)가 비어 있습니다"); return; }
    if (steps.size() > MAX_STEPS) { sendError("LIMIT", "재료(steps)는 최대 8개까지 가능합니다"); return; }

    // ④⑤ 각 재료 검사(p 먼저, 그다음 ml) + 같은 펌프는 합산(처음 나온 순서 유지)
    //    합계 검사(⑥⑦)는 모든 step 검사가 끝난 뒤에 합니다. (뒤쪽 step 의 BAD_PUMP 를 가리지 않도록)
    PumpMl merged[MAX_PUMPS];
    uint8_t n = 0;
    double total = 0;
    for (JsonVariantConst st : steps) {
      uint8_t p;
      if (!readPump(st["p"], p)) { sendBadPump(); return; }
      double ml;
      if (!readNumber(st["ml"], ml) || !(ml > 0.0)) { sendError("BAD_AMOUNT", "양(ml)은 0보다 큰 숫자여야 합니다"); return; }
      ml = quantizeMl(ml);
      if (ml > MAX_STEP_ML + 1e-9) { sendError("LIMIT", "재료 1개는 최대 300ml 까지 가능합니다"); return; }
      uint8_t k = 0;
      while (k < n && merged[k].p != p) k++;
      if (k == n) { merged[n].p = p; merged[n].ml = 0; n++; }
      merged[k].ml += ml;
      total += ml;
    }

    // ⑥ 합산 후 펌프별 300ml 이하 (예: 같은 펌프 200 + 200 = 400 → LIMIT). 부동소수 오차 1e-6 허용
    for (uint8_t k = 0; k < n; k++) {
      if (merged[k].ml > MAX_STEP_ML + 1e-6) {
        char msg[120];
        const double shown = std::ceil(merged[k].ml * 10.0 - 1e-6) / 10.0;   // 300.04 → "300.1" (항상 300 보다 크게 표시)
        snprintf(msg, sizeof(msg), "펌프 %u 의 합계 %.1fml 가 최대 300ml 를 넘습니다", (unsigned)merged[k].p, shown);
        sendError("LIMIT", msg);
        return;
      }
    }
    // ⑦ 총량 500ml 이하
    if (total > MAX_TOTAL_ML + 1e-6) { sendError("LIMIT", "총량은 최대 500ml 까지 가능합니다"); return; }

    // id: 문자열이면 최대 40바이트로 잘라 사용(제어문자는 '?' 로), 없거나 빈 문자열이면 "make"
    char id[ID_MAX_LEN + 1];
    JsonVariantConst iv = o["id"];
    const char* idStr = iv.is<const char*>() ? iv.as<const char*>() : nullptr;
    copyUtf8(id, (idStr && idStr[0]) ? idStr : "make", ID_MAX_LEN);

    // ⑧ 펌프별 구동시간 계산 + 120초 검사 → 작업 준비
    if (!buildMakeJob(merged, n, par, id)) return;

    // 버튼 '다시 만들기'용으로 기억 (재료·모드만. 다시 만든 잔은 새 id 를 씀 → repeatLast)
    memcpy(last_.list, merged, sizeof(PumpMl) * n);
    last_.n = n; last_.parallel = par;
    hasLast_ = true;

    startJob();
  }

  // run: {"cmd":"run","p":2,"ms":10000} — 캘리브레이션 측정·프라이밍(튜브에 액체 채우기)용
  //   p 오류 → BAD_PUMP, ms 가 숫자가 아니거나 ≤ 0 → BAD_AMOUNT, ms > 60000 → LIMIT (p 를 먼저 검사)
  void cmdRun(JsonObjectConst o) {
    if (busy()) { sendError("BUSY", "이미 제조 중입니다"); return; }
    uint8_t p;
    if (!readPump(o["p"], p)) { sendBadPump(); return; }
    double ms;
    if (!readNumber(o["ms"], ms) || !(ms > 0.0)) { sendError("BAD_AMOUNT", "구동시간(ms)은 0보다 큰 숫자여야 합니다"); return; }
    if (ms > (double)MAX_RUN_MS) { sendError("LIMIT", "구동시간은 최대 60000ms(60초) 입니다"); return; }

    prepareJob(Kind::Run, "run", false);
    addSlotByTime(p, roundMs(ms));
    startJob();
  }

  // clean: {"cmd":"clean","ms":5000} — 모든 펌프를 차례로 ms 동안 구동(세척/물 빼기)
  //   ms 가 숫자가 아니거나 ≤ 0 → BAD_AMOUNT, ms > 30000 → LIMIT
  void cmdClean(JsonObjectConst o) {
    if (busy()) { sendError("BUSY", "이미 제조 중입니다"); return; }
    double ms;
    if (!readNumber(o["ms"], ms) || !(ms > 0.0)) { sendError("BAD_AMOUNT", "세척 시간(ms)은 0보다 큰 숫자여야 합니다"); return; }
    if (ms > (double)CLEAN_MAX_MS) { sendError("LIMIT", "세척 시간은 펌프당 최대 30000ms(30초) 입니다"); return; }

    prepareJob(Kind::Clean, "clean", false);
    for (uint8_t p = 1; p <= PUMP_COUNT; p++) addSlotByTime(p, roundMs(ms));
    startJob();
  }

  // setcal: {"cmd":"setcal","p":2,"mlps":18.5} — 펌프 유량 저장. 응답은 cal 이벤트
  void cmdSetCal(JsonObjectConst o) {
    uint8_t p;
    if (!readPump(o["p"], p)) { sendBadPump(); return; }
    double v;
    if (!readNumber(o["mlps"], v) || v < (double)MIN_MLPS - 1e-9 || v > (double)MAX_MLPS + 1e-9) {
      sendError("BAD_AMOUNT", "유량(mlps)은 0.5 ~ 100 사이 숫자여야 합니다");
      return;
    }
    cal_[p - 1] = (float)v;
    calSet_ |= (uint16_t)(1u << (p - 1));      // 이제 이 펌프는 "캘리브레이션 완료"(calSet 1)
    calDirty_ |= (uint16_t)(1u << (p - 1));
    // 제조 중에는 플래시 쓰기(수 ms~수십 ms 정지 가능)를 미뤄 펌프 타이밍 정확도를 지킴.
    // 이미 시작된 작업의 구동시간은 시작 시점 값으로 고정되어 있어 영향 없음.
    if (!busy()) flushCal();
    emitCal();
  }

  // ======================= 작업 준비 / 시작 =======================

  void prepareJob(Kind kind, const char* id, bool parallel) {
    memset(&job_, 0, sizeof(job_));
    job_.kind = Kind::None;          // startJob() 에서 실제 종류로 바뀜(그 전까지는 대기 상태)
    pendingKind_ = kind;
    copyUtf8(job_.id, id, ID_MAX_LEN);
    job_.parallel = parallel;
  }

  // 시간(ms)으로 슬롯 추가 (run/clean): 예상량 = ms × 유량 / 1000
  void addSlotByTime(uint8_t p, uint32_t ms) {
    Slot& s = job_.slots[job_.count++];
    memset(&s, 0, sizeof(s));
    s.pump = p;
    s.targetMs = ms < 1 ? 1 : ms;
    s.targetMl = (double)s.targetMs * (double)cal_[p - 1] / 1000.0;
  }

  // 펌프 구동시간(ms, 정수 반올림) = ml ÷ 유량 × 1000
  uint32_t pumpMs(uint8_t p, double ml) const {
    const uint32_t ms = roundMs(ml / (double)cal_[p - 1] * 1000.0);
    return ms < 1 ? 1 : ms;
  }

  // 레시피(펌프,ml 목록) → 슬롯 생성. 120초 초과 펌프가 있으면 LIMIT 오류 후 false
  //   (실제로 켜질 시간 = 반올림한 정수 ms 로 비교 → 예: 유량 0.5 에서 60ml = 정확히 120000ms 는 통과)
  bool buildMakeJob(const PumpMl* list, uint8_t n, bool par, const char* id) {
    for (uint8_t i = 0; i < n; i++) {
      const uint32_t ms = pumpMs(list[i].p, list[i].ml);
      if (ms > MAX_PUMP_MS) {
        char msg[160];
        // 0.1초 단위 올림 → 120.04초가 '120.0초가 최대 120초를 넘습니다'로 보이지 않게 (위 합계 문구·앱과 같은 방식)
        const double shownSec = std::ceil((double)ms / 100.0) / 10.0;
        snprintf(msg, sizeof(msg), "펌프 %u 구동시간 %.1f초가 최대 120초를 넘습니다 (양을 줄이거나 유량 보정값 확인)",
                 (unsigned)list[i].p, shownSec);
        sendError("LIMIT", msg);
        return false;
      }
    }
    prepareJob(Kind::Make, id, par);
    for (uint8_t i = 0; i < n; i++) {
      Slot& s = job_.slots[job_.count++];
      memset(&s, 0, sizeof(s));
      s.pump = list[i].p;
      s.targetMl = list[i].ml;
      s.targetMs = pumpMs(list[i].p, list[i].ml);
    }
    return true;
  }

  // 작업 시작: 예상 소요시간 계산 → ack 전송 → 첫 펌프(들) 켜기
  void startJob() {
    const uint32_t now = hal_.nowMs();
    job_.kind = pendingKind_;
    job_.cur = 0;
    job_.inGap = false;
    job_.startedAt = now;
    job_.lastProgressAt = now;
    job_.rr = 0;

    uint32_t total = 0;
    for (uint8_t i = 0; i < job_.count; i++) {
      Slot& s = job_.slots[i];
      s.state = SlotState::Wait;
      s.offsetMs = job_.parallel ? (uint32_t)i * PAR_STAGGER_MS : 0;
      if (job_.parallel) { if (s.offsetMs + s.targetMs > total) total = s.offsetMs + s.targetMs; }
      else total += s.targetMs;
    }
    if (!job_.parallel && job_.count > 1) total += SEQ_GAP_MS * (uint32_t)(job_.count - 1);
    job_.totalMs = total;

    JsonDocument d;
    d["ev"] = "ack";
    d["id"] = (const char*)job_.id;
    d["kind"] = kindName(job_.kind);
    d["totalMs"] = job_.totalMs;
    send(d);

    advance(now);   // 지연 없이 바로 첫 펌프 ON
  }

  // ======================= 상태머신 (비차단) =======================
  void advance(uint32_t now) {
    if (job_.parallel) {
      // 병렬: 각 슬롯이 자기 시각에 켜지고 자기 시간이 지나면 꺼짐
      bool allDone = true;
      for (uint8_t i = 0; i < job_.count; i++) {
        Slot& s = job_.slots[i];
        if (s.state == SlotState::Wait) {
          if ((uint32_t)(now - job_.startedAt) >= s.offsetMs) startSlot(s, now);
          else { allDone = false; continue; }
        }
        if (s.state == SlotState::On) {
          if ((uint32_t)(now - s.startAt) >= s.targetMs) finishSlot(s, now);
          else allDone = false;
        }
      }
      if (allDone) finishJob(now);
      return;
    }

    // 순차: 슬롯 하나씩. 펌프 사이에는 300ms 휴지(전원 전압 회복 + 노즐 물방울 정리)
    if (job_.inGap) {
      if ((uint32_t)(now - job_.gapStart) < SEQ_GAP_MS) return;
      job_.inGap = false;
    }
    Slot& s = job_.slots[job_.cur];
    if (s.state == SlotState::Wait) startSlot(s, now);
    if (s.state == SlotState::On && (uint32_t)(now - s.startAt) >= s.targetMs) {
      finishSlot(s, now);
      if (job_.cur + 1 < job_.count) {
        job_.cur++;
        job_.inGap = true;
        job_.gapStart = now;
      } else {
        finishJob(now);
      }
    }
  }

  void startSlot(Slot& s, uint32_t now) {
    s.state = SlotState::On;
    s.startAt = now;
    pumpSet(s.pump - 1, true, now);
  }

  void finishSlot(Slot& s, uint32_t now) {
    pumpSet(s.pump - 1, false, now);
    s.state = SlotState::Done;
    s.ranMs = now - s.startAt;
    JsonDocument d;
    d["ev"] = "step";
    d["id"] = (const char*)job_.id;
    d["p"] = s.pump;
    d["ml"] = round1(s.targetMl);
    send(d);
  }

  // 작업 완료: done 이벤트 (dispensed = 목표량)
  void finishJob(uint32_t now) {
    allOff();
    recordResult(nullptr, now);              // status 의 last 갱신 (아래 done 과 같은 dispensed)
    JsonDocument d;
    d["ev"] = "done";
    d["id"] = (const char*)job_.id;
    d["kind"] = kindName(job_.kind);
    d["ms"] = (uint32_t)(now - job_.startedAt);
    addDispensed(d["dispensed"].to<JsonArray>(), result_);
    send(d);
    job_.kind = Kind::None;
    hal_.onJobEnd(true);
  }

  // 작업 중단: 지금까지 나온 양(추정치)을 stopped 이벤트로 알림
  void abortJob(const char* reason, uint32_t now) {
    allOff();
    recordResult(reason, now);               // status 의 last 갱신 (아래 stopped 와 같은 dispensed)
    JsonDocument d;
    d["ev"] = "stopped";
    d["id"] = (const char*)job_.id;
    d["reason"] = reason;
    addDispensed(d["dispensed"].to<JsonArray>(), result_);
    send(d);
    job_.kind = Kind::None;
    hal_.onJobEnd(false);
  }

  // 끝나는 작업의 결과를 result_(status 의 last)에 기록. reason == nullptr 이면 완료(done), 아니면 중단(stopped).
  //   dispensed 는 여기서 한 번만 계산하고 done/stopped 이벤트와 status 가 모두 이 값을 그대로 씁니다
  //   → 두 곳의 양(반올림 포함)이 절대 달라지지 않음.
  //   done   : 모든 펌프의 목표량 (소수 1자리 반올림)
  //   stopped: 구동시간 비율로 추정한 양 (소수 1자리 반올림), 0ml 펌프는 생략
  void recordResult(const char* reason, uint32_t now) {
    JobResult& r = result_;
    r.kind = job_.kind;
    memcpy(r.id, job_.id, sizeof(r.id));
    r.stopped = (reason != nullptr);
    copyUtf8(r.reason, reason ? reason : "", sizeof(r.reason) - 1);
    r.n = 0;
    for (uint8_t i = 0; i < job_.count; i++) {
      const double ml = round1(slotMl(job_.slots[i], now));
      if (r.stopped && ml <= 0) continue;    // 중단: 한 방울도 안 나온 펌프는 생략
      r.dispensed[r.n].p = job_.slots[i].pump;
      r.dispensed[r.n].ml = ml;
      r.n++;
    }
  }

  // "dispensed":[{"p":1,"ml":45},...] 채우기 (done / stopped / status.last 공통)
  static void addDispensed(JsonArray a, const JobResult& r) {
    for (uint8_t i = 0; i < r.n; i++) {
      JsonObject e = a.add<JsonObject>();
      e["p"] = r.dispensed[i].p;
      e["ml"] = r.dispensed[i].ml;
    }
  }

  // 슬롯이 지금까지 내보낸 양(ml) 추정: 구동시간 비율 × 목표량
  double slotMl(const Slot& s, uint32_t now) const {
    if (s.state == SlotState::Done) return s.targetMl;
    if (s.state == SlotState::Wait || s.targetMs == 0) return 0.0;
    double r = (double)(uint32_t)(now - s.startAt) / (double)s.targetMs;
    if (r > 1.0) r = 1.0;
    return s.targetMl * r;
  }

  // 전체 진행률(%) = 지금까지 나온 양 합 ÷ 목표량 합 × 100  (완료 전에는 최대 99)
  int pct(uint32_t now) const {
    double sum = 0, done = 0;
    for (uint8_t i = 0; i < job_.count; i++) { sum += job_.slots[i].targetMl; done += slotMl(job_.slots[i], now); }
    if (sum <= 0) return 0;
    int v = (int)std::floor(done / sum * 100.0);
    if (v < 0) v = 0;
    if (v > 99) v = 99;
    return v;
  }

  void emitProgress(uint32_t now) {
    const Slot* s = nullptr;
    if (!job_.parallel) {
      s = &job_.slots[job_.cur];             // 순차: 현재(또는 휴지 후 다음) 펌프
    } else {
      for (uint8_t k = 0; k < job_.count; k++) {   // 병렬: 켜져 있는 펌프를 돌아가며 1개씩(알림 폭주 방지)
        const uint8_t idx = (uint8_t)((job_.rr + k) % job_.count);
        if (job_.slots[idx].state == SlotState::On) { s = &job_.slots[idx]; job_.rr = (uint8_t)(idx + 1); break; }
      }
      if (!s) return;
    }
    JsonDocument d;
    d["ev"] = "progress";
    d["id"] = (const char*)job_.id;
    d["p"] = s->pump;
    d["ml"] = round1(s->targetMl);
    d["doneMl"] = round1(slotMl(*s, now));
    d["pct"] = pct(now);
    send(d, true);   // progress 는 '버려도 되는' 이벤트 (BLE 송신 대기열이 밀리면 생략)
  }

  void emitPong() {
    JsonDocument d;
    d["ev"] = "pong";
    d["up"] = hal_.nowMs();
    send(d);
  }

  void emitCal() {
    JsonDocument d;
    d["ev"] = "cal";
    addCalArrays(d);
    send(d);
  }

  // info / cal 공통: "cal":[유량...], "calSet":[0/1...] (펌프 순서)
  void addCalArrays(JsonDocument& d) const {
    JsonArray a = d["cal"].to<JsonArray>();
    for (uint8_t i = 0; i < PUMP_COUNT; i++) a.add(round2(cal_[i]));
    JsonArray s = d["calSet"].to<JsonArray>();
    for (uint8_t i = 0; i < PUMP_COUNT; i++) s.add(calSet(i) ? 1 : 0);
  }

  // ======================= 안전 =======================

  // 작업 종류별 펌프 1개 최대 구동시간: make 120초 / run 60초 / clean 30초
  static uint32_t kindMaxMs(Kind k) {
    switch (k) {
      case Kind::Run:   return MAX_RUN_MS;
      case Kind::Clean: return CLEAN_MAX_MS;
      default:          return MAX_PUMP_MS;    // make (그리고 작업이 없는데 켜져 있는 이상 상황)
    }
  }

  // 어떤 펌프든 (해당 작업 상한 + 1초) 이상 켜져 있으면 무조건 전부 끄고 오류 보고.
  // 정상이라면 검증 단계에서 상한 이하만 허용하므로 절대 실행되지 않는 '최후의 안전장치'.
  // (예: loop() 가 어떤 이유로 오래 멈췄다가 다시 돌 때)
  bool safetyCheck(uint32_t now) {
    const uint32_t maxMs = kindMaxMs(job_.kind);
    for (uint8_t i = 0; i < PUMP_COUNT; i++) {
      if (pumpOn_[i] && (uint32_t)(now - pumpOnSince_[i]) >= maxMs + SAFETY_MARGIN_MS) {
        allOff();
        hal_.log("안전 감시: 펌프 연속 구동 한계 초과 → 전체 정지");
        if (busy()) abortJob("error", now);
        char msg[120];
        snprintf(msg, sizeof(msg), "안전 제한(%lu초) 초과로 모든 펌프를 정지했습니다", (unsigned long)(maxMs / 1000UL));
        sendError("LIMIT", msg);
        return true;
      }
    }
    return false;
  }

  void pumpSet(uint8_t i, bool on, uint32_t now) {
    if (i >= PUMP_COUNT) return;
    hal_.pumpWrite(i, on);
    pumpOn_[i] = on;
    if (on) pumpOnSince_[i] = now;
  }

  void allOff() {
    for (uint8_t i = 0; i < PUMP_COUNT; i++) { hal_.pumpWrite(i, false); pumpOn_[i] = false; }
  }

  // 오류 응답. 대기 중이면 안전을 위해 모든 펌프 OFF 를 한 번 더 확인.
  // (제조 중에 들어온 '다른 명령'의 오류(BUSY 등)는 진행 중인 제조를 멈추지 않습니다.)
  void sendError(const char* code, const char* msg) {
    if (!busy()) allOff();
    JsonDocument d;
    d["ev"] = "error";
    d["code"] = code;
    d["msg"] = msg;
    send(d);
  }

  void sendBadPump() {
    char msg[64];
    snprintf(msg, sizeof(msg), "펌프 번호(p)는 1 ~ %d 사이 정수여야 합니다", PUMP_COUNT);
    sendError("BAD_PUMP", msg);
  }

  void flushCal() {
    for (uint8_t i = 0; i < PUMP_COUNT; i++) {
      if (calDirty_ & (1u << i)) {
        if (!hal_.saveCal(i, cal_[i])) hal_.log("유량값 NVS 저장 실패 (이번 전원이 꺼질 때까지만 유지됨)");
      }
    }
    calDirty_ = 0;
  }

  // ======================= 보조 함수 =======================

  // 숫자인지 확인 (정수/실수 모두 허용, 문자열 "45" 는 거부)
  static bool readNumber(JsonVariantConst v, double& out) {
    if (v.isNull() || !v.is<double>()) return false;
    out = v.as<double>();
    return std::isfinite(out);
  }

  // 양(ml)을 0.0001ml 단위로 반올림.
  //   ArduinoJson 7.4 는 150.1 같은 짧은 소수를 float(유효숫자 약 7자리) 정밀도로 읽어서 150.10000610… 이 됩니다.
  //   그대로 더하면 150.1 + 149.9 = 300.0000153 → "300ml 초과" 로 잘못 판정되므로, 앱(JavaScript, double)과
  //   같은 판정이 나오도록 소수 넷째 자리로 정리합니다. (0.0001ml 차이는 실제 양에 영향 없음)
  static double quantizeMl(double ml) { return std::floor(ml * 10000.0 + 0.5) / 10000.0; }

  // 펌프 번호: 1 ~ PUMP_COUNT 사이 '정수'
  static bool readPump(JsonVariantConst v, uint8_t& p) {
    double d;
    if (!readNumber(v, d)) return false;
    if (d != std::floor(d) || d < 1.0 || d > (double)PUMP_COUNT) return false;
    p = (uint8_t)d;
    return true;
  }

  static uint32_t roundMs(double ms) { return ms <= 0 ? 0 : (uint32_t)std::floor(ms + 0.5); }

  // 문자열 복사: 최대 maxLen 바이트(dst 는 maxLen+1 바이트 이상), 한글(UTF-8)이 글자 중간에서 잘리지 않게 처리,
  //   제어문자(0x01~0x1F, \t \n 포함)는 '?' 로 바꿈.
  //  (레시피 id 와 UNKNOWN_CMD 오류 메시지에서 사용 → 이벤트가 항상 올바른 UTF-8 · 올바른 JSON 이 되도록)
  //  제어문자를 바꾸는 이유: ArduinoJson 7 은 출력할 때 " \ \b \f \n \r \t 만 이스케이프하고 0x01 같은 나머지
  //  제어문자는 그대로 씁니다. 날것의 제어문자가 든 문자열은 JSON 규칙 위반이라 앱(JSON.parse)이 그 이벤트를 버리고,
  //  id 는 status.last 에도 남으므로 다음 작업이 끝날 때까지 모든 status 가 깨집니다.
  //  (앱이 만드는 id "r"+시각 에는 없고, nRF Connect·시리얼 같은 수동 도구로 보낼 때만 생길 수 있음)
  static void copyUtf8(char* dst, const char* src, size_t maxLen) {
    size_t n = strlen(src);
    if (n > maxLen) {
      n = maxLen;
      while (n > 0 && ((uint8_t)src[n] & 0xC0) == 0x80) n--;   // UTF-8 연속 바이트 경계까지 후퇴
    }
    for (size_t i = 0; i < n; i++) dst[i] = ((uint8_t)src[i] < 0x20) ? '?' : src[i];   // 1바이트 → 1바이트(길이·글자 경계 그대로)
    dst[n] = '\0';
  }

  // JSON 문서 → 1줄 문자열 → Hal 로 송신
  void send(JsonDocument& d, bool droppable = false) {
    // ArduinoJson 7 의 JsonDocument 는 크기가 고정이 아니라 필요한 만큼 늘어납니다(힙 메모리).
    // 메모리가 모자라 값 일부가 빠졌다면(overflowed) 빠진 채로 보내지 않고 버립니다.
    if (d.overflowed()) { hal_.log("메모리 부족으로 이벤트를 만들지 못했습니다"); return; }
    const size_t need = measureJson(d);
    if (need >= sizeof(out_)) { hal_.log("이벤트가 너무 커서 보내지 못했습니다"); return; }
    const size_t n = serializeJson(d, out_, sizeof(out_));
    hal_.emitLine(out_, n, droppable);
  }

  Hal& hal_;
  Job job_;
  Kind pendingKind_ = Kind::None;
  char name_[32];
  float cal_[MAX_PUMPS];
  uint16_t calSet_ = 0;     // 비트 i = 펌프 i+1 이 캘리브레이션 완료(NVS 저장값 또는 setcal 받음)
  uint16_t calDirty_ = 0;   // 비트 i = 아직 NVS 에 저장하지 못한 유량값(제조 중 setcal)
  bool pumpOn_[MAX_PUMPS];
  uint32_t pumpOnSince_[MAX_PUMPS];
  char out_[OUT_BUF_SIZE];

  // 버튼 '다시 만들기'(BUTTON_REPEAT_LAST)용: 마지막으로 '시작한' 앱 레시피의 재료·모드 (id 는 기억하지 않음 → repeatLast)
  struct LastRecipe { PumpMl list[MAX_PUMPS]; uint8_t n; bool parallel; } last_;
  bool hasLast_ = false;
  // status 의 last 용: 마지막으로 '끝난' 작업(make/run/clean)의 결과
  JobResult result_;
};

}  // namespace sb
