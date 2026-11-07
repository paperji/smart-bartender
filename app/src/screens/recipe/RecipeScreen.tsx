/**
 * 추천 레시피 화면 (v2.1 src/app/recipe.tsx 를 밝은 톤·반응형으로) — 비율 막대, 재료별 ml 조정, 도수/맛 프로필,
 * 추천 이유, 가니시·팁, 제안 카드, 새 재료 탐색 카드
 * - "다른 추천" = 거절: history 에 rejected 로 남겨 다음 추천에서 같은 조합을 피함 (SPEC §5.3)
 * - 연속 2회 거절 시 "새 재료를 장착해 볼까요?" → 탐색(explore) 모드
 * - normal 모드 응답의 explore(0~1개)는 "새 재료로 이런 것도" 카드로 표시
 * - ml 조정·잔 맞춤 때 다시 검증하면서 빠진 재료(성향 제외·무알콜·잔량 0 등)는 안내 배너에 더하고 토스트로도 알림
 * - 오프라인 추천으로 바뀐 이유(키 없음·키 오류·사용량 한도 등)는 위쪽 안내 + [설정] 버튼
 * 배치: 모바일(<900px) 한 열 + 아래 버튼 줄 / PC(≥900px) 왼쪽 = 레시피·재료·제조 버튼, 오른쪽 = 이유·맛·가니시·제안·탐색
 */
import { ChartPie, Compass, Flower2, Leaf, Lightbulb, MessageCircleMore, Play, RefreshCw, Scaling, Sparkles, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ExploreCard, FlavorBars, RecipeBar, ScreenBoundary } from '@/components';
import type { PumpPick } from '@/lib/ai/explore';
import { startBrew } from '@/lib/brew';
import { ingredientEditPath, openInstall, recommendAndShow } from '@/lib/flow';
import { fmtDuration, fmtMl } from '@/lib/format';
import { go, withQuery } from '@/lib/nav';
import { deviceLimits, estimateMakeMs } from '@/lib/protocol';
import type { ExploreItem, Suggestion } from '@/lib/types';
import { haptic } from '@/platform/haptics';
import { isBusy, useDevice } from '@/store/device';
import { useSession } from '@/store/draft';
import { isFavorite, useHistory } from '@/store/history';
import { useSettings } from '@/store/settings';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import { Button, Card, Columns, EmptyState, IconButton, Page, PageHeader, Section, Stack, Text } from '@/ui';

import {
  ExploreNudge,
  FallbackBanner,
  IngredientRows,
  InfoLine,
  RecipeBadges,
  StarFilled,
  StatTile,
  SuggestionCard,
  WarningsBanner,
} from './RecipeParts';
import {
  adjustIngredient,
  fallbackNotice,
  fitRecipeToCup,
  isTotalOff,
  recheckContext,
  regenerateToast,
  regenerateVariation,
  type AdjustResult,
} from './recipeLogic';
import './RecipeScreen.css';

const GLASS_TIP = '잔을 노즐 아래에 놓고 얼음을 먼저 채운 뒤 제조를 시작하세요.';

