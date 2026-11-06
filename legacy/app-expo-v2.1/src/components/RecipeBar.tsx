import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/constants/theme';
import type { PumpSlot, RecipeIngredient } from '@/lib/types';

import { AppText } from './ui/Text';

export function colorFor(pump: number, slots: PumpSlot[]) {
  return slots.find((s) => s.pump === pump)?.color ?? colors.textMuted;
}

/** 재료 비율 스택 막대 + 범례 */
export function RecipeBar({
  ingredients,
  slots,
  height = 18,
  legend = true,
}: {
  ingredients: RecipeIngredient[];
  slots: PumpSlot[];
  height?: number;
  legend?: boolean;
}) {
  const total = ingredients.reduce((a, b) => a + b.ml, 0) || 1;
  return (
    <View style={{ gap: space.sm }}>
      <View
        style={[styles.bar, { height, borderRadius: height / 2 }]}
        accessibilityLabel={ingredients.map((i) => `${i.name} ${Math.round((i.ml / total) * 100)}%`).join(', ')}>
        {ingredients.map((i, idx) => (
          <View
            key={i.pump}
            style={{
              flex: i.ml / total,
              backgroundColor: colorFor(i.pump, slots),
              borderRightWidth: idx < ingredients.length - 1 ? 2 : 0,
              borderRightColor: colors.card,
            }}
          />
        ))}
      </View>
      {legend ? (
        <View style={styles.legend}>
          {ingredients.map((i) => (
            <View key={i.pump} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: colorFor(i.pump, slots) }]} />
              <AppText variant="small" tone="secondary">
                {i.name} {Math.round((i.ml / total) * 100)}%
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', overflow: 'hidden', backgroundColor: colors.cardAlt },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
});
