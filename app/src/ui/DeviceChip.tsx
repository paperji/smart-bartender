import { Bluetooth, FlaskConical } from 'lucide-react';
import { Link } from 'react-router';

import { useDevice, type ConnState } from '@/store/device';

import { cx } from './cx';

export type ConnTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral';

/** 연결 상태 → 글자·색 (v2.1 DeviceChip connLabel 과 같은 문구) */
export function connLabel(conn: ConnState, kind: string): { text: string; tone: ConnTone } {
  switch (conn) {
    case 'connected':
      return { text: kind === 'demo' ? '데모 기기 연결됨' : '기기 연결됨', tone: 'success' };
    case 'connecting':
      return { text: '연결 중…', tone: 'warning' };
    case 'reconnecting':
      return { text: '다시 연결 중…', tone: 'warning' };
    case 'scanning':
      return { text: '기기 찾는 중…', tone: 'info' };
    case 'disconnected':
      return { text: '연결 끊김', tone: 'danger' };
    default:
      return { text: '기기 미연결', tone: 'neutral' };
  }
}

/** 상단 기기 연결 상태 칩 — 누르면 #/device (연결됨·데모·끊김 표시) */
export function DeviceChip({ className, compact }: { className?: string; compact?: boolean }) {
  const conn = useDevice((s) => s.conn);
  const kind = useDevice((s) => s.transportKind);
  const name = useDevice((s) => s.deviceName);
  const { text, tone } = connLabel(conn, kind);
  const busy = conn === 'connecting' || conn === 'reconnecting' || conn === 'scanning';
  const shown = conn === 'connected' && name ? name : text;
  const KindIcon = kind === 'demo' ? FlaskConical : Bluetooth;
  return (
    <Link to="/device" className={cx('sb-devchip', `sb-devchip--${tone}`, busy && 'is-busy', compact && 'sb-devchip--compact', className)} aria-label={`${text}${conn === 'connected' && name ? ` (${name})` : ''}. 기기 화면으로 이동`}>
      <span className="sb-devchip__dot" aria-hidden="true" />
      <span className="sb-devchip__text">{shown}</span>
      <KindIcon size={14} aria-hidden="true" className="sb-devchip__kind" />
    </Link>
  );
}
