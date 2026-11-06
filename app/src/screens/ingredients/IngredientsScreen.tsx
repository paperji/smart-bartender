/**
 * 재료 탭 — 펌프 슬롯(재료명·종류·도수·잔량/용량·색상) 목록 (v2.1 src/app/(tabs)/ingredients.tsx)
 *  - 요약: 장착 N/4 · 잔량 부족 · 주류
 *  - ?suggest=재료 (추천 레시피의 "재료 추가" 제안 — 빈 펌프가 없을 때): "○○ 장착하기" 배너 + 추천 펌프
 *    (탐색 카드와 같은 규칙: 빈 펌프 → 기록상 가장 적게 쓰인 펌프, 지금 레시피에 쓰는 펌프는 피함)
 *  - 펌프 카드(공용 PumpCard)를 누르면 재료 편집(#/ingredients/:pump, suggest 가 있으면 함께 넘김)
 *  - PC(≥900px): 펌프 카드를 2열 격자로
 */
import { Info, PackagePlus, X } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { PumpCard, pumpPickText, ScreenBoundary } from '@/components';
import { josa } from '@/lib/ai/normalize';
import { ingredientEditPath } from '@/lib/flow';
import { go } from '@/lib/nav';
import { useDevice } from '@/store/device';
import { useSession } from '@/store/draft';
import { useHistory } from '@/store/history';
import { isLowStock, useSlots } from '@/store/slots';
import { Badge, Banner, Button, Card, Columns, cx, Page, PageHeader, Row } from '@/ui';

import { isInstalled, pumpSummary, suggestPumpPick } from './logic';

import './ingredients.css';

function IngredientsScreenContent() {
  const slots = useSlots((s) => s.slots);
  const cal = useDevice((s) => s.cal);
  const info = useDevice((s) => s.info);
  const entries = useHistory((s) => s.entries);
  const recipeIngredients = useSession((s) => s.current?.recipe.ingredients ?? null);
  const [params, setParams] = useSearchParams();
  const suggestRaw = (params.get('suggest') ?? '').trim();
  // 제안한 재료를 이미 장착했으면(편집 화면에서 저장하고 돌아옴) 배너를 숨김
  const suggest = suggestRaw && !isInstalled(slots, suggestRaw) ? suggestRaw : '';

  const summary = useMemo(() => pumpSummary(slots, isLowStock), [slots]);
  const pick = useMemo(
    () => (suggest ? suggestPumpPick(slots, entries, suggest, recipeIngredients) : null),
    [suggest, slots, entries, recipeIngredients],
  );

  const open = (pump: number) => go(suggest ? ingredientEditPath(pump, { suggest }) : `/ingredients/${pump}`);
  const cancelSuggest = () => setParams({}, { replace: true });

  return (
    <Page
      header={
        <PageHeader
          title="재료"
          subtitle={`기기의 펌프 ${slots.length}개에 어떤 음료(또는 술)를 넣었는지 등록하세요. 언제든 바꿀 수 있어요.`}
        />
      }>
      <div className="ingredients-summary" role="list" aria-label="펌프 요약">
        <SummaryTile label="장착" value={`${summary.installed}/${summary.total}`} />
        <SummaryTile label="잔량 부족" value={`${summary.low}개`} warn={summary.low > 0} />
        <SummaryTile label="주류" value={`${summary.alcohol}개`} />
      </div>

      {suggest ? (
        <Banner
          tone="info"
          icon={PackagePlus}
          title={`${suggest} 장착하기`}
          message={
            <>
              <p>{`${josa(suggest, '을', '를')} 넣을 펌프를 선택하세요. 기존 재료를 빼고 새 재료로 바꾸게 돼요.`}</p>
              {pick ? <p className="ingredients-suggest__pick">{`추천: ${pumpPickText(pick)}`}</p> : null}
            </>
          }
          action={
            <Row gap={8} wrap>
              {pick ? <Button size="sm" label={`펌프 ${pick.pump}에 장착하기`} icon={PackagePlus} onClick={() => open(pick.pump)} /> : null}
              <Button size="sm" variant="ghost" label="취소" icon={X} onClick={cancelSuggest} />
            </Row>
          }
        />
      ) : null}

      <Columns gap={16} className="ingredients-grid">
        {slots.map((s) => {
          const picked = !!pick && pick.pump === s.pump;
          return (
            <div key={s.pump} className={cx('ingredients-grid__cell', picked && 'is-picked')}>
              {picked ? <Badge tone="accent" icon={PackagePlus} label="추천 펌프" className="ingredients-grid__pickbadge" /> : null}
              <PumpCard slot={s} mlps={cal?.[s.pump - 1]} onPress={() => open(s.pump)} className={picked ? 'ingredients-pumpcard--picked' : undefined} />
            </div>
          );
        })}
      </Columns>

      <Card flat className="ingredients-note">
        <Info size={18} aria-hidden="true" className="ingredients-note__icon" />
        <div className="ingredients-note__text">
          <p>재료를 바꾸면 점도에 따라 나오는 속도가 달라질 수 있어요. 정확한 양을 원하면 기기 탭 &gt; 캘리브레이션을 해 주세요.</p>
          {info && info.pumps !== slots.length ? <p className="sb-num">기기 펌프 수: {info.pumps}개</p> : null}
        </div>
      </Card>
    </Page>
  );
}

function SummaryTile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={cx('ingredients-summary__tile', warn && 'is-warn')} role="listitem">
      <span className="ingredients-summary__label">{label}</span>
      <span className="ingredients-summary__value sb-num">{value}</span>
    </div>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function IngredientsScreen() {
  return (
    <ScreenBoundary name="ingredients">
      <IngredientsScreenContent />
    </ScreenBoundary>
  );
}
