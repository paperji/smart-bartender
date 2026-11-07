/**
 * 레시피 공유 창 (기록 화면의 [공유]에서 열림, v3.1)
 *  - 미리 보기 = 실제로 올라가는 내용 그대로(이름·재료·도수·만든 AI·설명·가니시·팁) + 별명(선택) + 추천 한마디(선택) → [공유하기]
 *  - AI 가 쓴 설명·팁에는 그날의 기분·날씨가 섞여 있을 수 있어 "설명·팁도 올리기"를 끌 수 있음
 *  - 링크·전화번호·이메일·재료 수·양·도수는 서버와 같은 기준으로 올리기 전에 막음. 추천 이유·기분·날씨는 올리지 않음
 *  - 응답을 못 받았거나 이미 올린 레시피면 내 공유 목록으로 맞춰 보고 성공으로 처리
 */
import { Info, Lock, Share2, Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { providerLabel } from '@/lib/ai/providers';
import { fmtMl } from '@/lib/format';
import { SHARE_LIMITS } from '@/lib/share/api';
import { aiBadgeText, type ShareSource } from '@/lib/share/convert';
import type { HistoryEntry } from '@/store/history';
import { useShared } from '@/store/shared';
import { toast } from '@/store/toast';
import { Badge, Banner, Button, Modal, Row, Stack, Switch, Text, TextArea, TextField } from '@/ui';

import { previewPayload, shareEntry, shareErrorText, shareProblem } from './sharedActions';

import './SharedScreen.css';

export interface ShareDialogProps {
  entry: HistoryEntry | null;
  onClose: () => void;
}

export function ShareDialog({ entry, onClose }: ShareDialogProps) {
  const [nickname, setNickname] = useState(() => useShared.getState().nickname);
  const [comment, setComment] = useState('');
  const [withNotes, setWithNotes] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 새 레시피로 열릴 때마다 처음 상태로 (별명은 지난번 것)
  useEffect(() => {
    if (!entry) return;
    setNickname(useShared.getState().nickname);
    setComment('');
    setWithNotes(true);
    setError(null);
    setSending(false);
  }, [entry?.id]);

  const source: ShareSource | null = useMemo(
    () =>
      entry
        ? {
            recipe: entry.recipe,
            source: entry.source,
            meta: entry.meta,
            ...(entry.source === 'direct' && entry.provider ? { aiLabel: providerLabel(entry.provider) } : {}),
          }
        : null,
    [entry],
  );
  const opts = { nickname, comment, withNotes };
  const payload = source ? previewPayload(source, opts) : null;
  const problem = source ? shareProblem(source, opts) : null;

  if (!entry || !source || !payload) return null;

  const submit = async () => {
    if (problem) {
      setError(problem);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const r = await shareEntry(source, opts);
      toast(
        r.existing ? '이미 모두의 레시피에 올라가 있어요.' : '모두의 레시피에 공유했어요. 다른 사람이 만들면 사용 횟수가 올라가요.',
        'success',
      );
      onClose();
    } catch (e) {
      setError(shareErrorText(e));
    } finally {
      setSending(false);
    }
  };

  const abv = payload.ingredients.reduce((a, i) => a + i.ml * i.abv, 0) / Math.max(1, payload.ingredients.reduce((a, i) => a + i.ml, 0));
  const abvLabel = abv > 0 ? `도수 약 ${Math.round(abv * 10) / 10}%` : '무알콜';

  return (
    <Modal
      open
      onClose={sending ? undefined : onClose}
      title="레시피 공유"
      description="모두의 레시피에 올려 다른 사람도 이 레시피로 만들 수 있게 해요. 아래 내용이 그대로 올라가요."
      variant="sheet"
      footer={
        <Row gap={8} className="shared-dialog__footer">
          <Button variant="secondary" label="취소" onClick={onClose} disabled={sending} />
          <Button icon={Share2} label="공유하기" onClick={submit} loading={sending} disabled={!!problem && !error} />
        </Row>
      }>
      <Stack gap={12}>
        <div className="shared-preview" aria-label="올라가는 내용 미리 보기">
          <Text variant="heading">
            {payload.name}
            {payload.nameEn ? <span className="shared-card__en"> {payload.nameEn}</span> : null}
          </Text>
          <div className="shared-card__badges">
            <Badge label={abvLabel} tone={abv > 0 ? 'danger' : 'success'} />
            <Badge label={aiBadgeText(payload.source, payload.aiLabel)} tone={payload.source === 'direct' ? 'info' : 'neutral'} />
            <Badge label={fmtMl(payload.ingredients.reduce((a, i) => a + i.ml, 0))} tone="neutral" />
          </div>
          <Text variant="small" tone="secondary">
            {payload.ingredients.map((i) => `${i.name} ${fmtMl(i.ml)}`).join(' · ')}
          </Text>
          {payload.description ? <p className="shared-card__desc">설명: {payload.description}</p> : null}
          {payload.garnish ? <p className="shared-card__desc">가니시: {payload.garnish}</p> : null}
          {payload.tips ? <p className="shared-card__desc">팁: {payload.tips}</p> : null}
        </div>
        <Switch
          label="AI 가 쓴 설명·팁도 올리기"
          description="그날의 기분·날씨 이야기가 들어 있으면 꺼 주세요."
          checked={withNotes}
          onChange={setWithNotes}
        />
        <TextField
          label="별명 (선택)"
          value={nickname}
          onChange={setNickname}
          maxLength={SHARE_LIMITS.nickname}
          counter
          icon={Users}
          placeholder="비우면 '익명 바텐더'로 보여요"
          autoComplete="off"
          hint="이름·학번·연락처처럼 나를 알 수 있는 정보는 적지 마세요."
        />
        <TextArea
          label="추천 한마디 (선택)"
          value={comment}
          onChange={setComment}
          maxLength={SHARE_LIMITS.comment}
          counter
          rows={2}
          placeholder="예) 상큼하고 가볍게 마시기 좋아요"
        />
        {error || problem ? (
          <Banner tone="error" title="공유하지 못했어요" message={error ?? problem ?? ''} onClose={error ? () => setError(null) : undefined} />
        ) : null}
        <ul className="settings-notes">
          <li>
            <Users size={16} aria-hidden="true" />
            <span>
              <b>누구나 볼 수 있어요.</b> 위 미리 보기의 이름·재료·맛·설명·가니시·팁과 별명·한마디가 올라가요.
            </span>
          </li>
          <li>
            <Lock size={16} aria-hidden="true" />
            <span>추천 이유·그날의 기분·날씨 입력은 올리지 않아요. 링크·전화번호·이메일은 쓸 수 없어요.</span>
          </li>
          <li>
            <Trash2 size={16} aria-hidden="true" />
            <span>기록 화면이나 모두의 레시피에서 언제든 공유를 취소할 수 있어요(이 기기에서).</span>
          </li>
          <li>
            <Info size={16} aria-hidden="true" />
            <span>다른 사람이 이 레시피로 실제로 만들면 사용 횟수가 올라가고, 많이 만든 레시피는 인기 TOP 5 에 보여요.</span>
          </li>
        </ul>
      </Stack>
    </Modal>
  );
}
