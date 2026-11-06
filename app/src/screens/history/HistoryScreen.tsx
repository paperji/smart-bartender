/**
 * ③ 기록 — 제조 기록(날짜·레시피·피드백) / 즐겨찾기 → 다시 만들기  (v2.1 src/app/(tabs)/history.tsx)
 *  - 요약 줄: "지금까지 N잔을 만들었어요 · 좋아요 N개."
 *  - [제조 기록 N | 즐겨찾기 N] 전환 (주소 ?tab=favorites 로도 열림 — 새로 고침해도 그대로)
 *  - 기록 카드: 즐겨찾기 토글(토스트) · 삭제(확인창) · 다시 만들기 / 즐겨찾기 카드: 해제 · 다시 만들기
 *  - 배치: 모바일 1열, PC(≥900px) 카드 2열
 */
import { Clock, Sparkles, Star } from 'lucide-react';
import { useSearchParams } from 'react-router';

import { ScreenBoundary } from '@/components';
import { go } from '@/lib/nav';
import { isFavorite, useHistory } from '@/store/history';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { Button, Card, confirm, EmptyState, Page, PageHeader, Segmented } from '@/ui';

import { FavoriteCard, HistoryCard } from './HistoryCards';
import { favoriteOrigin, remakeSaved } from './remake';

import './HistoryScreen.css';

type TabKey = 'history' | 'favorites';

/** 요약 줄 (v2.1 문구 그대로) */
export function historySummary(count: number, likes: number): string {
  return `지금까지 ${count}잔을 만들었어요${likes ? ` · 좋아요 ${likes}개` : ''}.`;
}

function HistoryScreenContent() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get('tab') === 'favorites' ? 'favorites' : 'history';
  const setTab = (t: TabKey) => setParams(t === 'favorites' ? { tab: 'favorites' } : {}, { replace: true });

  const entries = useHistory((s) => s.entries);
  const favorites = useHistory((s) => s.favorites);
  const toggleFavorite = useHistory((s) => s.toggleFavorite);
  const removeEntry = useHistory((s) => s.remove);
  const removeFavorite = useHistory((s) => s.removeFavorite);
  const slots = useSlots((s) => s.slots);

  const likes = entries.filter((e) => e.feedback === 'like').length;

  return (
    <Page width="wide" header={<PageHeader title="기록" subtitle={historySummary(entries.length, likes)} />}>
      <Segmented<TabKey>
        ariaLabel="기록 종류"
        className="history-tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'history', label: `제조 기록 ${entries.length}` },
          { value: 'favorites', label: `즐겨찾기 ${favorites.length}` },
        ]}
      />

      {tab === 'history' ? (
        entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={Clock}
              title="아직 만든 음료가 없어요"
              message="바텐더 탭에서 AI 레시피를 만들고 기기로 제조하면 여기에 기록돼요."
              action={<Button label="첫 잔 만들러 가기" icon={Sparkles} onClick={() => go('/')} />}
            />
          </Card>
        ) : (
          <ul className="history-grid" aria-label="제조 기록">
            {entries.map((e) => (
              <li key={e.id}>
                <HistoryCard
                  entry={e}
                  slots={slots}
                  fav={isFavorite(favorites, e.recipe)}
                  onRemake={() => remakeSaved(e.recipe, e.source, e.strength)}
                  onFav={() => toast(toggleFavorite(e.recipe) ? '즐겨찾기에 추가했어요.' : '즐겨찾기에서 뺐어요.', 'success')}
                  onDelete={async () => {
                    if (await confirm('기록 삭제', `'${e.recipe.name}' 기록을 지울까요?`, { confirmText: '삭제', destructive: true })) {
                      removeEntry(e.id);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        )
      ) : favorites.length === 0 ? (
        <Card>
          <EmptyState icon={Star} title="즐겨찾기가 비어 있어요" message="마음에 드는 레시피 화면에서 별 아이콘을 누르면 여기에 저장돼요." />
        </Card>
      ) : (
        <ul className="history-grid" aria-label="즐겨찾기">
          {favorites.map((f) => (
            <li key={f.id}>
              <FavoriteCard
                fav={f}
                slots={slots}
                onRemake={() => {
                  const { source, strength } = favoriteOrigin(f.recipe, useHistory.getState().entries);
                  remakeSaved(f.recipe, source, strength);
                }}
                onRemove={() => {
                  removeFavorite(f.id);
                  toast('즐겨찾기에서 뺐어요.', 'success');
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function HistoryScreen() {
  return (
    <ScreenBoundary name="history">
      <HistoryScreenContent />
    </ScreenBoundary>
  );
}
