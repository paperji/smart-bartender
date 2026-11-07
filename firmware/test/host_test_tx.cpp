// PC 단위 테스트: BLE 송신 링버퍼(TxRing.h) — 블루투스가 혼잡해 notify 가 실패할 때
// 이벤트 줄이 어떻게 다시 보내지고, 정말 못 보낼 때 "한 줄만" 포기하는지, 앱 쪽 줄 조립이 깨지지 않는지 확인합니다.
// 실행: build_and_run.bat (host_test.cpp, host_test_8.cpp 다음에 실행)
// Host test for the BLE TX ring: retry with backoff while congested, give up one line at a time,
// and resync the app's line assembler with a leading '\n' when a half-sent line is abandoned.
#include "test_util.h"
#include "TxRing.h"

using sb::TxResult;
using sb::TxRing;

// 앱(protocol.ts LineAssembler)처럼 받은 바이트를 '\n' 단위 줄로 모음 (빈 줄은 버림)
struct App {
  std::string buf;
  std::vector<std::string> lines;
  std::string bytes;   // 받은 그대로 (첫 바이트 확인 등)
  void recv(const uint8_t* d, size_t n) {
    for (size_t i = 0; i < n; i++) {
      const char c = (char)d[i];
      bytes.push_back(c);
      if (c == '\n') {
        bool blank = true;
        for (char x : buf) if (x != ' ' && x != '\r' && x != '\t') { blank = false; break; }
        if (!blank) lines.push_back(buf);
        buf.clear();
      } else {
        buf.push_back(c);
      }
    }
  }
  size_t validJson() const { size_t k = 0; for (auto& l : lines) if (strictJson(l) && validUtf8(l)) k++; return k; }
};

// 가짜 BLE 링크: congested(t) 가 true 인 동안 ERROR_GATT, noSub 이면 구독 없음
struct Link {
  App app;
  uint32_t t = 1000;
  std::vector<uint32_t> attempts;      // notify 를 시도한 시각
  std::vector<size_t> sizes;           // 보낸 조각 크기
  uint32_t congestFrom = 0, congestTo = 0;   // [from, to) 동안 혼잡
  bool forever = false;                // 계속 실패
  bool noSub = false;
  int sentChunks = 0;
  TxResult send(const uint8_t* d, size_t n) {
    attempts.push_back(t);
    if (noSub) return TxResult::NoSubscriber;
    if (forever || (t >= congestFrom && t < congestTo)) return TxResult::Congested;
    app.recv(d, n);
    sizes.push_back(n);
    sentChunks++;
    return TxResult::Sent;
  }
};

static std::string ev(const char* kind, int i, size_t pad = 0) {
  std::string s = std::string("{\"ev\":\"") + kind + "\",\"id\":\"r" + std::to_string(i) + "\"";
  if (pad) s += ",\"pad\":\"" + std::string(pad, 'x') + "\"";
  return s + "}";
}
static void push(TxRing& r, const std::string& s) { r.push(s.c_str(), s.size()); }
// 1ms 씩 시계를 돌리며 drain (maxMs 안에 다 보내면 멈춤)
static void run(TxRing& r, Link& L, uint32_t maxMs, size_t chunk = 244) {
  for (uint32_t i = 0; i < maxMs && !r.idle(); i++) {
    r.drain(L.t, chunk, [&](const uint8_t* d, size_t n) { return L.send(d, n); });
    L.t++;
  }
}
static std::string join(const std::vector<std::string>& v) { std::string s; for (auto& x : v) s += (s.empty() ? "" : " | ") + x.substr(0, 40); return s; }

