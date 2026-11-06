/**
 * "캘리브레이션 전" 배너 — 기기가 알려준 calSet 에 0(기본값)인 펌프가 있으면 표시 (SPEC §5.6)
 * 바텐더 탭 · 기기 탭에서 사용. "나중에"를 누르면 앱을 다시 켤 때까지 숨김.
 */
import { router } from 'expo-router';
import { View } from 'react-native';
import { create } from 'zustand';

import { space } from '@/constants/theme';
import { LIMITS, uncalibratedPumps } from '@/lib/protocol';
import { useDevice } from '@/store/device';

import { Button } from './ui/Button';
import { Banner } from './ui/feedback';

const useDismissed = create<{ dismissed: boolean }>()(() => ({ dismissed: false }));

export function CalibrationBanner({ dismissible = true }: { dismissible?: boolean }) {
  const conn = useDevice((s) => s.conn);
  const calSet = useDevice((s) => s.calSet);
  const pumps = useDevice((s) => s.info?.pumps);
  const dismissed = useDismissed((s) => s.dismissed);
  if (conn !== 'connected') return null;
  const list = uncalibratedPumps(calSet, pumps);
  if (!list.length || (dismissible && dismissed)) return null;
  return (
    <Banner
      tone="warning"
      icon="speedometer"
      title="캘리브레이션 전 — 실제보다 적게 나올 수 있어요"
      message={`펌프 ${list.join('·')}의 유량을 아직 측정하지 않았어요. 기본값(${LIMITS.defaultMlps}ml/초)은 실제(약 3~6ml/초)보다 커서 레시피보다 적게 나와요. 마법사로 10초만 측정해 보세요.`}
      action={
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button
            size="sm"
            variant="outline"
            icon="speedometer"
            label="캘리브레이션 마법사"
            onPress={() => router.push({ pathname: '/calibrate', params: { pump: String(list[0]) } })}
          />
          {dismissible ? (
            <Button size="sm" variant="ghost" label="나중에" onPress={() => useDismissed.setState({ dismissed: true })} />
          ) : null}
        </View>
      }
    />
  );
}
