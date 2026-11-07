// PC 단위 테스트: BartenderCore.h (ESP32 펌웨어와 같은 파일)를 가짜 시계·가짜 릴레이로 실행해 SPEC §2 동작을 검증합니다.
// 실행: build_and_run.bat (Visual Studio 2022 C++ 도구 필요). 결과는 마크다운 표로 출력됩니다.
// Host-side unit test for BartenderCore.h (same file the ESP32 firmware compiles).
// Fake clock + fake relays; all input goes through LineAssembler exactly like BLE/serial bytes.
#include "test_util.h"   // FakeHal, row(), parse(), validUtf8(), dispensedText()

static FakeHal hal;
static sb::Bartender core(hal);
static sb::LineAssembler rx;

static void feedRaw(const std::string& bytes) {
  for (char c : bytes) {
    auto r = rx.feed(c);
    if (r == sb::LineAssembler::LINE) { core.handleLine(rx.line(), rx.length()); rx.reset(); }
    else if (r == sb::LineAssembler::TOO_LONG) core.reportTooLong();
  }
}
static void sendLine(const std::string& s) { feedRaw(s + "\n"); }
static void tick(uint32_t ms) { for (uint32_t i = 0; i < ms; i++) { hal.t++; core.update(); } }
static void runUntilIdle(uint32_t maxMs = 200000) { uint32_t n = 0; while (core.busy() && n++ < maxMs) { hal.t++; core.update(); } }

static std::string lastEv() { return hal.ev.empty() ? std::string("(none)") : hal.ev.back(); }
static int countEv(const char* ev, size_t from = 0) {
  int n = 0;
  for (size_t i = from; i < hal.ev.size(); i++) if (parse(hal.ev[i])["ev"] == ev) n++;
  return n;
}
static std::string pumpLog(uint32_t t0) {
  char buf[64]; std::string pl;
  for (auto& e : hal.plog) { snprintf(buf, sizeof buf, "P%d %s@+%u ", e.pump, e.on ? "ON" : "OFF", (unsigned)(uint32_t)(e.t - t0)); pl += buf; }
  return pl;
}

// send a command and check the code of the error / name of the first new event
static void expectEv(const char* name, const std::string& cmd, const char* ev, const char* code = nullptr) {
  size_t before = hal.ev.size();
  sendLine(cmd);
  std::string got = hal.ev.size() > before ? hal.ev[before] : std::string("(none)");
  JsonDocument d = parse(got);
  bool ok = hal.ev.size() > before && d["ev"] == ev && (!code || d["code"] == code);
  std::string exp = std::string(ev) + (code ? std::string("/") + code : "");
  row(name, cmd, exp, got, ok);
}

static void resetIdle() { if (core.busy()) sendLine("{\"cmd\":\"stop\"}"); hal.plog.clear(); }

static std::string mk(const std::string& steps, const std::string& extra = "") {
  return "{\"cmd\":\"make\",\"id\":\"r1\"" + extra + ",\"steps\":" + steps + "}";
}

// status 를 보내고 그 응답(1줄)을 돌려줌
static std::string statusNow() {
  size_t before = hal.ev.size();
  sendLine("{\"cmd\":\"status\"}");
  return hal.ev.size() > before ? hal.ev[before] : std::string("(none)");
}
// status 응답에서 "last":... 부분만 글자 그대로 (끝의 '}' 제외). 없으면 "(없음)"
static std::string lastText(const std::string& st) {
  const size_t a = st.find("\"last\":");
  if (a == std::string::npos || st.empty()) return "(없음)";
  return st.substr(a, st.size() - 1 - a);
}
// 방금 끝난 작업의 done/stopped 이벤트(evJson)와 지금 status 의 last 가 같은 작업·같은 양인지 검사
//   id·kind·result(·reason) 확인 + dispensed 는 글자 그대로(반올림·순서·생략까지) 같아야 함
static bool lastMatches(const std::string& st, const std::string& evJson, const char* kind, const char* result, const char* reason = nullptr) {
  JsonDocument s = parse(st), e = parse(evJson);
  JsonVariantConst l = s["last"];
  if (l.isNull() || !l.is<JsonObjectConst>()) return false;
  if (!(l["id"] == e["id"] && l["kind"] == kind && l["result"] == result)) return false;
  if (reason ? !(l["reason"] == reason && e["reason"] == reason) : !l["reason"].isNull()) return false;
  return dispensedText(lastText(st)) == dispensedText(evJson) && dispensedText(evJson) != "(없음)";
}

