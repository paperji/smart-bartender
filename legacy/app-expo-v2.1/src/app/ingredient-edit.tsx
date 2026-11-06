/**
 * 재료 편집 (모달) — 이름·종류·도수·용량·잔량·색상, 프리셋 빠른 선택, 가득 채움/비우기
 * 탐색 카드에서 열리면(from=explore) 이름·카테고리·도수를 미리 채우고,
 * 저장하면 그 레시피를 normal 모드로 다시 추천받아 레시피 화면으로 이동 (SPEC §5.4)
 *  - 빈 기기 탐색처럼 새 재료가 2개인 카드는, 첫 재료를 저장하면 남은 재료 장착 화면을 이어서 열고
 *    모두 장착된 뒤에 재추천 (1개만으로는 레시피가 성립하지 않음)
 * 술 종류(증류주·리큐르·와인)나 술 이름(프리셋 정확 일치)인데 도수 0% 이면 저장 전에 확인
 *  (도수 0% 술은 무알콜 레시피에 들어가고 성인 확인도 건너뛰기 때문)
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PumpNumber } from '@/components/PumpCard';
import { Button, type IconName } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Stepper } from '@/components/ui/controls';
import { Banner, ProgressBar } from '@/components/ui/feedback';
import { EmptyState, Row, Screen, Section } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/constants/theme';
import { nameKey, pumpUsage, recommendPump, remainingToInstall } from '@/lib/ai/explore';
import { josa } from '@/lib/ai/normalize';
import { openInstall, recommendAndShow } from '@/lib/flow';
import { CATEGORY_INFO, findExactPreset, findPreset, INGREDIENT_COLORS, PRESETS, type IngredientPreset } from '@/lib/presets';
import { CATEGORIES, type Category } from '@/lib/types';
import { confirmAsync, fmtMl, haptic } from '@/lib/ui';
import { useDraft, useSession } from '@/store/draft';
import { useHistory } from '@/store/history';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

/** 술 종류 */
const ALCOHOL_CATS: Category[] = ['spirit', 'liqueur', 'wine'];
/** 술 종류를 골랐는데 도수가 0이면 넣는 기본 도수 */
const DEFAULT_ABV: Partial<Record<Category, number>> = { spirit: 40, liqueur: 20, wine: 12 };

