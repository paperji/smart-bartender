/**
 * ① 바텐더 (홈) — 기분·맛·도수·날씨·상황·성향·잔 용량 입력 → AI 레시피 만들기 / 새 재료 탐색
 * v2.1 src/app/(tabs)/index.tsx 의 기능·문구를 그대로 옮기고 모양만 밝은 톤으로 (WEBAPP_DESIGN §3·§6)
 *  - 모바일(<900px): 한 줄로 쌓고, [AI 레시피 만들기]는 탭바 위에 붙는 아래 버튼 줄(Page footer)
 *  - PC(≥900px): 왼쪽 입력(넓으면 2열) + 오른쪽에 따라 내려오는 요약·실행 카드
 *  - 새로: 첫 실행 안내 카드("AI 키를 등록하면…", 닫으면 settings.onboardingDismissed)
 */
import { CircleQuestionMark, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CalibrationBanner, ScreenBoundary } from '@/components';
import { recommendAndShow } from '@/lib/flow';
import { haptic } from '@/platform/haptics';
import { DEFAULT_INPUT, useDraft, useSession } from '@/store/draft';
import { installedSlots, useSlots } from '@/store/slots';
import { startTutorial } from '@/store/tutorial';
import { alertMessage, Button, Columns, IconButton, Page, PageHeader, Stack } from '@/ui';

import { ActionCard, InstalledCard, OnboardingCard } from './HomeCards';
import { CupSection, MoodSection, PreferenceSection, SituationSection, StrengthSection, TasteSection, WeatherSection } from './HomeSections';
import { useMediaQuery, WIDE_QUERY } from './useMediaQuery';

import './HomeScreen.css';

function HomeScreenContent() {
  const input = useDraft((s) => s.input);
  const setInput = useDraft((s) => s.setInput);
  const slots = useSlots((s) => s.slots);
  const installed = useMemo(() => installedSlots(slots), [slots]);
  const hasAlcohol = installed.some((s) => s.abv > 0);
  const wide = useMediaQuery(WIDE_QUERY);
  const [generating, setGenerating] = useState(false);

  // 주류가 없으면 무알콜로 고정
  useEffect(() => {
    if (!hasAlcohol && input.strength !== 'none') setInput({ strength: 'none' });
  }, [hasAlcohol, input.strength, setInput]);

  const onGenerate = async () => {
    if (generating) return;
    if (installed.length === 0) {
      alertMessage(
        '장착된 재료가 없어요',
        '재료 탭에서 펌프에 음료(또는 술)를 먼저 등록하거나, 아래 "새 재료 탐색"으로 무엇을 장착할지 추천받아 보세요.',
      );
      return;
    }
    setGenerating(true);
    haptic.press();
    useSession.getState().setRejectStreak(0);
    try {
      await recommendAndShow({ input, mode: 'normal' });
    } finally {
      setGenerating(false);
    }
  };

  /** 탐색(explore) 모드: 새 재료 1개를 장착하면 만들 수 있는 레시피 (빈 기기에서도 동작) */
  const onExplore = async () => {
    if (generating) return;
    setGenerating(true);
    haptic.press();
    try {
      await recommendAndShow({ input, mode: 'explore' }, { round: 0 });
    } finally {
      setGenerating(false);
    }
  };

  /** 초기화 — 잔 용량만 남기고 처음 값으로 (v2.1 과 같음) */
  const onReset = () => setInput({ ...DEFAULT_INPUT, cupMl: input.cupMl });

  return (
    <Page
      width="wide"
      className="home-page"
      header={
        <PageHeader
          title="오늘의 한 잔"
          subtitle="지금 기분과 취향을 알려 주시면 딱 맞게 섞어 드릴게요."
          actions={<IconButton icon={CircleQuestionMark} label="사용법 보기" onClick={startTutorial} />}
        />
      }
      footer={wide ? undefined : <Button size="lg" icon={Sparkles} label="AI 레시피 만들기" onClick={onGenerate} loading={generating} full data-tour="home-generate" />}>
      <Columns template="minmax(0, 1fr) minmax(300px, 340px)" gap={24} className="home-layout">
        <Stack gap={20} className="home-main">
          <OnboardingCard />
          <CalibrationBanner />
          <InstalledCard installed={installed} pumpCount={slots.length} onExplore={onExplore} />
          <div className="home-form">
            <div className="home-form__col">
              {/* 사용법 안내가 비추는 칸 (lib/tutorial.ts) */}
              <div data-tour="home-input">
                <MoodSection moods={input.moods} onChange={(moods) => setInput({ moods })} />
              </div>
              <TasteSection taste={input.taste} onChange={(taste) => setInput({ taste })} />
              <StrengthSection value={input.strength} hasAlcohol={hasAlcohol} onChange={(strength) => setInput({ strength })} />
            </div>
            <div className="home-form__col">
              <WeatherSection weather={input.weather} onChange={(weather) => setInput({ weather })} />
              <SituationSection value={input.situation} onChange={(situation) => setInput({ situation })} />
              <PreferenceSection value={input.preference} onChange={(preference) => setInput({ preference })} />
              <CupSection value={input.cupMl} onChange={(cupMl) => setInput({ cupMl })} />
            </div>
          </div>
        </Stack>
        <aside className="home-side" aria-label={wide ? '고른 조건과 레시피 만들기' : '새 재료 탐색과 초기화'}>
          <ActionCard input={input} wide={wide} generating={generating} onGenerate={onGenerate} onExplore={onExplore} onReset={onReset} />
        </aside>
      </Columns>
    </Page>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function HomeScreen() {
  return (
    <ScreenBoundary name="home">
      <HomeScreenContent />
    </ScreenBoundary>
  );
}
