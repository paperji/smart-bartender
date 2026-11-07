/*
 * TxRing.h — BLE 송신 링버퍼 (기기 → 앱). 하드웨어와 무관 → PC 단위 테스트 가능 (test/host_test_tx.cpp)
 * ------------------------------------------------------------------
 * 이벤트 줄(JSON + '\n')을 모아 두었다가 (MTU-3) 바이트씩 잘라 notify 합니다.
 *
 * 블루투스가 혼잡해 notify 가 계속 실패할 때 (v2.1.1):
 *  - 연결이 살아 있는 동안은 같은 데이터를 점점 길게 쉬며(30 → 60 → 120 → 240ms) 다시 보냅니다.
 *    NOTIFY_GIVEUP_MS(4초) 동안 한 번도 못 보냈을 때만 맨 앞 줄 "하나"만 포기합니다.
 *    (v2.1.0 은 0.33초 만에 조각 전체를 버려서, 조각 안에 함께 있던 step·done 까지 사라질 수 있었음)
 *  - 포기한 줄의 앞부분이 이미 앱에 가 있었다면(줄 중간) 다음 전송 맨 앞에 '\n' 을 하나 붙입니다.
 *    → 앱이 반쪽 줄을 "알 수 없는 줄"로 끝내고 버리므로, 그다음 줄(예: done)이 반쪽 줄에 붙어 함께 망가지지 않습니다.
 *  - 진짜로 끊기면 연결 상태가 바뀌면서 clear() 로 모두 비웁니다 (SmartBartender.ino 의 updateConnection).
 *  - 그래도 줄을 하나 잃을 수 있으므로, 앱은 끝날 시각이 지나도 done/stopped 가 없으면 status 로 직접 확인합니다 (SPEC §2.4).
 */
#pragma once
#include <stddef.h>
#include <stdint.h>

#include "config.h"

namespace sb {

/** notify 1번의 결과 (SmartBartender.ino 가 BLE 라이브러리의 상태 값을 이것으로 바꿔 알려 줌) */
enum class TxResult : uint8_t {
  Sent,          // 보냄 (또는 상태 보고 없음 → 보낸 것으로 봄)
  Congested,     // 일시적 실패(혼잡, ERROR_GATT) → 잠시 뒤 다시
  NoSubscriber,  // 받을 사람이 없음(구독 전·연결 없음) → 모두 버림
};

class TxRing {
 public:
  static constexpr size_t SIZE = TX_RING_SIZE;
  static constexpr size_t MAX_CHUNK = 244;   // MTU 247 - 3

  void clear() {
    head_ = tail_ = used_ = 0;
    retry_ = 0;
    failSince_ = 0;
    failing_ = false;
    midLine_ = false;
    needLf_ = false;
  }

  /** 한 줄 + '\n' 을 통째로 넣음. 공간이 부족하면 넣지 않음(줄이 중간에 잘리는 일이 없게) */
  bool push(const char* s, size_t n) {
    if (n + 1 > SIZE - used_) return false;
    for (size_t i = 0; i <= n; i++) {
      buf_[head_] = (i < n) ? (uint8_t)s[i] : (uint8_t)'\n';
      head_ = (head_ + 1) % SIZE;
    }
    used_ += n + 1;
    return true;
  }

  size_t used() const { return used_; }
  bool idle() const { return used_ == 0 && !needLf_; }
  /** 지금 이 시각 전에는 보내지 않음 (연결 직후 앱이 알림을 구독할 시간 등) */
  void holdUntil(uint32_t t) { nextAt_ = t; }

