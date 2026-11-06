/**
 * 화면 오류 경계 — 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않고 복구 카드를 보여 줌
 *  - ScreenBoundary: 화면(라우트) 하나를 감쌈. 주소가 바뀌면 다시 그려 봄 (내비·탭바는 그대로 → 다른 탭으로 갈 수 있음)
 *  - AppErrorBoundary: 앱 전체(라우터 바깥)를 감쌀 때
 * 복구 카드: [다시 시도] · [입력 초기화 후 다시 열기](홈 입력값 sb3.draft 만 지우고 새로고침 — 재료·기록·설정은 그대로)
 *  · 기기가 작동 중이면 [비상 정지]도 (제조 화면이 깨져도 멈출 수 있게)
 */
import { OctagonX, RotateCcw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router';

import { deviceClient } from '@/lib/device/client';
import { kv } from '@/platform/storage';
import { isBusy, useDevice } from '@/store/device';
import { STORAGE_KEYS } from '@/store/storage';
import { Button, cx, EmptyState, Stack } from '@/ui';

function resetInputAndReload() {
  try {
    kv.removeItem(STORAGE_KEYS.draft);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.location.reload();
}

function ErrorFallback({ onRetry, full }: { onRetry: () => void; full?: boolean }) {
  const busy = useDevice((s) => isBusy(s.job));
  return (
    <div className={cx('dc-crash', full && 'dc-crash--full')} role="alert">
      <EmptyState
        icon={TriangleAlert}
        title="화면을 여는 중 문제가 생겼어요"
        message="저장된 입력값이 깨졌을 수 있어요. 다시 시도해 보고, 그래도 안 되면 입력을 초기화한 뒤 다시 열어 주세요. 재료 설정·제조 기록·설정은 지우지 않아요."
        action={
          <Stack gap={8} align="center">
            {busy ? (
              <Button variant="danger" icon={OctagonX} label="비상 정지" onClick={() => void deviceClient.stop().catch(() => undefined)} />
            ) : null}
            <Button icon={RotateCcw} label="다시 시도" onClick={onRetry} />
            <Button variant="secondary" label="입력 초기화 후 다시 열기" onClick={resetInputAndReload} />
          </Stack>
        }
      />
    </div>
  );
}

interface BoundaryProps {
  children?: ReactNode;
  /** 오류 기록에 남길 화면 이름 */
  name?: string;
  /** 이 값이 바뀌면 오류 상태를 풀고 다시 그려 봄 (화면 이동 등) */
  resetKey?: string;
  /** 앱 전체를 감쌀 때 — 복구 카드를 화면 가운데에 */
  full?: boolean;
}

/** 앱 전체(라우터 바깥)를 감싸는 오류 경계 */
export class AppErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[화면 오류] ${this.props.name ?? 'app'}`, error, info.componentStack);
  }

  componentDidUpdate(prev: BoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <ErrorFallback full={this.props.full} onRetry={() => this.setState({ failed: false })} />;
  }
}

/** 화면(라우트) 하나를 감싸는 오류 경계 — 주소(경로·쿼리·기록 칸)가 바뀌면 다시 그려 봄 */
export function ScreenBoundary({ name, children }: { name: string; children?: ReactNode }) {
  const loc = useLocation();
  return (
    <AppErrorBoundary name={name} resetKey={`${loc.pathname}${loc.search}|${loc.key}`}>
      {children}
    </AppErrorBoundary>
  );
}
