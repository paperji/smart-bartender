/**
 * 재료 편집 — 이름·종류·도수·용량·잔량·색상·메모, 프리셋 빠른 선택(이름 칸으로 검색), 가득 채움/비우기, 재료 빼기
 * (v2.1 src/app/ingredient-edit.tsx — 주소 #/ingredients/:pump?suggest=…&category=…&abv=…&from=explore&done=a|b)
 * 탐색 카드에서 열리면(from=explore) 이름·카테고리·도수를 미리 채우고,
 * 저장하면 그 레시피를 normal 모드로 다시 추천받아 레시피 화면으로 이동 (SPEC §5.4)
 *  - 빈 기기 탐색처럼 새 재료가 2개인 카드는, 첫 재료를 저장하면 남은 재료 장착 화면을 이어서 열고
 *    모두 장착된 뒤에 재추천 (1개만으로는 레시피가 성립하지 않음)
 * 술 종류(증류주·리큐르·와인)나 술 이름(프리셋 정확 일치)인데 도수 0% 이면 저장 전에 확인
 *  (도수 0% 술은 무알콜 레시피에 들어가고 성인 확인도 건너뛰기 때문)
 * PC(≥900px): 왼쪽 = 빠른 선택·이름·종류·도수, 오른쪽 = 용량·남은 양·색상·메모
 */
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Compass,
  Droplet,
  Droplets,
  Gauge,
  Trash2,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router';

import { calibratePath, categoryIcon, ColorProgress, edgeColor, isLightColor, PumpNumber, ScreenBoundary } from '@/components';
import { nameKey, pumpUsage, recommendPump, remainingToInstall } from '@/lib/ai/explore';
import { josa } from '@/lib/ai/normalize';
import { openInstall, recommendAfterInstall } from '@/lib/flow';
import { fmtMl } from '@/lib/format';
import { back, dismissTo, go } from '@/lib/nav';
import { CATEGORY_INFO, emptySlot, findExactPreset, INGREDIENT_COLORS, PRESETS, type IngredientPreset } from '@/lib/presets';
import { CATEGORIES, type Category } from '@/lib/types';
import { haptic } from '@/platform/haptics';
import { useDevice } from '@/store/device';
import { useSession } from '@/store/draft';
import { useHistory } from '@/store/history';
import { useSlots } from '@/store/slots';
import { toast } from '@/store/toast';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  Columns,
  confirm,
  cx,
  EmptyState,
  NumberStepper,
  Page,
  PageHeader,
  Row,
  Section,
  Stack,
  Text,
  TextField,
} from '@/ui';

import {
  ABV_STEPPER,
  abvForCategoryChange,
  alcoholZeroCheck,
  CAPACITY_STEPPER,
  clampAbv,
  COLOR_NAMES,
  doneKeysOf,
  filterPresets,
  initialForm,
  isMaterialChanged,
  looksAlcoholic,
  REMAINING_STEP,
} from './logic';

import './ingredients.css';

/** #/ingredients/:pump — 펌프가 없으면 안내, 있으면 편집 폼 (주소가 바뀌면 폼을 새로 만듦: 다음 재료 장착 화면으로 넘어갈 때·주소창에서 펌프 번호를 바꿨을 때 첫 값 다시 계산) */
function IngredientEditScreenContent() {
  const { pump: pumpParam } = useParams();
  const location = useLocation();
  const pump = Number(pumpParam);
  const exists = useSlots((s) => s.slots.some((x) => x.pump === pump));
  if (!Number.isInteger(pump) || !exists) {
    return (
      <Page width="narrow" header={<PageHeader title="재료 설정" back="/ingredients" />}>
        <EmptyState
          icon={CircleAlert}
          title="펌프를 찾을 수 없어요"
          action={<Button label="닫기" variant="secondary" onClick={() => back('/ingredients')} />}
        />
      </Page>
    );
  }
  // 주소창에서 펌프 번호·쿼리만 바꾸면(react-router 밖의 이동) location.key 가 그대로라서 펌프·쿼리도 key 에 넣음
  return <IngredientEditForm key={`${pump}|${location.search}|${location.key}`} pump={pump} />;
}

