// PC 단위 테스트(펌프 8개): PUMP_COUNT=8 로 BartenderCore.h 를 컴파일해서, 가장 긴 이벤트인
// 제조 중 status(job + last, dispensed 8개, id 40바이트)가 출력 버퍼(OUT_BUF_SIZE)를 넘지 않고
// 잘리거나 버려지지 않는지 실제로 재어 확인합니다. 실행: build_and_run.bat (host_test.cpp 다음에 실행)
// Host test with PUMP_COUNT=8: worst-case event sizes (status with job + last, 8 pumps, 40-byte ids).
#define PUMP_COUNT 8
#include "test_util.h"

static FakeHal hal;
static sb::Bartender core(hal);
static sb::LineAssembler rx;
static size_t maxStatusLen = 0;      // 지금까지 본 status 이벤트 중 가장 긴 길이(바이트)
static std::string maxStatusEv;

static void sendLine(const std::string& s) {
  for (char c : s + "\n") {
    auto r = rx.feed(c);
    if (r == sb::LineAssembler::LINE) { core.handleLine(rx.line(), rx.length()); rx.reset(); }
    else if (r == sb::LineAssembler::TOO_LONG) core.reportTooLong();
  }
}
static void tick(uint32_t ms) { for (uint32_t i = 0; i < ms; i++) { hal.t++; core.update(); } }
static void runUntilIdle(uint32_t maxMs = 300000) { uint32_t n = 0; while (core.busy() && n++ < maxMs) { hal.t++; core.update(); } }
static std::string lastEv() { return hal.ev.empty() ? std::string("(none)") : hal.ev.back(); }

static std::string statusNow() {
  size_t before = hal.ev.size();
  sendLine("{\"cmd\":\"status\"}");
  std::string st = hal.ev.size() > before ? hal.ev[before] : std::string("(none)");
  if (st.size() > maxStatusLen) { maxStatusLen = st.size(); maxStatusEv = st; }
  return st;
}
static std::string lastText(const std::string& st) {
  const size_t a = st.find("\"last\":");
  if (a == std::string::npos || st.empty()) return "(없음)";
  return st.substr(a, st.size() - 1 - a);
}
// 완전한 JSON 객체 1개인지(잘리지 않았는지): 파싱 오류 없음 + 엄격한 JSON(앱 JSON.parse 규칙) + 올바른 UTF-8 + '}' 로 끝남 + 버퍼보다 짧음
static bool wholeJson(const std::string& s) {
  JsonDocument d;
  return !s.empty() && s.back() == '}' && !deserializeJson(d, s) && d.is<JsonObjectConst>() && strictJson(s) && validUtf8(s) &&
         s.size() < sb::Bartender::OUT_BUF_SIZE;
}
static bool droppedAny() {   // send() 가 "너무 커서/메모리 부족" 으로 이벤트를 버린 적이 있는가
  for (auto& m : hal.logs) if (m.find("이벤트") != std::string::npos) return true;
  return false;
}
// 펌프 1~8 에 ml 씩, par 모드 make 명령 (idJson = JSON 문자열 안에 들어갈 그대로의 id 표기)
static std::string make8(const std::string& idJson, const char* ml) {
  std::string s = "{\"cmd\":\"make\",\"id\":\"" + idJson + "\",\"mode\":\"par\",\"steps\":[";
  for (int p = 1; p <= 8; p++) s += std::string(p > 1 ? "," : "") + "{\"p\":" + std::to_string(p) + ",\"ml\":" + ml + "}";
  return s + "]}";
}

