/**
 * 탐색(explore) 카드 — "이 재료를 장착하면 이런 레시피를 만들 수 있어요" (SPEC §5.4)
 * 레시피 이름·설명·재료(미장착 재료 강조)·메시지 + "펌프 N에 장착하기"
 * (빈 펌프 우선, 없으면 기록상 가장 적게 쓰인 펌프)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';
import { missingIngredients, pumpUsage, recommendPump, type PumpPick } from '@/lib/ai/explore';
import { particle } from '@/lib/ai/normalize';
import { CATEGORY_INFO, findPreset } from '@/lib/presets';
import type { ExploreItem } from '@/lib/types';
import { fmtMl } from '@/lib/ui';
import { useHistory } from '@/store/history';
import { useSlots } from '@/store/slots';

import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Badge } from './ui/feedback';
import { Row } from './ui/layout';
import { AppText } from './ui/Text';

export function ExploreCard({
  item,
  onInstall,
  compact,
}: {
  item: ExploreItem;
  onInstall: (item: ExploreItem, pick: PumpPick) => void;
  /** 레시피 화면 안에 넣을 때(normal 모드 0~1개) */
  compact?: boolean;
}) {
  const slots = useSlots((s) => s.slots);
  const entries = useHistory((s) => s.entries);
  const pick = useMemo(() => recommendPump(slots, pumpUsage(slots, entries), item), [slots, entries, item]);
  const missing = missingIngredients(item);
  const total = item.ingredients.reduce((a, b) => a + b.ml, 0) || 1;
  const cat = CATEGORY_INFO[item.category] ?? CATEGORY_INFO.other;
  const newColor = findPreset(item.addIngredient)?.color ?? colors.primary;

  return (
    <Card style={[styles.card, compact ? null : styles.full]}>
      <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name="add-circle" size={24} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Badge label="새 재료" tone="primary" icon="sparkles" />
          <AppText variant="heading">{item.addIngredient}</AppText>
          <AppText variant="caption" tone="muted">
            {cat.label} · {item.abv > 0 ? `도수 ${item.abv}%` : '무알콜'}
          </AppText>
        </View>
      </Row>

      <View style={{ gap: 2 }}>
        <AppText variant="title">{item.recipeName}</AppText>
        {item.description ? (
          <AppText variant="body" tone="secondary">
            {item.description}
          </AppText>
        ) : null}
      </View>

      <View style={styles.list}>
        {item.ingredients.map((i, idx) => {
          const slot = i.installed ? slots.find((s) => s.pump === i.pump) : undefined;
          const color = i.installed ? (slot?.color ?? colors.textMuted) : newColor;
          return (
            <View key={`${i.name}-${idx}`} style={[styles.ing, !i.installed ? styles.ingNew : null]}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong" numberOfLines={1} color={i.installed ? colors.text : colors.primary}>
                  {i.name}
                </AppText>
                <AppText variant="small" tone={i.installed ? 'muted' : 'primary'}>
                  {i.installed ? `펌프 ${i.pump} · 장착됨` : '미장착 · 새로 넣어야 해요'} · {Math.round((i.ml / total) * 100)}%
                </AppText>
              </View>
              <AppText variant="label" tone={i.installed ? 'secondary' : 'primary'}>
                {fmtMl(i.ml)}
              </AppText>
            </View>
          );
        })}
      </View>

      <AppText variant="caption" tone="secondary">
        {item.message}
      </AppText>

      {pick ? (
        <View style={{ gap: space.xs }}>
          <Button icon="add-circle" label={`펌프 ${pick.pump}에 장착하기`} onPress={() => onInstall(item, pick)} full />
          <AppText variant="caption" tone="muted">
            {pick.reason === 'empty'
              ? `펌프 ${pick.pump}번이 비어 있어요.`
              : `펌프 ${pick.pump}의 ${pick.current}${particle(pick.current ?? '', '은', '는')} 기록상 가장 적게 쓰였어요(${pick.uses ?? 0}회). 바꿔 끼우면 돼요.`}
          </AppText>
        </View>
      ) : null}
      {missing.length > 1 ? (
        <AppText variant="caption" tone="warning">
          {missing.slice(1).join(', ')}도 함께 장착해야 이 레시피를 그대로 만들 수 있어요. 첫 재료를 저장하면 다음 재료 장착 화면이 이어서 열려요.
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, borderColor: colors.primaryBorder },
  full: { borderWidth: 1.5 },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  list: { gap: space.xs },
  ing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ingNew: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder, borderStyle: 'dashed' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
