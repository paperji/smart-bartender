// host_test.cpp / host_test_8.cpp 공통 도우미: 가짜 하드웨어(FakeHal), 결과 표 출력, UTF-8 검사 등.
// Shared helpers for the host tests (fake clock/relays, markdown result rows, strict UTF-8 check).
// PUMP_COUNT 를 바꿔 시험하려면 이 파일을 include 하기 전에 #define PUMP_COUNT 를 둡니다(host_test_8.cpp).
#pragma once
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "BartenderCore.h"

struct PumpEvt { uint32_t t; int pump; bool on; };

struct FakeHal : sb::Hal {
  uint32_t t = 100000;
  bool pump[8] = {};
  std::vector<std::string> ev;
  std::vector<std::string> logs;
  std::vector<PumpEvt> plog;
  float saved[8] = {};
  int saveCount = 0, jobEnds = 0;
  bool lastCompleted = false;
  uint32_t nowMs() override { return t; }
  void pumpWrite(uint8_t i, bool on) override {
    if (pump[i] != on) plog.push_back({t, i + 1, on});
    pump[i] = on;
  }
  void emitLine(const char* s, size_t n, bool) override { ev.emplace_back(s, n); }
  bool saveCal(uint8_t i, float v) override { saved[i] = v; saveCount++; return true; }
  void onJobEnd(bool c) override { jobEnds++; lastCompleted = c; }
  void log(const char* m) override { logs.emplace_back(m); }
  bool anyOn() const { for (bool b : pump) if (b) return true; return false; }
};

inline int passCount = 0, failCount = 0;

inline JsonDocument parse(const std::string& s) { JsonDocument d; deserializeJson(d, s); return d; }

inline void row(const char* name, const std::string& input, const std::string& expect, const std::string& actual, bool ok) {
  if (ok) passCount++; else failCount++;
  std::string in = input.size() > 60 ? input.substr(0, 57) + "..." : input;
  std::string ac = actual.size() > 110 ? actual.substr(0, 107) + "..." : actual;
  printf("| %s | %s | `%s` | %s | `%s` |\n", ok ? "PASS" : "**FAIL**", name, in.c_str(), expect.c_str(), ac.c_str());
}

// 엄격한 UTF-8 검사 (잘린 멀티바이트·과잉 표현·서로게이트·0x10FFFF 초과 거부)
inline bool validUtf8(const std::string& s) {
  size_t i = 0;
  while (i < s.size()) {
    const unsigned char c = (unsigned char)s[i];
    size_t len; uint32_t cp;
    if (c < 0x80) { i++; continue; }
    else if ((c & 0xE0) == 0xC0) { len = 2; cp = c & 0x1F; }
    else if ((c & 0xF0) == 0xE0) { len = 3; cp = c & 0x0F; }
    else if ((c & 0xF8) == 0xF0) { len = 4; cp = c & 0x07; }
    else return false;
    if (i + len > s.size()) return false;
    for (size_t k = 1; k < len; k++) {
      const unsigned char cc = (unsigned char)s[i + k];
      if ((cc & 0xC0) != 0x80) return false;
      cp = (cp << 6) | (cc & 0x3F);
    }
    if ((len == 2 && cp < 0x80) || (len == 3 && cp < 0x800) || (len == 4 && cp < 0x10000)) return false;
    if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return false;
    i += len;
  }
  return true;
}

// 엄격한 JSON 검사 (RFC 8259 = 앱의 JSON.parse 와 같은 규칙): 값 1개 + 앞뒤 공백만 허용.
//   문자열 안의 날것 제어문자(0x00~0x1F)·잘못된 이스케이프·숫자 형식·뒤에 남은 글자를 모두 거부합니다.
//   parse()(ArduinoJson)는 관대해서 제어문자가 그대로 든 줄도 받아 주므로, 앱이 받을 수 있는지는 이것으로 확인합니다.
struct StrictJson {
  const std::string& s;
  size_t i = 0;
  explicit StrictJson(const std::string& str) : s(str) {}
  bool more() const { return i < s.size(); }
  void ws() { while (more() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++; }
  bool eat(char c) { if (more() && s[i] == c) { i++; return true; } return false; }
  bool lit(const char* w) { const size_t n = strlen(w); if (s.compare(i, n, w) != 0) return false; i += n; return true; }
  bool digits() { const size_t a = i; while (more() && s[i] >= '0' && s[i] <= '9') i++; return i > a; }
  bool str() {
    if (!eat('"')) return false;
    while (more()) {
      const unsigned char c = (unsigned char)s[i++];
      if (c == '"') return true;
      if (c < 0x20) return false;                       // 날것 제어문자 → JSON.parse "Bad control character"
      if (c != '\\') continue;
      if (!more()) return false;
      const char e = s[i++];
      if (e == 'u') {
        for (int k = 0; k < 4; k++) { if (!more() || !isxdigit((unsigned char)s[i])) return false; i++; }
      } else if (e == '\0' || !strchr("\"\\/bfnrt", e)) {
        return false;
      }
    }
    return false;                                        // 닫는 " 없음
  }
  bool num() {
    eat('-');
    if (!eat('0') && !digits()) return false;
    if (eat('.') && !digits()) return false;
    if (more() && (s[i] == 'e' || s[i] == 'E')) { i++; if (!eat('+')) eat('-'); if (!digits()) return false; }
    return true;
  }
  bool val(int depth) {
    if (depth > 32) return false;
    ws();
    if (!more()) return false;
    const char c = s[i];
    if (c == '{') {
      i++; ws();
      if (eat('}')) return true;
      for (;;) {
        ws();
        if (!str()) return false;
        ws();
        if (!eat(':') || !val(depth + 1)) return false;
        ws();
        if (eat(',')) continue;
        return eat('}');
      }
    }
    if (c == '[') {
      i++; ws();
      if (eat(']')) return true;
      for (;;) {
        if (!val(depth + 1)) return false;
        ws();
        if (eat(',')) continue;
        return eat(']');
      }
    }
    if (c == '"') return str();
    if (c == 't') return lit("true");
    if (c == 'f') return lit("false");
    if (c == 'n') return lit("null");
    if (c == '-' || (c >= '0' && c <= '9')) return num();
    return false;
  }
};
inline bool strictJson(const std::string& s) {
  StrictJson p(s);
  if (!p.val(0)) return false;
  p.ws();
  return !p.more();
}

// 이벤트 원문에서 "dispensed":[...] 부분을 글자 그대로 잘라 냄 (반올림·순서까지 똑같은지 비교용).
// dispensed 안에는 숫자와 {"p":..,"ml":..} 만 있으므로 첫 ']' 가 배열의 끝입니다. 없으면 "(없음)".
inline std::string dispensedText(const std::string& json) {
  const std::string key = "\"dispensed\":[";
  const size_t a = json.find(key);
  if (a == std::string::npos) return "(없음)";
  const size_t b = json.find(']', a);
  if (b == std::string::npos) return "(없음)";
  return json.substr(a, b - a + 1);
}