function RecipeScreenContent() {
  const current = useSession((s) => s.current);
  const setCurrent = useSession((s) => s.setCurrent);
  const rejectStreak = useSession((s) => s.rejectStreak);
  const slots = useSlots((s) => s.slots);
  const cal = useDevice((s) => s.cal);
  const info = useDevice((s) => s.info);
  const job = useDevice((s) => s.job);
  const mode = useSettings((s) => s.dispenseMode);
  const adultVerified = useSettings((s) => !!s.adultVerifiedAt);
  const favorites = useHistory((s) => s.favorites);
  const toggleFavorite = useHistory((s) => s.toggleFavorite);
  const [regen, setRegen] = useState(false);
  const [starting, setStarting] = useState(false);
  /**
   * 진행 중인 동작 (화면 상태보다 먼저 바로 잠김 — 빠르게 연달아 눌러도 하나만).
   * 제조를 시작하는 동안(알림 권한 묻기·기기 응답 기다림)에는 "다른 추천"·탐색·장착을 막음:
   * 붓고 있는 레시피가 거절 기록에 남거나 뒤에서 다른 레시피로 바뀌지 않게
   */
  const action = useRef<'regen' | 'start' | null>(null);

  const r = current?.recipe;
  const etaMs = useMemo(
    () => (r ? estimateMakeMs(r.ingredients.map((i) => ({ p: i.pump, ml: i.ml })), cal, mode) : 0),
    [r, cal, mode],
  );

  // "다른 추천"·탐색 카드 등으로 새 레시피가 오면(같은 화면) 맨 위로 — 새 이름·안내부터 보이게
  const createdAt = current?.createdAt;
  const seenAt = useRef(createdAt);
  useEffect(() => {
    if (seenAt.current !== undefined && createdAt !== undefined && seenAt.current !== createdAt && typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
    seenAt.current = createdAt;
  }, [createdAt]);

  if (!current || !r) {
    return (
      <Page header={<PageHeader title="추천 레시피" back />}>
        <EmptyState
          icon={Sparkles}
          title="아직 레시피가 없어요"
          message="바텐더 탭에서 기분과 취향을 입력하고 AI 레시피를 만들어 보세요."
          action={<Button label="바텐더로 가기" onClick={() => go('/')} />}
        />
      </Page>
    );
  }

  const limits = deviceLimits(info);
  // 성향(알레르기·싫어하는 재료)으로 뺀 재료는 ml 조정·잔 맞춤 때 도수 보정용 재료로도 다시 넣지 않음 (SPEC §3.3 규칙 1·8)
  // adultVerified: 다시 검증할 때도 성인 확인 전이면 술 장착·대체 제안을 지움 (SPEC §3.2, 요청과 같은 설정 값)
  const ctx = recheckContext(slots, current.input, limits, adultVerified);
  const fav = isFavorite(favorites, r, current.sharedId);
  const cupMl = current.input.cupMl;
  const notice = fallbackNotice(current);
  const busy = isBusy(job);

  /** 조정 결과 반영 + 토스트 (빠진 재료 안내는 배너에도 더함 — 안내 없이 사라지지 않게) */
  const apply = (res: AdjustResult) => {
    if (res.ok) setCurrent({ ...current, recipe: res.recipe, warnings: res.warnings });
    for (const t of res.toasts) toast(t.message, t.kind);
  };

  const adjust = (pump: number, delta: number) =>
    apply(adjustIngredient(r, current.warnings, pump, delta, ctx, limits, current.input.strength));

  const fitToCup = () => apply(fitRecipeToCup(r, current.warnings, cupMl, ctx));

  const onToggleFavorite = () => {
    const added = toggleFavorite(r, { sharedId: current.sharedId, provider: current.provider, source: current.source });
    toast(added ? '즐겨찾기에 추가했어요.' : '즐겨찾기에서 뺐어요.', 'success');
  };

  /** "다른 추천" = 거절 → 기록에 남기고 같은 입력으로 다시 추천 */
  const regenerate = async () => {
    if (action.current) return;
    action.current = 'regen';
    setRegen(true);
    const variation = current.variation + 1;
    useHistory.getState().addRejection(r);
    const streak = useSession.getState().rejectStreak + 1;
    useSession.getState().setRejectStreak(streak);
    try {
      const res = await recommendAndShow(
        { input: current.input, mode: 'normal', variation: regenerateVariation(variation) },
        { variation, nav: 'none' },
      );
      if (res) {
        haptic.success();
        toast(regenerateToast(streak), 'info');
      }
    } finally {
      action.current = null;
      setRegen(false);
    }
  };

  /** 연속 거절 → 탐색(explore) 모드 */
  const explore = async () => {
    if (action.current) return;
    action.current = 'regen';
    setRegen(true);
    try {
      const res = await recommendAndShow({ input: current.input, mode: 'explore' }, { round: 0 });
      if (res) useSession.getState().setRejectStreak(0);
    } finally {
      action.current = null;
      setRegen(false);
    }
  };

  const onStart = async () => {
    if (action.current) return;
    action.current = 'start';
    setStarting(true);
    try {
      await startBrew();
    } finally {
      action.current = null;
      setStarting(false);
    }
  };

  /** 탐색 카드 "펌프 N에 장착하기" — 장착 후 이 레시피의 입력값으로 다시 추천 (예전 탐색 입력이 아니라) */
  const install = (item: ExploreItem, pick: PumpPick) => {
    if (action.current) return;
    openInstall(item, pick, { input: current.input });
  };

  /** 제조 시작·다른 추천·탐색이 진행 중 */
  const locked = regen || starting;

  const openSuggestion = (s: Suggestion) => {
    if (s.type === 'low_stock' && s.pump) {
      go(`/ingredients/${s.pump}`);
      return;
    }
    const empty = slots.find((x) => !x.name);
    if (empty) go(ingredientEditPath(empty.pump, { suggest: s.ingredient ?? '' }));
    else go(withQuery('/ingredients', { suggest: s.ingredient ?? '' }));
  };

  const regenButton = (
    <Button
      variant="secondary"
      icon={RefreshCw}
      label="다른 추천"
      onClick={regenerate}
      loading={regen}
      disabled={starting}
      title="이 레시피는 거절하고 다른 레시피를 추천받아요"
      aria-describedby="recipe-regen-hint"
      className="recipe-actions__regen"
    />
  );
  const startButton = (
    <Button
      icon={Play}
      label={busy ? '기기 작동 중' : '기기로 제조 시작'}
      onClick={onStart}
      loading={starting}
      disabled={busy || regen}
      className="recipe-actions__start"
    />
  );

  const header = (
    <PageHeader
      title="추천 레시피"
      back
      actions={
        <IconButton
          icon={fav ? StarFilled : Star}
          label={fav ? '즐겨찾기 해제' : '즐겨찾기'}
          aria-pressed={fav}
          className={fav ? 'recipe-fav is-on' : 'recipe-fav'}
          onClick={onToggleFavorite}
        />
      }
    />
  );

  return (
    <Page
      width="wide"
      className="recipe-page"
      header={header}
      footer={
        // 모바일: 화면 아래 버튼 줄 (PC 에서는 CSS 로 숨기고 왼쪽 열의 제조 카드를 씀 — 화면 폭이 바뀌어도 다시 그리지 않게 CSS 로만 전환)
        <div className="recipe-footer">
          {regenButton}
          {startButton}
        </div>
      }>
      <span id="recipe-regen-hint" hidden>
        이 레시피는 거절하고 다른 레시피를 추천받아요
      </span>

      {/* 제목 */}
      <Stack gap={8} className="recipe-title">
        <RecipeBadges
          source={current.source}
          abv={r.estimatedAbv}
          fromSaved={current.fromSaved}
          model={current.model}
          provider={current.provider}
          shared={!!current.sharedId}
        />
        <Text variant="display" as="h2" className="recipe-title__name">
          {r.name}
        </Text>
        {r.nameEn ? (
          <Text variant="caption" tone="muted" lang="en">
            {r.nameEn}
          </Text>
        ) : null}
        {r.description ? (
          <Text variant="body" tone="secondary">
            {r.description}
          </Text>
        ) : null}
      </Stack>

      {/* 안내 */}
      {notice || current.warnings.length || rejectStreak >= 2 ? (
        <Stack gap={12}>
          {notice ? <FallbackBanner notice={notice} onOpenSettings={() => go('/settings')} /> : null}
          <WarningsBanner warnings={current.warnings} />
          {rejectStreak >= 2 ? (
            <ExploreNudge busy={locked} onExplore={explore} onDismiss={() => useSession.getState().setRejectStreak(0)} />
          ) : null}
        </Stack>
      ) : null}

      <Columns template="7fr 5fr" gap={24}>
        {/* 왼쪽(PC) — 비율·수치·재료·제조 (제조 카드는 PC 에서 화면에 붙어 따라옴) */}
        <Stack gap={20} className="recipe-left">
          <Card className="recipe-summary">
            <Stack gap={16}>
              <RecipeBar ingredients={r.ingredients} slots={slots} height={22} legend={false} />
              <div className="recipe-stats">
                <StatTile label="총량" value={fmtMl(r.totalMl)} />
                <StatTile label="예상 도수" value={`${r.estimatedAbv}%`} />
                <StatTile label="예상 시간" value={fmtDuration(etaMs)} />
              </div>
            </Stack>
          </Card>

          <Section
            title="재료"
            description="± 버튼으로 양을 조절할 수 있어요 (5ml 단위)"
            action={
              isTotalOff(r, cupMl) ? (
                <Button size="sm" variant="secondary" icon={Scaling} label={`${cupMl}ml 맞추기`} onClick={fitToCup} />
              ) : null
            }>
            <IngredientRows recipe={r} slots={slots} onAdjust={adjust} />
          </Section>

          {/* PC 전용 안내 + 제조 카드 (모바일은 CSS 로 숨김 — 맨 아래 안내·아래 버튼 줄 사용) */}
          <Text variant="caption" tone="muted" align="center" className="recipe-tip--pc">
            {GLASS_TIP}
          </Text>
          <Card className="recipe-actions" role="group" aria-label="제조">
            <div className="recipe-actions__row">
              {regenButton}
              {startButton}
            </div>
          </Card>
        </Stack>

        {/* 오른쪽(PC) — 이유·맛·가니시·제안·탐색 */}
        <Stack gap={20}>
          {r.reason ? (
            <Section title="추천 이유" icon={MessageCircleMore}>
              <Card tone="accent">
                <Text variant="body">{r.reason}</Text>
              </Card>
            </Section>
          ) : null}

          <Section title="맛 프로필" icon={ChartPie}>
            <Card>
              <FlavorBars flavor={r.flavor} />
            </Card>
          </Section>

          {r.garnish || r.tips ? (
            <Section title="가니시 & 팁" icon={Leaf}>
              <Card>
                <Stack gap={12}>
                  {r.garnish ? (
                    <InfoLine icon={Flower2} title="가니시">
                      {r.garnish}
                    </InfoLine>
                  ) : null}
                  {r.tips ? (
                    <InfoLine icon={Lightbulb} title="팁">
                      {r.tips}
                    </InfoLine>
                  ) : null}
                </Stack>
              </Card>
            </Section>
          ) : null}

          {r.suggestions.length ? (
            <Section title="바텐더의 제안" icon={Lightbulb}>
              <Stack gap={8}>
                {r.suggestions.map((s, idx) => (
                  <SuggestionCard key={idx} s={s} onOpen={openSuggestion} />
                ))}
              </Stack>
            </Section>
          ) : null}

          {/* 새 재료 탐색 (normal 모드 응답의 explore 0~1개) */}
          {current.explore?.length ? (
            <Section title="새 재료로 이런 것도 만들 수 있어요" description="재료 1개만 바꿔 끼우면 돼요" icon={Compass}>
              <Stack gap={12}>
                {current.explore.map((x) => (
                  <ExploreCard key={x.addIngredient} item={x} onInstall={install} disabled={locked} compact />
                ))}
              </Stack>
            </Section>
          ) : null}
        </Stack>
      </Columns>

      <Text variant="caption" tone="muted" align="center" className="recipe-tip--mobile">
        {GLASS_TIP}
      </Text>
    </Page>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function RecipeScreen() {
  return (
    <ScreenBoundary name="recipe">
      <RecipeScreenContent />
    </ScreenBoundary>
  );
}
