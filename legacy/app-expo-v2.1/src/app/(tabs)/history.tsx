/**
 * ③ 기록 — 제조 기록(날짜·레시피·피드백) / 즐겨찾기 → 다시 만들기
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { RecipeBar } from '@/components/RecipeBar';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Segmented } from '@/components/ui/controls';
import { Badge } from '@/components/ui/feedback';
import { EmptyState, Row, Screen } from '@/components/ui/layout';
import { AppText } from '@/components/ui/Text';
import { colors, space } from '@/constants/theme';
import { strengthForAbv } from '@/lib/ai/normalize';
import { remapSavedRecipe } from '@/lib/brew';
import type { Recipe, RecipeSource, Strength } from '@/lib/types';
import { alertMessage, confirmAsync, fmtDate, fmtMl } from '@/lib/ui';
import { DEFAULT_INPUT, useDraft, useSession } from '@/store/draft';
import { isFavorite, useHistory, type HistoryEntry } from '@/store/history';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';

type TabKey = 'history' | 'favorites';

export default function HistoryScreen() {
  const [tab, setTab] = useState<TabKey>('history');
  const entries = useHistory((s) => s.entries);
  const favorites = useHistory((s) => s.favorites);
  const toggleFavorite = useHistory((s) => s.toggleFavorite);
  const removeEntry = useHistory((s) => s.remove);
  const removeFavorite = useHistory((s) => s.removeFavorite);
  const slots = useSlots((s) => s.slots);

  const remake = (recipe: Recipe, source: RecipeSource, strength?: Strength) => {
    try {
      const st = strength ?? strengthForAbv(recipe.estimatedAbv);
      const base = useDraft.getState().input ?? DEFAULT_INPUT;
      // 지금 성향(알레르기·싫어하는 재료)도 레시피 화면의 ml 조정과 같은 기준으로 처음부터 반영 (빠진 재료는 안내 배너)
      const { recipe: r, warnings } = remapSavedRecipe(recipe, slots, st, undefined, base.preference);
      useSession.getState().setCurrent({
        recipe: r,
        explore: [],
        mode: 'normal',
        source,
        warnings,
        createdAt: Date.now(),
        input: { ...base, strength: st, cupMl: Math.round(r.totalMl) },
        variation: 0,
        fromSaved: true,
      });
      useSession.getState().setRejectStreak(0);
      router.push('/recipe');
    } catch (e: any) {
      // 왜 못 만드는지(성향으로 뺀 재료·무알콜·미장착 등)도 함께 보여 줌
      const why: string[] = Array.isArray(e?.adjustments) ? e.adjustments : [];
      alertMessage('다시 만들 수 없어요', [e?.message ?? '지금 장착된 재료로는 이 레시피를 만들 수 없어요.', ...why].join('\n'));
    }
  };

  const likes = entries.filter((e) => e.feedback === 'like').length;

  return (
    <Screen>
      <View style={{ gap: 4, paddingTop: space.sm }}>
        <AppText variant="display">기록</AppText>
        <AppText variant="body" tone="secondary">
          지금까지 {entries.length}잔을 만들었어요{likes ? ` · 좋아요 ${likes}개` : ''}.
        </AppText>
      </View>
      <Segmented<TabKey>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'history', label: `제조 기록 ${entries.length}` },
          { value: 'favorites', label: `즐겨찾기 ${favorites.length}` },
        ]}
      />

      {tab === 'history' ? (
        entries.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="아직 만든 음료가 없어요"
            message="바텐더 탭에서 AI 레시피를 만들고 기기로 제조하면 여기에 기록돼요."
            action={<Button label="첫 잔 만들러 가기" icon="sparkles" onPress={() => router.navigate('/')} />}
          />
        ) : (
          <View style={{ gap: space.md }}>
            {entries.map((e) => (
              <HistoryCard
                key={e.id}
                entry={e}
                fav={isFavorite(favorites, e.recipe)}
                onRemake={() => remake(e.recipe, e.source, e.strength)}
                onFav={() => toast(toggleFavorite(e.recipe) ? '즐겨찾기에 추가했어요.' : '즐겨찾기에서 뺐어요.', 'success')}
                onDelete={async () => {
                  if (await confirmAsync('기록 삭제', `'${e.recipe.name}' 기록을 지울까요?`, { confirmText: '삭제', destructive: true })) removeEntry(e.id);
                }}
              />
            ))}
          </View>
        )
      ) : favorites.length === 0 ? (
        <EmptyState
          icon="star-outline"
          title="즐겨찾기가 비어 있어요"
          message="마음에 드는 레시피 화면에서 별 아이콘을 누르면 여기에 저장돼요."
        />
      ) : (
        <View style={{ gap: space.md }}>
          {favorites.map((f) => (
            <Card key={f.id} style={{ gap: space.md }}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="heading">{f.recipe.name}</AppText>
                  <AppText variant="caption" tone="muted">
                    {fmtDate(f.savedAt)} 저장 · {fmtMl(f.recipe.totalMl)} · {f.recipe.estimatedAbv > 0 ? `${f.recipe.estimatedAbv}%` : '무알콜'}
                  </AppText>
                </View>
                <IconButton icon="star" color={colors.warning} label="즐겨찾기 해제" onPress={() => removeFavorite(f.id)} />
              </Row>
              <RecipeBar ingredients={f.recipe.ingredients} slots={slots} height={12} />
              <Button variant="outline" icon="repeat" label="다시 만들기" onPress={() => remake(f.recipe, 'gemini')} />
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

function HistoryCard({
  entry,
  fav,
  onRemake,
  onFav,
  onDelete,
}: {
  entry: HistoryEntry;
  fav: boolean;
  onRemake: () => void;
  onFav: () => void;
  onDelete: () => void;
}) {
  const slots = useSlots((s) => s.slots);
  const r = entry.recipe;
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="caption" tone="muted">
            {fmtDate(entry.createdAt)}
            {entry.moods.length ? ` · ${entry.moods.join(', ')}` : ''}
          </AppText>
          <AppText variant="heading">{r.name}</AppText>
          <Row style={{ flexWrap: 'wrap' }}>
            {entry.status === 'stopped' ? <Badge label="중단됨" tone="warning" icon="hand-left" /> : <Badge label="완성" tone="success" icon="checkmark" />}
            {entry.uncertain ? <Badge label="결과 확인 필요" tone="warning" icon="help-circle" /> : null}
            <Badge label={r.estimatedAbv > 0 ? `${r.estimatedAbv}%` : '무알콜'} tone={r.estimatedAbv > 0 ? 'danger' : 'neutral'} />
            {entry.source === 'offline' ? <Badge label="오프라인 추천" tone="neutral" icon="cloud-offline" /> : null}
            {entry.feedback ? (
              <Badge
                label={entry.feedback === 'like' ? '좋아요' : '별로예요'}
                tone={entry.feedback === 'like' ? 'primary' : 'neutral'}
                icon={entry.feedback === 'like' ? 'thumbs-up' : 'thumbs-down'}
              />
            ) : null}
          </Row>
        </View>
        <Row gap={0}>
          <IconButton icon={fav ? 'star' : 'star-outline'} color={fav ? colors.warning : colors.textMuted} label="즐겨찾기" onPress={onFav} />
          <IconButton icon="trash-outline" color={colors.textMuted} label="삭제" onPress={onDelete} />
        </Row>
      </Row>
      <RecipeBar ingredients={r.ingredients} slots={slots} height={12} />
      <Row style={{ flexWrap: 'wrap', gap: space.md }}>
        {r.ingredients.map((i) => (
          <Row key={i.pump} gap={4}>
            <Ionicons name="water" size={12} color={colors.textMuted} />
            <AppText variant="small" tone="secondary">
              {i.name} {fmtMl(i.ml)}
            </AppText>
          </Row>
        ))}
      </Row>
      <Button variant="outline" size="sm" icon="repeat" label="다시 만들기" onPress={onRemake} />
    </Card>
  );
}
