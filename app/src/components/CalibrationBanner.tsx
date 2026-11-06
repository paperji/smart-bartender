/**
 * "캘리브레이션 전" 배너 — 기기가 알려준 calSet 에 0(기본값)인 펌프가 있으면 표시 (SPEC §5.6)
 * 바텐더 탭 · 기기 탭에서 사용. "나중에"를 누르면 앱을 다시 켤 때까지 숨김(저장하지 않음). v2.1 CalibrationBanner
 */
import { Gauge } from 'lucide-react';
import { create } from 'zustand';

import { go, withQuery } from '@/lib/nav';
import { LIMITS, uncalibratedPumps } from '@/lib/protocol';
import { useDevice } from '@/store/device';
import { Banner, Button, Row } from '@/ui';

const useDismissed = create<{ dismissed: boolean }>()(() => ({ dismissed: false }));

/** "나중에"로 숨긴 배너를 다시 보이게 (데이터 초기화 등) */
export function resetCalibrationBanner(): void {
  useDismissed.setState({ dismissed: false });
}

/** 캘리브레이션 마법사 주소 — 펌프를 주면 그 펌프부터 (`/calibrate?pump=2`) */
export function calibratePath(pump?: number): string {
  return withQuery('/calibrate', { pump: pump ? String(pump) : undefined });
}

export interface CalibrationNoticeProps {
  /** 아직 측정하지 않은 펌프 번호들 (1부터) */
  pumps: readonly number[];
  /** [캘리브레이션 마법사] */
  onCalibrate: () => void;
  /** 있으면 [나중에] 버튼 */
  onDismiss?: () => void;
  className?: string;
}

/** 배너 모양만 (상태와 무관) — 보통은 아래 CalibrationBanner 를 쓰세요 */
export function CalibrationNotice({ pumps, onCalibrate, onDismiss, className }: CalibrationNoticeProps) {
  return (
    <Banner
      tone="warning"
      icon={Gauge}
      className={className}
      title="캘리브레이션 전 — 실제보다 적게 나올 수 있어요"
      message={`펌프 ${pumps.join('·')}의 유량을 아직 측정하지 않았어요. 기본값(${LIMITS.defaultMlps}ml/초)은 실제(약 3~6ml/초)보다 커서 레시피보다 적게 나와요. 마법사로 10초만 측정해 보세요.`}
      action={
        <Row wrap>
          <Button size="sm" variant="secondary" icon={Gauge} label="캘리브레이션 마법사" onClick={onCalibrate} />
          {onDismiss ? <Button size="sm" variant="ghost" label="나중에" onClick={onDismiss} /> : null}
        </Row>
      }
    />
  );
}

export interface CalibrationBannerProps {
  /** [나중에] 버튼 표시 (기본 true). 기기 화면은 false */
  dismissible?: boolean;
  className?: string;
}

/** 기기가 연결돼 있고 측정 안 한 펌프가 있을 때만 보임 — 아니면 아무것도 그리지 않음(null) */
export function CalibrationBanner({ dismissible = true, className }: CalibrationBannerProps) {
  const conn = useDevice((s) => s.conn);
  const calSet = useDevice((s) => s.calSet);
  const pumps = useDevice((s) => s.info?.pumps);
  const dismissed = useDismissed((s) => s.dismissed);
  if (conn !== 'connected') return null;
  const list = uncalibratedPumps(calSet, pumps);
  if (!list.length || (dismissible && dismissed)) return null;
  return (
    <CalibrationNotice
      pumps={list}
      className={className}
      onCalibrate={() => go(calibratePath(list[0]))}
      onDismiss={dismissible ? () => useDismissed.setState({ dismissed: true }) : undefined}
    />
  );
}