int main() {
  float cal[8] = {20, 20, 20, 20, 20, 20, 20, 20};
  core.begin("SmartBartender-A1B2", cal);
  printf("| 결과 | 케이스 (PUMP_COUNT=8) | 입력 | 기대 | 실제 |\n|---|---|---|---|---|\n");

  sendLine("{\"cmd\":\"hello\"}");
  row("info pumps 8", "{\"cmd\":\"hello\"}", "pumps 8, cal 8개", lastEv(), parse(lastEv())["pumps"] == 8 && parse(lastEv())["cal"].size() == 8);
  {
    const std::string st = statusNow();
    row("부팅 직후 last null (8펌프)", "status", "last:null", st, st == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":null}");
  }

  // 1) 긴 한글 id(41바이트 → 40바이트로 자름) + 8펌프 par 제조를 도중에 정지 → last 에 8개 모두(0.1ml 단위 추정)
  const std::string ga = "\xEA\xB0\x80";   // '가' (UTF-8 3바이트)
  std::string ko13;
  for (int i = 0; i < 13; i++) ko13 += ga;            // 39바이트
  const std::string koId = ko13 + "A";                // 40바이트 (보낼 때는 ko13 + "AB" = 41바이트)
  {
    hal.ev.clear();
    sendLine(make8(ko13 + "AB", "62.5"));
    const std::string ack = hal.ev.empty() ? "(none)" : hal.ev[0];
    row("8펌프 make ack (한글 id 41→40바이트)", "par 8 x 62.5ml", "ack id = '가'x13+A (40바이트)", ack,
        parse(ack)["ev"] == "ack" && parse(ack)["id"].as<std::string>() == koId && validUtf8(ack));
    tick(1234);
    sendLine("{\"cmd\":\"stop\"}");
    const std::string stopped = lastEv();
    const std::string st = statusNow();
    row("8펌프 stopped 이벤트 잘리지 않음", "1.234초 후 stop", "dispensed 8개, 완전한 JSON", stopped,
        wholeJson(stopped) && parse(stopped)["dispensed"].size() == 8);
    row("8펌프 status.last = stopped 와 같은 8개", "status", "last.dispensed 글자 그대로 같음, 완전한 JSON",
        std::to_string(st.size()) + "B " + lastText(st),
        wholeJson(st) && parse(st)["last"]["dispensed"].size() == 8 && parse(st)["last"]["id"].as<std::string>() == koId &&
        dispensedText(lastText(st)) == dispensedText(stopped));
  }

  // 2) 제조 중 status: job(id = 따옴표 40개 → 출력 시 \" 로 80바이트) + last(한글 id, 8개)
  const std::string q40json = [] { std::string s; for (int i = 0; i < 41; i++) s += "\\\""; return s; }();   // 41개 → 40개로 자름
  const std::string q40(40, '"');
  {
    hal.ev.clear();
    sendLine(make8(q40json, "10"));
    tick(150);
    const std::string st = statusNow();
    JsonDocument d = parse(st);
    row("제조 중 status: 이스케이프 id + 한글 last 8개", "job.id = '\"'x40, last.id 한글 40B", "완전한 JSON, job.id 40글자, last 8개",
        std::to_string(st.size()) + "B " + st,
        wholeJson(st) && d["state"] == "running" && d["job"]["id"].as<std::string>() == q40 && d["last"]["id"].as<std::string>() == koId &&
        d["last"]["dispensed"].size() == 8);
  }

  // 3) 그 작업을 버튼으로 정지 → last(id 따옴표 40개, reason button, 8개) + 다시 같은 id 로 제조 중 status
  //    = make 로 만들 수 있는 가장 긴 status (id 2개 모두 80바이트로 이스케이프, stopped·button, 8개)
  {
    tick(1000);
    hal.ev.clear();
    core.stop("button");
    const std::string stopped = lastEv();
    sendLine(make8(q40json, "62.5"));
    tick(150);
    const std::string st = statusNow();
    JsonDocument d = parse(st);
    row("가장 긴 make status (id 2개 이스케이프 + button + 8개)", "last=버튼 정지, job 진행 중", "완전한 JSON, last 가 stopped 와 같음",
        std::to_string(st.size()) + "B / 버퍼 " + std::to_string(sb::Bartender::OUT_BUF_SIZE),
        wholeJson(stopped) && wholeJson(st) && d["last"]["reason"] == "button" && d["last"]["dispensed"].size() == 8 &&
        d["job"]["id"].as<std::string>() == q40 && dispensedText(lastText(st)) == dispensedText(stopped));
    sendLine("{\"cmd\":\"stop\"}");
  }

  // 4) clean 8펌프 × 30초 (유량 99.99 → 펌프당 2999.7ml, 숫자가 가장 긴 경우) 완료 → 제조 중 status 의 last
  {
    for (int p = 1; p <= 8; p++) sendLine("{\"cmd\":\"setcal\",\"p\":" + std::to_string(p) + ",\"mlps\":99.99}");
    hal.ev.clear();
    sendLine("{\"cmd\":\"clean\",\"ms\":30000}");
    runUntilIdle();
    const std::string done = lastEv();
    int n2999 = 0;   // 출력 글자 그대로 "ml":2999.7} 이 몇 번 나오나 (파싱하면 float 오차가 생기므로 글자로 비교)
    for (size_t at = done.find("\"ml\":2999.7}"); at != std::string::npos; at = done.find("\"ml\":2999.7}", at + 1)) n2999++;
    row("clean 8펌프 done 잘리지 않음", "clean 30000ms x 8 (99.99ml/s)", "dispensed 8개 x 2999.7", done,
        wholeJson(done) && parse(done)["ev"] == "done" && parse(done)["dispensed"].size() == 8 && n2999 == 8);
    sendLine(make8(q40json, "10"));
    tick(10);
    const std::string st = statusNow();
    row("제조 중 status: last = clean 8개(4자리 ml)", "job.id '\"'x40 + last clean", "완전한 JSON, last 가 done 과 같음",
        std::to_string(st.size()) + "B " + lastText(st),
        wholeJson(st) && parse(st)["last"]["kind"] == "clean" && dispensedText(lastText(st)) == dispensedText(done));
    sendLine("{\"cmd\":\"stop\"}");
  }

  row("이벤트를 버린 적 없음", "send() 로그", "'너무 커서/메모리 부족' 0회", std::to_string(hal.logs.size()) + " logs", !droppedAny());
  row("가장 긴 status 길이 < 버퍼", "위 status 전부", "< " + std::to_string(sb::Bartender::OUT_BUF_SIZE) + "바이트 (이론상 최대 516)",
      std::to_string(maxStatusLen) + "B", maxStatusLen > 0 && maxStatusLen < sb::Bartender::OUT_BUF_SIZE && maxStatusLen <= 516);
  printf("\n가장 긴 status (%u바이트):\n%s\n", (unsigned)maxStatusLen, maxStatusEv.c_str());

  printf("\nTOTAL: %d passed, %d failed\n", passCount, failCount);
  return failCount ? 1 : 0;
}
