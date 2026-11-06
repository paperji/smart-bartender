/**
 * Windows 앱(EXE, Electron) 의 블루투스 기기 선택 창 (WEBAPP_DESIGN §7)
 * Electron 에는 Chrome 같은 기기 선택 창이 없어서, requestDevice() 를 부르면 메인 프로세스가 select-bluetooth-device 로
 * 찾은 기기 목록을 보내 줌(electron/main.cjs → preload 의 onBleDevices) → 이 창에서 고르면 chooseBleDevice(id),
 * 닫으면 cancelBle() (→ requestDevice 는 NotFoundError 로 조용히 끝남, web-ble.ts 와 같은 흐름).
 * 웹·APK 에서는 아무것도 그리지 않음 (window.sbElectron 이 없음).
 */
import { Bluetooth, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DEVICE_NAME_PREFIX } from '@/lib/protocol';
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
    const offList = bridge.onBleDevices((list) => {
      // 이름 있는 SmartBartender 를 위로
      const sorted = [...list].sort(
        (a, b) => Number(b.deviceName.startsWith(DEVICE_NAME_PREFIX)) - Number(a.deviceName.startsWith(DEVICE_NAME_PREFIX)),
      );
      setDevices(sorted);
      if (!openRef.current) {
        openRef.current = true;
        setOpen(true);
        setSlow(false);
        if (slowTimer.current) clearTimeout(slowTimer.current);
        slowTimer.current = setTimeout(() => setSlow(true), SLOW_MS);
      }
    });
    const offEnd = bridge.onBleRequestEnd?.(() => close());
    return () => {
      offList();
      offEnd?.();
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
    close();
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
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