  /**
   * loop() 에서 호출: 보낼 때가 됐으면 조각 1개를 send(data, len) 로 notify 하고 결과에 따라 정리.
   * send 는 TxResult 를 돌려주는 함수(람다). maxChunk = MTU-3 (최대 244)
   */
  template <typename SendFn>
  void drain(uint32_t now, size_t maxChunk, SendFn send) {
    if (idle() || (int32_t)(now - nextAt_) < 0) return;
    if (maxChunk < 1) maxChunk = 1;
    if (maxChunk > MAX_CHUNK) maxChunk = MAX_CHUNK;

    size_t off = 0;
    if (needLf_) chunk_[off++] = (uint8_t)'\n';   // 앱에 남은 반쪽 줄을 끝내는 줄바꿈
    const size_t fromRing = peek(chunk_ + off, maxChunk - off);
    const size_t n = off + fromRing;

    const TxResult r = send(chunk_, n);
    if (r == TxResult::NoSubscriber) {
      clear();
      return;
    }
    if (r == TxResult::Sent) {
      consume(fromRing);
      needLf_ = false;
      midLine_ = chunk_[n - 1] != (uint8_t)'\n';
      retry_ = 0;
      failing_ = false;
      nextAt_ = now + NOTIFY_GAP_MS;
      return;
    }
    // Congested: 연결은 살아 있으므로 같은 데이터를 잠시 뒤 다시 (점점 길게 쉼)
    if (fromRing == 0) {
      // 줄 맞춤 '\n' 만 남음: 포기할 줄이 없으므로 포기 시계를 돌리지 않음
      // (돌리면 그사이 새로 들어온 줄이 4초가 아니라 몇십 ms 만에 포기될 수 있음)
      failing_ = false;
    } else if (!failing_) {
      failing_ = true;
      failSince_ = now;
    }
    if (failing_ && (uint32_t)(now - failSince_) >= NOTIFY_GIVEUP_MS) {
      giveUpLine();
      nextAt_ = now;   // 남은 줄은 바로 이어서
      return;
    }
    const uint8_t step = retry_ < 3 ? retry_ : 3;
    if (retry_ < 255) retry_++;
    nextAt_ = now + (NOTIFY_RETRY_MS << step);   // 30, 60, 120, 240, 240 ...
  }

  // ---- 테스트용 ----
  bool midLine() const { return midLine_; }
  bool needLf() const { return needLf_; }

 private:
  size_t peek(uint8_t* out, size_t maxLen) const {
    const size_t n = used_ < maxLen ? used_ : maxLen;
    size_t t = tail_;
    for (size_t i = 0; i < n; i++) {
      out[i] = buf_[t];
      t = (t + 1) % SIZE;
    }
    return n;
  }

  void consume(size_t n) {
    if (n > used_) n = used_;
    tail_ = (tail_ + n) % SIZE;
    used_ -= n;
  }

  /** 계속 못 보낸 맨 앞 줄 하나를 '\n' 까지 버림. 그 줄의 앞부분이 이미 나갔으면 다음 전송 앞에 '\n' 을 붙임 */
  void giveUpLine() {
    if (midLine_) needLf_ = true;
    while (used_ > 0) {
      const uint8_t c = buf_[tail_];
      consume(1);
      if (c == (uint8_t)'\n') break;
    }
    midLine_ = false;
    retry_ = 0;
    failing_ = false;
  }

  uint8_t buf_[SIZE];
  uint8_t chunk_[MAX_CHUNK];
  size_t head_ = 0, tail_ = 0, used_ = 0;
  uint32_t nextAt_ = 0;
  uint32_t failSince_ = 0;
  uint8_t retry_ = 0;
  bool failing_ = false;
  bool midLine_ = false;   // 마지막으로 보낸 조각이 줄 중간에서 끝났음 (앱이 반쪽 줄을 들고 있음)
  bool needLf_ = false;    // 다음 전송 맨 앞에 '\n' 을 붙여야 함
};

/**
 * BLE 연결 상태 변화 감지 (SmartBartender.ino 의 updateConnection 이 loop 마다 호출).
 * BT 태스크가 onConnect 에서 연결 번호(gen)를 +1 한 뒤 connected=true, onDisconnect 에서 connected=false 로 바꿈.
 * loop 가 두 번 도는 사이에 끊겼다가 다시 연결되면 connected 는 true 그대로지만 gen 이 바뀜 → RECONNECTED
 * (예전 연결에 보내려던 반쪽 줄·줄바꿈이 새 연결로 새어 나가지 않게 송신 버퍼를 비우는 데 씀).
 * 부르는 쪽은 connected 를 먼저, gen 을 나중에 읽어야 함 (그 사이 새로 연결돼도 다음 loop 에서 CONNECTED 로 잡힘).
 */
struct LinkWatch {
  enum Change : uint8_t { NONE, CONNECTED, DISCONNECTED, RECONNECTED };
  bool was = false;
  uint32_t seenGen = 0;
  Change update(bool is, uint32_t gen) {
    if (is == was && (!is || gen == seenGen)) return NONE;
    const Change c = !is ? DISCONNECTED : (was ? RECONNECTED : CONNECTED);
    was = is;
    seenGen = gen;
    return c;
  }
};

}  // namespace sb
