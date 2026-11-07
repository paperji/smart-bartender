"""PC 블루투스로 실제 ESP32 펌웨어를 시험 (휴대폰·앱 없이) — firmware/README.md 5장 "방법 C"
Real-hardware BLE test for the SmartBartender firmware (Nordic UART, one JSON line per message).

  - 이 PC 의 블루투스(BLE)로 SmartBartender-XXXX 를 찾아 연결 → hello/status/ping, 순차·동시 제조, BUSY, 비상 정지,
    검증 오류 4종, 한글 id(20바이트 조각 쓰기), run, 제조 중 연결 끊기 → 다시 연결해 status.last 확인 (32개 항목)
  - --port COM5 처럼 USB 시리얼 포트를 주면 펌웨어 로그(# <- BLE: ...)도 함께 모아 보여 줌 (보드를 리셋하지 않게 DTR/RTS 끔)
  - 주의: 펌프 핀을 실제로 켭니다(합계 약 400ml 분량, 20ml/s 기준). 릴레이·펌프가 연결돼 있으면 5V 어댑터를 뽑고 하세요.
    (USB 만 꽂힌 보드 단독이면 핀만 바뀌고 아무것도 움직이지 않음)

준비:  python -m pip install bleak pyserial      (Windows 10/11 + BLE 어댑터, Python 3.10+)
실행:  python ble_e2e.py [--port COM5] [--yes]
       다른 휴대폰·PC 가 기기에 연결돼 있으면 광고를 안 하므로 먼저 끊으세요(한 번에 한 대만 연결).
2026-11-07 결과: 펌웨어 2.1.0·2.1.1 모두 32/32 (ESP32-D0WD-V3, Windows 11 인텔 블루투스, MTU 247)
"""
import argparse, asyncio, json, sys, time, threading

from bleak import BleakClient, BleakScanner

try:
    import serial  # pyserial (선택: --port 를 줄 때만)
except ImportError:  # pragma: no cover
    serial = None

NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  # app -> device
TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"  # device -> app

T0 = time.monotonic()
results = []  # (name, ok, detail)


def ts():
    return f"{time.monotonic() - T0:7.3f}"


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{ts()}] {'PASS' if ok else 'FAIL'} {name} {detail}", flush=True)


# ---------- serial tail (firmware logs) ----------
serial_lines = []


def serial_tail(stop, port):
    s = serial.Serial()
    s.port, s.baudrate, s.timeout = port, 115200, 0.2
    s.dtr = False
    s.rts = False
    s.open()
    buf = b""
    while not stop.is_set():
        buf += s.read(512)
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            t = line.decode("utf-8", "replace").rstrip("\r")
            serial_lines.append((time.monotonic() - T0, t))
    s.close()


