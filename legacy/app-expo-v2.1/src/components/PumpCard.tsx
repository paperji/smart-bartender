import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';
import { CATEGORY_INFO } from '@/lib/presets';
import type { PumpSlot } from '@/lib/types';
import { fmtMl } from '@/lib/ui';
import { isLowStock } from '@/store/slots';

import type { IconName } from './ui/Button';
import { Card } from './ui/Card';
import { Badge, ProgressBar } from './ui/feedback';
import { AppText } from './ui/Text';

export function PumpCard({ slot, onPress, mlps }: { slot: PumpSlot; onPress: () => void; mlps?: number }) {
  const empty = !slot.name;
  if (empty) {
    return (
      <Card dashed tone="alt" onPress={onPress} accessibilityLabel={`펌프 ${slot.pump} 비어 있음. 눌러서 재료 장착`}>
        <View style={styles.row}>
          <PumpNumber n={slot.pump} color={colors.borderStrong} />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong" tone="secondary">
              비어 있음
            </AppText>
            <AppText variant="caption" tone="muted">
              눌러서 재료를 장착하세요
            </AppText>
          </View>
          <Ionicons name="add-circle" size={28} color={colors.primary} />
        </View>
      </Card>
    );
  }
  const info = CATEGORY_INFO[slot.category];
  const ratio = slot.capacityMl > 0 ? slot.remainingMl / slot.capacityMl : 0;
  const low = isLowStock(slot);
  return (
    <Card onPress={onPress} accessibilityLabel={`펌프 ${slot.pump} ${slot.name}, 남은 양 ${Math.round(slot.remainingMl)}ml`}>
      <View style={{ gap: space.md }}>
        <View style={styles.row}>
          <PumpNumber n={slot.pump} color={slot.color} />
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading" numberOfLines={1}>
              {slot.name}
            </AppText>
            <View style={styles.meta}>
              <Ionicons name={info.icon as IconName} size={14} color={colors.textMuted} />
              <AppText variant="caption" tone="muted">
                {info.label}
                {slot.abv > 0 ? ` · ${slot.abv}%` : ' · 무알콜'}
                {mlps ? ` · ${mlps} ml/s` : ''}
              </AppText>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </View>
        <View style={{ gap: 6 }}>
          <View style={styles.between}>
            <AppText variant="small" tone={low ? 'warning' : 'secondary'}>
              남은 양 {fmtMl(slot.remainingMl)} / {fmtMl(slot.capacityMl)}
            </AppText>
            <AppText variant="small" tone="muted">
              {Math.round(ratio * 100)}%
            </AppText>
          </View>
          <ProgressBar value={ratio} color={low ? colors.warning : slot.color} height={8} />
        </View>
        {low || slot.needsCal ? (
          <View style={styles.badges}>
            {low ? <Badge tone="warning" icon="warning" label="잔량 부족 — 보충 필요" /> : null}
            {slot.needsCal ? <Badge tone="info" icon="speedometer" label="캘리브레이션 권장" /> : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

export function PumpNumber({ n, color, size = 44 }: { n: number; color: string; size?: number }) {
  return (
    <View
      style={[
        styles.num,
        { width: size, height: size, borderRadius: size / 2, borderColor: color, backgroundColor: color + '22' },
      ]}>
      <AppText variant="small" tone="muted" style={{ fontSize: 9, lineHeight: 11 }}>
        PUMP
      </AppText>
      <AppText variant="bodyStrong" style={{ lineHeight: 18 }}>
        {n}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  badges: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  num: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
});
