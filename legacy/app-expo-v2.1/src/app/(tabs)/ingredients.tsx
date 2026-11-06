/**
 * ② 재료 — 펌프 슬롯(재료명·종류·도수·잔량/용량·색상) 관리
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { PumpCard } from '@/components/PumpCard';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/feedback';
import { Row, Screen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { colors, radius, space } from '@/constants/theme';
import { josa } from '@/lib/ai/normalize';
import { useDevice } from '@/store/device';
import { installedSlots, isLowStock, useSlots } from '@/store/slots';

export default function IngredientsScreen() {
  const slots = useSlots((s) => s.slots);
  const cal = useDevice((s) => s.cal);
  const info = useDevice((s) => s.info);
  const params = useLocalSearchParams<{ suggest?: string }>();
  const suggest = typeof params.suggest === 'string' ? params.suggest : '';
  const installed = useMemo(() => installedSlots(slots), [slots]);
  const low = slots.filter(isLowStock);

  const open = (pump: number) =>
    router.push({ pathname: '/ingredient-edit', params: suggest ? { pump: String(pump), suggest } : { pump: String(pump) } });

  return (
    <Screen>
      <View style={{ gap: 4, paddingTop: space.sm }}>
        <AppText variant="display">재료</AppText>
        <AppText variant="body" tone="secondary">
          기기의 펌프 {slots.length}개에 어떤 음료(또는 술)를 넣었는지 등록하세요. 언제든 바꿀 수 있어요.
        </AppText>
      </View>

      <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
        <Summary label="장착" value={`${installed.length}/${slots.length}`} />
        <Summary label="잔량 부족" value={`${low.length}개`} warn={low.length > 0} />
        <Summary label="주류" value={`${installed.filter((s) => s.abv > 0).length}개`} />
      </Row>

      {suggest ? (
        <Banner
          tone="info"
          title={`${suggest} 장착하기`}
          message={`${josa(suggest, '을', '를')} 넣을 펌프를 선택하세요. 기존 재료를 빼고 새 재료로 바꾸게 돼요.`}
          action={<Button size="sm" variant="ghost" label="취소" onPress={() => router.setParams({ suggest: '' })} />}
        />
      ) : null}

      <View style={{ gap: space.md }}>
        {slots.map((s) => (
          <PumpCard key={s.pump} slot={s} onPress={() => open(s.pump)} mlps={cal?.[s.pump - 1]} />
        ))}
      </View>

      <Banner
        tone="neutral"
        icon="information-circle"
        message={
          '재료를 바꾸면 점도에 따라 나오는 속도가 달라질 수 있어요. 정확한 양을 원하면 기기 탭 > 캘리브레이션을 해 주세요.' +
          (info && info.pumps !== slots.length ? `\n기기 펌프 수: ${info.pumps}개` : '')
        }
      />
    </Screen>
  );
}

function Summary({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: 96,
        backgroundColor: colors.card,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: warn ? colors.warning + '73' : colors.border,
        paddingVertical: space.md,
        paddingHorizontal: space.md,
        gap: 2,
      }}>
      <AppText variant="small" tone="muted">
        {label}
      </AppText>
      <AppText variant="heading" tone={warn ? 'warning' : 'default'}>
        {value}
      </AppText>
    </View>
  );
}