int main() {
  float cal[8] = {20, 20, 20, 20, 20, 20, 20, 20};
  core.begin("SmartBartender-A1B2", cal);   // calSetMask 생략 = 모든 펌프 캘리브레이션 전
  printf("| 결과 | 케이스 | 입력 | 기대 | 실제(첫 이벤트) |\n|---|---|---|---|---|\n");

  // ---------- A. basic commands ----------
  sendLine("{\"cmd\":\"hello\"}");
  row("hello→info (v2.1 필드)", "{\"cmd\":\"hello\"}", "info: fw 2.1.1, calSet, maxPumpMs 120000",
      lastEv(), lastEv() == "{\"ev\":\"info\",\"fw\":\"2.1.1\",\"name\":\"SmartBartender-A1B2\",\"pumps\":4,\"cal\":[20,20,20,20],\"calSet\":[0,0,0,0],\"maxMl\":500,\"maxStepMl\":300,\"maxPumpMs\":120000,\"state\":\"idle\"}");
  sendLine("{\"cmd\":\"status\"}");
  row("status(idle) 부팅 직후 last null", "{\"cmd\":\"status\"}", "status idle job:null last:null", lastEv(), lastEv() == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":null}");
  sendLine("{\"cmd\":\"ping\"}");
  row("ping→pong", "{\"cmd\":\"ping\"}", "pong up=ms", lastEv(), lastEv() == "{\"ev\":\"pong\",\"up\":" + std::to_string(hal.t) + "}");
  sendLine("{\"cmd\":\"getcal\"}");
  row("getcal", "{\"cmd\":\"getcal\"}", "cal [20x4] calSet [0x4]", lastEv(), lastEv() == "{\"ev\":\"cal\",\"cal\":[20,20,20,20],\"calSet\":[0,0,0,0]}");

  // ---------- A2. calSet from NVS at boot (begin mask) ----------
  {
    FakeHal h2;
    sb::Bartender c2(h2);
    // 펌프1 = NVS 20(저장됨), 펌프2 = NVS 18.5, 펌프3 = NVS 에 이상한 값 0.1(무시), 펌프4 = 키 없음
    float c[8] = {20, 18.5f, 0.1f, 20, 20, 20, 20, 20};
    c2.begin("SmartBartender-TEST", c, 0x07);
    const char* g = "{\"cmd\":\"getcal\"}";
    c2.handleLine(g, strlen(g));
    std::string got = h2.ev.empty() ? "(none)" : h2.ev.back();
    row("부팅 calSet(NVS 키 존재)", "mask=펌프1,2,3 / 펌프3 값 0.1", "cal [20,18.5,20,20] calSet [1,1,0,0]", got,
        got == "{\"ev\":\"cal\",\"cal\":[20,18.5,20,20],\"calSet\":[1,1,0,0]}");
    const char* h = "{\"cmd\":\"hello\"}";
    c2.handleLine(h, strlen(h));
    got = h2.ev.back();
    JsonDocument d = parse(got);
    row("부팅 calSet → info", "{\"cmd\":\"hello\"}", "info calSet [1,1,0,0]", got,
        d["calSet"][0] == 1 && d["calSet"][1] == 1 && d["calSet"][2] == 0 && d["calSet"][3] == 0 && d["calSet"].size() == 4);
    FakeHal h3;
    sb::Bartender c3(h3);
    c3.begin("SmartBartender-TEST", nullptr, 0x0F);   // 유량표 없음 → mask 무시
    c3.handleLine(g, strlen(g));
    row("부팅 유량표 없음", "cal=nullptr, mask=0x0F", "cal 기본값, calSet 모두 0", h3.ev.back(),
        h3.ev.back() == "{\"ev\":\"cal\",\"cal\":[20,20,20,20],\"calSet\":[0,0,0,0]}");
  }

  // ---------- B. setcal ----------
  sendLine("{\"cmd\":\"setcal\",\"p\":2,\"mlps\":18.5}");
  row("setcal p2 18.5", "{\"cmd\":\"setcal\",\"p\":2,\"mlps\":18.5}", "cal [20,18.5,20,20] calSet [0,1,0,0] + NVS 저장",
      lastEv(), lastEv() == "{\"ev\":\"cal\",\"cal\":[20,18.5,20,20],\"calSet\":[0,1,0,0]}" && hal.saveCount == 1 && hal.saved[1] == 18.5f);
  expectEv("setcal mlps 0.4", "{\"cmd\":\"setcal\",\"p\":2,\"mlps\":0.4}", "error", "BAD_AMOUNT");
  expectEv("setcal mlps 100.1", "{\"cmd\":\"setcal\",\"p\":2,\"mlps\":100.1}", "error", "BAD_AMOUNT");
  expectEv("setcal mlps 0.5(경계)", "{\"cmd\":\"setcal\",\"p\":3,\"mlps\":0.5}", "cal");
  expectEv("setcal mlps 100(경계)", "{\"cmd\":\"setcal\",\"p\":3,\"mlps\":100}", "cal");
  expectEv("setcal p=5", "{\"cmd\":\"setcal\",\"p\":5,\"mlps\":20}", "error", "BAD_PUMP");
  expectEv("setcal mlps \"20\"(문자열)", "{\"cmd\":\"setcal\",\"p\":4,\"mlps\":\"20\"}", "error", "BAD_AMOUNT");
  sendLine("{\"cmd\":\"getcal\"}");
  row("setcal 오류는 calSet 안 바꿈", "getcal", "cal [20,18.5,100,20] calSet [0,1,1,0]", lastEv(),
      lastEv() == "{\"ev\":\"cal\",\"cal\":[20,18.5,100,20],\"calSet\":[0,1,1,0]}");
  sendLine("{\"cmd\":\"hello\"}");
  row("setcal → info calSet 반영", "{\"cmd\":\"hello\"}", "info calSet [0,1,1,0]", lastEv(),
      parse(lastEv())["calSet"][1] == 1 && parse(lastEv())["calSet"][2] == 1 && parse(lastEv())["calSet"][0] == 0 && parse(lastEv())["calSet"][3] == 0);
  sendLine("{\"cmd\":\"setcal\",\"p\":2,\"mlps\":20}");
  sendLine("{\"cmd\":\"setcal\",\"p\":3,\"mlps\":20}");

  // ---------- C. make validation (SPEC §2.3 ①~⑧) ----------
  expectEv("make ml=0", mk("[{\"p\":1,\"ml\":0}]"), "error", "BAD_AMOUNT");
  expectEv("make ml=-5", mk("[{\"p\":1,\"ml\":-5}]"), "error", "BAD_AMOUNT");
  expectEv("make ml=\"45\"(문자열)", mk("[{\"p\":1,\"ml\":\"45\"}]"), "error", "BAD_AMOUNT");
  expectEv("make ml=true", mk("[{\"p\":1,\"ml\":true}]"), "error", "BAD_AMOUNT");
  expectEv("make ml 누락", mk("[{\"p\":1}]"), "error", "BAD_AMOUNT");
  {
    const std::string st = statusNow();
    row("검증 오류 뒤에도 last null (끝난 작업 없음)", "오류 5회 → status", "last:null", st, st == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":null}");
  }
  expectEv("make ml=300.1", mk("[{\"p\":1,\"ml\":300.1}]"), "error", "LIMIT");
  expectEv("make ml=300(경계)", mk("[{\"p\":1,\"ml\":300}]"), "ack"); resetIdle();
  expectEv("make 합계 500.1", mk("[{\"p\":1,\"ml\":300},{\"p\":2,\"ml\":200.1}]"), "error", "LIMIT");
  expectEv("make 합계 500(경계)", mk("[{\"p\":1,\"ml\":300},{\"p\":2,\"ml\":200}]"), "ack"); resetIdle();
  expectEv("make 합계 166.7+166.7+166.6(부동소수 오차)", mk("[{\"p\":1,\"ml\":166.7},{\"p\":2,\"ml\":166.7},{\"p\":3,\"ml\":166.6}]"), "ack"); resetIdle();
  expectEv("make 합계 250.1+249.9=500(float 파싱 오차)", mk("[{\"p\":1,\"ml\":250.1},{\"p\":2,\"ml\":249.9}]"), "ack"); resetIdle();
  expectEv("make 합계 200.1+150.1+149.9=500.1 → LIMIT", mk("[{\"p\":1,\"ml\":200.1},{\"p\":2,\"ml\":150.1},{\"p\":3,\"ml\":149.9}]"), "error", "LIMIT");
  expectEv("make p=0", mk("[{\"p\":0,\"ml\":10}]"), "error", "BAD_PUMP");
  expectEv("make p=5 (PUMP_COUNT=4)", mk("[{\"p\":5,\"ml\":10}]"), "error", "BAD_PUMP");
  expectEv("make p=1.5", mk("[{\"p\":1.5,\"ml\":10}]"), "error", "BAD_PUMP");
  expectEv("make p=\"1\"(문자열)", mk("[{\"p\":\"1\",\"ml\":10}]"), "error", "BAD_PUMP");
  expectEv("make p 누락", mk("[{\"ml\":10}]"), "error", "BAD_PUMP");
  expectEv("make step 이 객체 아님", mk("[5]"), "error", "BAD_PUMP");
  expectEv("make steps []", mk("[]"), "error", "BAD_AMOUNT");
  expectEv("make steps 누락", "{\"cmd\":\"make\",\"id\":\"r1\"}", "error", "BAD_AMOUNT");
  expectEv("make steps 문자열", mk("\"abc\""), "error", "BAD_AMOUNT");
  expectEv("make steps 객체", mk("{\"p\":1,\"ml\":10}"), "error", "BAD_AMOUNT");
  {
    std::string s9 = "[";
    for (int i = 0; i < 9; i++) s9 += std::string(i ? "," : "") + "{\"p\":" + std::to_string(i % 4 + 1) + ",\"ml\":10}";
    s9 += "]";
    expectEv("make steps 9개", mk(s9), "error", "LIMIT");
    std::string s8 = "[";
    for (int i = 0; i < 8; i++) s8 += std::string(i ? "," : "") + "{\"p\":" + std::to_string(i % 4 + 1) + ",\"ml\":10}";
    s8 += "]";
    expectEv("make steps 8개(경계)", mk(s8), "ack"); resetIdle();
    // 순서: 개수(③)가 step 내용(④)보다 먼저
    std::string s9bad = "[";
    for (int i = 0; i < 9; i++) s9bad += std::string(i ? "," : "") + "{\"p\":9,\"ml\":0}";
    s9bad += "]";
    expectEv("순서: 9개 + p 오류 → LIMIT", mk(s9bad), "error", "LIMIT");
  }
  expectEv("make mode=fast", mk("[{\"p\":1,\"ml\":10}]", ",\"mode\":\"fast\""), "error", "BAD_JSON");
  expectEv("make mode=1(숫자)", mk("[{\"p\":1,\"ml\":10}]", ",\"mode\":1"), "error", "BAD_JSON");
  expectEv("make mode=\"SEQ\"(대문자)", mk("[{\"p\":1,\"ml\":10}]", ",\"mode\":\"SEQ\""), "error", "BAD_JSON");
  expectEv("make mode=null → 생략과 같음(seq)", mk("[{\"p\":1,\"ml\":10}]", ",\"mode\":null"), "ack"); resetIdle();
  // 검증 순서 (SPEC §2.3: 위에서부터 차례로)
  expectEv("순서: mode 오류 + p 오류 → BAD_JSON", mk("[{\"p\":9,\"ml\":10}]", ",\"mode\":\"fast\""), "error", "BAD_JSON");
  expectEv("순서: mode 오류 + steps [] → BAD_JSON", mk("[]", ",\"mode\":\"x\""), "error", "BAD_JSON");
  expectEv("순서: mode 오류 + steps 누락 → BAD_JSON", "{\"cmd\":\"make\",\"mode\":\"x\"}", "error", "BAD_JSON");
  expectEv("순서: step1 ml=0, step2 p=9 → BAD_AMOUNT", mk("[{\"p\":1,\"ml\":0},{\"p\":9,\"ml\":10}]"), "error", "BAD_AMOUNT");
  expectEv("순서: 같은 step p=9 + ml=0 → BAD_PUMP", mk("[{\"p\":9,\"ml\":0}]"), "error", "BAD_PUMP");
  expectEv("순서: step1 ml=301, step2 p=0 → LIMIT", mk("[{\"p\":1,\"ml\":301},{\"p\":0,\"ml\":10}]"), "error", "LIMIT");
  expectEv("순서: step1 p=0, step2 ml=301 → BAD_PUMP", mk("[{\"p\":0,\"ml\":10},{\"p\":1,\"ml\":301}]"), "error", "BAD_PUMP");
  // 합산 후 펌프별 300ml (⑥) — 합계 검사는 모든 step 검사 뒤
  expectEv("같은 펌프 200+200=400 → LIMIT", mk("[{\"p\":1,\"ml\":200},{\"p\":1,\"ml\":200}]"), "error", "LIMIT");
  expectEv("같은 펌프 150+150=300(경계)", mk("[{\"p\":1,\"ml\":150},{\"p\":1,\"ml\":150}]"), "ack"); resetIdle();
  expectEv("같은 펌프 150.1+149.9(부동소수)", mk("[{\"p\":2,\"ml\":150.1},{\"p\":2,\"ml\":149.9}]"), "ack"); resetIdle();
  expectEv("같은 펌프 100+100+100.1 → LIMIT", mk("[{\"p\":3,\"ml\":100},{\"p\":3,\"ml\":100},{\"p\":3,\"ml\":100.1}]"), "error", "LIMIT");
  expectEv("같은 펌프 100.1x3=300.3 → LIMIT", mk("[{\"p\":4,\"ml\":100.1},{\"p\":4,\"ml\":100.1},{\"p\":4,\"ml\":100.1}]"), "error", "LIMIT");
  expectEv("순서: 200+200 뒤 step3 p=9 → BAD_PUMP", mk("[{\"p\":1,\"ml\":200},{\"p\":1,\"ml\":200},{\"p\":9,\"ml\":10}]"), "error", "BAD_PUMP");
  expectEv("순서: 200+200 뒤 step3 ml=0 → BAD_AMOUNT", mk("[{\"p\":1,\"ml\":200},{\"p\":1,\"ml\":200},{\"p\":2,\"ml\":0}]"), "error", "BAD_AMOUNT");
  {
    size_t before = hal.ev.size();
    sendLine(mk("[{\"p\":1,\"ml\":200},{\"p\":1,\"ml\":200}]"));
    std::string msg = parse(hal.ev[before])["msg"].as<std::string>();
    row("펌프별 합계 오류 메시지", "p1 200+200", "msg 에 '펌프 1' 과 '400' 포함", msg,
        msg.find("펌프 1") != std::string::npos && msg.find("400") != std::string::npos && !hal.anyOn());
  }
  // 120 s limit (v2.1) via low calibration: 0.5 ml/s → 60 ml = 120 s
  sendLine("{\"cmd\":\"setcal\",\"p\":1,\"mlps\":0.5}");
  expectEv("make 120.2초 (mlps 0.5, 60.1ml) → LIMIT", mk("[{\"p\":1,\"ml\":60.1}]"), "error", "LIMIT");
  expectEv("make 중복합산 30+30.1=60.1ml→120.2초 → LIMIT", mk("[{\"p\":1,\"ml\":30},{\"p\":1,\"ml\":30.1}]"), "error", "LIMIT");
  expectEv("make 중복합산 30+30=60ml→120초(경계)", mk("[{\"p\":1,\"ml\":30},{\"p\":1,\"ml\":30}]"), "ack"); resetIdle();
  expectEv("make 80초(예전 60초 제한이면 오류였음)", mk("[{\"p\":1,\"ml\":40}]"), "ack"); resetIdle();
  {
    hal.ev.clear(); hal.plog.clear();
    uint32_t t0 = hal.t;
    sendLine("{\"cmd\":\"make\",\"id\":\"long\",\"steps\":[{\"p\":1,\"ml\":60}]}");
    std::string ack = hal.ev.empty() ? "(none)" : hal.ev[0];
    row("make 120.0초(경계, 60ml) ack", "mlps 0.5, 60ml", "ack totalMs=120000", ack, ack == "{\"ev\":\"ack\",\"id\":\"long\",\"kind\":\"make\",\"totalMs\":120000}");
    runUntilIdle();
    bool ok = parse(lastEv())["ev"] == "done" && parse(lastEv())["ms"] == 120000 && countEv("error") == 0 && countEv("stopped") == 0 &&
              hal.plog.size() == 2 && (uint32_t)(hal.plog[1].t - t0) == 120000 && !hal.anyOn();
    row("make 120초 끝까지 실행(감시 오작동 없음)", "1ms 단위 120000회", "done ms=120000, error/stopped 없음", lastEv(), ok);
    const std::string doneEv = lastEv();
    const std::string st = statusNow();
    row("make 완료 후 status.last = done(목표량)", "status", "last{id long, make, done, [p1 60]}", lastText(st),
        st == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":{\"id\":\"long\",\"kind\":\"make\",\"result\":\"done\",\"dispensed\":[{\"p\":1,\"ml\":60}]}}" &&
        lastMatches(st, doneEv, "make", "done"));
  }
  sendLine("{\"cmd\":\"setcal\",\"p\":1,\"mlps\":20}");

  // ---------- D. JSON / command errors ----------
  expectEv("잘린 JSON", "{\"cmd\":\"make\",", "error", "BAD_JSON");
  expectEv("JSON 아님", "hello", "error", "BAD_JSON");
  expectEv("배열", "[1,2]", "error", "BAD_JSON");
  expectEv("cmd 없음", "{}", "error", "UNKNOWN_CMD");
  expectEv("cmd 숫자", "{\"cmd\":5}", "error", "UNKNOWN_CMD");
  expectEv("모르는 cmd", "{\"cmd\":\"dance\"}", "error", "UNKNOWN_CMD");
  {
    // 오류 메시지에 cmd 를 최대 24바이트만 보여 줄 때, 한글(3바이트)이 글자 중간에서 잘리면 안 됨 (SPEC §2: UTF-8 JSON)
    const std::string ga = "\xEA\xB0\x80";   // '가'
    const std::string prefix = "알 수 없는 명령입니다: ";
    struct Case { const char* name; std::string cmd; std::string shown; };
    std::string ga9, ga8;
    for (int i = 0; i < 9; i++) ga9 += ga;
    for (int i = 0; i < 8; i++) ga8 += ga;
    const Case cases[] = {
      {"UNKNOWN_CMD 23바이트+한글 → 글자 경계에서 자름", "abcdefghijklmnopqrstuvw" + ga + ga, "abcdefghijklmnopqrstuvw"},
      {"UNKNOWN_CMD 한글 9자(27바이트) → 8자", ga9, ga8},
      {"UNKNOWN_CMD ASCII 30자 → 24자", std::string(30, 'x'), std::string(24, 'x')},
    };
    for (const Case& c : cases) {
      size_t before = hal.ev.size();
      sendLine("{\"cmd\":\"" + c.cmd + "\"}");
      std::string got = hal.ev.size() > before ? hal.ev[before] : std::string("(none)");
      JsonDocument d = parse(got);
      bool ok = hal.ev.size() == before + 1 && d["code"] == "UNKNOWN_CMD" && validUtf8(got) && d["msg"].as<std::string>() == prefix + c.shown;
      row(c.name, "cmd " + std::to_string(c.cmd.size()) + "바이트", "올바른 UTF-8, msg 끝 = " + std::to_string(c.shown.size()) + "바이트",
          std::string(validUtf8(got) ? "utf8 OK " : "utf8 BAD ") + got, ok);
    }
  }

  // ---------- D2. 검증 오류·그 밖의 명령은 status.last 를 바꾸지 않음 ----------
  {
    const std::string st0 = statusNow();
    const size_t from = hal.ev.size();
    sendLine(mk("[{\"p\":9,\"ml\":10}]"));                       // BAD_PUMP
    sendLine(mk("[{\"p\":1,\"ml\":301}]"));                      // LIMIT
    sendLine(mk("[{\"p\":1,\"ml\":10}]", ",\"mode\":\"x\""));    // BAD_JSON
    sendLine("{\"cmd\":\"run\",\"p\":1,\"ms\":0}");              // BAD_AMOUNT
    sendLine("{\"cmd\":\"clean\",\"ms\":30001}");                 // LIMIT
    sendLine("{\"cmd\":\"setcal\",\"p\":1,\"mlps\":0.5}");
    sendLine(mk("[{\"p\":1,\"ml\":61}]"));                       // 122초 → LIMIT (구동시간 검사 단계)
    sendLine("{\"cmd\":\"setcal\",\"p\":1,\"mlps\":20}");
    sendLine("{\"cmd\":\"dance\"}");                              // UNKNOWN_CMD
    sendLine("{bad");                                              // BAD_JSON
    sendLine("{\"cmd\":\"stop\"}");                               // 대기 중 stop → status
    sendLine("{\"cmd\":\"ping\"}"); sendLine("{\"cmd\":\"hello\"}"); sendLine("{\"cmd\":\"getcal\"}");
    const int errs = countEv("error", from);
    const std::string st1 = statusNow();
    row("검증 오류·기타 명령은 last 안 바꿈", "오류 8종 + stop(idle)/ping/hello/getcal/setcal", "error 8개, status 그대로(last=long)",
        "errors=" + std::to_string(errs) + " " + lastText(st1), errs == 8 && st1 == st0 && lastText(st1).find("\"long\"") != std::string::npos && !hal.anyOn());
  }

  // ---------- E. seq timing ----------
  {
    hal.ev.clear(); hal.plog.clear();
    uint32_t t0 = hal.t;
    sendLine("{\"cmd\":\"make\",\"id\":\"r1730000000\",\"mode\":\"seq\",\"steps\":[{\"p\":1,\"ml\":45},{\"p\":3,\"ml\":30.5}]}");
    bool ackOk = hal.ev.size() >= 1 && hal.ev[0] == "{\"ev\":\"ack\",\"id\":\"r1730000000\",\"kind\":\"make\",\"totalMs\":4075}";
    bool p1on = hal.pump[0];
    // BUSY while running
    expectEv("실행 중 make → BUSY", "{\"cmd\":\"make\",\"id\":\"x\",\"steps\":[{\"p\":2,\"ml\":10}]}", "error", "BUSY");
    expectEv("실행 중 잘못된 make → BUSY 가 먼저", "{\"cmd\":\"make\",\"mode\":\"x\",\"steps\":[]}", "error", "BUSY");
    row("BUSY 후에도 기존 작업 계속", "(BUSY 직후)", "펌프1 ON 유지", hal.pump[0] ? "pump1=ON" : "pump1=OFF", hal.pump[0] && core.busy());
    expectEv("실행 중 run → BUSY", "{\"cmd\":\"run\",\"p\":2,\"ms\":1000}", "error", "BUSY");
    expectEv("실행 중 clean → BUSY", "{\"cmd\":\"clean\",\"ms\":1000}", "error", "BUSY");
    sendLine("{\"cmd\":\"status\"}");
    row("status(running) + 직전 작업 last", "{\"cmd\":\"status\"}", "running job{id,kind,pct}, last=직전 작업(long, BUSY 무시)", lastEv(),
        lastEv() == "{\"ev\":\"status\",\"state\":\"running\",\"job\":{\"id\":\"r1730000000\",\"kind\":\"make\",\"pct\":0},"
                    "\"last\":{\"id\":\"long\",\"kind\":\"make\",\"result\":\"done\",\"dispensed\":[{\"p\":1,\"ml\":60}]}}");
    sendLine("{\"cmd\":\"hello\"}");
    row("hello(running)", "{\"cmd\":\"hello\"}", "info state=running", lastEv(), parse(lastEv())["state"] == "running");
    runUntilIdle();
    std::string pl = pumpLog(t0);
    bool timingOk = hal.plog.size() == 4 && hal.plog[0].pump == 1 && hal.plog[0].on && hal.plog[0].t - t0 == 0 &&
                    hal.plog[1].pump == 1 && !hal.plog[1].on && hal.plog[1].t - t0 == 2250 &&
                    hal.plog[2].pump == 3 && hal.plog[2].on && hal.plog[2].t - t0 == 2550 &&
                    hal.plog[3].pump == 3 && !hal.plog[3].on && hal.plog[3].t - t0 == 4075;
    row("seq ack totalMs", "make p1 45ml, p3 30.5ml (20ml/s)", "ack totalMs=4075 & 즉시 P1 ON", hal.ev[0], ackOk && p1on);
    row("seq 펌프 타이밍", "(시뮬레이션 1ms 단위)", "P1 0~2250, 휴지300, P3 2550~4075", pl, timingOk);
    // events
    int prog = 0, steps = 0; std::string doneEv, firstProg;
    uint32_t lastPct = 0; bool pctMono = true;
    for (auto& s : hal.ev) {
      JsonDocument d = parse(s);
      if (d["ev"] == "progress") { if (!prog) firstProg = s; prog++; uint32_t p = d["pct"]; if (p < lastPct) pctMono = false; lastPct = p; }
      if (d["ev"] == "step") steps++;
      if (d["ev"] == "done") doneEv = s;
    }
    row("seq progress 개수/간격", "4075ms 동안", "약 16개(250ms 간격), pct 단조 증가", "progress=" + std::to_string(prog) + " first=" + firstProg, prog >= 15 && prog <= 17 && pctMono);
    row("seq step 이벤트", "", "step 2개", "steps=" + std::to_string(steps), steps == 2);
    row("seq done", "", "done ms=4075 dispensed[45,30.5]", doneEv,
        doneEv == "{\"ev\":\"done\",\"id\":\"r1730000000\",\"kind\":\"make\",\"ms\":4075,\"dispensed\":[{\"p\":1,\"ml\":45},{\"p\":3,\"ml\":30.5}]}");
    row("완료 후 전체 OFF + 부저", "", "pumps OFF, onJobEnd(true)", hal.anyOn() ? "ON 남음" : "all OFF", !hal.anyOn() && hal.lastCompleted);
    const std::string st = statusNow();
    row("seq 완료 후 status.last", "status", "idle, last{r1730000000, make, done, done 과 같은 [45,30.5]}", st,
        st == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":{\"id\":\"r1730000000\",\"kind\":\"make\",\"result\":\"done\","
              "\"dispensed\":[{\"p\":1,\"ml\":45},{\"p\":3,\"ml\":30.5}]}}" && lastMatches(st, doneEv, "make", "done"));
    // BUSY 로 거절된 명령(id x)은 last 에 남지 않음 — 위의 BUSY 4개가 있었어도 last 는 이 작업
    row("BUSY 명령은 last 에 안 남음", "실행 중 make id=x 등 BUSY 4회", "last.id = r1730000000 (x 아님)", lastText(st),
        parse(st)["last"]["id"] == "r1730000000" && countEv("error") == 4);
  }

  // ---------- F. par timing ----------
  {
    hal.ev.clear(); hal.plog.clear();
    uint32_t t0 = hal.t;
    sendLine("{\"cmd\":\"make\",\"id\":\"rp\",\"mode\":\"par\",\"steps\":[{\"p\":1,\"ml\":45},{\"p\":2,\"ml\":20},{\"p\":3,\"ml\":30.5}]}");
    std::string ack = hal.ev[0];
    runUntilIdle();
    std::string pl = pumpLog(t0);
    // expected: P1 ON 0, P2 ON 100, P3 ON 200, P2 OFF 1100, P3 OFF 1725, P1 OFF 2250
    bool ok = hal.plog.size() == 6 &&
      hal.plog[0].pump == 1 && hal.plog[0].t - t0 == 0 && hal.plog[1].pump == 2 && hal.plog[1].t - t0 == 100 &&
      hal.plog[2].pump == 3 && hal.plog[2].t - t0 == 200 && hal.plog[3].pump == 2 && !hal.plog[3].on && hal.plog[3].t - t0 == 1100 &&
      hal.plog[4].pump == 3 && hal.plog[4].t - t0 == 1725 && hal.plog[5].pump == 1 && hal.plog[5].t - t0 == 2250;
    row("par ack", "par p1 45, p2 20, p3 30.5", "totalMs=2250", ack, ack == "{\"ev\":\"ack\",\"id\":\"rp\",\"kind\":\"make\",\"totalMs\":2250}");
    row("par 타이밍(0.1초 간격 기동)", "", "P1@0 P2@100 P3@200 / OFF P2@1100 P3@1725 P1@2250", pl, ok);
    int prog = 0; for (auto& s : hal.ev) if (parse(s)["ev"] == "progress") prog++;
    row("par progress 폭주 방지", "", "250ms당 1개(≈9개)", "progress=" + std::to_string(prog), prog >= 8 && prog <= 9);
  }

  // ---------- G. duplicate merge ----------
  {
    hal.ev.clear(); hal.plog.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"dup\",\"steps\":[{\"p\":1,\"ml\":100},{\"p\":2,\"ml\":50},{\"p\":1,\"ml\":150}]}");
    std::string ack = hal.ev[0];
    runUntilIdle();
    std::string done = lastEv();
    row("중복 펌프 합산 ack", "p1 100 + p2 50 + p1 150", "totalMs=12500+300+2500=15300", ack, ack == "{\"ev\":\"ack\",\"id\":\"dup\",\"kind\":\"make\",\"totalMs\":15300}");
    row("중복 펌프 합산 done", "", "dispensed [p1 250, p2 50]", done, parse(done)["dispensed"][0]["ml"] == 250 && parse(done)["dispensed"][1]["ml"] == 50 && hal.plog.size() == 4);
  }

  // ---------- H. stop ----------
  {
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"s1\",\"steps\":[{\"p\":1,\"ml\":100},{\"p\":2,\"ml\":30}]}");
    tick(2000);
    size_t before = hal.ev.size();
    sendLine("{\"cmd\":\"stop\"}");
    std::string got = hal.ev.size() > before ? hal.ev[before] : "(none)";
    row("stop(user) 진행 중", "2초 후 {\"cmd\":\"stop\"}", "stopped user dispensed[p1 40] + 전체 OFF", got,
        got == "{\"ev\":\"stopped\",\"id\":\"s1\",\"reason\":\"user\",\"dispensed\":[{\"p\":1,\"ml\":40}]}" && !hal.anyOn() && !core.busy() && !hal.lastCompleted);
    const std::string stoppedS1 = got;
    expectEv("stop(idle) → status", "{\"cmd\":\"stop\"}", "status");
    row("stop(idle) 응답 = status + last(stopped user)", "", "idle, last{s1, make, stopped, user, stopped 과 같은 [p1 40]}", lastEv(),
        lastEv() == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":{\"id\":\"s1\",\"kind\":\"make\",\"result\":\"stopped\",\"reason\":\"user\","
                    "\"dispensed\":[{\"p\":1,\"ml\":40}]}}" && lastMatches(lastEv(), stoppedS1, "make", "stopped", "user"));
    sendLine("{\"cmd\":\"make\",\"id\":\"s2\",\"steps\":[{\"p\":1,\"ml\":10},{\"p\":2,\"ml\":30}]}");
    tick(500 + 300 + 750);   // p1 done(500) + gap(300) + p2 750ms → 15ml
    before = hal.ev.size();
    core.stop("button");
    got = hal.ev.size() > before ? hal.ev[before] : "(none)";
    row("stop(button) 2번째 펌프 중", "버튼", "stopped button [p1 10, p2 15]", got,
        got == "{\"ev\":\"stopped\",\"id\":\"s2\",\"reason\":\"button\",\"dispensed\":[{\"p\":1,\"ml\":10},{\"p\":2,\"ml\":15}]}" && !hal.anyOn());
    std::string st = statusNow();
    row("버튼 정지 후 status.last reason button", "status", "last{s2, stopped, button, [p1 10, p2 15]}", lastText(st),
        lastMatches(st, got, "make", "stopped", "button") && dispensedText(st) == "\"dispensed\":[{\"p\":1,\"ml\":10},{\"p\":2,\"ml\":15}]");
    // 소수 추정량의 반올림까지 같은지: 3 펌프 par, 1.234초 뒤 정지 → 0.1ml 단위 추정값
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"s3\",\"mode\":\"par\",\"steps\":[{\"p\":1,\"ml\":33.3},{\"p\":2,\"ml\":7.77},{\"p\":4,\"ml\":100}]}");
    tick(1234);
    sendLine("{\"cmd\":\"stop\"}");
    got = lastEv();
    st = statusNow();
    row("par 정지 추정량: stopped 와 last 글자 그대로 같음", "par 3펌프 1.234초 후 stop", "dispensed 동일(반올림 포함)", dispensedText(st) + " / " + dispensedText(got),
        parse(got)["ev"] == "stopped" && lastMatches(st, got, "make", "stopped", "user") && parse(st)["last"]["dispensed"].size() == 3);
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"s4\",\"steps\":[{\"p\":1,\"ml\":10},{\"p\":2,\"ml\":10}]}");
    sendLine("{\"cmd\":\"stop\"}");   // 켜자마자 정지 → 나온 양 0 → 모두 생략
    got = lastEv();
    st = statusNow();
    row("즉시 정지: dispensed [] 도 같음", "ack 직후 stop", "stopped [] / last.dispensed []", lastText(st),
        got == "{\"ev\":\"stopped\",\"id\":\"s4\",\"reason\":\"user\",\"dispensed\":[]}" && lastMatches(st, got, "make", "stopped", "user"));
  }

  // ---------- I. run / clean ----------
  {
    hal.ev.clear(); hal.plog.clear();
    sendLine("{\"cmd\":\"run\",\"p\":2,\"ms\":10000}");
    std::string ack = hal.ev[0];
    runUntilIdle();
    row("run ack", "{\"cmd\":\"run\",\"p\":2,\"ms\":10000}", "ack id=run kind=run totalMs=10000", ack, ack == "{\"ev\":\"ack\",\"id\":\"run\",\"kind\":\"run\",\"totalMs\":10000}");
    row("run done", "", "done run ms=10000 [p2 200ml]", lastEv(), lastEv() == "{\"ev\":\"done\",\"id\":\"run\",\"kind\":\"run\",\"ms\":10000,\"dispensed\":[{\"p\":2,\"ml\":200}]}");
    {
      const std::string doneEv = lastEv();
      const std::string st = statusNow();
      row("run 완료 후 status.last kind run", "status", "last{run, run, done, [p2 200]}", lastText(st),
          st == "{\"ev\":\"status\",\"state\":\"idle\",\"job\":null,\"last\":{\"id\":\"run\",\"kind\":\"run\",\"result\":\"done\",\"dispensed\":[{\"p\":2,\"ml\":200}]}}" &&
          lastMatches(st, doneEv, "run", "done"));
    }
    expectEv("run ms=60001", "{\"cmd\":\"run\",\"p\":2,\"ms\":60001}", "error", "LIMIT");
    expectEv("run ms=60000.4", "{\"cmd\":\"run\",\"p\":2,\"ms\":60000.4}", "error", "LIMIT");
    expectEv("run ms=120000(make 상한과 별개)", "{\"cmd\":\"run\",\"p\":2,\"ms\":120000}", "error", "LIMIT");
    expectEv("run ms=0", "{\"cmd\":\"run\",\"p\":2,\"ms\":0}", "error", "BAD_AMOUNT");
    expectEv("run ms=-1", "{\"cmd\":\"run\",\"p\":2,\"ms\":-1}", "error", "BAD_AMOUNT");
    expectEv("run ms=\"1000\"(문자열)", "{\"cmd\":\"run\",\"p\":2,\"ms\":\"1000\"}", "error", "BAD_AMOUNT");
    expectEv("run ms 누락", "{\"cmd\":\"run\",\"p\":2}", "error", "BAD_AMOUNT");
    expectEv("run p=5", "{\"cmd\":\"run\",\"p\":5,\"ms\":1000}", "error", "BAD_PUMP");
    expectEv("run p=0", "{\"cmd\":\"run\",\"p\":0,\"ms\":1000}", "error", "BAD_PUMP");
    expectEv("run p 누락", "{\"cmd\":\"run\",\"ms\":1000}", "error", "BAD_PUMP");
    expectEv("run p 오류 + ms 오류 → BAD_PUMP", "{\"cmd\":\"run\",\"p\":5,\"ms\":0}", "error", "BAD_PUMP");
    expectEv("run ms=0.5(0 초과)", "{\"cmd\":\"run\",\"p\":2,\"ms\":0.5}", "ack"); resetIdle();
    expectEv("run ms=60000(경계)", "{\"cmd\":\"run\",\"p\":2,\"ms\":60000}", "ack"); resetIdle();
    {
      hal.ev.clear();
      sendLine("{\"cmd\":\"run\",\"p\":2,\"ms\":60000}");
      runUntilIdle();
      bool ok = parse(lastEv())["ev"] == "done" && parse(lastEv())["ms"] == 60000 && countEv("error") == 0 && countEv("stopped") == 0;
      row("run 60초 끝까지 실행(감시 오작동 없음)", "1ms 단위 60000회", "done ms=60000, error 없음", lastEv(), ok);
    }

    hal.ev.clear(); hal.plog.clear();
    uint32_t t0 = hal.t;
    sendLine("{\"cmd\":\"clean\",\"ms\":5000}");
    ack = hal.ev[0];
    runUntilIdle();
    bool order = hal.plog.size() == 8;
    for (int i = 0; order && i < 4; i++) order = hal.plog[2 * i].pump == i + 1 && hal.plog[2 * i].t - t0 == (uint32_t)(i * 5300) && hal.plog[2 * i + 1].t - t0 == (uint32_t)(i * 5300 + 5000);
    row("clean ack", "{\"cmd\":\"clean\",\"ms\":5000}", "totalMs=4x5000+3x300=20900", ack, ack == "{\"ev\":\"ack\",\"id\":\"clean\",\"kind\":\"clean\",\"totalMs\":20900}");
    row("clean 순서/시간", "", "P1→P2→P3→P4 각 5초, 300ms 휴지", order ? "OK" : "순서 불일치", order);
    row("clean done", "", "done clean dispensed 4개(각 100ml)", lastEv(), parse(lastEv())["kind"] == "clean" && parse(lastEv())["dispensed"].size() == 4 && parse(lastEv())["dispensed"][3]["ml"] == 100);
    {
      const std::string doneEv = lastEv();
      const std::string st = statusNow();
      row("clean 완료 후 status.last kind clean", "status", "last{clean, clean, done, 4개 각 100}", lastText(st),
          lastMatches(st, doneEv, "clean", "done") && parse(st)["last"]["dispensed"].size() == 4);
      // clean 도중 정지 → kind clean, stopped
      hal.ev.clear();
      sendLine("{\"cmd\":\"clean\",\"ms\":1000}");
      tick(1000 + 300 + 500);   // P1 1초 완료 + 휴지 + P2 0.5초
      sendLine("{\"cmd\":\"stop\"}");
      const std::string stoppedEv = lastEv();
      const std::string st2 = statusNow();
      row("clean 도중 정지 → last kind clean, stopped", "clean 1초, P2 0.5초에서 stop", "last{clean, stopped, user, [p1 20, p2 10]}", lastText(st2),
          stoppedEv == "{\"ev\":\"stopped\",\"id\":\"clean\",\"reason\":\"user\",\"dispensed\":[{\"p\":1,\"ml\":20},{\"p\":2,\"ml\":10}]}" &&
          lastMatches(st2, stoppedEv, "clean", "stopped", "user"));
    }
    expectEv("clean ms=30001", "{\"cmd\":\"clean\",\"ms\":30001}", "error", "LIMIT");
    expectEv("clean ms=0", "{\"cmd\":\"clean\",\"ms\":0}", "error", "BAD_AMOUNT");
    expectEv("clean ms=-5", "{\"cmd\":\"clean\",\"ms\":-5}", "error", "BAD_AMOUNT");
    expectEv("clean ms 누락", "{\"cmd\":\"clean\"}", "error", "BAD_AMOUNT");
    expectEv("clean ms=\"x\"", "{\"cmd\":\"clean\",\"ms\":\"x\"}", "error", "BAD_AMOUNT");
    expectEv("clean ms=30000(경계)", "{\"cmd\":\"clean\",\"ms\":30000}", "ack"); resetIdle();
  }

  // ---------- J. setcal while running (deferred NVS write, calSet immediate) ----------
  {
    int sc = hal.saveCount;
    sendLine("{\"cmd\":\"run\",\"p\":1,\"ms\":1000}");
    tick(100);
    sendLine("{\"cmd\":\"setcal\",\"p\":4,\"mlps\":22.25}");
    bool evOk = lastEv() == "{\"ev\":\"cal\",\"cal\":[20,20,20,22.25],\"calSet\":[1,1,1,1]}";
    bool deferred = hal.saveCount == sc;
    runUntilIdle(); tick(1);
    row("제조 중 setcal", "run 중 setcal p4 22.25", "cal+calSet 즉시 응답, NVS 저장은 작업 종료 후", lastEv(), evOk && deferred && hal.saveCount == sc + 1 && hal.saved[3] == 22.25f);
    sendLine("{\"cmd\":\"setcal\",\"p\":4,\"mlps\":20}");
  }

  // ---------- K. framing (LineAssembler) ----------
  {
    // exactly 1024 bytes (no newline counted) → accepted
    std::string head = "{\"cmd\":\"ping\",\"pad\":\"", tail = "\"}";
    std::string pad(1024 - head.size() - tail.size(), 'x');
    std::string m1024 = head + pad + tail;
    expectEv("1024바이트(경계)", m1024, "pong");
    std::string m1025 = head + pad + "x" + tail;
    size_t before = hal.ev.size();
    sendLine(m1025);
    sendLine("{\"cmd\":\"ping\"}");
    int tooLong = 0, pong = 0, other = 0;
    for (size_t i = before; i < hal.ev.size(); i++) { auto d = parse(hal.ev[i]); if (d["code"] == "TOO_LONG") tooLong++; else if (d["ev"] == "pong") pong++; else other++; }
    row("1025바이트 → TOO_LONG 1회, 다음 명령 정상", "1025B + \\n + ping", "TOO_LONG 1, pong 1", "TOO_LONG=" + std::to_string(tooLong) + " pong=" + std::to_string(pong) + " other=" + std::to_string(other), tooLong == 1 && pong == 1 && other == 0);
    // 1500 bytes, no newline, then ping without newline
    before = hal.ev.size();
    std::string big = head + std::string(1500, 'y') + tail;
    feedRaw(big); feedRaw("{\"cmd\":\"ping\"}");
    tooLong = pong = other = 0;
    for (size_t i = before; i < hal.ev.size(); i++) { auto d = parse(hal.ev[i]); if (d["code"] == "TOO_LONG") tooLong++; else if (d["ev"] == "pong") pong++; else other++; }
    row("1500B(줄바꿈 없음)+ping", "괄호로 끝 판정", "TOO_LONG 1, pong 1", "TOO_LONG=" + std::to_string(tooLong) + " pong=" + std::to_string(pong), tooLong == 1 && pong == 1 && other == 0);
    // chunked delivery (20-byte BLE packets)
    before = hal.ev.size();
    std::string msg = "{\"cmd\":\"make\",\"id\":\"chunk\",\"steps\":[{\"p\":1,\"ml\":5},{\"p\":2,\"ml\":5}]}\n";
    for (size_t i = 0; i < msg.size(); i += 20) feedRaw(msg.substr(i, 20));
    row("20바이트 조각 수신", "MTU 23 분할", "ack id=chunk", hal.ev.size() > before ? hal.ev[before] : "(none)", hal.ev.size() > before && parse(hal.ev[before])["id"] == "chunk");
    resetIdle();
    before = hal.ev.size();
    feedRaw("{\"cmd\":\"ping\"}\n{\"cmd\":\"getcal\"}\n");
    row("한 패킷에 2개 메시지", "ping\\n getcal\\n", "pong, cal", std::to_string(hal.ev.size() - before) + " events", hal.ev.size() - before == 2 && parse(hal.ev[before])["ev"] == "pong" && parse(hal.ev[before + 1])["ev"] == "cal");
    before = hal.ev.size();
    feedRaw("{\"cmd\":\"ping\"}");
    row("줄바꿈 없이 전송(nRF Connect)", "{\"cmd\":\"ping\"}", "pong", hal.ev.size() > before ? hal.ev[before] : "(none)", hal.ev.size() - before == 1);
    before = hal.ev.size();
    feedRaw("{\"cmd\":\"ping\"}\r\n");
    row("CRLF", "ping\\r\\n", "pong 1개만", std::to_string(hal.ev.size() - before) + " events", hal.ev.size() - before == 1);
    before = hal.ev.size();
    feedRaw("   \n\n\r\n");
    row("공백/빈 줄 무시", "'   \\n\\n'", "이벤트 없음", std::to_string(hal.ev.size() - before) + " events", hal.ev.size() == before);
    before = hal.ev.size();
    feedRaw("{\"cmd\":\"make\",\"id\":\"a}b{\\\"c\",\"steps\":[{\"p\":1,\"ml\":5}]}");
    row("문자열 안의 괄호/이스케이프", "id:\"a}b{\\\"c\"", "ack id=a}b{\"c", hal.ev.size() > before ? hal.ev[before] : "(none)", hal.ev.size() > before && parse(hal.ev[before])["id"] == "a}b{\"c");
    resetIdle();
    before = hal.ev.size();
    feedRaw("{\"cmd\":\"make\",\"id\":\"n1\",\"steps\":[{\"p\":1,");   // 괄호가 아직 안 닫힘 → 처리 안 됨
    size_t mid = hal.ev.size();
    feedRaw("\"ml\":5}]}");                                         // 닫히는 순간 1개 메시지
    row("괄호가 닫힐 때까지 기다림", "2조각, \\n 없음", "1번째 조각 뒤 0개, 닫힌 뒤 ack", hal.ev.size() > mid ? hal.ev[mid] : "(none)",
        mid == before && hal.ev.size() > mid && parse(hal.ev[mid])["id"] == "n1");
    resetIdle();

    // 괄호로 끝난 메시지 뒤에 남은 글자(오타 '}')는 버리고, 줄바꿈 없이 이어 보낸 stop 을 정상 처리
    {
      sendLine("{\"cmd\":\"run\",\"p\":1,\"ms\":5000}");
      tick(100);
      before = hal.ev.size();
      feedRaw("{\"cmd\":\"ping\"}}");
      const bool pongOk = hal.ev.size() == before + 1 && parse(hal.ev[before])["ev"] == "pong";
      feedRaw("{\"cmd\":\"stop\"}");
      const bool stopOk = hal.ev.size() == before + 2 && parse(hal.ev[before + 1])["ev"] == "stopped" &&
                          parse(hal.ev[before + 1])["reason"] == "user" && !core.busy() && !hal.anyOn();
      row("닫힌 객체 뒤 남은 '}' + stop(줄바꿈 없음)", "run 중 {ping}} 다음 {stop}", "pong, stopped(user), 펌프 OFF", lastEv(),
          pongOk && stopOk && countEv("error", before) == 0);
      resetIdle();
    }
    {
      // 남은 '"' 와 공백, 그 뒤 줄바꿈 붙은 명령: 쓰레기와 합쳐져 BAD_JSON 이 되면 안 됨
      before = hal.ev.size();
      feedRaw("{\"cmd\":\"ping\"}\" ]");
      feedRaw("{\"cmd\":\"getcal\"}\n");
      row("닫힌 객체 뒤 남은 '\" ]' + getcal\\n", "{ping}\" ] {getcal}\\n", "pong, cal (BAD_JSON 없음)",
          std::to_string(hal.ev.size() - before) + " events",
          hal.ev.size() == before + 2 && parse(hal.ev[before])["ev"] == "pong" && parse(hal.ev[before + 1])["ev"] == "cal");
    }
    {
      // 기존 동작 유지: 줄바꿈으로 끝난 메시지 뒤에는 버리기 모드가 아님 → 객체가 아닌 줄은 그대로 BAD_JSON
      before = hal.ev.size();
      feedRaw("{\"cmd\":\"ping\"}\n");
      feedRaw("[1,2]\n");
      row("{ping}\\n 뒤 [1,2]\\n", "줄바꿈으로 끝난 뒤", "pong 1개, 그다음 BAD_JSON",
          std::to_string(hal.ev.size() - before) + " events",
          hal.ev.size() == before + 2 && parse(hal.ev[before])["ev"] == "pong" && parse(hal.ev[before + 1])["code"] == "BAD_JSON");
      // 괄호로 끝난 직후라도 줄바꿈이 오면 버리기 모드 해제
      before = hal.ev.size();
      feedRaw("{\"cmd\":\"ping\"}");
      feedRaw("\nhello\n");
      row("{ping} 뒤 \\n hello\\n", "줄바꿈이 경계를 확정", "pong, BAD_JSON",
          std::to_string(hal.ev.size() - before) + " events",
          hal.ev.size() == before + 2 && parse(hal.ev[before])["ev"] == "pong" && parse(hal.ev[before + 1])["code"] == "BAD_JSON");
      // 새 연결(hardReset): 이전 연결의 '괄호로 끝난 직후' 상태를 남기지 않음
      before = hal.ev.size();
      feedRaw("{\"cmd\":\"ping\"}");
      rx.hardReset();
      feedRaw("[1,2]\n");
      row("hardReset(새 BLE 연결) 후 [1,2]\\n", "{ping} → 재연결 → [1,2]", "pong, BAD_JSON",
          std::to_string(hal.ev.size() - before) + " events",
          hal.ev.size() == before + 2 && parse(hal.ev[before + 1])["code"] == "BAD_JSON");
    }
    {
      // 너무 긴 객체(줄바꿈 없음)가 닫힌 뒤 남은 '}' 도 버림 → 이어서 보낸 ping 정상
      std::string head2 = "{\"cmd\":\"ping\",\"pad\":\"", tail2 = "\"}";
      before = hal.ev.size();
      feedRaw(head2 + std::string(1500, 'z') + tail2 + "}");
      feedRaw("{\"cmd\":\"ping\"}");
      int tl = 0, pg = 0, ot = 0;
      for (size_t i = before; i < hal.ev.size(); i++) { auto d = parse(hal.ev[i]); if (d["code"] == "TOO_LONG") tl++; else if (d["ev"] == "pong") pg++; else ot++; }
      row("1500B 객체 + 남은 '}' + ping(줄바꿈 없음)", "TOO_LONG 뒤 쓰레기", "TOO_LONG 1, pong 1",
          "TOO_LONG=" + std::to_string(tl) + " pong=" + std::to_string(pg) + " other=" + std::to_string(ot), tl == 1 && pg == 1 && ot == 0);
    }
  }

  // ---------- L. misc ----------
  {
    size_t before = hal.ev.size();
    sendLine("{\"cmd\":\"make\",\"id\":\"0123456789012345678901234567890123456789ABCDEFGHIJ\",\"steps\":[{\"p\":1,\"ml\":5}]}");
    std::string id = parse(hal.ev[before])["id"].as<std::string>();
    row("id 40자 초과 → 잘라서 사용", "id 50자", "id 40바이트", id, id == "0123456789012345678901234567890123456789");
    resetIdle();
    {
      std::string ga = "\xEA\xB0\x80";   // '가' (UTF-8 3바이트)
      std::string id14, id13;
      for (int i = 0; i < 14; i++) id14 += ga;   // 42바이트
      for (int i = 0; i < 13; i++) id13 += ga;   // 39바이트
      before = hal.ev.size();
      sendLine("{\"cmd\":\"make\",\"id\":\"" + id14 + "\",\"steps\":[{\"p\":1,\"ml\":5}]}");
      std::string got = parse(hal.ev[before])["id"].as<std::string>();
      row("한글 id 42바이트 → 글자 중간에서 안 자름", "'가'x14", "39바이트('가'x13)", std::to_string(got.size()) + " bytes", got == id13);
      resetIdle();
      const std::string st = statusNow();
      row("한글 id 가 status.last 에도 그대로(올바른 UTF-8)", "정지 후 status", "last.id = '가'x13, UTF-8 OK", lastText(st),
          validUtf8(st) && parse(st)["last"]["id"].as<std::string>() == id13 && parse(st)["last"]["result"] == "stopped");
    }
    before = hal.ev.size();
    sendLine("{\"cmd\":\"make\",\"steps\":[{\"p\":1,\"ml\":5}]}");
    row("id 누락", "", "id=make", hal.ev[before], parse(hal.ev[before])["id"] == "make");
    resetIdle();
    before = hal.ev.size();
    sendLine("{\"cmd\":\"make\",\"id\":\"\",\"steps\":[{\"p\":1,\"ml\":5}]}");
    row("id 빈 문자열", "id:\"\"", "id=make", hal.ev[before], parse(hal.ev[before])["id"] == "make");
    resetIdle();
    // progress float formatting
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"f\",\"steps\":[{\"p\":1,\"ml\":45}]}");
    tick(1120);   // 1120ms → 22.4ml
    sendLine("{\"cmd\":\"stop\"}");
    row("소수 출력 형식", "1.12초 후 stop", "ml 22.4 (22.39999 아님)", lastEv(), lastEv() == "{\"ev\":\"stopped\",\"id\":\"f\",\"reason\":\"user\",\"dispensed\":[{\"p\":1,\"ml\":22.4}]}");
  }

  // ---------- M. safety watchdog per kind (상한 + 1초 이상 켜져 있으면 강제 정지) ----------
  {
    // run: 상한 60초 → 감시 61초
    hal.ev.clear();
    sendLine("{\"cmd\":\"run\",\"p\":1,\"ms\":60000}");
    hal.t += 60999;   // loop 가 60.999초 멈췄다가 다시 돎(시뮬레이션)
    core.update();
    row("감시 경계: run 60초 + 60.999초 멈춤", "감시 61초 미만", "정상 done (error 없음)", lastEv(),
        parse(lastEv())["ev"] == "done" && countEv("error") == 0 && !hal.anyOn() && !core.busy());
    hal.ev.clear();
    sendLine("{\"cmd\":\"run\",\"p\":1,\"ms\":60000}");
    hal.t += 61000;
    core.update();
    std::string e1 = hal.ev.size() > 1 ? hal.ev[1] : "(none)", e2 = hal.ev.size() > 2 ? hal.ev[2] : "(none)";
    row("안전 감시 run(61초 이상)", "run 60s + 61초 멈춤", "stopped(error) + error/LIMIT, 전체 OFF", e1 + " / " + e2,
        parse(e1)["ev"] == "stopped" && parse(e1)["reason"] == "error" && parse(e2)["code"] == "LIMIT" && !hal.anyOn() && !core.busy() && !hal.lastCompleted);
    {
      const std::string st = statusNow();
      row("안전 감시 중단도 last 에 기록(reason error)", "감시 정지 후 status", "last{run, stopped, error, stopped 과 같은 양}", lastText(st),
          lastMatches(st, e1, "run", "stopped", "error"));
    }
    // make: 상한 120초 → 감시 121초. 10초짜리 make 가 70초 멈춰도(61초 초과) 감시는 안 걸림
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"w1\",\"steps\":[{\"p\":1,\"ml\":200}]}");
    hal.t += 70000;
    core.update();
    row("make 는 감시 121초 (70초 멈춤)", "make 10초 + 70초 멈춤", "정상 done (error 없음)", lastEv(),
        parse(lastEv())["ev"] == "done" && countEv("error") == 0 && !hal.anyOn());
    sendLine("{\"cmd\":\"setcal\",\"p\":1,\"mlps\":0.5}");
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"w2\",\"steps\":[{\"p\":1,\"ml\":60}]}");
    hal.t += 120999;
    core.update();
    row("감시 경계: make 120초 + 120.999초 멈춤", "감시 121초 미만", "정상 done", lastEv(), parse(lastEv())["ev"] == "done" && countEv("error") == 0);
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"w3\",\"steps\":[{\"p\":1,\"ml\":60}]}");
    hal.t += 121000;
    core.update();
    e1 = hal.ev.size() > 1 ? hal.ev[1] : "(none)"; e2 = hal.ev.size() > 2 ? hal.ev[2] : "(none)";
    row("안전 감시 make(121초 이상)", "make 120s + 121초 멈춤", "stopped(error) + error/LIMIT(120초)", e1 + " / " + e2,
        parse(e1)["ev"] == "stopped" && parse(e1)["reason"] == "error" && parse(e1)["id"] == "w3" && parse(e2)["code"] == "LIMIT" &&
        parse(e2)["msg"].as<std::string>().find("120") != std::string::npos && !hal.anyOn() && !core.busy());
    {
      const std::string st = statusNow();
      row("안전 감시 make 중단 → last{w3, error}", "감시 정지 후 status", "last{w3, make, stopped, error}", lastText(st),
          lastMatches(st, e1, "make", "stopped", "error") && parse(st)["last"]["id"] == "w3");
    }
    sendLine("{\"cmd\":\"setcal\",\"p\":1,\"mlps\":20}");
    // clean: 상한 30초 → 감시 31초
    hal.ev.clear();
    sendLine("{\"cmd\":\"clean\",\"ms\":30000}");
    hal.t += 31000;
    core.update();
    e1 = hal.ev.size() > 1 ? hal.ev[1] : "(none)"; e2 = hal.ev.size() > 2 ? hal.ev[2] : "(none)";
    row("안전 감시 clean(31초 이상)", "clean 30s + 31초 멈춤", "stopped(error) + error/LIMIT", e1 + " / " + e2,
        parse(e1)["ev"] == "stopped" && parse(e1)["reason"] == "error" && parse(e2)["code"] == "LIMIT" && !hal.anyOn() && !core.busy());
  }

  // ---------- N. millis() overflow (49.7일 뒤 0 으로 돌아감) ----------
  {
    hal.t = 0xFFFFFFFFu - 1000u;   // 1초 뒤 0 으로 넘어감
    hal.ev.clear(); hal.plog.clear();
    uint32_t t0 = hal.t;
    sendLine("{\"cmd\":\"make\",\"id\":\"wrap\",\"steps\":[{\"p\":1,\"ml\":45},{\"p\":3,\"ml\":30.5}]}");
    runUntilIdle();
    std::string pl = pumpLog(t0);
    bool timingOk = hal.plog.size() == 4 && (uint32_t)(hal.plog[1].t - t0) == 2250 && (uint32_t)(hal.plog[2].t - t0) == 2550 &&
                    (uint32_t)(hal.plog[3].t - t0) == 4075;
    row("millis 오버플로 중 seq 타이밍", "시작 = 0xFFFFFFFF-1000", "P1 0~2250, P3 2550~4075 (그대로)", pl, timingOk);
    int prog = 0; uint32_t lastPct = 0; bool mono = true;
    for (auto& s : hal.ev) { JsonDocument d = parse(s); if (d["ev"] == "progress") { prog++; uint32_t p = d["pct"]; if (p < lastPct) mono = false; lastPct = p; } }
    row("millis 오버플로 중 done/progress", "", "done ms=4075, error 없음, pct 단조", lastEv(),
        parse(lastEv())["ev"] == "done" && parse(lastEv())["ms"] == 4075 && countEv("error") == 0 && prog >= 15 && mono);
    // 오버플로를 걸친 상태에서 stop 추정량
    hal.t = 0xFFFFFFFFu - 500u;
    hal.ev.clear();
    sendLine("{\"cmd\":\"make\",\"id\":\"wrap2\",\"steps\":[{\"p\":2,\"ml\":40}]}");
    tick(1000);   // 0 을 넘어 1초 → 20ml
    sendLine("{\"cmd\":\"stop\"}");
    row("millis 오버플로 중 stop 추정량", "1초 후 stop", "dispensed p2 20ml", lastEv(),
        lastEv() == "{\"ev\":\"stopped\",\"id\":\"wrap2\",\"reason\":\"user\",\"dispensed\":[{\"p\":2,\"ml\":20}]}");
  }

  // ---------- O. 버튼 길게 = 마지막 레시피 다시 만들기 (BUTTON_REPEAT_LAST=1 빌드에서 .ino 가 repeatLast() 호출) ----------
  //   다시 만든 잔은 원래 작업과 다른 작업 → 새 id "btn"+기동 후 ms. 원래 id 를 다시 쓰면 앱이 재연결 후
  //   status.last(id 같음)를 원래 작업의 결과로 잘못 확정함(SPEC §2.4 판정 ②). 따로 만든 기기로 시험(위 상태와 무관)
  {
    FakeHal h;
    sb::Bartender c(h);
    float c20[8] = {20, 20, 20, 20, 20, 20, 20, 20};
    c.begin("SmartBartender-TEST", c20);
    auto line = [&](const std::string& s) { c.handleLine(s.c_str(), s.size()); };
    auto runIdle = [&]() { uint32_t n = 0; while (c.busy() && n++ < 200000) { h.t++; c.update(); } };
    auto status = [&]() { size_t b = h.ev.size(); line("{\"cmd\":\"status\"}"); return h.ev.size() > b ? h.ev[b] : std::string("(none)"); };
    auto evAt = [&](size_t k) { return h.ev.size() > k ? h.ev[k] : std::string("(none)"); };

    size_t b = h.ev.size();
    const bool r0 = c.repeatLast();
    row("다시 만들기: 앱 제조 전", "repeatLast()", "false, 이벤트 없음, 펌프 OFF", std::to_string(h.ev.size() - b) + " events",
        !r0 && h.ev.size() == b && !h.anyOn() && !c.busy());

    // 앱 make r1730000000 40ml(유량 20 → 2초) → 0.5초 뒤 버튼 정지(10ml) → 3초 뒤 길게 눌러 다시 만들기(40ml)
    line("{\"cmd\":\"make\",\"id\":\"r1730000000\",\"steps\":[{\"p\":1,\"ml\":40}]}");
    for (int k = 0; k < 500; k++) { h.t++; c.update(); }
    c.stop("button");
    const std::string stopped = h.ev.back();
    h.t += 3000;
    b = h.ev.size();
    const std::string id1 = "btn" + std::to_string(h.t);
    const bool r1 = c.repeatLast();
    const std::string ack = evAt(b);
    row("다시 만들기 ack = 새 id", "make r1730000000 → 버튼 정지 → 길게", "ack id = " + id1 + " (r1730000000 아님), kind make, 펌프1 ON", ack,
        r1 && parse(stopped)["id"] == "r1730000000" && parse(ack)["ev"] == "ack" && parse(ack)["id"] == id1.c_str() &&
        parse(ack)["kind"] == "make" && h.pump[0] && c.busy());
    const std::string st1 = status();
    row("다시 만드는 중 status", "status", "job.id = 새 id, last = 버튼 정지한 원래 작업(10ml)", st1,
        parse(st1)["state"] == "running" && parse(st1)["job"]["id"] == id1.c_str() && lastMatches(st1, stopped, "make", "stopped", "button") &&
        parse(st1)["last"]["id"] == "r1730000000" && dispensedText(stopped) == "\"dispensed\":[{\"p\":1,\"ml\":10}]");
    runIdle();
    const std::string done = h.ev.back();
    const std::string st2 = status();
    row("다시 만든 잔 done → status.last.id ≠ 원래 id", "끝까지 + status", "done/last id = " + id1 + ", dispensed 40", lastText(st2),
        parse(done)["ev"] == "done" && parse(done)["id"] == id1.c_str() && lastMatches(st2, done, "make", "done") &&
        parse(st2)["last"]["id"] != "r1730000000" && dispensedText(done) == "\"dispensed\":[{\"p\":1,\"ml\":40}]");

    h.t += 1000;
    b = h.ev.size();
    const std::string id2 = "btn" + std::to_string(h.t);
    const bool r2 = c.repeatLast();
    const std::string ack2 = evAt(b);
    row("두 번째 다시 만들기도 또 새 id", "1초 뒤 다시 길게", "ack id = " + id2 + " (앞의 것과 다름)", ack2,
        r2 && parse(ack2)["id"] == id2.c_str() && id2 != id1);
    b = h.ev.size();
    const bool r3 = c.repeatLast();
    row("제조 중 다시 만들기 → BUSY", "진행 중 repeatLast()", "error/BUSY, 진행 중 작업 계속", evAt(b),
        !r3 && parse(evAt(b))["code"] == "BUSY" && c.busy() && h.pump[0]);
    runIdle();
    bool allStrict = true;
    for (auto& e : h.ev) if (!strictJson(e) || !validUtf8(e)) allStrict = false;
    row("다시 만들기 이벤트 전부 엄격한 JSON", std::to_string(h.ev.size()) + " events", "JSON.parse 규칙 통과", allStrict ? "OK" : "FAIL", allStrict);
  }

  // ---------- P. id·cmd 의 제어문자(0x01~0x1F) → '?' 로 바꿔 모든 이벤트가 엄격한 JSON (앱 JSON.parse 가 버리지 않게) ----------
  //   ArduinoJson 은 \u0001 같은 제어문자를 이스케이프 없이 그대로 출력함 → 그대로 두면 그 작업 이벤트와
  //   (status.last 에 id 가 남아) 다음 작업이 끝날 때까지 모든 idle status 가 올바르지 않은 JSON 이 됨
  {
    row("엄격한 JSON 검사기 자체", "정상 / 날것 0x01 / 뒤 쓰레기 / 이스케이프", "정상·\\u0001 이스케이프만 통과",
        "", strictJson("{\"a\":[1,-2.5e3,true,null,\"x\\u0001\\n\"],\"b\":{}}") && !strictJson(std::string("{\"a\":\"x\x01\"}")) &&
            !strictJson("{\"a\":1}x") && !strictJson("{\"a\":01}") && !strictJson("{\"a\":\"\\x\"}") && strictJson("{\"ev\":\"status\",\"job\":null}"));
    hal.ev.clear();
    // JSON 이스케이프로 보낸 제어문자 \u0001 \u001f \t \n (nRF Connect·시리얼 같은 수동 도구로만 가능)
    sendLine("{\"cmd\":\"make\",\"id\":\"t\\u0001a\\u001fb\\tc\\nd\",\"steps\":[{\"p\":1,\"ml\":10}]}");
    const std::string ack = hal.ev.empty() ? std::string("(none)") : hal.ev[0];
    row("제어문자 id → '?'", "id \"t\\u0001a\\u001fb\\tc\\nd\"", "ack id = t?a?b?c?d", ack,
        parse(ack)["ev"] == "ack" && parse(ack)["id"] == "t?a?b?c?d" && strictJson(ack));
    runUntilIdle();
    const std::string st = statusNow();   // 대기 중 status 명령
    sendLine("{\"cmd\":\"stop\"}");       // 대기 중 stop → status
    core.emitStatus();                    // 대기 중 버튼 짧게 → status (.ino updateButton)
    int nBad = 0, nStatus = 0;
    for (auto& e : hal.ev) {
      if (!strictJson(e) || !validUtf8(e)) nBad++;
      if (parse(e)["ev"] == "status") nStatus++;
    }
    row("제어문자 id 작업 이벤트 + 이후 idle status 3개", std::to_string(hal.ev.size()) + " events", "엄격한 JSON 실패 0, last.id = t?a?b?c?d",
        "bad=" + std::to_string(nBad) + " status=" + std::to_string(nStatus) + " " + lastText(st),
        nBad == 0 && nStatus == 3 && parse(st)["last"]["id"] == "t?a?b?c?d" && parse(st)["last"]["result"] == "done");
    // 이스케이프 없이 날것 0x01 바이트를 보낸 경우(ArduinoJson 은 받아 줌)도 같은 처리
    hal.ev.clear();
    sendLine(std::string("{\"cmd\":\"make\",\"id\":\"raw") + "\x01" + "x\",\"steps\":[{\"p\":1,\"ml\":10}]}");
    runUntilIdle();
    const std::string st2 = statusNow();
    nBad = 0;
    for (auto& e : hal.ev) if (!strictJson(e)) nBad++;
    row("날것 0x01 바이트 id", "id \"raw<0x01>x\"", "id = raw?x, 모든 이벤트 엄격한 JSON", lastText(st2),
        !hal.ev.empty() && parse(hal.ev[0])["id"] == "raw?x" && parse(st2)["last"]["id"] == "raw?x" && nBad == 0);
    // 한글 + 제어문자 + 40바이트 자르기: \u0001 + '가'x14 (43바이트) → '?' + '가'x13 (40바이트, 글자 중간에서 안 자름)
    {
      std::string ga = "\xEA\xB0\x80", ko14, ko13;
      for (int i = 0; i < 14; i++) ko14 += ga;
      for (int i = 0; i < 13; i++) ko13 += ga;
      hal.ev.clear();
      sendLine("{\"cmd\":\"make\",\"id\":\"\\u0001" + ko14 + "\",\"steps\":[{\"p\":1,\"ml\":5}]}");
      const std::string a = hal.ev.empty() ? std::string("(none)") : hal.ev[0];
      const std::string got = parse(a)["id"].as<std::string>();
      row("제어문자 + 한글 id 43바이트", "\\u0001 + '가'x14", "'?' + '가'x13 (40바이트), UTF-8·JSON OK", std::to_string(got.size()) + " bytes",
          got == "?" + ko13 && validUtf8(a) && strictJson(a));
      resetIdle();
    }
    // 모르는 cmd 에 제어문자 → UNKNOWN_CMD 메시지도 '?' 로 (v2.1 이전부터 있던 같은 문제)
    hal.ev.clear();
    sendLine("{\"cmd\":\"x\\u0001y\\u001b\"}");
    row("모르는 cmd 의 제어문자", "{\"cmd\":\"x\\u0001y\\u001b\"}", "UNKNOWN_CMD, msg 에 x?y?, 엄격한 JSON", lastEv(),
        parse(lastEv())["code"] == "UNKNOWN_CMD" && parse(lastEv())["msg"].as<std::string>().find("x?y?") != std::string::npos && strictJson(lastEv()));
  }

  printf("\nTOTAL: %d passed, %d failed\n", passCount, failCount);
  return failCount ? 1 : 0;
}