function IngredientEditForm({ pump }: { pump: number }) {
  const [params] = useSearchParams();
  const q = {
    suggest: params.get('suggest'),
    category: params.get('category'),
    abv: params.get('abv'),
    from: params.get('from'),
    done: params.get('done'),
  };
  const fromExplore = q.from === 'explore';
  // 바깥(IngredientEditScreen)이 펌프가 있을 때만 그리지만, 사라지는 순간에도 깨지지 않게 빈 슬롯으로 대신
  const found = useSlots((s) => s.slots.find((x) => x.pump === pump));
  const slot = found ?? emptySlot(pump);
  const allSlots = useSlots((s) => s.slots);
  const updateSlot = useSlots((s) => s.updateSlot);
  const clearSlot = useSlots((s) => s.clearSlot);
  const installTarget = useSession((s) => s.installTarget);
  const mlps = useDevice((s) => s.cal?.[pump - 1] ?? null);

  // 첫 값은 화면을 열 때 한 번만 (v2.1 useMemo [])
  const [initial] = useState(() => initialForm(slot, q));
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<Category>(initial.category);
  const [abv, setAbv] = useState(initial.abv);
  const [color, setColor] = useState(initial.color);
  const [capacityMl, setCapacity] = useState(initial.capacityMl);
  const [remainingMl, setRemaining] = useState(initial.remainingMl);
  const [notes, setNotes] = useState(initial.notes);
  const [showAllPresets, setShowAllPresets] = useState(false);
  const [saving, setSaving] = useState(false);

  const presets = useMemo(() => filterPresets(name, initial.name, showAllPresets), [name, showAllPresets, initial.name]);

  const exploreFlow = fromExplore && !!installTarget;
  const materialChanged = isMaterialChanged(slot, name, category);
  /** 탐색 카드의 재료 중 이 화면에서 넣는 것 말고도 아직 장착해야 하는 재료 */
  const othersToInstall =
    fromExplore && installTarget ? remainingToInstall(installTarget, allSlots).filter((x) => nameKey(x) !== nameKey(name.trim())) : [];
  const ratio = remainingMl / Math.max(1, capacityMl);
  const swatches = INGREDIENT_COLORS.includes(color) ? INGREDIENT_COLORS : [color, ...INGREDIENT_COLORS];

  const applyPreset = (p: IngredientPreset) => {
    setName(p.name);
    setCategory(p.category);
    setAbv(p.abv);
    setColor(p.color);
  };

  const changeCategory = (c: Category | null) => {
    if (!c) return;
    // 술 종류로 바꿨는데 도수가 0 → 기본 도수 (증류주 40 · 리큐르 20 · 와인 12), 술이 아닌 종류로 바꾸면 0
    setAbv(abvForCategoryChange(category, c, abv));
    setCategory(c);
  };

  const changeCapacity = (v: number) => {
    setCapacity(v);
    if (remainingMl > v) setRemaining(v);
  };

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast('재료 이름을 입력해 주세요.', 'warning');
      return;
    }
    const abvToSave = clampAbv(abv);
    // 술 종류이거나 술 이름(프리셋 정확 일치)인데 도수 0% → 무알콜 레시피에 들어가고 성인 확인도 건너뜀 → 확인 받기
    const check = alcoholZeroCheck(n, category, abvToSave);
    if (check) {
      const ok = await confirm(check.title, check.message, { confirmText: '네, 무알콜이에요', cancelText: '도수 고치기', tone: 'warning' });
      if (!ok) {
        // 고치기 쉽게 도수를 미리 채워 둠 (프리셋 도수 → 종류 기본 도수)
        if (check.fix) setAbv(check.fix);
        toast('도수를 확인한 뒤 다시 저장해 주세요.', 'info');
        return;
      }
    }
    updateSlot(pump, {
      name: n.slice(0, 20),
      category,
      abv: abvToSave,
      color,
      capacityMl,
      remainingMl: Math.min(remainingMl, capacityMl),
      notes: notes.trim().slice(0, 80),
      ...(slot.name ? {} : { needsCal: false }),
    });
    haptic.success();
    toast(`펌프 ${pump}에 ${josa(n, '을', '를')} 저장했어요.`, 'success');

    const target = useSession.getState().installTarget;
    if (fromExplore && target) {
      // 새 재료가 2개인 카드(빈 기기 탐색): 남은 재료가 있으면 그 장착 화면을 이어서 엶 (재추천은 모두 장착한 뒤)
      const slotsNow = useSlots.getState().slots;
      // 앞 단계와 이 화면에서 넣기로 한 재료는 (사용자가 이름을 바꿔 저장했더라도) 장착한 것으로 봄 → 같은 재료를 다시 묻지 않음
      const doneKeys = doneKeysOf(q.done, q.suggest, n);
      const left = remainingToInstall(target, slotsNow).filter((x) => !doneKeys.has(nameKey(x)));
      if (left.length) {
        const next = left[0];
        const used = new Set(target.ingredients.map((i) => nameKey(i.name)));
        const exclude = new Set<number>([pump, ...slotsNow.filter((x) => x.name && used.has(nameKey(x.name))).map((x) => x.pump)]);
        const pick = recommendPump(slotsNow, pumpUsage(slotsNow, useHistory.getState().entries), target, exclude);
        if (pick) {
          const p = findExactPreset(next);
          openInstall(target, pick, {
            replace: true,
            ingredient: { name: next, category: p?.category ?? 'other', abv: p?.abv ?? 0 },
            done: Array.from(doneKeys),
            // 카드가 나온 요청의 입력값을 다음 장착 화면까지 그대로 넘김
            input: useSession.getState().installInput,
          });
          setTimeout(() => toast(`이어서 ${josa(next, '을', '를')} 펌프 ${pick.pump}에 장착해 주세요.`, 'info'), 600);
          return;
        }
        // 남은 재료를 넣을 펌프가 없음 → 지금 재료로 다시 추천 (아래)
      }
      // 장착 완료 → 해당 레시피를 normal 모드로 다시 추천 (SPEC §5.4) — 카드가 나온 요청의 입력값으로 (lib/flow)
      setSaving(true);
      const res = await recommendAfterInstall();
      setSaving(false);
      if (res) {
        // v2.1 router.dismissTo('/recipe') — 앞 기록에 레시피 화면이 있으면 그리로 돌아가고(탐색·편집 화면은 닫힘), 없으면 편집 화면 자리를 레시피로
        dismissTo('/recipe');
        if (materialChanged || slot.name) {
          setTimeout(() => toast(`재료가 바뀌었어요. 정확한 양을 위해 기기 탭에서 펌프 ${pump} 프라이밍·캘리브레이션을 권장해요.`, 'info'), 3000);
        }
      }
      return;
    }

    back('/ingredients');
    if (materialChanged) {
      const goCal = await confirm(
        '캘리브레이션을 권장해요',
        `재료가 바뀌었어요. 액체의 점도에 따라 나오는 양이 달라질 수 있어서 펌프 ${pump} 캘리브레이션을 권장해요. 지금 할까요?`,
        { confirmText: '캘리브레이션 하기', cancelText: '나중에', tone: 'info' },
      );
      if (goCal) go(calibratePath(pump));
    }
  };

  const remove = async () => {
    const ok = await confirm('재료 빼기', `펌프 ${pump}번을 빈 슬롯으로 만들까요? (레시피에 쓰이지 않게 돼요)`, {
      confirmText: '빼기',
      destructive: true,
    });
    if (!ok) return;
    clearSlot(pump);
    toast(`펌프 ${pump}번을 비웠어요.`, 'success');
    back('/ingredients');
  };

  const displayName = name.trim() || '새 재료';

  return (
    <Page
      width="wide"
      header={<PageHeader title={`펌프 ${pump} 재료 설정`} back="/ingredients" />}
      footer={
        <div className="ingredients-edit__footer">
          <Button variant="secondary" label="취소" onClick={() => back('/ingredients')} className="ingredients-edit__cancel" />
          <Button
            icon={Check}
            label={exploreFlow ? '저장하고 추천받기' : '저장'}
            onClick={save}
            loading={saving}
            disabled={!name.trim() || saving}
            className="ingredients-edit__save"
          />
        </div>
      }>
      {fromExplore ? (
        <Card tone="accent" className="ingredients-explore" role="status">
          <Compass size={20} aria-hidden="true" className="ingredients-explore__icon" />
          <div className="ingredients-explore__body">
            <p className="ingredients-explore__title">새 재료 장착하기</p>
            <p className="ingredients-explore__msg">
              {(slot.name
                ? `펌프 ${pump}의 ${slot.name} 대신 ${josa(displayName, '을', '를')} 넣어요. 실제 용기를 바꿔 끼운 뒤 저장하세요.`
                : `비어 있는 펌프 ${pump}에 ${josa(displayName, '을', '를')} 넣어요. 용기를 끼운 뒤 저장하세요.`) +
                (othersToInstall.length
                  ? ` 이 레시피는 ${othersToInstall.join(', ')}도 필요해서, 저장하면 다음 재료 장착 화면이 이어서 열려요.`
                  : '')}
            </p>
          </div>
        </Card>
      ) : null}

      <Row gap={12} className="ingredients-edit__head">
        <PumpNumber n={pump} color={color} size={52} />
        <div className="ingredients-edit__headtext">
          <Text variant="title" as="p" truncate>
            {displayName}
          </Text>
          <Text variant="caption" tone="muted" numeric>
            {CATEGORY_INFO[category].label} · {abv > 0 ? `${abv}%` : '무알콜'} · {fmtMl(remainingMl)} 남음
          </Text>
        </div>
      </Row>

      <Columns gap={24} className="ingredients-edit__cols">
        <Stack gap={24}>
          <Section title="빠른 선택" description="누르면 이름·종류·도수·색이 자동으로 채워져요" icon={Zap}>
            {presets.list.length ? (
              <div className="ingredients-presets" role="group" aria-label="재료 프리셋">
                {presets.list.map((p) => (
                  <Chip key={p.name} size="sm" label={p.name} dotColor={p.color} selected={p.name === name.trim()} onClick={() => applyPreset(p)} />
                ))}
              </div>
            ) : (
              <Text variant="caption" tone="muted">
                {`'${name.trim()}'와(과) 맞는 프리셋이 없어요. 입력한 이름 그대로 저장돼요.`}
              </Text>
            )}
            {!presets.searching ? (
              <Button
                size="sm"
                variant="ghost"
                label={showAllPresets ? '접기' : `전체 보기 (${PRESETS.length}개)`}
                iconRight={showAllPresets ? ChevronUp : ChevronDown}
                onClick={() => setShowAllPresets((v) => !v)}
                aria-expanded={showAllPresets}
                className="ingredients-edit__more"
              />
            ) : null}
          </Section>

          <TextField
            label="재료 이름"
            placeholder="예: 오렌지주스"
            value={name}
            onChange={setName}
            maxLength={20}
            counter
            autoComplete="off"
            enterKeyHint="done"
            hint="입력하면 위 빠른 선택에서 비슷한 재료를 찾아 줘요."
          />

          <Section title="종류">
            <ChipGroup
              ariaLabel="재료 종류"
              value={category}
              onChange={changeCategory}
              options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_INFO[c].label, icon: categoryIcon(c) }))}
            />
          </Section>

          <Section title="알코올 도수" description="무알콜 음료는 0%">
            <NumberStepper
              label="알코올 도수"
              value={abv}
              onChange={setAbv}
              min={ABV_STEPPER.min}
              max={ABV_STEPPER.max}
              step={ABV_STEPPER.step}
              unit="%"
              presets={ABV_STEPPER.presets}
            />
            {abv > 0 ? (
              <Text variant="caption" tone="warning">
                주류가 장착되면 제조 전에 성인 확인을 해요.
              </Text>
            ) : looksAlcoholic(name, category) ? (
              <Text variant="caption" tone="danger">
                술인데 도수가 0%예요. 0%로 두면 무알콜 레시피에 들어가요.
              </Text>
            ) : null}
          </Section>
        </Stack>

        <Stack gap={24}>
          <Section title="용기 용량">
            <NumberStepper
              label="용기 용량"
              value={capacityMl}
              onChange={changeCapacity}
              min={CAPACITY_STEPPER.min}
              max={CAPACITY_STEPPER.max}
              step={CAPACITY_STEPPER.step}
              unit="ml"
              presets={CAPACITY_STEPPER.presets}
            />
          </Section>

          <Section title="남은 양" description="제조할 때마다 자동으로 줄어들어요">
            <Card className="ingredients-edit__stock">
              <Row justify="space-between">
                <Text variant="heading" numeric>
                  {fmtMl(remainingMl)}
                </Text>
                <Text variant="label" tone="muted" numeric>
                  {Math.round(ratio * 100)}%
                </Text>
              </Row>
              <ColorProgress value={ratio} color={color} height={12} ariaLabel="남은 양" />
              <NumberStepper label="남은 양" value={remainingMl} onChange={setRemaining} min={0} max={capacityMl} step={REMAINING_STEP} unit="ml" />
              <div className="ingredients-edit__fill">
                <Button variant="secondary" icon={Droplets} label="가득 채움" onClick={() => setRemaining(capacityMl)} />
                <Button variant="ghost" icon={Droplet} label="비우기 (0ml)" onClick={() => setRemaining(0)} />
              </div>
            </Card>
          </Section>

          <Section title="표시 색상" description="레시피 비율 막대와 진행 화면에 쓰여요">
            <div className="ingredients-swatches" role="group" aria-label="표시 색상">
              {swatches.map((c) => {
                const selected = c === color;
                const cname = COLOR_NAMES[c] ?? (INGREDIENT_COLORS.includes(c) ? c : '지금 색');
                return (
                  <button
                    key={c}
                    type="button"
                    className={cx('ingredients-swatch', selected && 'is-selected')}
                    aria-label={`색상 ${cname}`}
                    aria-pressed={selected}
                    title={cname}
                    style={{ backgroundColor: c, borderColor: edgeColor(c) }}
                    onClick={() => {
                      haptic.tap();
                      setColor(c);
                    }}>
                    {selected ? <Check size={20} aria-hidden="true" color={isLightColor(c) ? 'var(--text)' : '#fff'} /> : null}
                  </button>
                );
              })}
            </div>
          </Section>

          <TextField label="메모 (선택)" placeholder="예: 무가당, 냉장 보관" value={notes} onChange={setNotes} maxLength={80} autoComplete="off" />

          {materialChanged ? (
            <Card tone="info" className="ingredients-flow" role="status">
              <Gauge size={18} aria-hidden="true" className="ingredients-flow__icon is-info" />
              <p className="ingredients-flow__text">
                재료가 바뀌면 이 펌프 캘리브레이션을 권장해요. 저장 후 안내해 드릴게요.
                {mlps ? <span className="sb-num">{` (지금 유량 ${mlps} ml/s)`}</span> : null}
              </p>
            </Card>
          ) : (
            <Card flat className="ingredients-flow">
              <Gauge size={18} aria-hidden="true" className="ingredients-flow__icon" />
              <p className="ingredients-flow__text">
                {mlps ? (
                  <>
                    이 펌프 유량: <span className="sb-num">{mlps} ml/s</span>.{' '}
                  </>
                ) : null}
                재료를 바꾸면 점도에 따라 나오는 속도가 달라질 수 있어요. 정확한 양을 원하면 기기 탭 &gt; 캘리브레이션을 해 주세요.
              </p>
            </Card>
          )}

          {slot.name ? <Button variant="ghost" icon={Trash2} label="이 펌프에서 재료 빼기" onClick={remove} className="ingredients-edit__remove" /> : null}
        </Stack>
      </Columns>
    </Page>
  );
}

/** 화면을 그리다 오류가 나도 앱 전체가 하얀 화면으로 멈추지 않게 복구 카드로 (components/ErrorBoundary) */
export function IngredientEditScreen() {
  return (
    <ScreenBoundary name="ingredient-edit">
      <IngredientEditScreenContent />
    </ScreenBoundary>
  );
}
