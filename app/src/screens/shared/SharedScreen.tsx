/**
 * 모두의 레시피 (v3.1) — 다른 사람이 AI 로 만들어 공유한 레시피
 *  - 인기 TOP 5: 실제로 많이 만든 순 (같으면 최근 순). 아직 아무도 만들지 않은 레시피는 순위 없이 "새로 올라온 레시피"로 따로
 *  - 레시피 찾기: 이름·설명·재료·별명으로 검색 (띄어 쓴 낱말이 모두 들어간 것), 20개씩 더 보기. 빈 칸으로 찾으면 전체
 *  - 내가 공유한 레시피: 사용 횟수 확인 · 공유 취소 (레시피 공유는 기록 탭의 [공유] 버튼에서)
 *  - 성인 확인 전이면 무알콜 레시피만 (서버에서 거름) + 성인 확인 버튼
 *  - 서버에 연결하지 못해도 앱의 다른 기능은 그대로 — 화면 안에서만 안내·다시 시도
 */
import { History as HistoryIcon, RefreshCw, Search, Share2, Trophy, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { ScreenBoundary } from '@/components';
import { go } from '@/lib/nav';
import { browseShared, PAGE_SIZE, SHARE_LIMITS, TOP_COUNT, type SharedRecipe } from '@/lib/share/api';
import { sharedToRecipe } from '@/lib/share/convert';
import { shareDeviceId } from '@/lib/share/device';
import { ensureAdult } from '@/store/adultGate';
import { isFavorite, useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { flushSharedUses, useShared } from '@/store/shared';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { Banner, Button, Card, Chip, EmptyState, Page, PageHeader, Section, Spinner, Text, TextField } from '@/ui';

import { SharedCard } from './SharedCard';
import { cancelShare, openShared, reportShared, shareErrorText, syncMine } from './sharedActions';

import './SharedScreen.css';

type Load<T> = { status: 'idle' | 'loading' | 'ok' | 'error'; data: T; error?: string };

interface SearchState {
  query: string;
  items: SharedRecipe[];
  total: number;
}

function SharedScreenContent() {
  const slots = useSlots((s) => s.slots);
  const adult = useSettings((s) => !!s.adultVerifiedAt);
  const reported = useShared((s) => s.reported);
  const favorites = useHistory((s) => s.favorites);
  const toggleFavorite = useHistory((s) => s.toggleFavorite);

  const [softOnly, setSoftOnly] = useState(false);
  const alcohol = adult && !softOnly;
  const [top, setTop] = useState<Load<SharedRecipe[]>>({ status: 'idle', data: [] });
  const [queryInput, setQueryInput] = useState('');
  const [search, setSearch] = useState<Load<SearchState | null>>({ status: 'idle', data: null });
  const [mine, setMine] = useState<Load<SharedRecipe[]>>({ status: 'idle', data: [] });
  const [opening, setOpening] = useState<string | null>(null);
  const topSeq = useRef(0);
  const searchSeq = useRef(0);
  /** 마지막으로 보낸 검색 (다시 시도·무알콜만 바꿀 때 같은 검색어로) */
  const lastQuery = useRef<string | null>(null);

  const loadTop = useCallback(async () => {
    const my = ++topSeq.current;
    setTop((t) => ({ ...t, status: 'loading' }));
    try {
      const { items } = await browseShared(shareDeviceId(), { limit: TOP_COUNT, alcohol });
      if (my === topSeq.current) setTop({ status: 'ok', data: items });
    } catch (e) {
      if (my === topSeq.current) setTop({ status: 'error', data: [], error: shareErrorText(e) });
    }
  }, [alcohol]);

  const runSearch = useCallback(
    async (query: string, more = false) => {
      const my = ++searchSeq.current;
      lastQuery.current = query;
      const prev = more && search.data?.query === query ? search.data : null;
      setSearch((s) => ({ ...s, status: 'loading' }));
      try {
        const r = await browseShared(shareDeviceId(), { query, limit: PAGE_SIZE, offset: prev?.items.length ?? 0, alcohol });
        if (my !== searchSeq.current) return;
        const items = prev ? [...prev.items, ...r.items.filter((x) => !prev.items.some((p) => p.id === x.id))] : r.items;
        // 더 보기가 비어 오면 더 볼 것이 없음 (전체 개수를 0 으로 덮지 않게)
        const total = prev && !r.items.length ? items.length : Math.max(items.length, r.total);
        setSearch({ status: 'ok', data: { query, items, total } });
      } catch (e) {
        if (my === searchSeq.current) setSearch((s) => ({ status: 'error', data: s.data, error: shareErrorText(e) }));
      }
    },
    [alcohol, search.data],
  );

  const loadMine = useCallback(async () => {
    setMine((m) => ({ ...m, status: 'loading' }));
    try {
      setMine({ status: 'ok', data: await syncMine() });
    } catch (e) {
      setMine({ status: 'error', data: [], error: shareErrorText(e) });
    }
  }, []);

  // 처음 열 때·성인 확인·무알콜만 바꿀 때 인기 목록을 다시, 검색 중이었으면 검색도 다시
  useEffect(() => {
    loadTop();
    flushSharedUses().catch(() => undefined);
  }, [loadTop]);
  useEffect(() => {
    // 검색 중이거나 결과가 있으면 같은 검색어로 다시 (가던 요청은 searchSeq 로 버려짐)
    if (lastQuery.current !== null) runSearch(lastQuery.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alcohol]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(queryInput.trim().slice(0, SHARE_LIMITS.query));
  };

  const visible = (list: SharedRecipe[]) => list.filter((x) => !reported.includes(x.id));

  const use = async (s: SharedRecipe) => {
    setOpening(s.id);
    try {
      await openShared(s);
    } finally {
      setOpening(null);
    }
  };
  const fav = (s: SharedRecipe) =>
    toast(toggleFavorite(sharedToRecipe(s), { sharedId: s.id, source: s.source }) ? '즐겨찾기에 추가했어요.' : '즐겨찾기에서 뺐어요.', 'success');
  /** 목록들에서 빼기 (신고·공유 취소 뒤 — 검색 개수·더 보기 위치가 서버와 맞게) */
  const drop = (id: string) => {
    setMine((m) => ({ ...m, data: m.data.filter((x) => x.id !== id) }));
    setTop((t) => ({ ...t, data: t.data.filter((x) => x.id !== id) }));
    setSearch((st) =>
      st.data && st.data.items.some((x) => x.id === id)
        ? { ...st, data: { ...st.data, items: st.data.items.filter((x) => x.id !== id), total: Math.max(0, st.data.total - 1) } }
        : st,
    );
  };
  const report = async (s: SharedRecipe) => {
    if (await reportShared(s)) {
      drop(s.id);
      toast('신고했어요. 이 기기에서는 더 보이지 않아요.', 'success');
    }
  };
  const remove = async (s: SharedRecipe) => {
    if (await cancelShare(s.id, s.name)) {
      drop(s.id);
      toast('공유를 취소했어요.', 'success');
    }
  };

  const card = (s: SharedRecipe, rank?: number) => (
    <li key={s.id}>
      <SharedCard
        recipe={s}
        slots={slots}
        rank={rank}
        fav={isFavorite(favorites, sharedToRecipe(s), s.id)}
        busy={opening === s.id}
        onUse={() => use(s)}
        onFav={() => fav(s)}
        onReport={s.mine ? undefined : () => report(s)}
        onDelete={s.mine ? () => remove(s) : undefined}
      />
    </li>
  );

  const topItems = visible(top.data);
  // 실제로 만든 레시피만 순위, 아직 아무도 만들지 않은 것은 "새로 올라온 레시피" (막 올린 글이 인기 순위처럼 보이지 않게)
  const ranked = topItems.filter((s) => s.useCount > 0);
  const fresh = topItems.filter((s) => s.useCount === 0);
  const found = search.data ? visible(search.data.items) : [];

  return (
    <Page width="wide" header={<PageHeader title="모두의 레시피" subtitle="다른 사람이 AI 로 만든 레시피를 써 보고, 내 레시피도 공유해 보세요." />}>
      {!adult ? (
        <Banner
          tone="info"
          title="지금은 무알콜 레시피만 보여요"
          message="만 19세 이상이면 성인 확인 뒤 술이 들어간 레시피도 볼 수 있어요."
          action={{ label: '성인 확인', onClick: () => void ensureAdult() }}
        />
      ) : null}

      <Section
        title={`인기 레시피 TOP ${TOP_COUNT}`}
        icon={Trophy}
        description="실제로 많이 만든 순이에요"
        action={<Button size="sm" variant="ghost" icon={RefreshCw} label="새로고침" loading={top.status === 'loading'} onClick={loadTop} />}>
        {top.status === 'error' ? (
          <Banner tone="error" title="불러오지 못했어요" message={top.error} action={{ label: '다시 시도', icon: RefreshCw, onClick: loadTop }} />
        ) : top.status !== 'ok' && !topItems.length ? (
          <Card className="shared-loading">
            <Spinner label="인기 레시피를 불러오는 중" />
          </Card>
        ) : topItems.length === 0 ? (
          <Card>
            <EmptyState
              icon={Users}
              title="아직 공유된 레시피가 없어요"
              message="기록 탭에서 만든 잔의 [공유] 버튼을 누르면 첫 레시피가 돼요."
              action={<Button label="기록 탭으로" icon={HistoryIcon} variant="secondary" onClick={() => go('/history')} />}
            />
          </Card>
        ) : (
          <>
            {ranked.length ? (
              <ul className="shared-grid" aria-label={`인기 레시피 TOP ${TOP_COUNT}`}>
                {ranked.map((s, i) => card(s, i + 1))}
              </ul>
            ) : (
              <Text variant="small" tone="secondary">
                아직 공유 레시피로 실제로 만든 사람이 없어요. 먼저 만들어 보면 그 레시피가 1위가 돼요.
              </Text>
            )}
            {fresh.length ? (
              <>
                <Text variant="label" as="h3" className="shared-subhead">
                  새로 올라온 레시피
                </Text>
                <ul className="shared-grid" aria-label="새로 올라온 레시피">
                  {fresh.map((s) => card(s))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </Section>

      <Section title="레시피 찾기" icon={Search} description="이름·재료·별명으로 다른 공유 레시피를 찾아요">
        <Card className="shared-search">
          <form className="shared-search__form" role="search" onSubmit={onSubmit}>
            <TextField
              label="검색어"
              value={queryInput}
              onChange={setQueryInput}
              icon={Search}
              maxLength={SHARE_LIMITS.query}
              placeholder="예) 오렌지, 하이볼, 상큼"
              enterKeyHint="search"
              autoComplete="off"
              wrapperClassName="shared-search__field"
            />
            <Button type="submit" icon={Search} label="찾기" loading={search.status === 'loading'} />
          </form>
          {adult ? <Chip size="sm" label="무알콜만" selected={softOnly} onClick={() => setSoftOnly((v) => !v)} /> : null}
          <Text variant="small" tone="secondary">
            빈 칸으로 찾으면 공유된 레시피를 많이 만든 순으로 모두 보여 줘요.
          </Text>
        </Card>
        {search.status === 'error' ? (
          <Banner
            tone="error"
            title="찾지 못했어요"
            message={search.error}
            action={{ label: '다시 시도', icon: RefreshCw, onClick: () => runSearch(lastQuery.current ?? queryInput.trim()) }}
          />
        ) : null}
        {search.data ? (
          <>
            <Text variant="label" className="shared-result-count" role="status">
              {search.data.query ? `'${search.data.query}' 검색 결과 ${search.data.total}개` : `공유된 레시피 ${search.data.total}개`}
            </Text>
            {found.length ? (
              <ul className="shared-grid" aria-label="검색 결과">
                {found.map((s) => card(s))}
              </ul>
            ) : search.status === 'ok' ? (
              <Card>
                <EmptyState icon={Search} title="맞는 레시피가 없어요" message="다른 낱말로 찾거나 띄어쓰기를 줄여 보세요." />
              </Card>
            ) : null}
            {search.data.items.length < search.data.total ? (
              <Button variant="secondary" label="더 보기" full loading={search.status === 'loading'} onClick={() => runSearch(search.data!.query, true)} />
            ) : null}
          </>
        ) : null}
      </Section>

      <Section title="내가 공유한 레시피" icon={Share2} description="기록 탭에서 만든 잔의 [공유] 버튼으로 올릴 수 있어요">
        {mine.status === 'idle' ? (
          <Button variant="secondary" icon={Users} label="내 공유 레시피 보기" onClick={loadMine} />
        ) : mine.status === 'loading' ? (
          <Card className="shared-loading">
            <Spinner label="내 공유 레시피를 불러오는 중" />
          </Card>
        ) : mine.status === 'error' ? (
          <Banner tone="error" title="불러오지 못했어요" message={mine.error} action={{ label: '다시 시도', icon: RefreshCw, onClick: loadMine }} />
        ) : mine.data.length === 0 ? (
          <Card>
            <EmptyState
              icon={Share2}
              title="아직 공유한 레시피가 없어요"
              message="기록 탭에서 마음에 든 잔의 [공유] 버튼을 눌러 보세요."
              action={<Button label="기록 탭으로" icon={HistoryIcon} variant="secondary" onClick={() => go('/history')} />}
            />
          </Card>
        ) : (
          <ul className="shared-grid" aria-label="내가 공유한 레시피">
            {mine.data.map((s) => card(s))}
          </ul>
        )}
      </Section>
    </Page>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 */
export function SharedScreen() {
  return (
    <ScreenBoundary name="shared">
      <SharedScreenContent />
    </ScreenBoundary>
  );
}