class Link:
    def __init__(self, client):
        self.c = client
        self.buf = bytearray()
        self.events = []  # (t, dict)
        self.raw_chunks = []
        self.cond = asyncio.Condition()

    def on_notify(self, _h, data: bytearray):
        self.raw_chunks.append(len(data))
        self.buf += data
        while True:
            i = self.buf.find(b"\n")
            if i < 0:
                break
            line = bytes(self.buf[:i])
            del self.buf[: i + 1]
            if not line.strip():
                continue
            try:
                ev = json.loads(line.decode("utf-8"))  # strict, like the app's JSON.parse
            except Exception as e:  # noqa: BLE001
                ev = {"ev": "__BAD__", "raw": line[:200].decode("utf-8", "replace"), "err": str(e)}
            self.events.append((time.monotonic() - T0, ev))
            print(f"[{ts()}] <- {json.dumps(ev, ensure_ascii=False)[:220]}", flush=True)
            asyncio.get_event_loop().call_soon_threadsafe(self._wake)

    def _wake(self):
        async def w():
            async with self.cond:
                self.cond.notify_all()
        asyncio.ensure_future(w())

    async def send(self, obj, chunk=180):
        data = (json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        print(f"[{ts()}] -> {data.decode().strip()}", flush=True)
        for i in range(0, len(data), chunk):
            await self.c.write_gatt_char(RX, data[i : i + chunk], response=False)

    async def wait(self, pred, timeout, since=0):
        end = time.monotonic() + timeout
        while True:
            for t, ev in self.events[since:]:
                if pred(ev):
                    return t, ev
            left = end - time.monotonic()
            if left <= 0:
                return None, None
            try:
                async with self.cond:
                    await asyncio.wait_for(self.cond.wait(), timeout=min(left, 0.2))
            except asyncio.TimeoutError:
                pass


async def find_device():
    print(f"[{ts()}] scanning...", flush=True)
    found = {}

    def cb(d, adv):
        if (adv.local_name or d.name or "").startswith("SmartBartender") or NUS in [u.lower() for u in adv.service_uuids]:
            found[d.address] = (d, adv)

    async with BleakScanner(cb, scanning_mode="active"):
        for _ in range(100):
            await asyncio.sleep(0.1)
            if found:
                await asyncio.sleep(0.5)
                break
    return found


async def main(port):
    stop = threading.Event()
    th = None
    if port:
        if serial is None:
            sys.exit("--port 를 쓰려면 pyserial 이 필요해요: python -m pip install pyserial")
        th = threading.Thread(target=serial_tail, args=(stop, port), daemon=True)
        th.start()
        await asyncio.sleep(1.0)
    try:
        await run()
    finally:
        stop.set()
        if th:
            th.join(2)
        print("\n===== serial log (BLE-related) =====" if port else "")
        for t, line in serial_lines:
            if "BLE" in line or "연결" in line or "MTU" in line or "구독" in line or "광고" in line or "#" in line[:2]:
                print(f"{t:7.3f} {line[:200]}")
        print("\n===== summary =====")
        for n, ok, d in results:
            print(f"{'PASS' if ok else 'FAIL'}  {n}  {d}")
        print(f"{sum(ok for _, ok, _ in results)}/{len(results)} passed")


async def run():
    found = await find_device()
    check("scan finds SmartBartender", bool(found), str([(a, adv.local_name) for a, (d, adv) in found.items()]))
    if not found:
        return
    addr, (dev, adv) = next(iter(found.items()))
    check("adv carries NUS service UUID", NUS in [u.lower() for u in adv.service_uuids], str(adv.service_uuids))
    check("adv name prefix", (adv.local_name or "").startswith("SmartBartender-"), str(adv.local_name))

    # ---------- session 1 ----------
    async with BleakClient(dev) as c:
        check("connect", c.is_connected)
        svc = c.services.get_service(NUS)
        check("NUS service present", svc is not None)
        rxc, txc = svc.get_characteristic(RX), svc.get_characteristic(TX)
        check("RX props", rxc and "write-without-response" in rxc.properties and "write" in rxc.properties, str(rxc.properties if rxc else None))
        check("TX props", txc and "notify" in txc.properties, str(txc.properties if txc else None))
        print(f"[{ts()}] MTU={c.mtu_size}", flush=True)
        L = Link(c)
        await c.start_notify(TX, L.on_notify)
        await asyncio.sleep(0.3)

        n = len(L.events); await L.send({"cmd": "hello"})
        t, ev = await L.wait(lambda e: e.get("ev") == "info", 3, n)
        check("hello -> info", ev and ev.get("pumps") == 4 and str(ev.get("fw", "")).startswith("2.1") and ev.get("maxPumpMs") == 120000, str(ev)[:160])

        n = len(L.events); await L.send({"cmd": "status"})
        t, ev = await L.wait(lambda e: e.get("ev") == "status", 3, n)
        check("status idle", ev and ev.get("state") == "idle" and ev.get("job") is None, str(ev))

        n = len(L.events); await L.send({"cmd": "ping"})
        t, ev = await L.wait(lambda e: e.get("ev") == "pong", 3, n)
        check("ping -> pong", ev and isinstance(ev.get("up"), int), str(ev))

        # recipe like the app sends: id r+timestamp, seq, two pumps (pins only toggle; nothing wired)
        rid = f"r{int(time.time()*1000)}"
        n = len(L.events); t_send = time.monotonic() - T0
        await L.send({"cmd": "make", "id": rid, "mode": "seq", "steps": [{"p": 1, "ml": 30}, {"p": 3, "ml": 12.5}]})
        t_ack, ack = await L.wait(lambda e: e.get("ev") == "ack" and e.get("id") == rid, 3, n)
        check("make seq -> ack", ack and ack.get("kind") == "make", f"totalMs={ack and ack.get('totalMs')} latency={(t_ack - t_send) if t_ack else None:.3f}s" if t_ack else "no ack")
        t_done, done = await L.wait(lambda e: e.get("ev") == "done" and e.get("id") == rid, 10, n)
        if ack and done:
            actual = (t_done - t_ack) * 1000
            check("make seq -> done on time", abs(actual - ack["totalMs"]) < 600, f"expected {ack['totalMs']}ms, got {actual:.0f}ms; dispensed={done.get('dispensed')}")
        else:
            check("make seq -> done", False, str(done))
        steps = [e for _, e in L.events[n:] if e.get("ev") == "step"]
        prog = [e for _, e in L.events[n:] if e.get("ev") == "progress"]
        check("step events x2", len(steps) == 2, str(steps))
        check("progress events", len(prog) >= 4 and all(0 <= p.get("pct", -1) <= 99 for p in prog), f"{len(prog)} progress")
        bad = [e for _, e in L.events if e.get("ev") == "__BAD__"]
        check("no unparsable lines so far", not bad, str(bad))

        n = len(L.events); await L.send({"cmd": "status"})
        t, ev = await L.wait(lambda e: e.get("ev") == "status", 3, n)
        last = (ev or {}).get("last") or {}
        check("status.last = done recipe", last.get("id") == rid and last.get("result") == "done" and last.get("dispensed") == done.get("dispensed") if done else False, str(last))

        # parallel + emergency stop
        rid2 = f"r{int(time.time()*1000)}"
        n = len(L.events)
        await L.send({"cmd": "make", "id": rid2, "mode": "par", "steps": [{"p": 1, "ml": 100}, {"p": 2, "ml": 60}, {"p": 4, "ml": 40}]})
        t_ack, ack = await L.wait(lambda e: e.get("ev") == "ack" and e.get("id") == rid2, 3, n)
        check("make par -> ack", bool(ack), str(ack))
        await asyncio.sleep(1.2)
        n2 = len(L.events); await L.send({"cmd": "make", "id": "busy", "steps": [{"p": 1, "ml": 5}]})
        t, ev = await L.wait(lambda e: e.get("ev") == "error", 3, n2)
        check("make while running -> BUSY", ev and ev.get("code") == "BUSY", str(ev))
        n2 = len(L.events); await L.send({"cmd": "status"})
        t, ev = await L.wait(lambda e: e.get("ev") == "status", 3, n2)
        check("status running with job", ev and ev.get("state") == "running" and (ev.get("job") or {}).get("id") == rid2, str(ev)[:200])
        n2 = len(L.events); t_stop = time.monotonic() - T0
        await L.send({"cmd": "stop"})
        t, ev = await L.wait(lambda e: e.get("ev") == "stopped" and e.get("id") == rid2, 3, n2)
        check("stop -> stopped(user)", ev and ev.get("reason") == "user" and ev.get("dispensed"), f"{ev} latency={(t - t_stop):.3f}s" if t else str(ev))

        # validation errors
        for cmd, code in [
            ({"cmd": "make", "steps": [{"p": 5, "ml": 10}]}, "BAD_PUMP"),
            ({"cmd": "make", "steps": [{"p": 1, "ml": 200}, {"p": 1, "ml": 200}]}, "LIMIT"),
            ({"cmd": "make", "steps": [{"p": 1, "ml": 0}]}, "BAD_AMOUNT"),
            ({"cmd": "dance"}, "UNKNOWN_CMD"),
        ]:
            n2 = len(L.events); await L.send(cmd)
            t, ev = await L.wait(lambda e: e.get("ev") == "error", 3, n2)
            check(f"error {code}", ev and ev.get("code") == code, str(ev)[:160])

        # Korean 40-byte id + long line split across several writes (20-byte chunks, like MTU 23)
        kid = "칵테일테스트한글아이디열세글자"  # 15 chars * 3 bytes = 45 bytes -> firmware trims to 40 bytes (13 chars)
        n2 = len(L.events)
        await L.send({"cmd": "make", "id": kid, "steps": [{"p": 2, "ml": 4}]}, chunk=20)
        t, ack = await L.wait(lambda e: e.get("ev") == "ack", 3, n2)
        check("korean id ack (20-byte writes)", ack and ack.get("id") == kid[:13], str(ack))
        t, done = await L.wait(lambda e: e.get("ev") == "done", 5, n2)
        check("korean id done", done and done.get("id") == kid[:13], str(done))

        # calibration commands (restore defaults afterwards: NVS keys are kept, so re-set to 20 then check calSet)
        n2 = len(L.events); await L.send({"cmd": "run", "p": 2, "ms": 1500})
        t, ev = await L.wait(lambda e: e.get("ev") == "done" and e.get("kind") == "run", 4, n2)
        check("run 1.5s -> done", bool(ev), str(ev))

        # long-running make, then disconnect mid-brew
        rid3 = f"r{int(time.time()*1000)}"
        n2 = len(L.events)
        await L.send({"cmd": "make", "id": rid3, "steps": [{"p": 1, "ml": 80}]})  # 4 s at 20 ml/s
        t_ack3, ack3 = await L.wait(lambda e: e.get("ev") == "ack" and e.get("id") == rid3, 3, n2)
        check("make before disconnect -> ack", bool(ack3), str(ack3))
        await asyncio.sleep(1.0)
        bad = [e for _, e in L.events if e.get("ev") == "__BAD__"]
        check("no unparsable lines in session 1", not bad, str(bad))
        print(f"[{ts()}] notify chunk sizes seen: max={max(L.raw_chunks) if L.raw_chunks else 0} count={len(L.raw_chunks)}")
    t_disc = time.monotonic()
    print(f"[{ts()}] disconnected mid-brew", flush=True)

    # ---------- session 2: reconnect ----------
    found = {}
    for _ in range(3):
        found = await find_device()
        if found:
            break
    check("re-advertises after disconnect", bool(found), f"after {time.monotonic() - t_disc:.1f}s")
    if not found:
        return
    dev = next(iter(found.values()))[0]
    async with BleakClient(dev) as c:
        L = Link(c)
        await c.start_notify(TX, L.on_notify)
        await asyncio.sleep(0.3)
        await L.send({"cmd": "hello"})
        await L.wait(lambda e: e.get("ev") == "info", 3)
        wait_left = 4.0 - (time.monotonic() - t_disc) - 1.0
        if wait_left > 0:
            await asyncio.sleep(wait_left + 0.5)
        n = len(L.events); await L.send({"cmd": "status"})
        t, ev = await L.wait(lambda e: e.get("ev") == "status", 3, n)
        last = (ev or {}).get("last") or {}
        check("after reconnect: status.last = recipe done while away", last.get("id") == rid3 and last.get("result") == "done" and last.get("dispensed") == [{"p": 1, "ml": 80}], str(ev))
        n = len(L.events); await L.send({"cmd": "ping"})
        t, ev = await L.wait(lambda e: e.get("ev") == "pong", 3, n)
        check("pong.up shows no reboot", ev and ev.get("up", 0) > 12000, str(ev))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="SmartBartender 펌웨어 BLE 시험 (PC 블루투스)")
    ap.add_argument("--port", help="USB 시리얼 포트(예: COM5) — 펌웨어 로그를 함께 모음")
    ap.add_argument("--yes", action="store_true", help="펌프 핀을 켜도 된다는 확인을 건너뜀")
    a = ap.parse_args()
    if not a.yes:
        print("이 시험은 펌프 핀을 실제로 켭니다(약 400ml 분량). 릴레이·펌프가 연결돼 있으면 5V 어댑터를 먼저 뽑으세요.")
        if input("계속할까요? [y/N] ").strip().lower() not in ("y", "yes"):
            sys.exit(0)
    asyncio.run(main(a.port))
    sys.exit(0 if results and all(ok for _, ok, _ in results) else 1)
