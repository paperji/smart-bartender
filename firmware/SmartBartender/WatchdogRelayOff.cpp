/*
 * WatchdogRelayOff.cpp — 워치독(TWDT)이 걸리는 순간 릴레이(펌프)를 즉시 끄는 안전 장치
 * ------------------------------------------------------------------------
 * 왜 필요한가요?
 *   - 전원 투입·EN(리셋) 버튼·브라운아웃 리셋은 칩 전체가 리셋되어 GPIO 가 입력(꺼짐)이 됩니다.
 *   - 그러나 워치독·패닉(오류) 재시작은 CPU 만 리셋하고 GPIO 출력 레지스터는 그대로 둡니다
 *     (ESP-IDF esp_restart_noos → esp_rom_software_reset_cpu). 펌프가 켜진(LOW) 상태였다면
 *     재부팅해 setup() 이 다시 OFF 로 쓸 때까지 펌프가 계속 돕니다.
 *   → 태스크 워치독 시간이 초과되면 ESP-IDF 가 패닉(재시작) 직전에 인터럽트 안에서
 *     esp_task_wdt_isr_user_handler() 를 불러 주므로(약한 심볼), 여기서 모든 릴레이 핀을 '꺼짐'으로 씁니다.
 *   ※ 워치독이 아닌 다른 원인의 크래시(패닉)는 이 함수가 불리지 않습니다. 그 경우 재부팅해 setup() 이 돌 때까지
 *     약 1초 안팎(패닉 로그·코어덤프 저장·부팅 시간, 추정) 펌프가 더 돌 수 있습니다.
 *
 * 왜 .ino 가 아니라 별도 .cpp 파일인가요?
 *   Arduino IDE 는 .ino 의 함수 원형(prototype)을 자동으로 만들어 주는데, .ino 안에 extern "C" 함수가 있으면
 *   그 뒤 함수들의 원형까지 extern "C" 로 잘못 만들어 컴파일 오류가 납니다. .cpp 는 이 자동 처리를 거치지 않습니다.
 *   (같은 폴더의 .cpp 는 Arduino IDE 가 자동으로 함께 컴파일합니다. 따로 할 일 없음)
 */
#include <Arduino.h>
#include "esp_attr.h"
#include "esp_task_wdt.h"
#include "soc/gpio_struct.h"
#include "config.h"

// 릴레이 핀 비트 마스크. 인터럽트 안에서는 플래시에 있는 PUMP_PINS 표를 읽지 않도록,
// setup() 에서 미리 레지스터 비트로 바꿔 RAM(DRAM)에 둡니다.
//   Lo = GPIO0~31 (out_w1ts / out_w1tc 레지스터), Hi = GPIO32~39 (out1_w1ts / out1_w1tc, 비트 0 = GPIO32)
static DRAM_ATTR volatile uint32_t sRelayMaskLo = 0;
static DRAM_ATTR volatile uint32_t sRelayMaskHi = 0;

// setup() 에서 릴레이 핀을 OFF 로 만든 직후, 워치독을 켜기 전에 1번 호출합니다.
void watchdogRelayOffBegin() {
  uint32_t lo = 0, hi = 0;
  for (uint8_t i = 0; i < PUMP_COUNT; i++) {
    const uint8_t p = PUMP_PINS[i];
    if (p < 32) lo |= (1u << p);
    else        hi |= (1u << (p - 32));
  }
  sRelayMaskLo = lo;
  sRelayMaskHi = hi;
}

// 태스크 워치독 인터럽트에서 호출됨 (ESP-IDF esp_task_wdt.h 의 약한 심볼을 재정의).
// 레지스터에 한 번씩 쓰는 것뿐이라 인터럽트 안에서도 안전합니다. (로그 출력·플래시 읽기 금지)
extern "C" void IRAM_ATTR esp_task_wdt_isr_user_handler(void) {
#if RELAY_OFF_LEVEL
  GPIO.out_w1ts = sRelayMaskLo;          // Active-LOW 릴레이(기본): HIGH 쓰기 = 꺼짐
  GPIO.out1_w1ts.val = sRelayMaskHi;
#else
  GPIO.out_w1tc = sRelayMaskLo;          // Active-HIGH 릴레이 모듈로 바꾼 경우: LOW 쓰기 = 꺼짐
  GPIO.out1_w1tc.val = sRelayMaskHi;
#endif
}
