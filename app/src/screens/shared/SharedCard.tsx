/**
 * 공유 레시피 카드 (모두의 레시피 화면, v3.1)
 *  - 순위(인기 TOP 5) · 이름 · 올린 사람·날짜·만든 수 · 추천 한마디 · 도수/AI 배지 · 재료(장착됨/없음) · 맛 · 만들기·즐겨찾기·신고(또는 공유 취소)
 */
import { Check, CircleAlert, CloudOff, Droplet, EyeOff, Flag, Play, Sparkles, Star, Trash2, UserRound, Users } from 'lucide-react';
import { useId } from 'react';

import { FlavorBars } from '@/components';
import { fmtDate, fmtMl } from '@/lib/format';
import type { SharedRecipe } from '@/lib/share/api';
import { aiBadgeText, authorOf, availability } from '@/lib/share/convert';
import type { PumpSlot } from '@/lib/types';
import { Badge, Button, Card, cx, IconButton, Text } from '@/ui';

export interface SharedCardProps {
  recipe: SharedRecipe;
  slots: readonly PumpSlot[];
  /** 인기 순위 (1~5) */
  rank?: number;
  fav: boolean;
  onUse: () => void;
  onFav: () => void;
  onReport?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}

export function SharedCard({ recipe: s, slots, rank, fav, onUse, onFav, onReport, onDelete, busy }: SharedCardProps) {
  // 같은 레시피가 TOP 5 와 검색 결과에 함께 보일 수 있어 카드마다 다른 id
  const titleId = useId();
  const av = availability(s, slots);
  const ai = aiBadgeText(s.source, s.aiLabel);
  return (
    <Card className={cx('shared-card', rank === 1 && 'shared-card--first')} role="article" aria-labelledby={titleId}>
      <div className="shared-card__head">
        {rank ? (
          <>
            <span className={cx('shared-rank', `shared-rank--${rank}`)} aria-hidden="true">
              {rank}
            </span>
            <span className="sr-only">인기 {rank}위</span>
          </>
        ) : null}
        <div className="shared-card__titles">
          <Text variant="heading" id={titleId} className="shared-card__name">
            {s.name}
            {s.nameEn ? <span className="shared-card__en"> {s.nameEn}</span> : null}
          </Text>
          <Text variant="caption" tone="muted" numeric className="shared-card__meta">
            <UserRound size={12} aria-hidden="true" /> {authorOf(s)} · {fmtDate(s.createdAt)} ·{' '}
            <b className="shared-card__count">{s.useCount > 0 ? `${s.useCount}명이 만들었어요` : '아직 만든 사람이 없어요'}</b>
          </Text>
        </div>
        <div className="shared-card__actions">
          <IconButton icon={Star} label={fav ? '즐겨찾기 해제' : '즐겨찾기'} aria-pressed={fav} className={cx('history-star', fav && 'is-on')} onClick={onFav} />
          {onDelete ? <IconButton icon={Trash2} label="공유 취소" className="history-muted-btn" onClick={onDelete} /> : null}
          {onReport ? <IconButton icon={Flag} label="신고" className="history-muted-btn" onClick={onReport} /> : null}
        </div>
      </div>

      {s.comment ? <p className="shared-card__comment">“{s.comment}”</p> : s.description ? <p className="shared-card__desc">{s.description}</p> : null}

      <div className="shared-card__badges">
        <Badge label={s.estimatedAbv > 0 ? `도수 ${s.estimatedAbv}%` : '무알콜'} tone={s.estimatedAbv > 0 ? 'danger' : 'success'} />
        <Badge label={ai} tone={s.source === 'direct' ? 'info' : 'neutral'} icon={s.source === 'direct' ? Sparkles : CloudOff} />
        <Badge label={fmtMl(s.totalMl)} tone="neutral" />
        {s.mine ? <Badge label="내 레시피" tone="accent" icon={Users} /> : null}
        {s.used ? <Badge label="만들어 봤어요" tone="neutral" icon={Check} /> : null}
        {s.hidden ? <Badge label="신고가 쌓여 숨겨짐" tone="warning" icon={EyeOff} /> : null}
      </div>

      <ul className="shared-card__ings" aria-label="재료">
        {av.items.map(({ ingredient: i, slot, low }) => (
          <li key={i.name} className={cx('shared-ing', slot ? 'is-on' : 'is-off')}>
            {slot ? <Check size={13} aria-hidden="true" /> : <Droplet size={13} aria-hidden="true" />}
            <span>
              {i.name} <span className="sb-num">{fmtMl(i.ml)}</span>
            </span>
            <span className="sr-only">{slot ? (low ? ' — 장착됨, 잔량 부족' : ' — 장착됨') : ' — 장착 안 됨'}</span>
            {slot && low ? <span className="shared-ing__low">잔량 부족</span> : null}
          </li>
        ))}
      </ul>
      <p className={cx('shared-card__ready', av.ready ? 'is-ready' : 'is-missing')}>
        {av.ready ? (
          <>
            <Check size={14} aria-hidden="true" /> 지금 장착된 재료로 만들 수 있어요
          </>
        ) : (
          <>
            <CircleAlert size={14} aria-hidden="true" /> 없는 재료: {av.missing.join(', ')}
          </>
        )}
      </p>

      <details className="shared-card__more">
        <summary>맛·가니시 보기</summary>
        <FlavorBars flavor={s.flavor} />
        {s.comment && s.description ? <p className="shared-card__desc">{s.description}</p> : null}
        {s.garnish ? <p className="shared-card__desc">가니시: {s.garnish}</p> : null}
        {s.tips ? <p className="shared-card__desc">팁: {s.tips}</p> : null}
      </details>

      <Button icon={Play} label="이 레시피로 만들기" variant={av.ready ? 'primary' : 'secondary'} full loading={busy} onClick={onUse} className="shared-card__use" />
    </Card>
  );
}
