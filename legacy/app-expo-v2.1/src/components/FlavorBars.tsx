import { StyleSheet, View } from 'react-native';

import { colors, space } from '@/constants/theme';
import type { Flavor } from '@/lib/types';

import { AppText } from './ui/Text';

const ITEMS: { key: keyof Flavor; label: string; color: string }[] = [
  { key: 'sweet', label: '단맛', color: '#FF6FAE' },
  { key: 'sour', label: '신맛', color: '#FFC542' },
  { key: 'bitter', label: '쓴맛', color: '#8B7CF6' },
  { key: 'fizzy', label: '탄산', color: '#5CE1C6' },
  { key: 'strength', label: '도수', color: colors.primary },
];

/** 맛 프로필 (0~5, 칸 5개) */
export function FlavorBars({ flavor }: { flavor: Flavor }) {
  return (
    <View style={{ gap: space.sm }}>
      {ITEMS.map((it) => {
        const v = Math.max(0, Math.min(5, flavor[it.key] ?? 0));
        return (
          <View key={it.key} style={styles.row} accessibilityLabel={`${it.label} ${v}점`}>
            <AppText variant="label" tone="secondary" style={styles.label}>
              {it.label}
            </AppText>
            <View style={styles.cells}>
              {[1, 2, 3, 4, 5].map((n) => (
                <View key={n} style={[styles.cell, { backgroundColor: n <= v ? it.color : colors.cardAlt }]} />
              ))}
            </View>
            <AppText variant="small" tone="muted" style={styles.num}>
              {v}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  label: { width: 40 },
  cells: { flex: 1, flexDirection: 'row', gap: 4 },
  cell: { flex: 1, height: 10, borderRadius: 3 },
  num: { width: 14, textAlign: 'right' },
});
