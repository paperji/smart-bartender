/**
 * 추천 레시피 화면 조각 — 출처 배지, 오프라인 안내, 수치 칸, 재료 줄(± 조정), 제안 카드, 정보 줄
 * (v2.1 src/app/recipe.tsx 의 Stat·InfoLine·AdjustBtn·제안 카드를 밝은 톤 UI 키트로)
 */
import {
  ArrowLeftRight,
  Bookmark,
  CircleAlert,
  CirclePlus,
  CloudOff,
  Compass,
  Droplets,
  Info,
  KeyRound,
  Leaf,
  Minus,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Users,
  Wine,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

import { colorFor } from '@/components';
import { providerLabel, type AiProviderId } from '@/lib/ai/providers';
import { fmtMl } from '@/lib/format';
import type { PumpSlot, Recipe, RecipeSource, Suggestion } from '@/lib/types';
import { Badge, Banner, Button, Card, IconButton, Row, Stack, Text, type Tone } from '@/ui';

import { ADJUST_STEP_ML, sharePctOf, totalMlOf, type FallbackNotice } from './recipeLogic';

// ───────────────────────── 배지 ─────────────────────────

/** 출처 배지 (v3.0: 서버 모드 제거 — 사용자 키로 부른 AI / 앱 내장 오프라인 추천. v3.1: AI 이름까지) */
const SOURCE_BADGE: Record<RecipeSource, { label: string; tone: Tone; icon: LucideIcon }> = {
  direct: { label: 'AI 추천', tone: 'info', icon: Sparkles },
  offline: { label: '오프라인 추천', tone: 'warning', icon: CloudOff },
};

export function RecipeBadges({
  source,
  abv,
  fromSaved,
  model,
  provider,
  shared,
}: {
  source: RecipeSource;
  abv: number;
  fromSaved?: boolean;
  model?: string;
  provider?: AiProviderId;
  /** 모두의 레시피에서 불러옴 */
  shared?: boolean;
}) {
  const b = SOURCE_BADGE[source] ?? SOURCE_BADGE.offline;
  const label = source === 'direct' && provider && !shared ? `${b.label} · ${providerLabel(provider)}` : b.label;
  return (
    <Row wrap gap={6} className="recipe-badges">
      {shared ? (
        <Badge label="모두의 레시피" tone="accent" icon={Users} />
      ) : (
        <span title={source === 'direct' && model ? `모델: ${model}` : undefined}>
          <Badge label={label} tone={b.tone} icon={b.icon} />
        </span>
      )}
      {abv > 0 ? <Badge label={`도수 ${abv}%`} tone="danger" icon={Wine} /> : <Badge label="무알콜" tone="success" icon={Leaf} />}
      {fromSaved && !shared ? <Badge label="저장된 레시피" tone="info" icon={Bookmark} /> : null}
    </Row>
  );
}

// ───────────────────────── 오프라인 추천 안내 ─────────────────────────

export function FallbackBanner({ notice, onOpenSettings }: { notice: FallbackNotice; onOpenSettings: () => void }) {
  return (
    <Banner
      tone={notice.tone}
      icon={notice.kind === 'key' ? KeyRound : CloudOff}
      title={notice.title}
      message={
        <>
          <span>{notice.message}</span>
          {notice.detail ? <span className="recipe-notice__detail"> ({notice.detail})</span> : null}
        </>
      }
      action={notice.settingsLabel ? { label: notice.settingsLabel, icon: SettingsIcon, onClick: onOpenSettings } : undefined}
    />
  );
}

/** 보정·제외 안내 (여러 줄) */
export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <Banner tone="info">
      <ul className="recipe-warnings">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </Banner>
  );
}

/** 연속 2회 거절 → 새 재료 탐색 권유 (v2.1 primary 배너 → 당근색 카드) */
export function ExploreNudge({ busy, onExplore, onDismiss }: { busy: boolean; onExplore: () => void; onDismiss: () => void }) {
  return (
    <Card tone="accent" className="recipe-nudge" role="status">
      <Row align="flex-start" gap={12}>
        <Compass size={22} aria-hidden="true" className="recipe-nudge__icon" />
        <Stack gap={8} style={{ flex: 1 }}>
          <Text variant="label" as="p">
            새 재료를 장착해 볼까요?
          </Text>
          <Text variant="body" tone="secondary">
            연속으로 다른 추천을 고르셨어요. 지금 재료 말고, 재료 1개만 새로 넣으면 만들 수 있는 레시피를 찾아 드릴게요.
          </Text>
          <Row wrap gap={8}>
            <Button size="sm" icon={Compass} label="새 재료 추천 받기" onClick={onExplore} disabled={busy} />
            <Button size="sm" variant="ghost" label="괜찮아요" onClick={onDismiss} />
          </Row>
        </Stack>
      </Row>
    </Card>
  );
}

