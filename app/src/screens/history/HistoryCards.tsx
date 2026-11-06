/**
 * 기록 화면 카드 — 제조 기록 카드(HistoryCard) · 즐겨찾기 카드(FavoriteCard)
 * v2.1 (tabs)/history.tsx 의 HistoryCard·즐겨찾기 카드와 같은 내용·문구, 모양만 밝은 톤
 */
import { Check, CircleHelp, CloudOff, Droplet, Hand, Repeat, Star, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';

import { RecipeBar } from '@/components';
import { fmtDate, fmtMl } from '@/lib/format';
import type { PumpSlot, Recipe } from '@/lib/types';
import type { FavoriteEntry, HistoryEntry } from '@/store/history';
import { Badge, Button, Card, cx, IconButton, Text } from '@/ui';

/** 도수 표시 — 0 이면 '무알콜' */
export const abvLabel = (r: Pick<Recipe, 'estimatedAbv'>) => (r.estimatedAbv > 0 ? `${r.estimatedAbv}%` : '무알콜');

const isoOf = (ts: number) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

export interface HistoryCardProps {
  entry: HistoryEntry;
  slots: PumpSlot[];
  /** 즐겨찾기에 들어 있는지 */
  fav: boolean;
  onRemake: () => void;
  onFav: () => void;
  onDelete: () => void;
}

/** 제조 기록 한 잔 — 시각·기분, 이름, 결과·도수·출처·피드백 배지, 즐겨찾기·삭제, 비율 막대, 재료 ml, 다시 만들기 */
export function HistoryCard({ entry, slots, fav, onRemake, onFav, onDelete }: HistoryCardProps) {
  const r = entry.recipe;
  const titleId = `history-entry-${entry.id}`;
  return (
    <Card className="history-card" aria-labelledby={titleId} role="article">
      <div className="history-card__head">
        <div className="history-card__titles">
          <Text variant="caption" tone="muted" numeric>
            <time dateTime={isoOf(entry.createdAt)}>{fmtDate(entry.createdAt)}</time>
            {entry.moods.length ? ` · ${entry.moods.join(', ')}` : ''}
          </Text>
          <Text variant="heading" id={titleId} className="history-card__name">
            {r.name}
          </Text>
          <div className="history-card__badges">
            {entry.status === 'stopped' ? (
              <Badge label="중단됨" tone="warning" icon={Hand} />
            ) : (
              <Badge label="완성" tone="success" icon={Check} />
            )}
            {entry.uncertain ? <Badge label="결과 확인 필요" tone="warning" icon={CircleHelp} /> : null}
            <Badge label={abvLabel(r)} tone={r.estimatedAbv > 0 ? 'danger' : 'neutral'} />
            {entry.source === 'offline' ? <Badge label="오프라인 추천" tone="neutral" icon={CloudOff} /> : null}
            {entry.feedback ? (
              <Badge
                label={entry.feedback === 'like' ? '좋아요' : '별로예요'}
                tone={entry.feedback === 'like' ? 'accent' : 'neutral'}
                icon={entry.feedback === 'like' ? ThumbsUp : ThumbsDown}
              />
            ) : null}
          </div>
        </div>
        <div className="history-card__actions">
          <IconButton
            icon={Star}
            label="즐겨찾기"
            aria-pressed={fav}
            className={cx('history-star', fav && 'is-on')}
            onClick={onFav}
          />
          <IconButton icon={Trash2} label="삭제" className="history-muted-btn" onClick={onDelete} />
        </div>
      </div>
      <RecipeBar ingredients={r.ingredients} slots={slots} height={12} />
      <ul className="history-card__mls" aria-label="재료 양">
        {r.ingredients.map((i, idx) => (
          <li key={`${i.pump}-${idx}`} className="history-card__ml">
            <Droplet size={12} aria-hidden="true" />
            <Text variant="small" tone="secondary" numeric>
              {i.name} {fmtMl(i.ml)}
            </Text>
          </li>
        ))}
      </ul>
      <Button variant="secondary" size="sm" icon={Repeat} label="다시 만들기" full className="history-card__remake" onClick={onRemake} />
    </Card>
  );
}

export interface FavoriteCardProps {
  fav: FavoriteEntry;
  slots: PumpSlot[];
  onRemake: () => void;
  onRemove: () => void;
}

/** 즐겨찾기 한 개 — 이름, 저장 시각·총량·도수, 즐겨찾기 해제, 비율 막대, 다시 만들기 */
export function FavoriteCard({ fav, slots, onRemake, onRemove }: FavoriteCardProps) {
  const r = fav.recipe;
  const titleId = `history-fav-${fav.id}`;
  return (
    <Card className="history-card" aria-labelledby={titleId} role="article">
      <div className="history-card__head">
        <div className="history-card__titles">
          <Text variant="heading" id={titleId} className="history-card__name">
            {r.name}
          </Text>
          <Text variant="caption" tone="muted" numeric>
            <time dateTime={isoOf(fav.savedAt)}>{fmtDate(fav.savedAt)}</time> 저장 · {fmtMl(r.totalMl)} · {abvLabel(r)}
          </Text>
        </div>
        <div className="history-card__actions">
          <IconButton icon={Star} label="즐겨찾기 해제" className="history-star is-on" onClick={onRemove} />
        </div>
      </div>
      <RecipeBar ingredients={r.ingredients} slots={slots} height={12} />
      <Button variant="secondary" icon={Repeat} label="다시 만들기" full className="history-card__remake" onClick={onRemake} />
    </Card>
  );
}
