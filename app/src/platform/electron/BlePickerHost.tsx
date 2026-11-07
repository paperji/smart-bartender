/**
 * Windows 앱(EXE, Electron) 의 블루투스 기기 선택 창 (WEBAPP_DESIGN §7)
 * Electron 에는 Chrome 같은 기기 선택 창이 없어서, requestDevice() 를 부르면 메인 프로세스가 select-bluetooth-device 로
 * 찾은 기기 목록을 보내 줌(electron/main.cjs → preload 의 onBleDevices) → 이 창에서 고르면 chooseBleDevice(id),
 * 닫으면 cancelBle() (→ requestDevice 는 NotFoundError 로 조용히 끝남, web-ble.ts 와 같은 흐름).
 * 검색을 시작하면(web-ble.ts 의 BLE_SCAN_EVENT 'start') 기기를 찾기 전이라도 바로 열어 "찾는 중"·취소 버튼을 보여 줌
 * (Electron 은 기기를 하나도 못 찾으면 몇 분 동안 아무 목록도 보내지 않음). 취소하면 BLE_SCAN_CANCEL_EVENT 로 검색도 끝냄.
 * 웹·APK 에서는 아무것도 그리지 않음 (window.sbElectron 이 없음).
 */
import { Bluetooth, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DEVICE_NAME_PREFIX } from '@/lib/protocol';
import { BLE_SCAN_CANCEL_EVENT, BLE_SCAN_EVENT, type BleScanPhase } from '@/lib/transport/web-ble';
import { Badge, Button, Card, ListRow, Modal, Row, Spinner, Stack, Text } from '@/ui';

import type { ElectronBleDevice } from '../detect';

/** 오래 못 찾으면 안내를 바꿈 */
const SLOW_MS = 12000;

export function BlePickerHost() {
  const bridge = typeof window !== 'undefined' ? window.sbElectron : undefined;
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<ElectronBleDevice[]>([]);
  const [slow, setSlow] = useState(false);
  const openRef = useRef(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    openRef.current = false;
    setOpen(false);
    setDevices([]);
    setSlow(false);
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
  };

  useEffect(() => {
    if (!bridge?.onBleDevices) return;
    const openNow = () => {
      if (openRef.current) return;
      openRef.current = true;
      setOpen(true);
      setSlow(false);
      if (slowTimer.current) clearTimeout(slowTimer.current);
      slowTimer.current = setTimeout(() => setSlow(true), SLOW_MS);
    };
    const offList = bridge.onBleDevices((list) => {
      // 이름 있는 SmartBartender 를 위로
      const sorted = [...list].sort(
        (a, b) => Number(b.deviceName.startsWith(DEVICE_NAME_PREFIX)) - Number(a.deviceName.startsWith(DEVICE_NAME_PREFIX)),
      );
      setDevices(sorted);
      openNow();
    });
    const offEnd = bridge.onBleRequestEnd?.(() => close());
    // 검색 시작·끝 (web-ble.ts): 기기를 찾기 전부터 "찾는 중"·취소 버튼을 보여 줌
    const onPhase = (e: Event) => {
      const phase = (e as CustomEvent<{ phase?: BleScanPhase }>).detail?.phase;
      if (phase === 'start') {
        setDevices([]);
        openNow();
      } else if (phase === 'end') {
        close();
      }
    };
    window.addEventListener(BLE_SCAN_EVENT, onPhase);
    return () => {
      offList();
      offEnd?.();
      window.removeEventListener(BLE_SCAN_EVENT, onPhase);
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!bridge?.onBleDevices) return null;

  const choose = (id: string) => {
    bridge.chooseBleDevice?.(id);
    close();
  };
  const cancel = () => {
    bridge.cancelBle?.();
    // 기기를 하나도 못 찾았으면 Electron 이 요청을 끝내 주지 않으므로 검색(web-ble.ts)에도 직접 알림
    window.dispatchEvent(new Event(BLE_SCAN_CANCEL_EVENT));
    close();
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      // 검색을 누르자마자 열리므로 "기기 선택" 두 번 누르기의 두 번째가 바깥(배경)을 눌러 취소되지 않게 — 닫기는 취소·Esc·X
      closeOnBackdrop={false}
      size="sm"
      title="연결할 기기 선택"
      description="칵테일 메이커(SmartBartender)를 골라 주세요."
      footer={<Button variant="secondary" label="취소" full onClick={cancel} />}>
      {devices.length === 0 ? (
        <Stack gap={8}>
          <Row gap={10}>
            <Spinner size={18} label="기기 찾는 중" />
            <Text tone="secondary">주변 기기를 찾는 중이에요…</Text>
          </Row>
          {slow ? (
            <Text variant="caption" tone="muted">
              기기를 찾지 못했어요. 칵테일 메이커 전원이 켜져 있는지, 이 PC 의 블루투스가 켜져 있는지 확인해 주세요. 다른 휴대폰·PC 에
              이미 연결돼 있으면 먼저 끊어 주세요.
            </Text>
          ) : null}
        </Stack>
      ) : (
        <Stack gap={8}>
          <Card padded={false}>
            {devices.map((d) => {
              const likely = d.deviceName.startsWith(DEVICE_NAME_PREFIX);
              return (
                <ListRow
                  key={d.deviceId}
                  icon={Bluetooth}
                  title={d.deviceName || '(이름 없음)'}
                  trailing={likely ? <Badge label="칵테일 메이커" tone="accent" /> : undefined}
                  onClick={() => choose(d.deviceId)}
                />
              );
            })}
          </Card>
          <Row gap={6}>
            <Search size={14} aria-hidden="true" />
            <Text variant="caption" tone="muted">
              계속 찾는 중이에요. 목록에 없으면 기기 전원을 확인해 주세요.
            </Text>
          </Row>
        </Stack>
      )}
    </Modal>
  );
}
