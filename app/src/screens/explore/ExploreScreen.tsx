/**
 * 새 재료 탐색 화면 (explore 모드 결과, SPEC §5.4) — v2.1 src/app/explore.tsx 를 밝은 톤으로 옮김
 * - 탐색 카드 1~3개: 레시피 이름·설명·재료(미장착 재료 강조)·메시지 + "펌프 N에 장착하기" (공용 ExploreCard)
 *   → 재료 편집 화면(#/ingredients/:pump?suggest=…&from=explore) — lib/flow openInstall
 * - 함께 온 "지금 재료로 만들 수 있는 레시피"(있으면) 바로가기
 * - 다시 탐색 (다른 새 재료 — exploreRound + 1), 바텐더로
 * - 오프라인 추천 안내·정규화 안내(NO_MIXER 등) 배너, 결과가 없을 때 빈 화면
 * 배치: 모바일 1열 + 아래 고정 버튼 줄, PC(≥900px) 카드 2개 이상이면 2열
 */
import { ChevronRight, CloudOff, Compass, Home, Info, RefreshCw, Settings as SettingsIcon, Wine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ExploreCard, ScreenBoundary } from '@/components';
import { openInstall, recommendAndShow } from '@/lib/flow';
import { fmtMl } from '@/lib/format';
import { dismissTo, go } from '@/lib/nav';
import { useAiBusy } from '@/store/aiBusy';
import { useDraft, useSession, type ExploreSession } from '@/store/draft';
import { installedSlots, useSlots } from '@/store/slots';
import { Badge, Banner, Button, Card, Columns, EmptyState, Page, PageHeader, Row, Spinner, Stack, Text } from '@/ui';

import { fallbackNotice, nextExploreRound, noticeLines, sourceBadge } from './exploreNotices';
import './ExploreScreen.css';

const TITLE = '새 재료 탐색';

/**
 * 탐색 결과와 함께 온 레시피를 현재 레시피로 (이미 같으면 그대로) — v2.1 showRecipe.
 * v2.1 router.dismissTo('/recipe'): 레시피 화면에서 탐색으로 왔으면 그 레시피 화면으로 돌아가고(기록이 겹치지 않게), 아니면 탐색 자리를 레시피로
 */
function openNowRecipe(ex: ExploreSession) {
  if (!ex.recipe) return;
  const s = useSession.getState();
  if (!s.current || s.current.recipe !== ex.recipe) {
    s.setCurrent({
      recipe: ex.recipe,
      explore: [],
      mode: 'normal',
      source: ex.source,
      model: ex.model,
      warnings: [],
      fallbackReason: ex.fallbackReason,
      fallbackCode: ex.fallbackCode,
      ...(ex.provider ? { provider: ex.provider } : {}),
      createdAt: Date.now(),
      input: ex.input,
      variation: 0,
    });
  }
  dismissTo('/recipe');
}

