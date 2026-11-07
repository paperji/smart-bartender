/**
 * 바텐더 홈 — 카드들: 첫 실행 안내(새로), 장착된 재료 요약, 요약·실행 카드(PC 오른쪽 고정 / 모바일 맨 아래)
 */
import { ChevronRight, Compass, KeyRound, ListChecks, RotateCcw, Sparkles, WifiOff } from 'lucide-react';
import { useId } from 'react';

import { aiModeCaption } from '@/lib/ai/mode';
import { providerLabel } from '@/lib/ai/providers';
import { go } from '@/lib/nav';
import type { PumpSlot, UserInput } from '@/lib/types';
import { activeKeyHint, useEffectiveAiMode, useSettings } from '@/store/settings';
import { Badge, Banner, Button, Card, cx, Divider, Row, SectionHeader, Stack, Text } from '@/ui';

import { summaryRows } from './homeData';

/* ───────── 첫 실행 안내 (WEBAPP_DESIGN §4) ───────── */

/** 키가 없고 아직 닫지 않았으면 보임. 닫으면 settings.onboardingDismissed 에 저장 */
export function OnboardingCard() {
  const dismissed = useSettings((s) => s.onboardingDismissed);
  const hasKey = useSettings((s) => Object.keys(s.aiKeyHints).length > 0);
  const set = useSettings((s) => s.set);
  if (dismissed || hasKey) return null;
  return (
    <Banner
      tone="info"
      icon={Sparkles}
      title="처음 오셨나요?"
      message="내 AI 키(Gemini·ChatGPT·Claude 등)를 등록하면 AI 가 레시피를 만들어요. 없어도 오프라인 추천으로 바로 쓸 수 있어요."
      action={<Button size="sm" variant="secondary" icon={KeyRound} label="AI 키 등록하러 가기" onClick={() => go('/settings')} />}
      onClose={() => set({ onboardingDismissed: true })}
    />
  );
}

/* ───────── 장착된 재료 ───────── */

export function InstalledCard({ installed, pumpCount, onExplore }: { installed: PumpSlot[]; pumpCount: number; onExplore: () => void }) {
  if (installed.length === 0) {
    return (
      <Banner
        tone="warning"
        title="장착된 재료가 없어요"
        message={`재료 탭에서 펌프 1~${pumpCount}번에 들어 있는 음료를 등록하거나, 무엇을 장착하면 좋을지 추천받아 보세요.`}
        action={
          <Row wrap>
            <Button size="sm" variant="secondary" label="재료 등록하기" onClick={() => go('/ingredients')} />
            <Button size="sm" variant="ghost" icon={Compass} label="새 재료 탐색" onClick={onExplore} />
          </Row>
        }
      />
    );
  }
  const names = installed.map((s) => `${s.pump}번 ${s.name}`).join(', ');
  return (
    <Card onPress={() => go('/ingredients')} pressLabel={`장착된 재료 ${installed.length}개 보기: ${names}`} className="home-installed">
      <div className="home-installed__head">
        <Text variant="label" tone="secondary">
          장착된 재료 {installed.length}개
        </Text>
        <span className="home-installed__more" aria-hidden="true">
          관리
          <ChevronRight size={14} />
        </span>
      </div>
      <ul className="home-tags" aria-hidden="true">
        {installed.map((s) => (
          <li key={s.pump} className="home-tag">
            <span className="dc-dot" style={{ backgroundColor: s.color }} />
            <span className="home-tag__pump sb-num">{s.pump}</span>
            <span className="home-tag__name">{s.name}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ───────── 요약 · 실행 ───────── */

export interface ActionCardProps {
  input: UserInput;
  /** PC: 요약 + [AI 레시피 만들기] 까지 이 카드에. 모바일: 아래 고정 줄에 [AI 레시피 만들기]가 있어서 여기엔 탐색·안내·초기화만 */
  wide: boolean;
  generating: boolean;
  onGenerate: () => void;
  onExplore: () => void;
  onReset: () => void;
}

export function ActionCard({ input, wide, generating, onGenerate, onExplore, onReset }: ActionCardProps) {
  const hintId = useId();
  const aiMode = useSettings((s) => s.aiMode);
  const hasKey = useSettings((s) => !!activeKeyHint(s));
  const label = useSettings((s) => providerLabel(s.aiProvider));
  const effective = useEffectiveAiMode();
  const caption = aiModeCaption(aiMode, hasKey, label);
  return (
    <Card padded={wide ? 'lg' : true} className={cx('home-action', wide && 'home-action--wide')}>
      <Stack gap={14}>
        {wide ? (
          <>
            <SectionHeader
              title="지금 고른 조건"
              icon={ListChecks}
              action={
                effective === 'ai' ? (
                  <Badge tone="info" icon={Sparkles} label={`${label} AI`} />
                ) : (
                  <Badge tone="neutral" icon={WifiOff} label="오프라인 추천" />
                )
              }
            />
            <dl className="home-summary">
              {summaryRows(input).map((r) => (
                <div key={r.label} className="home-summary__row">
                  <dt>{r.label}</dt>
                  <dd className={cx(r.empty && 'is-empty')}>{r.value}</dd>
                </div>
              ))}
            </dl>
            <Divider />
            <Button size="lg" icon={Sparkles} label="AI 레시피 만들기" onClick={onGenerate} loading={generating} full />
          </>
        ) : null}
        <Button
          variant="secondary"
          icon={Compass}
          label="새 재료 탐색 (다른 맛 찾기)"
          onClick={onExplore}
          disabled={generating}
          full
          aria-describedby={hintId}
          title="재료 하나를 새로 장착하면 만들 수 있는 레시피를 추천해요"
        />
        <span id={hintId} className="sr-only">
          재료 하나를 새로 장착하면 만들 수 있는 레시피를 추천해요
        </span>
        <div className="home-action__foot">
          <Text variant="caption" tone="secondary" className="home-grow">
            {caption}
          </Text>
          <Button size="sm" variant="ghost" icon={RotateCcw} label="초기화" onClick={onReset} />
        </div>
      </Stack>
    </Card>
  );
}