export default function IngredientEditScreen() {
  const params = useLocalSearchParams<{ pump?: string; suggest?: string; category?: string; abv?: string; from?: string; done?: string }>();
  const pump = Number(params.pump);
  const fromExplore = params.from === 'explore';
  const [saving, setSaving] = useState(false);
  const slot = useSlots((s) => s.slots.find((x) => x.pump === pump));
  const allSlots = useSlots((s) => s.slots);
  const installTarget = useSession((s) => s.installTarget);
  const updateSlot = useSlots((s) => s.updateSlot);
  const clearSlot = useSlots((s) => s.clearSlot);
  const insets = useSafeAreaInsets();

  const initial = useMemo(() => {
    const suggest = typeof params.suggest === 'string' ? params.suggest.trim() : '';
    const base = slot ?? null;
    if (suggest) {
      const p = findPreset(suggest);
      const cat = typeof params.category === 'string' && (CATEGORIES as string[]).includes(params.category) ? (params.category as Category) : null;
      const abvParam = typeof params.abv === 'string' ? Number(params.abv) : NaN;
      return {
        // 탐색 카드에서 온 경우 AI 가 쓴 이름을 그대로 (재추천 때 이름으로 매칭)
        name: fromExplore ? suggest.slice(0, 20) : (p?.name ?? suggest),
        category: (cat ?? p?.category ?? 'other') as Category,
        abv: Number.isFinite(abvParam) && abvParam >= 0 ? Math.min(96, abvParam) : (p?.abv ?? 0),
        color: p?.color ?? base?.color ?? INGREDIENT_COLORS[0],
        capacityMl: base?.capacityMl ?? 1000,
        remainingMl: base?.capacityMl ?? 1000,
        notes: '',
      };
    }
    return {
      name: base?.name ?? '',
      category: base?.category ?? ('other' as Category),
      abv: base?.abv ?? 0,
      color: base?.color ?? INGREDIENT_COLORS[0],
      capacityMl: base?.capacityMl ?? 1000,
      remainingMl: base?.name ? base.remainingMl : (base?.capacityMl ?? 1000),
      notes: base?.notes ?? '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<Category>(initial.category);
  const [abv, setAbv] = useState(initial.abv);
  const [color, setColor] = useState(initial.color);
  const [capacityMl, setCapacity] = useState(initial.capacityMl);
  const [remainingMl, setRemaining] = useState(Math.min(initial.remainingMl, initial.capacityMl));
  const [notes, setNotes] = useState(initial.notes);
  const [showAllPresets, setShowAllPresets] = useState(false);

  const presets = useMemo(() => {
    // 사용자가 이름을 새로 입력하고 있을 때만 검색(기존 재료를 열었을 땐 전체 표시)
    const q = name.trim() === initial.name.trim() ? '' : name.replace(/\s+/g, '').toLowerCase();
    const list = q
      ? PRESETS.filter(
          (p) => p.name.toLowerCase().includes(q) || p.aliases?.some((a) => a.toLowerCase().includes(q)),
        )
      : PRESETS;
    return showAllPresets || q ? list : list.slice(0, 12);
  }, [name, showAllPresets, initial.name]);

  if (!slot) {
    return (
      <Screen edges={[]}>
        <EmptyState icon="alert-circle" title="펌프를 찾을 수 없어요" action={<Button label="닫기" onPress={() => router.back()} />} />
      </Screen>
    );
  }

  const applyPreset = (p: IngredientPreset) => {
    haptic.tap();
    setName(p.name);
    setCategory(p.category);
    setAbv(p.abv);
    setColor(p.color);
  };

  const materialChanged = !!slot.name && (slot.name.trim() !== name.trim() || slot.category !== category);

  /** 탐색 카드의 재료 중 이 화면에서 넣는 것 말고도 아직 장착해야 하는 재료 */
  const othersToInstall =
    fromExplore && installTarget
      ? remainingToInstall(installTarget, allSlots).filter((x) => nameKey(x) !== nameKey(name.trim()))
      : [];

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('재료 이름을 입력해 주세요.', 'warning');
      return;
    }
    const abvToSave = Math.max(0, Math.min(96, Math.round(abv * 10) / 10));
    // 술 종류이거나 술 이름(프리셋 정확 일치)인데 도수 0% → 무알콜 레시피에 들어가고 성인 확인도 건너뜀 → 확인 받기
    const preset = findExactPreset(n);
    const presetAlcohol = preset && preset.abv > 0 ? preset : null;
    if (abvToSave <= 0 && (ALCOHOL_CATS.includes(category) || presetAlcohol)) {
      const why = presetAlcohol
        ? `${josa(n, '은', '는')} 보통 도수 ${presetAlcohol.abv}% 술이에요.`
        : `종류가 '${CATEGORY_INFO[category].label}'(술)인데 도수가 0%예요.`;
      const ok = await confirmAsync(
        '술인데 도수가 0%예요',
        `${why} 도수 0%로 저장하면 무알콜 레시피에 들어가고 성인 확인도 건너뛰어요. 정말 알코올이 없는 음료인가요?`,
        { confirmText: '네, 무알콜이에요', cancelText: '도수 고치기' },
      );
      if (!ok) {
        // 고치기 쉽게 도수를 미리 채워 둠 (프리셋 도수 → 종류 기본 도수)
        const fix = presetAlcohol?.abv ?? DEFAULT_ABV[category];
        if (fix) setAbv(fix);
        toast('도수를 확인한 뒤 다시 저장해 주세요.', 'info');
        return;
      }
    }
    updateSlot(pump, {
      name: n.slice(0, 20),
      category,
      abv: abvToSave,
      color,
      capacityMl,
      remainingMl: Math.min(remainingMl, capacityMl),
      notes: notes.trim().slice(0, 80),
      ...(slot.name ? {} : { needsCal: false }),
    });
    haptic.success();
    toast(`펌프 ${pump}에 ${josa(n, '을', '를')} 저장했어요.`, 'success');
    const target = useSession.getState().installTarget;
    if (fromExplore && target) {
      // 새 재료가 2개인 카드(빈 기기 탐색): 남은 재료가 있으면 그 장착 화면을 이어서 엶 (재추천은 모두 장착한 뒤)
      const slotsNow = useSlots.getState().slots;
      // 앞 단계와 이 화면에서 넣기로 한 재료는 (사용자가 이름을 바꿔 저장했더라도) 장착한 것으로 봄 → 같은 재료를 다시 묻지 않음
      const doneKeys = new Set(
        [...(typeof params.done === 'string' && params.done ? params.done.split('|') : []), typeof params.suggest === 'string' ? params.suggest : '', n]
          .map((x) => nameKey(x))
          .filter(Boolean),
      );
      const left = remainingToInstall(target, slotsNow).filter((x) => !doneKeys.has(nameKey(x)));
      if (left.length) {
        const next = left[0];
        const used = new Set(target.ingredients.map((i) => nameKey(i.name)));
        const exclude = new Set<number>([pump, ...slotsNow.filter((x) => x.name && used.has(nameKey(x.name))).map((x) => x.pump)]);
        const pick = recommendPump(slotsNow, pumpUsage(slotsNow, useHistory.getState().entries), target, exclude);
        if (pick) {
          const p = findExactPreset(next);
          openInstall(target, pick, {
            replace: true,
            ingredient: { name: next, category: p?.category ?? 'other', abv: p?.abv ?? 0 },
            done: Array.from(doneKeys),
          });
          setTimeout(() => toast(`이어서 ${josa(next, '을', '를')} 펌프 ${pick.pump}에 장착해 주세요.`, 'info'), 600);
          return;
        }
        // 남은 재료를 넣을 펌프가 없음 → 지금 재료로 다시 추천 (아래)
      }
      // 장착 완료 → 해당 레시피를 normal 모드로 다시 추천 (SPEC §5.4)
      setSaving(true);
      useSession.getState().setInstallTarget(null);
      const input = useSession.getState().explore?.input ?? useSession.getState().current?.input ?? useDraft.getState().input;
      const res = await recommendAndShow({ input, mode: 'normal', target }, { nav: 'none' });
      setSaving(false);
      if (res) {
        useSession.getState().setRejectStreak(0);
        router.dismissTo('/recipe');
        if (materialChanged || slot.name) {
          setTimeout(() => toast(`재료가 바뀌었어요. 정확한 양을 위해 기기 탭에서 펌프 ${pump} 프라이밍·캘리브레이션을 권장해요.`, 'info'), 3000);
        }
      }
      return;
    }
    router.back();
    if (materialChanged) {
      const go = await confirmAsync(
        '캘리브레이션을 권장해요',
        `재료가 바뀌었어요. 액체의 점도에 따라 나오는 양이 달라질 수 있어서 펌프 ${pump} 캘리브레이션을 권장해요. 지금 할까요?`,
        { confirmText: '캘리브레이션 하기', cancelText: '나중에' },
      );
      if (go) router.push({ pathname: '/calibrate', params: { pump: String(pump) } });
    }
  };

  const remove = async () => {
    const ok = await confirmAsync('재료 빼기', `펌프 ${pump}번을 빈 슬롯으로 만들까요? (레시피에 쓰이지 않게 돼요)`, {
      confirmText: '빼기',
      destructive: true,
    });
    if (!ok) return;
    clearSlot(pump);
    toast(`펌프 ${pump}번을 비웠어요.`, 'success');
    router.back();
  };

  return (
    <>
      <Stack.Screen options={{ title: `펌프 ${pump} 재료 설정` }} />
      <Screen
        edges={[]}
        keyboard
        footer={
          <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
            <View style={styles.footerInner}>
              <Button variant="secondary" label="취소" onPress={() => router.back()} style={{ flex: 1 }} />
              <Button
                icon="checkmark"
                label={fromExplore ? '저장하고 추천받기' : '저장'}
                onPress={save}
                loading={saving}
                style={{ flex: 2 }}
                disabled={!name.trim() || saving}
              />
            </View>
          </View>
        }>
        {fromExplore ? (
          <Banner
            tone="primary"
            icon="compass"
            title="새 재료 장착하기"
            message={
              (slot.name
                ? `펌프 ${pump}의 ${slot.name} 대신 ${josa(name.trim() || '새 재료', '을', '를')} 넣어요. 실제 용기를 바꿔 끼운 뒤 저장하세요.`
                : `비어 있는 펌프 ${pump}에 ${josa(name.trim() || '새 재료', '을', '를')} 넣어요. 용기를 끼운 뒤 저장하세요.`) +
              (othersToInstall.length
                ? ` 이 레시피는 ${othersToInstall.join(', ')}도 필요해서, 저장하면 다음 재료 장착 화면이 이어서 열려요.`
                : '')
            }
          />
        ) : null}
        <Row style={{ gap: space.md }}>
          <PumpNumber n={pump} color={color} size={52} />
          <View style={{ flex: 1 }}>
            <AppText variant="title">{name.trim() || '새 재료'}</AppText>
            <AppText variant="caption" tone="muted">
              {CATEGORY_INFO[category].label} · {abv > 0 ? `${abv}%` : '무알콜'} · {fmtMl(remainingMl)} 남음
            </AppText>
          </View>
        </Row>

        <Section title="빠른 선택" subtitle="누르면 이름·종류·도수·색이 자동으로 채워져요" icon="flash">
          <ChipRow>
            {presets.map((p) => (
              <Chip key={p.name} size="sm" label={p.name} dotColor={p.color} selected={p.name === name.trim()} onPress={() => applyPreset(p)} />
            ))}
          </ChipRow>
          {name.trim() === initial.name.trim() ? (
            <Button
              size="sm"
              variant="ghost"
              label={showAllPresets ? '접기' : `전체 보기 (${PRESETS.length}개)`}
              iconRight={showAllPresets ? 'chevron-up' : 'chevron-down'}
              onPress={() => setShowAllPresets((v) => !v)}
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </Section>

        <TextField label="재료 이름" placeholder="예: 오렌지주스" value={name} onChangeText={setName} maxLength={20} returnKeyType="done" />

        <Section title="종류">
          <ChipRow>
            {CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={CATEGORY_INFO[c].label}
                icon={CATEGORY_INFO[c].icon as IconName}
                selected={category === c}
                onPress={() => {
                  setCategory(c);
                  if (ALCOHOL_CATS.includes(c)) {
                    // 술 종류로 바꿨는데 도수가 0 → 기본 도수 (증류주 40 · 리큐르 20 · 와인 12)
                    if (abv <= 0) setAbv(DEFAULT_ABV[c] ?? 0);
                  } else if (abv > 0 && category !== c) {
                    setAbv(0);
                  }
                }}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="알코올 도수" subtitle="무알콜 음료는 0%">
          <Stepper value={abv} onChange={setAbv} min={0} max={60} step={0.5} unit="%" presets={[0, 4.5, 12, 16.5, 20, 40]} />
          {abv > 0 ? (
            <AppText variant="caption" tone="warning">
              주류가 장착되면 제조 전에 성인 확인을 해요.
            </AppText>
          ) : ALCOHOL_CATS.includes(category) || findExactPreset(name)?.abv ? (
            <AppText variant="caption" tone="danger">
              술인데 도수가 0%예요. 0%로 두면 무알콜 레시피에 들어가요.
            </AppText>
          ) : null}
        </Section>

        <Section title="용기 용량">
          <Stepper
            value={capacityMl}
            onChange={(v) => {
              setCapacity(v);
              if (remainingMl > v) setRemaining(v);
            }}
            min={100}
            max={3000}
            step={50}
            unit="ml"
            presets={[500, 750, 1000, 1500, 2000]}
          />
        </Section>

        <Section title="남은 양" subtitle="제조할 때마다 자동으로 줄어들어요">
          <Card style={{ gap: space.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="heading">{fmtMl(remainingMl)}</AppText>
              <AppText variant="label" tone="muted">
                {Math.round((remainingMl / Math.max(1, capacityMl)) * 100)}%
              </AppText>
            </Row>
            <ProgressBar value={remainingMl / Math.max(1, capacityMl)} color={color} height={12} />
            <Stepper value={remainingMl} onChange={setRemaining} min={0} max={capacityMl} step={10} unit="ml" />
            <Row>
              <Button variant="outline" icon="water" label="가득 채움" onPress={() => setRemaining(capacityMl)} style={{ flex: 1 }} />
              <Button variant="secondary" icon="water-outline" label="비우기 (0ml)" onPress={() => setRemaining(0)} style={{ flex: 1 }} />
            </Row>
          </Card>
        </Section>

        <Section title="표시 색상" subtitle="레시피 비율 막대와 진행 화면에 쓰여요">
          <View style={styles.swatches}>
            {INGREDIENT_COLORS.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`색상 ${c}`}
                accessibilityState={{ selected: c === color }}
                onPress={() => {
                  haptic.tap();
                  setColor(c);
                }}
                style={[styles.swatch, { backgroundColor: c, borderColor: c === color ? colors.text : 'transparent' }]}>
                {c === color ? <Ionicons name="checkmark" size={20} color={colors.onPrimary} /> : null}
              </Pressable>
            ))}
          </View>
        </Section>

        <TextField label="메모 (선택)" placeholder="예: 무가당, 냉장 보관" value={notes} onChangeText={setNotes} maxLength={80} />

        {materialChanged ? (
          <Banner tone="info" icon="speedometer" message="재료가 바뀌면 이 펌프 캘리브레이션을 권장해요. 저장 후 안내해 드릴게요." />
        ) : null}

        {slot.name ? (
          <Button variant="ghost" icon="trash" label="이 펌프에서 재료 빼기" onPress={remove} />
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  footerInner: { flexDirection: 'row', gap: space.sm, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