// ───────────────────────── 수치 ─────────────────────────

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="recipe-stat">
      <Text variant="small" tone="muted" as="span">
        {label}
      </Text>
      <Text variant="heading" as="span" numeric className="recipe-stat__value">
        {value}
      </Text>
    </div>
  );
}

// ───────────────────────── 재료 줄 ─────────────────────────

export function IngredientRows({
  recipe,
  slots,
  onAdjust,
}: {
  recipe: Recipe;
  slots: PumpSlot[];
  onAdjust: (pump: number, delta: number) => void;
}) {
  const total = totalMlOf(recipe);
  return (
    <Card padded={false} className="recipe-ings">
      <ul className="recipe-ings__list">
        {recipe.ingredients.map((i) => {
          const slot = slots.find((s) => s.pump === i.pump);
          return (
            <li key={i.pump} className="recipe-ing">
              <span className="recipe-ing__swatch" style={{ backgroundColor: colorFor(i.pump, slots) }} aria-hidden="true" />
              <div className="recipe-ing__text">
                <Text variant="label" as="p" truncate className="recipe-ing__name">
                  {i.name}
                </Text>
                <Text variant="small" tone="muted" as="p" numeric>
                  펌프 {i.pump} · {sharePctOf(i.ml, total)}%{slot && slot.abv > 0 ? ` · ${slot.abv}%` : ''}
                </Text>
              </div>
              <div className="recipe-ing__adjust" role="group" aria-label={`${i.name} 양`}>
                <IconButton
                  icon={Minus}
                  variant="secondary"
                  label={`${i.name} 줄이기`}
                  title={`${ADJUST_STEP_ML}ml 줄이기`}
                  onClick={() => onAdjust(i.pump, -ADJUST_STEP_ML)}
                />
                <Text variant="label" as="span" numeric className="recipe-ing__ml" aria-live="polite">
                  {fmtMl(i.ml)}
                </Text>
                <IconButton
                  icon={Plus}
                  variant="secondary"
                  label={`${i.name} 늘리기`}
                  title={`${ADJUST_STEP_ML}ml 늘리기`}
                  onClick={() => onAdjust(i.pump, ADJUST_STEP_ML)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ───────────────────────── 가니시·팁 ─────────────────────────

export function InfoLine({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Row align="flex-start" gap={12}>
      <Icon size={18} aria-hidden="true" className="recipe-infoline__icon" />
      <Stack gap={2} style={{ flex: 1 }}>
        <Text variant="label" tone="secondary" as="p">
          {title}
        </Text>
        <Text variant="body">{children}</Text>
      </Stack>
    </Row>
  );
}

// ───────────────────────── 바텐더의 제안 ─────────────────────────

const SUG_ICON: Record<Suggestion['type'], LucideIcon> = {
  add_ingredient: CirclePlus,
  substitute: ArrowLeftRight,
  low_stock: CircleAlert,
  info: Info,
};

export function SuggestionCard({ s, onOpen }: { s: Suggestion; onOpen: (s: Suggestion) => void }) {
  const Icon = SUG_ICON[s.type] ?? Info;
  const tone: Tone = s.type === 'low_stock' ? 'warning' : s.type === 'add_ingredient' ? 'info' : 'neutral';
  return (
    <Card tone={tone} flat={tone === 'neutral'} className={`recipe-sug recipe-sug--${s.type}`}>
      <Row align="flex-start" gap={12}>
        <Icon size={22} aria-hidden="true" className="recipe-sug__icon" />
        <Stack gap={8} style={{ flex: 1 }}>
          <Text variant="body">{s.message}</Text>
          {s.type === 'add_ingredient' ? (
            <div>
              <Button size="sm" variant="secondary" icon={Plus} label={`재료 탭에서 ${s.ingredient ?? '재료'} 장착하기`} onClick={() => onOpen(s)} />
            </div>
          ) : s.type === 'low_stock' && s.pump ? (
            <div>
              <Button size="sm" variant="secondary" icon={Droplets} label={`펌프 ${s.pump} 잔량 채우기`} onClick={() => onOpen(s)} />
            </div>
          ) : null}
        </Stack>
      </Row>
    </Card>
  );
}

// ───────────────────────── 즐겨찾기 별 ─────────────────────────

/** 채운 별 (즐겨찾기 된 상태) — IconButton 에 넘길 수 있게 lucide 아이콘 모양으로 */
export const StarFilled = forwardRef<SVGSVGElement, LucideProps>(function StarFilled(props, ref) {
  return <Star ref={ref} {...props} fill="currentColor" />;
}) as unknown as LucideIcon;
