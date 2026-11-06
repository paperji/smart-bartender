/**
 * 탐색(explore) 카드 — "이 재료를 장착하면 이런 레시피를 만들 수 있어요" (SPEC §5.4)
 * 레시피 이름·설명·재료(미장착 재료 강조)·메시지 + "펌프 N에 장착하기"
 * (빈 펌프 우선, 없으면 기록상 가장 적게 쓰인 펌프). v2.1 ExploreCard
 */
import { CirclePlus, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

import { missingIngredients, pumpUsage, recommendPump, type PumpPick, type UsageEntry } from '@/lib/ai/explore';
import { particle } from '@/lib/ai/normalize';
import { fmtMl } from '@/lib/format';
import { CATEGORY_INFO, findPreset } from '@/lib/presets';
import type { ExploreItem, PumpSlot } from '@/lib/types';
import { useHistory } from '@/store/history';
import { useSlots } from '@/store/slots';
import { Badge, Button, Card, cx } from '@/ui';

import { FALLBACK_COLOR, sharePct } from './color';

export interface ExploreCardProps {
  item: ExploreItem;
  /** "펌프 N에 장착하기" — 보통 `openInstall` (`@/lib/flow`) 을 그대로 넘김 */
  onInstall: (item: ExploreItem, pick: PumpPick) => void;
  /** 레시피 화면 안에 넣을 때(normal 모드 0~1개) — 테두리를 얇게 */
  compact?: boolean;
  /** "펌프 N에 장착하기" 를 잠시 막음 (제조 시작·다른 추천 진행 중 등) */
  disabled?: boolean;
  /** (보통 생략) 펌프 슬롯 — 기본은 재료 스토어(useSlots) */
  slots?: PumpSlot[];
  /** (보통 생략) 펌프 사용 기록 — 기본은 기록 스토어(useHistory entries) */
  entries?: UsageEntry[];
  className?: string;
}

/** 탐색 카드에서 고를 펌프 (빈 펌프 우선 → 기록상 가장 적게 쓰인 펌프) — 화면에서 같은 결과가 필요할 때 */
export function usePumpPick(item: ExploreItem, slotsOverride?: PumpSlot[], entriesOverride?: UsageEntry[]): PumpPick | null {
  const storeSlots = useSlots((s) => s.slots);
  const storeEntries = useHistory((s) => s.entries);
  const slots = slotsOverride ?? storeSlots;
  const entries = entriesOverride ?? storeEntries;
  return useMemo(() => recommendPump(slots, pumpUsage(slots, entries), item), [slots, entries, item]);
}

/** "펌프 N에 장착하기" 아래 설명 문구 (v2.1 과 같음) */
export function pumpPickText(pick: PumpPick): string {
  return pick.reason === 'empty'
    ? `펌프 ${pick.pump}번이 비어 있어요.`
    : `펌프 ${pick.pump}의 ${pick.current}${particle(pick.current ?? '', '은', '는')} 기록상 가장 적게 쓰였어요(${pick.uses ?? 0}회). 바꿔 끼우면 돼요.`;
}

export function ExploreCard({ item, onInstall, compact, disabled, slots: slotsOverride, entries, className }: ExploreCardProps) {
  const storeSlots = useSlots((s) => s.slots);
  const slots = slotsOverride ?? storeSlots;
  const pick = usePumpPick(item, slotsOverride, entries);
  const missing = missingIngredients(item);
  const total = item.ingredients.reduce((a, b) => a + b.ml, 0) || 1;
  const cat = CATEGORY_INFO[item.category] ?? CATEGORY_INFO.other;
  const newColor = findPreset(item.addIngredient)?.color ?? 'var(--accent)';

  return (
    <Card className={cx('dc-explore', compact ? 'dc-explore--compact' : 'dc-explore--full', className)}>
      <div className="dc-explore__head">
        <span className="dc-explore__icon" aria-hidden="true">
          <CirclePlus size={24} />
        </span>
        <div className="dc-explore__headtext">
          <Badge label="새 재료" tone="accent" icon={Sparkles} />
          <p className="dc-explore__add">{item.addIngredient}</p>
          <p className="dc-explore__cat">
            {cat.label} · {item.abv > 0 ? `도수 ${item.abv}%` : '무알콜'}
          </p>
        </div>
      </div>

      <div className="dc-explore__recipe">
        <h3 className="dc-explore__name">{item.recipeName}</h3>
        {item.description ? <p className="dc-explore__desc">{item.description}</p> : null}
      </div>

      <ul className="dc-explore__list" aria-label="재료">
        {item.ingredients.map((i, idx) => {
          const slot = i.installed ? slots.find((s) => s.pump === i.pump) : undefined;
          const color = i.installed ? slot?.color || FALLBACK_COLOR : newColor;
          return (
            <li key={`${i.name}-${idx}`} className={cx('dc-explore__ing', !i.installed && 'is-new')}>
              <span className="dc-dot" style={{ backgroundColor: color }} aria-hidden="true" />
              <div className="dc-explore__ingtext">
                <p className="dc-explore__ingname">{i.name}</p>
                <p className="dc-explore__ingmeta">
                  {i.installed ? `펌프 ${i.pump} · 장착됨` : '미장착 · 새로 넣어야 해요'} · {sharePct(i.ml, total)}%
                </p>
              </div>
              <span className="dc-explore__ml sb-num">{fmtMl(i.ml)}</span>
            </li>
          );
        })}
      </ul>

      {item.message ? <p className="dc-explore__msg">{item.message}</p> : null}

      {pick ? (
        <div className="dc-explore__install">
          <Button
            icon={CirclePlus}
            label={`펌프 ${pick.pump}에 장착하기`}
            onClick={() => {
              if (!disabled) onInstall(item, pick);
            }}
            disabled={disabled}
            full
          />
          <p className="dc-explore__hint">{pumpPickText(pick)}</p>
        </div>
      ) : null}
      {missing.length > 1 ? (
        <p className="dc-explore__warn">
          {missing.slice(1).join(', ')}도 함께 장착해야 이 레시피를 그대로 만들 수 있어요. 첫 재료를 저장하면 다음 재료 장착 화면이 이어서 열려요.
        </p>
      ) : null}
    </Card>
  );
}