int main() {
  printf("| 결과 | 케이스 (TxRing) | 입력 | 기대 | 실제 |\n|---|---|---|---|---|\n");

  {  // 1. 평소: 긴 줄(조각 여러 개)도 순서·내용 그대로
    TxRing r; r.clear(); Link L;
    const std::string a = ev("status", 1, 400), b = ev("progress", 2), c = ev("done", 3);
    push(r, a); push(r, b); push(r, c);
    run(r, L, 2000);
    const bool ok = L.app.lines.size() == 3 && L.app.lines[0] == a && L.app.lines[1] == b && L.app.lines[2] == c && !r.midLine() && r.idle();
    row("평소 전송: 순서·내용 그대로", "status(420B)+progress+done, MTU 247", "3줄 그대로", std::to_string(L.app.lines.size()) + "줄, 조각 " + std::to_string(L.sentChunks), ok);
  }
  {  // 2. 짧은 혼잡(1초): 하나도 안 잃음
    TxRing r; r.clear(); Link L; L.congestFrom = 1000; L.congestTo = 2000;
    push(r, ev("step", 1)); push(r, ev("done", 2));
    run(r, L, 5000);
    const bool ok = L.app.lines.size() == 2 && L.app.validJson() == 2 && L.app.lines[1] == ev("done", 2);
    row("1초 혼잡 → 다시 보내서 모두 도착", "ERROR_GATT 1000ms", "2줄 모두, 버림 0", join(L.app.lines), ok);
  }
  {  // 3. 다시 보내는 간격: 30 → 60 → 120 → 240 → 240ms
    TxRing r; r.clear(); Link L; L.congestFrom = 1000; L.congestTo = 1700;
    push(r, ev("done", 1));
    run(r, L, 3000);
    std::string gaps;
    bool ok = L.attempts.size() >= 6;
    const uint32_t want[] = {30, 60, 120, 240, 240};
    for (size_t i = 1; i < L.attempts.size() && i <= 5; i++) {
      const uint32_t g = L.attempts[i] - L.attempts[i - 1];
      gaps += std::to_string(g) + " ";
      if (g != want[i - 1]) ok = false;
    }
    ok = ok && L.app.lines.size() == 1;
    row("혼잡 시 다시 보내는 간격", "ERROR_GATT 700ms", "30 60 120 240 240", gaps, ok);
  }
  {  // 4. 줄 시작에서 4초 넘게 혼잡: 그 줄 하나만 포기, 반쪽 줄 없음
    TxRing r; r.clear(); Link L; L.congestFrom = 1000; L.congestTo = 1000 + NOTIFY_GIVEUP_MS + 500;
    const std::string a = ev("step", 1), b = ev("done", 2);
    push(r, a);
    // 혼잡 중에 done 이 뒤에 쌓임 (v2.1.0 은 0.33초 만에 조각 전체 = step+done 을 버렸음)
    for (int i = 0; i < 100; i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    push(r, b);
    run(r, L, 10000);
    const bool ok = L.app.lines.size() == 1 && L.app.lines[0] == b && L.app.validJson() == 1;
    row("줄 시작에서 4초+ 혼잡 → 첫 줄만 포기", "step 막힘, 뒤에 done", "done 은 도착, 반쪽 줄 없음", join(L.app.lines), ok);
  }
  {  // 5. 포기하기까지 걸린 시간 ≥ NOTIFY_GIVEUP_MS
    TxRing r; r.clear(); Link L; L.forever = true;
    push(r, ev("done", 1));
    const uint32_t t0 = L.t;
    uint32_t gaveUpAt = 0;
    for (uint32_t i = 0; i < 10000 && !r.idle(); i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    gaveUpAt = L.t;
    const uint32_t took = gaveUpAt - t0;
    const bool ok = r.idle() && took >= NOTIFY_GIVEUP_MS && took < NOTIFY_GIVEUP_MS + 300;
    row("포기 시점", "계속 ERROR_GATT", "4.0~4.3초 뒤 1줄 포기", std::to_string(took) + "ms", ok);
  }
  {  // 6. 줄 중간에서 막힘: 앞부분은 이미 앱에 감 → '\n' 을 먼저 보내 앱의 반쪽 줄을 끝냄 → 다음 줄(done) 은 멀쩡히
    TxRing r; r.clear(); Link L;
    const std::string a = ev("status", 1, 400), b = ev("done", 2);
    push(r, a); push(r, b);
    // 첫 조각(244B)만 보내고 그 뒤로 4.5초 혼잡
    r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); });
    const bool mid = r.midLine();
    L.t += 20; L.congestFrom = L.t; L.congestTo = L.t + NOTIFY_GIVEUP_MS + 500;
    run(r, L, 12000);
    const bool lfFirst = L.app.bytes.size() > 244 && L.app.bytes[244] == '\n';
    const bool ok = mid && lfFirst && L.app.lines.size() == 2 && !strictJson(L.app.lines[0]) && L.app.lines[1] == b;
    row("줄 중간에서 포기 → '\\n' 로 앱 줄 맞춤", "status 244B 보낸 뒤 막힘 + done", "반쪽 줄 1개(버려짐) + done 그대로", join(L.app.lines), ok);
  }
  {  // 7. 같은 상황에서 v2.1.0 방식이었다면 done 이 반쪽 줄에 붙어 함께 망가짐 → 새 방식은 done 을 지킴 (회귀 방지용 확인)
    TxRing r; r.clear(); Link L;
    const std::string a = ev("status", 1, 400), b = ev("done", 2), c = ev("pong", 3);
    push(r, a);
    r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); });
    L.t += 20; L.congestFrom = L.t; L.congestTo = L.t + NOTIFY_GIVEUP_MS + 200;
    push(r, b); push(r, c);
    run(r, L, 12000);
    size_t okLines = 0; for (auto& l : L.app.lines) if (l == b || l == c) okLines++;
    const bool ok = okLines == 2 && L.app.validJson() == 2;
    row("혼잡 중 쌓인 done·pong 은 살아남음", "status 반쪽 + 혼잡 중 done, pong", "done, pong 둘 다 그대로", join(L.app.lines), ok);
  }
  {  // 8. 계속 실패해도 멈추지 않음: 줄마다 4초씩 하나씩 포기, 링버퍼가 결국 빔
    TxRing r; r.clear(); Link L; L.forever = true;
    for (int i = 0; i < 3; i++) push(r, ev("step", i));
    run(r, L, 20000);
    const bool ok = r.idle() && r.used() == 0 && L.app.lines.empty();
    row("계속 실패 → 줄 단위로 비워짐(멈춤 없음)", "3줄 + 끝없는 ERROR_GATT", "약 12초 뒤 빈 버퍼", std::to_string(L.t - 1000) + "ms 뒤 used=" + std::to_string(r.used()), ok);
  }
  {  // 9. 구독 없음 → 모두 버림
    TxRing r; r.clear(); Link L; L.noSub = true;
    push(r, ev("info", 1)); push(r, ev("status", 2));
    run(r, L, 100);
    const bool ok = r.idle() && L.app.lines.empty();
    row("구독 전(ERROR_NOTIFY_DISABLED) → 버림", "2줄", "used 0", "used=" + std::to_string(r.used()), ok);
  }
  {  // 10. 연결이 바뀌면 clear → 예전 연결의 반쪽 줄·줄바꿈이 새 연결로 새지 않음
    TxRing r; r.clear(); Link L;
    push(r, ev("status", 1, 400));
    r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); });   // 반쪽만 보냄
    // 혼잡으로 그 줄을 포기 → '\n' 예약까지 된 상태에서 연결이 바뀜
    L.t += 20; L.congestFrom = L.t; L.congestTo = L.t + 100000;
    for (int i = 0; i < 4300 && !r.needLf(); i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    const bool mid = r.needLf();
    r.clear();               // 연결 끊김 → 새 연결
    Link L2; L2.t = L.t + 100;
    const std::string x = ev("info", 9);
    push(r, x);
    run(r, L2, 1000);
    const bool ok = mid && !r.midLine() && !r.needLf() && L2.app.bytes.size() > 0 && L2.app.bytes[0] == '{' && L2.app.lines.size() == 1 && L2.app.lines[0] == x;
    row("연결 바뀜(clear) → 새 연결은 깨끗하게", "반쪽 줄 포기('\\n' 예약) 뒤 clear + info", "첫 바이트 '{', info 그대로", L2.app.bytes.substr(0, 20), ok);
  }
  {  // 11. 버퍼가 가득 차면 줄을 통째로 거절 (반쪽만 넣지 않음)
    TxRing r; r.clear();
    const std::string big(1000, 'a');
    int okPush = 0; while (r.push(big.c_str(), big.size())) okPush++;
    const size_t before = r.used();
    const bool rej = !r.push(big.c_str(), big.size());
    const bool ok = okPush == 4 && rej && r.used() == before && before == 4 * 1001;
    row("가득 참 → 통째로 거절", "1000B 줄 반복", "4줄 들어가고 5번째 거절", std::to_string(okPush) + "줄, used=" + std::to_string(before), ok);
  }
  {  // 12. 링 끝을 여러 번 돌아도(랩어라운드) 내용 그대로
    TxRing r; r.clear(); Link L;
    size_t total = 0; bool same = true; size_t k = 0;
    for (int round = 0; round < 40; round++) {
      for (int i = 0; i < 5; i++) { const std::string s = ev("progress", round * 5 + i, 150 + (size_t)(i * 37)); push(r, s); total += s.size() + 1; }
      run(r, L, 3000);
    }
    for (int round = 0; round < 40 && same; round++)
      for (int i = 0; i < 5; i++, k++) if (k >= L.app.lines.size() || L.app.lines[k] != ev("progress", round * 5 + i, 150 + (size_t)(i * 37))) { same = false; break; }
    const bool ok = same && L.app.lines.size() == 200 && total > 4 * TX_RING_SIZE;
    row("랩어라운드 200줄", std::to_string(total) + "B 누적", "200줄 그대로", std::to_string(L.app.lines.size()) + "줄", ok);
  }
  {  // 13. MTU 23(20바이트 조각) + 한글: 글자 중간에서 잘려도 앱이 줄 단위로 모아 올바른 UTF-8
    TxRing r; r.clear(); Link L;
    const std::string k = "{\"ev\":\"error\",\"code\":\"LIMIT\",\"msg\":\"펌프 1 의 합계 400.0ml 가 최대 300ml 를 넘습니다\"}";
    push(r, k); push(r, ev("pong", 1));
    run(r, L, 3000, 20);
    bool small = true; for (size_t s : L.sizes) if (s > 20) small = false;
    const bool ok = small && L.app.lines.size() == 2 && L.app.lines[0] == k && validUtf8(L.app.lines[0]);
    row("20바이트 조각 + 한글", "LIMIT 오류(한글) + pong", "조각 ≤20B, 한글 그대로", std::to_string(L.sizes.size()) + "조각", ok);
  }
  {  // 14. 20바이트 조각에서 줄 중간 포기 + '\n' 붙이기 (조각 크기 안에서)
    TxRing r; r.clear(); Link L;
    const std::string a = ev("status", 1, 60), b = ev("done", 2);
    push(r, a); push(r, b);
    r.drain(L.t, 20, [&](const uint8_t* d, size_t n) { return L.send(d, n); });
    L.t += 20; L.congestFrom = L.t; L.congestTo = L.t + NOTIFY_GIVEUP_MS + 100;
    run(r, L, 12000, 20);
    bool small = true; for (size_t s : L.sizes) if (s > 20) small = false;
    const bool ok = small && L.app.lines.size() == 2 && L.app.lines[1] == b;
    row("20바이트 조각에서 줄 중간 포기", "status 20B 보낸 뒤 막힘", "done 그대로, 조각 ≤20B", join(L.app.lines), ok);
  }
  {  // 15. holdUntil: 연결 직후 200ms 는 보내지 않음
    TxRing r; r.clear(); Link L;
    r.holdUntil(L.t + 200);
    push(r, ev("info", 1));
    const uint32_t t0 = L.t;
    run(r, L, 1000);
    const bool ok = !L.attempts.empty() && L.attempts[0] == t0 + 200;
    row("연결 직후 200ms 대기", "holdUntil(+200)", "첫 notify 200ms 뒤", L.attempts.empty() ? "(없음)" : std::to_string(L.attempts[0] - t0) + "ms", ok);
  }

  {  // 16. 혼잡 3초 → 한 번 성공 → 다시 혼잡 3초: 성공하면 포기 시계·간격이 처음부터 (줄을 잃지 않음)
    TxRing r; r.clear(); Link L;
    // 첫 줄은 1000~4000 혼잡, 4000 에 보내짐. 둘째 줄은 4000 에 들어와 4100~7100 혼잡
    push(r, ev("step", 1));
    L.congestFrom = 1000; L.congestTo = 4000;
    for (int i = 0; i < 3100 && L.app.lines.empty(); i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    const bool first = L.app.lines.size() == 1;
    push(r, ev("done", 2));
    L.congestFrom = L.t; L.congestTo = L.t + 3000;
    const size_t a0 = L.attempts.size();
    run(r, L, 8000);
    const uint32_t gap1 = L.attempts.size() > a0 + 1 ? L.attempts[a0 + 1] - L.attempts[a0] : 0;
    const bool ok = first && L.app.lines.size() == 2 && L.app.lines[1] == ev("done", 2) && gap1 == 30;
    row("혼잡 3초 → 성공 → 혼잡 3초", "두 번 끊어진 혼잡", "2줄 모두, 둘째 혼잡의 첫 간격 30ms", join(L.app.lines) + " gap=" + std::to_string(gap1), ok);
  }
  {  // 17. 줄 맞춤 '\n' 만 남은 채 혼잡이 이어질 때 새로 들어온 줄도 자기 몫 4초를 다 기다림 (리뷰 firmware-1)
    TxRing r; r.clear(); Link L;
    const std::string a = ev("status", 1, 400), b = ev("pong", 2);
    push(r, a);
    r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); });   // 반쪽만 보냄
    L.t += 20; L.congestFrom = L.t; L.congestTo = L.t + 100000;               // 오래 혼잡
    for (int i = 0; i < 6000 && !r.needLf(); i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    const bool lfOnly = r.used() == 0 && r.needLf();                         // 반쪽 줄은 포기, '\n' 만 남음 (지금이 포기 시각)
    // '\n' 만 3.9초 동안 못 보냄 → 고치기 전에는 이 3.9초가 다음 줄의 4초에 들어가, 새 줄이 몇십 ms 만에 포기됐음
    for (int i = 0; i < 3900; i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    push(r, b);
    L.congestTo = L.t + 500;                                                  // 0.5초 뒤 혼잡 끝
    run(r, L, 3000);
    const bool ok = lfOnly && L.app.lines.size() == 2 && L.app.lines[1] == b;
    row("'\\n' 만 남은 혼잡 뒤 새 줄", "반쪽 줄 포기 → 3.9초 뒤 pong → 0.5초 뒤 혼잡 끝", "pong 도착(바로 포기하지 않음)", join(L.app.lines), ok);
  }
  {  // 18. 줄 중간 포기 직후 구독 없음 → 모두 비움 ('\n' 예약도 지움)
    TxRing r; r.clear(); Link L;
    push(r, ev("status", 1, 400)); push(r, ev("done", 2));
    r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); });
    L.t += 20; L.congestFrom = L.t; L.congestTo = L.t + 100000;
    for (int i = 0; i < 4200 && !r.needLf(); i++) { r.drain(L.t, 244, [&](const uint8_t* d, size_t n) { return L.send(d, n); }); L.t++; }
    const bool armed = r.needLf();
    L.noSub = true;
    run(r, L, 500);
    const bool ok = armed && r.idle() && !r.needLf() && r.used() == 0;
    row("줄 중간 포기 뒤 구독 없음", "needLf 상태에서 NoSubscriber", "idle, needLf 지워짐", armed ? "needLf→idle" : "needLf 안 됨", ok);
  }
  {  // 19~22. 연결 변화 감지(LinkWatch): 처음 연결 / 그대로 / 끊김 / loop 두 번 사이 끊겼다 다시 연결 / 끊긴 채 번호만 바뀜
    sb::LinkWatch w;
    using C = sb::LinkWatch;
    const C::Change c1 = w.update(true, 1), c2 = w.update(true, 1), c3 = w.update(false, 1), c4 = w.update(false, 2), c5 = w.update(true, 3);
    row("LinkWatch 처음 연결·그대로·끊김", "true1 → true1 → false1", "CONNECTED, NONE, DISCONNECTED",
        std::to_string(c1) + "," + std::to_string(c2) + "," + std::to_string(c3), c1 == C::CONNECTED && c2 == C::NONE && c3 == C::DISCONNECTED);
    row("LinkWatch 끊긴 채 번호만 바뀜 → 다시 연결", "false2 → true3", "NONE, CONNECTED", std::to_string(c4) + "," + std::to_string(c5),
        c4 == C::NONE && c5 == C::CONNECTED);
    const C::Change c6 = w.update(true, 4), c7 = w.update(true, 4);
    row("LinkWatch loop 두 번 사이 끊겼다 다시 연결", "true3 → true4 → true4", "RECONNECTED, 그다음 NONE", std::to_string(c6) + "," + std::to_string(c7),
        c6 == C::RECONNECTED && c7 == C::NONE);
    // BT 태스크 순서: onConnect = gen++ 뒤 connected=true. loop 가 connected(false) 를 읽은 직후 연결되면 gen 은 새 값 → 이번엔 NONE, 다음 loop 에 CONNECTED
    sb::LinkWatch v;
    const C::Change d1 = v.update(false, 5), d2 = v.update(true, 5);
    row("LinkWatch 연결 순간에 읽음(경쟁)", "false5 → true5", "NONE, CONNECTED", std::to_string(d1) + "," + std::to_string(d2), d1 == C::NONE && d2 == C::CONNECTED);
  }

  printf("\nTOTAL: %d passed, %d failed\n", passCount, failCount);
  return failCount ? 1 : 0;
}