function ExploreScreenContent() {
  const ex = useSession((s) => s.explore);
  const slots = useSlots((s) => s.slots);
  const aiBusy = useAiBusy((s) => s.busy);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState('');

  // "다시 탐색"으로 결과가 바뀌면 맨 위(설명·첫 카드)부터 보이게
  const shownAt = useRef(ex?.createdAt);
  useEffect(() => {
    if (!ex) return;
    if (shownAt.current !== undefined && shownAt.current !== ex.createdAt && typeof window !== 'undefined') {
      window.scrollTo({ top: 0 });
    }
    shownAt.current = ex.createdAt;
  }, [ex]);

  const header = <PageHeader title={TITLE} back />;

  /** 결과가 없을 때(새로고침·주소로 바로 열기) 바텐더 입력값으로 바로 탐색 */
  const exploreNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await recommendAndShow({ input: useDraft.getState().input, mode: 'explore' }, { round: 0, nav: 'none' });
    } finally {
      setBusy(false);
    }
  };

  if (!ex) {
    return (
      <Page header={header} width="narrow">
        {aiBusy || busy ? (
          <Card className="explore-loading" aria-busy="true">
            <Row gap={12}>
              <Spinner size={24} label="새 재료를 찾는 중" color="var(--accent)" />
              <Text tone="secondary">AI 바텐더가 새 재료를 찾고 있어요</Text>
            </Row>
          </Card>
        ) : (
          <EmptyState
            icon={Compass}
            title="탐색 결과가 없어요"
            message="바텐더 탭에서 '새 재료 탐색'을 눌러 보세요."
            action={
              <Stack gap={8} align="center">
                <Button label="바텐더로 가기" icon={Home} onClick={() => go('/')} />
                <Button variant="ghost" label="여기서 바로 탐색하기" icon={Compass} onClick={exploreNow} />
              </Stack>
            }
          />
        )}
      </Page>
    );
  }

  const badge = sourceBadge(ex.source, ex.provider);
  const installedCount = installedSlots(slots).length;
  const fallback = fallbackNotice(ex);
  const lines = noticeLines(ex.warnings);
  const multi = ex.items.length >= 2;

  const again = async () => {
    if (busy) return;
    setBusy(true);
    setAnnounce('');
    try {
      const next = nextExploreRound(ex.round);
      const res = await recommendAndShow(
        { input: ex.input, mode: 'explore', exploreRound: next.round, variation: next.variation },
        { round: next.round, nav: 'none' },
      );
      if (res) setAnnounce(`새 재료를 다시 골랐어요. 카드 ${res.explore.length}개예요.`);
    } finally {
      setBusy(false);
    }
  };

  // 장착 후 다시 추천할 때 이 탐색의 입력값을 쓰도록 함께 넘김
  const cards = ex.items.map((item) => (
    <ExploreCard key={item.addIngredient} item={item} onInstall={(it, pick) => openInstall(it, pick, { input: ex.input })} disabled={busy} />
  ));

  return (
    <Page
      header={header}
      width={multi ? 'wide' : 'normal'}
      footer={
        <>
          <Button variant="secondary" icon={RefreshCw} label="다시 탐색" onClick={again} loading={busy} />
          <Button variant="ghost" icon={Home} label="바텐더로" onClick={() => go('/')} />
        </>
      }>
      <section className="explore-intro" aria-labelledby="explore-title">
        <Row wrap>
          <Badge label={badge.label} tone={badge.tone} icon={badge.icon} />
          <Badge label="탐색 모드" tone="accent" icon={Compass} />
        </Row>
        <Text variant="display" as="h2" id="explore-title">
          새 재료로 색다르게
        </Text>
        <Text tone="secondary" className="explore-intro__lead">
          재료 1개만 새로 장착하면 만들 수 있는 레시피예요. 마음에 드는 카드에서 "펌프에 장착하기"를 누르면 재료 설정 화면이 열리고, 저장하면 바로
          그 레시피를 다시 추천해 드려요.
        </Text>
      </section>

      {fallback?.kind === 'nokey' ? (
        <Card flat className="explore-note explore-note--nokey">
          <Row gap={10} wrap>
            <CloudOff size={18} aria-hidden="true" className="explore-note__icon" />
            <Text variant="caption" tone="secondary" className="explore-note__text">
              {fallback.message}
            </Text>
            <Button variant="ghost" size="sm" icon={SettingsIcon} label="AI 키 등록" className="explore-note__action" onClick={() => go('/settings')} />
          </Row>
        </Card>
      ) : fallback ? (
        <Banner
          tone={fallback.tone}
          title={fallback.title}
          message={fallback.message}
          action={fallback.settings ? { label: '설정에서 확인', icon: SettingsIcon, onClick: () => go('/settings') } : undefined}
        />
      ) : null}

      {lines.length ? (
        <Banner tone="info">
          <div className="explore-notes">
            {lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </Banner>
      ) : null}

      {ex.items.length === 0 ? (
        <Banner tone="info" title="지금은 추천할 새 재료가 없어요" message="맛 취향이나 도수를 바꿔 다시 탐색해 보세요." />
      ) : (
        <section className="explore-cards" aria-label={`새 재료 추천 ${ex.items.length}개`} aria-busy={busy || undefined}>
          {multi ? <Columns gap={16}>{cards}</Columns> : <Stack gap={16}>{cards}</Stack>}
        </section>
      )}

      {ex.recipe ? (
        <Card className="explore-now" onPress={() => openNowRecipe(ex)} pressLabel="지금 재료로 만들 수 있는 레시피 보기">
          <Row gap={12}>
            <span className="explore-now__icon" aria-hidden="true">
              <Wine size={22} />
            </span>
            <div className="explore-now__text">
              <Text variant="label" tone="secondary" as="p">
                새 재료 없이 지금 재료로는
              </Text>
              <Text variant="heading" as="p" className="explore-now__name">
                {ex.recipe.name}
              </Text>
              <Text variant="caption" tone="muted" numeric>
                {fmtMl(ex.recipe.totalMl)} · {ex.recipe.estimatedAbv > 0 ? `도수 ${ex.recipe.estimatedAbv}%` : '무알콜'} · 눌러서 보기
              </Text>
            </div>
            <ChevronRight size={20} aria-hidden="true" className="explore-now__chev" />
          </Row>
        </Card>
      ) : installedCount === 0 && !ex.warnings.length ? (
        <Card flat className="explore-note">
          <Row gap={10} align="flex-start">
            <Info size={18} aria-hidden="true" className="explore-note__icon" />
            <Text variant="caption" tone="secondary">
              지금은 장착된 재료가 없어서 새 재료만으로 만드는 레시피를 골랐어요. 카드의 재료를 펌프에 넣어 보세요.
            </Text>
          </Row>
        </Card>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </Page>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function ExploreScreen() {
  return (
    <ScreenBoundary name="explore">
      <ExploreScreenContent />
    </ScreenBoundary>
  );
}
