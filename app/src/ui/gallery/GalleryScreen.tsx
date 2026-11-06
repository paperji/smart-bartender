/**
 * 숨은 화면 #/ui — UI 키트의 모든 컴포넌트를 모든 모양으로 보여 줌 (디자인 확인용, 메뉴에는 없음)
 */
import { Bell, Bluetooth, Candy, Citrus, Coffee, Droplets, Heart, KeyRound, Plus, Search, Sparkles, Trash2, Wine } from 'lucide-react';
import { useState } from 'react';

import {
  CalibrationBanner,
  CalibrationNotice,
  categoryIcon,
  colorFor,
  ColorProgress,
  ExploreCard,
  FlavorBars,
  PumpCard,
  PumpNumber,
  RecipeBar,
} from '@/components';
import { APP_NAME, APP_VERSION, OSS_NOTICES } from '@/lib/appInfo';
import { CATEGORY_INFO } from '@/lib/presets';
import { CATEGORIES, type ExploreItem, type PumpSlot, type Recipe } from '@/lib/types';

import { toast } from '@/store/toast';
import { withAiBusy } from '@/store/aiBusy';
import { ensureAdult } from '@/store/adultGate';
import { useSettings } from '@/store/settings';

import {
  AiLoading,
  alert,
  Badge,
  Banner,
  Button,
  Card,
  Chip,
  ChipGroup,
  Columns,
  confirm,
  DeviceChip,
  Divider,
  EmptyState,
  IconButton,
  ListRow,
  Modal,
  NumberStepper,
  Page,
  PageHeader,
  ProgressBar,
  Row,
  ScaleSelector,
  Section,
  SectionHeader,
  Segmented,
  Sheet,
  Slider,
  Spinner,
  Stack,
  Switch,
  Text,
  TextArea,
  TextField,
} from '..';
import { BrandMark } from '../BrandMark';

const MOODS = ['신나요', '피곤해요', '설레요', '차분해요', '우울해요'] as const;
type Mood = (typeof MOODS)[number];

/* ───── 도메인 컴포넌트 예시 데이터 (화면에 저장되지 않음) ───── */
const slot = (p: Partial<PumpSlot> & { pump: number }): PumpSlot => ({
  name: '',
  category: 'other',
  abv: 0,
  capacityMl: 1000,
  remainingMl: 0,
  color: '#9AA3B5',
  notes: '',
  updatedAt: 0,
  ...p,
});
const SAMPLE_SLOTS: PumpSlot[] = [
  slot({ pump: 1, name: '사이다', category: 'soda', capacityMl: 1000, remainingMl: 820, color: '#C9D6E8' }),
  slot({ pump: 2, name: '오렌지주스', category: 'juice', capacityMl: 1000, remainingMl: 120, color: '#FF9F43' }),
  slot({ pump: 3, name: '보드카', category: 'spirit', abv: 40, capacityMl: 700, remainingMl: 520, color: '#E3ECF5', needsCal: true }),
  slot({ pump: 4 }),
];
const FULL_SLOTS: PumpSlot[] = [
  ...SAMPLE_SLOTS.slice(0, 3),
  slot({ pump: 4, name: '콜라', category: 'soda', capacityMl: 1000, remainingMl: 640, color: '#B0794F' }),
];
const SAMPLE_RECIPE: Pick<Recipe, 'name' | 'ingredients' | 'flavor'> = {
  name: '스파클링 스크루드라이버',
  ingredients: [
    { pump: 3, name: '보드카', ml: 40 },
    { pump: 2, name: '오렌지주스', ml: 130 },
    { pump: 1, name: '사이다', ml: 30 },
  ],
  flavor: { sweet: 3, sour: 2, bitter: 1, fizzy: 2, strength: 2 },
};
const EXPLORE_EMPTY: ExploreItem = {
  addIngredient: '그레나딘시럽',
  category: 'syrup',
  abv: 0,
  recipeName: '선라이즈 에이드',
  description: '오렌지주스 아래로 그레나딘이 노을처럼 가라앉는 무알콜 에이드예요.',
  ingredients: [
    { name: '오렌지주스', ml: 140, installed: true, pump: 2 },
    { name: '사이다', ml: 40, installed: true, pump: 1 },
    { name: '그레나딘시럽', ml: 20, installed: false },
  ],
  message: '그레나딘시럽을 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요.',
};
const EXPLORE_TWO: ExploreItem = {
  addIngredient: '라임즙',
  category: 'juice',
  abv: 0,
  recipeName: '버진 모히토 쿨러',
  description: '라임의 산뜻함과 사이다의 탄산이 어울리는 청량한 한 잔이에요.',
  ingredients: [
    { name: '사이다', ml: 150, installed: true, pump: 1 },
    { name: '라임즙', ml: 30, installed: false },
    { name: '설탕시럽', ml: 20, installed: false },
  ],
  message: '라임즙과 설탕시럽만 있으면 모히토 느낌을 낼 수 있어요.',
};

export function GalleryScreen() {
  const [seg, setSeg] = useState<'gemini' | 'offline'>('gemini');
  const [single, setSingle] = useState<string | null>('맑음');
  const [multi, setMulti] = useState<Mood[]>(['신나요']);
  const [sweet, setSweet] = useState(3);
  const [sour, setSour] = useState(0);
  const [cup, setCup] = useState(200);
  const [slider, setSlider] = useState(40);
  const [text, setText] = useState('');
  const [area, setArea] = useState('땅콩 알레르기가 있어요');
  const [sw, setSw] = useState(true);
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <Page width="wide" header={<PageHeader title="UI 키트" subtitle="모든 컴포넌트·모양 모아 보기 (#/ui)" back actions={<DeviceChip />} />}>
      <Section title="글자" icon={Sparkles}>
        <Card>
          <Stack gap={6}>
            <Text variant="display">디스플레이 28px</Text>
            <Text variant="title">제목 22px</Text>
            <Text variant="heading">소제목 18px</Text>
            <Text>본문 15px — 기분과 취향을 고르면 AI 바텐더가 레시피를 만들어 드려요.</Text>
            <Text variant="label">라벨 14px</Text>
            <Text variant="caption">캡션 13px (보조 글)</Text>
            <Text variant="small" tone="muted">작은 글 12px (힌트)</Text>
            <Row wrap>
              {(['accent', 'success', 'warning', 'danger', 'info', 'secondary', 'muted'] as const).map((t) => (
                <Text key={t} tone={t} variant="label">
                  {t}
                </Text>
              ))}
              <Text numeric variant="label">
                123.4ml (tabular)
              </Text>
            </Row>
          </Stack>
        </Card>
      </Section>

      <Section title="버튼" icon={Sparkles} description="primary · secondary · ghost · danger / sm · md · lg / 아이콘 · 진행 중 · 꺼짐">
        <Card>
          <Stack gap={12}>
            {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
              <Row key={v} wrap>
                <Button variant={v} size="sm" label="작게" />
                <Button variant={v} label="보통" icon={Sparkles} />
                <Button variant={v} size="lg" label="크게" iconRight={Plus} />
                <Button variant={v} label="진행 중" loading />
                <Button variant={v} label="꺼짐" disabled />
              </Row>
            ))}
            <Button label="가로 꽉 채우기 (full)" full icon={Wine} size="lg" />
            <Row wrap>
              <IconButton icon={Search} label="검색" />
              <IconButton icon={Heart} label="즐겨찾기" variant="secondary" />
              <IconButton icon={Plus} label="추가" variant="primary" />
              <IconButton icon={Trash2} label="삭제" variant="danger" />
              <IconButton icon={Bell} label="알림" size="sm" badge={3} />
              <IconButton icon={Bluetooth} label="기기" size="lg" badge="!" variant="secondary" />
            </Row>
          </Stack>
        </Card>
      </Section>

      <Columns>
        <Section title="카드" icon={Sparkles}>
          <Stack>
            <Card>기본 카드 (흰 바탕)</Card>
            <Card tone="accent">accent — 강조 카드</Card>
            <Card tone="success">success</Card>
            <Card tone="warning">warning</Card>
            <Card tone="danger">danger</Card>
            <Card tone="info">info</Card>
            <Card dashed>dashed — 빈 슬롯</Card>
            <Card flat>flat — 카드 안 구역</Card>
            <Card onPress={() => toast('카드를 눌렀어요')} pressLabel="누를 수 있는 카드">
              누를 수 있는 카드 (Enter/Space)
            </Card>
          </Stack>
        </Section>
        <Section title="배지 · 배너" icon={Sparkles}>
          <Stack>
            <Row wrap>
              {(['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const).map((t) => (
                <Badge key={t} tone={t} label={t} icon={t === 'info' ? Sparkles : undefined} />
              ))}
            </Row>
            <Row wrap>
              {(['neutral', 'accent', 'success', 'warning', 'danger', 'info'] as const).map((t) => (
                <Badge key={t} tone={t} label={t} solid />
              ))}
            </Row>
            <Banner tone="info" title="알려 드려요" message="AI 키를 등록하면 Gemini 가 레시피를 만들어요." />
            <Banner tone="success" message="키가 확인됐어요." />
            <Banner tone="warning" title="캘리브레이션 전이에요" message="양이 조금 다를 수 있어요." action={{ label: '지금 하기', onClick: () => toast('이동') }} />
            <Banner tone="error" title="연결이 끊겼어요" message="기기 전원을 확인해 주세요." onClose={() => toast('닫기')} />
          </Stack>
        </Section>
      </Columns>

      <Section title="칩 · 세그먼트" icon={Sparkles}>
        <Card>
          <Stack gap={16}>
            <Row wrap>
              <Chip label="기본" />
              <Chip label="선택됨" selected />
              <Chip label="아이콘" icon={Coffee} />
              <Chip label="색 점" dotColor="#FF9F1C" />
              <Chip label="작게" size="sm" />
              <Chip label="꺼짐" disabled />
            </Row>
            <SectionHeader title="ChipGroup — 하나만" level={3} />
            <ChipGroup
              ariaLabel="날씨"
              value={single}
              onChange={setSingle}
              allowDeselect
              options={['맑음', '흐림', '비', '눈'].map((v) => ({ value: v, label: v }))}
            />
            <SectionHeader title="ChipGroup — 여러 개 (최대 3)" level={3} />
            <ChipGroup ariaLabel="기분" multiple max={3} value={multi} onChange={setMulti} options={MOODS.map((v) => ({ value: v, label: v }))} />
            <Segmented
              ariaLabel="AI 방식"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'gemini', label: 'Gemini (내 키)', icon: KeyRound },
                { value: 'offline', label: '오프라인' },
              ]}
            />
            <Segmented
              ariaLabel="작은 세그먼트"
              size="sm"
              full={false}
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'gemini', label: 'Gemini' },
                { value: 'offline', label: '오프라인' },
              ]}
            />
          </Stack>
        </Card>
      </Section>

      <Columns>
        <Section title="맛 단계 · 슬라이더 · 스테퍼" icon={Sparkles}>
          <Card>
            <Stack gap={16}>
              <ScaleSelector label="단맛" icon={Candy} value={sweet} onChange={setSweet} />
              <ScaleSelector label="신맛" icon={Citrus} value={sour} onChange={setSour} color="#1E9E6A" />
              <ScaleSelector label="꺼짐" value={2} onChange={() => undefined} disabled />
              <Slider label="잔 용량" value={slider} onChange={setSlider} min={30} max={500} step={10} unit="ml" marks={[{ value: 30, label: '30' }, { value: 500, label: '500' }]} />
              <NumberStepper label="잔 용량" showLabel value={cup} onChange={setCup} min={30} max={500} step={10} unit="ml" presets={[150, 200, 250, 300]} />
            </Stack>
          </Card>
        </Section>
        <Section title="입력 · 스위치" icon={Sparkles}>
          <Card>
            <Stack gap={16}>
              <TextField label="Gemini API 키" value={text} onChange={setText} placeholder="AQ.… 또는 AIza…" icon={KeyRound} hint="마지막 4자리만 보여요." autoComplete="off" />
              <TextField label="오류 예" value="abc" onChange={() => undefined} error="API 키 형식이 올바르지 않아요." />
              <TextField label="단위" value="200" onChange={() => undefined} inputMode="numeric" trailing="ml" />
              <TextArea label="성향" value={area} onChange={setArea} maxLength={300} counter hint="알레르기·싫어하는 재료를 적으면 빼고 만들어요." />
              <Switch label="자동 재연결" description="앱을 켜면 마지막 기기에 다시 연결해요." icon={Bluetooth} checked={sw} onChange={setSw} />
              <Switch label="꺼진 스위치" checked={false} onChange={() => undefined} disabled />
              <Row>
                <Switch ariaLabel="이름 없는 스위치" checked={sw} onChange={setSw} />
                <Text variant="caption">이름 없이 (ariaLabel)</Text>
              </Row>
            </Stack>
          </Card>
        </Section>
      </Columns>

      <Columns>
        <Section title="진행 · 로딩" icon={Sparkles}>
          <Card>
            <Stack gap={16}>
              <ProgressBar value={0.35} label="펌프 1" showValue />
              <ProgressBar value={1} tone="success" label="완료" showValue />
              <ProgressBar value={0.6} tone="warning" ariaLabel="노랑" />
              <ProgressBar value={0.2} tone="danger" height={12} ariaLabel="빨강" />
              <ProgressBar indeterminate label="확인 중" />
              <Row>
                <Spinner />
                <Spinner size={28} color="var(--accent)" />
                <Text variant="caption">Spinner</Text>
              </Row>
              <AiLoading title="AI 바텐더가 레시피를 고민 중이에요" lines={['기분과 취향을 분석하고 있어요', '황금 비율을 계산하고 있어요']} />
              <Button
                variant="secondary"
                label="전체 화면 AI 로딩 3초"
                onClick={() => void withAiBusy(() => new Promise((r) => setTimeout(r, 3000)))}
              />
            </Stack>
          </Card>
        </Section>
        <Section title="목록 · 빈 상태" icon={Sparkles}>
          <Card>
            <ListRow title="AI 키" subtitle="••••••••AbCd" icon={KeyRound} onClick={() => toast('행을 눌렀어요')} />
            <ListRow title="배출 모드" trailing={<Badge tone="accent" label="순차" />} icon={Droplets} />
            <ListRow title="알림" trailing={<Switch ariaLabel="알림" checked={sw} onChange={setSw} />} icon={Bell} chevron={false} />
            <ListRow title="모든 데이터 초기화" icon={Trash2} danger onClick={() => toast('초기화')} />
          </Card>
          <Card>
            <EmptyState icon={Wine} title="아직 기록이 없어요" message="첫 칵테일을 만들어 보세요." action={<Button label="바텐더로" size="sm" />} />
          </Card>
        </Section>
      </Columns>

      <Section title="창 · 알림" icon={Sparkles} description="Modal · Sheet · confirm · alert · 토스트 · 성인 확인">
        <Card>
          <Row wrap>
            <Button variant="secondary" label="모달" onClick={() => setModal(true)} />
            <Button variant="secondary" label="시트" onClick={() => setSheet(true)} />
            <Button
              variant="secondary"
              label="확인창"
              onClick={async () => toast((await confirm('데이터 초기화', '되돌릴 수 없어요. 계속할까요?', { confirmText: '모두 초기화', destructive: true })) ? '확인' : '취소')}
            />
            <Button variant="secondary" label="안내창" onClick={() => void alert('레시피를 만들지 못했어요', '장착된 재료가 없어요.', { tone: 'warning' })} />
            <Button variant="secondary" label="토스트 info" onClick={() => toast('알려 드려요', 'info')} />
            <Button variant="secondary" label="토스트 success" onClick={() => toast('저장했어요', 'success')} />
            <Button variant="secondary" label="토스트 warning" onClick={() => toast('잔량이 얼마 남지 않았어요.', 'warning')} />
            <Button variant="secondary" label="토스트 error" onClick={() => toast('연결하지 못했어요', 'error')} />
            <Button
              variant="secondary"
              label="성인 확인"
              onClick={async () => {
                useSettings.getState().set({ adultVerifiedAt: null });
                toast((await ensureAdult()) ? '성인 확인됨' : '확인 안 함');
              }}
            />
            <Button
              variant="ghost"
              label={loading ? '진행 중…' : '버튼 진행 중 2초'}
              loading={loading}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 2000);
              }}
            />
          </Row>
        </Card>
      </Section>

      <Section title="기타" icon={Sparkles}>
        <Card>
          <Row wrap gap={16}>
            <BrandMark size={48} />
            <DeviceChip />
            <DeviceChip compact />
          </Row>
          <Divider />
          <Text variant="caption">Divider 위아래</Text>
        </Card>
      </Section>

      <Section
        title="도메인 컴포넌트"
        icon={Wine}
        description="src/components — 레시피·펌프 전용 조각 (사용법: src/components/README.md). 아래 값은 예시 데이터예요.">
        <Columns>
          <Card>
            <Stack gap={16}>
              <SectionHeader title={`RecipeBar — ${SAMPLE_RECIPE.name}`} level={3} />
              <RecipeBar ingredients={SAMPLE_RECIPE.ingredients} slots={SAMPLE_SLOTS} height={22} legend={false} />
              <RecipeBar ingredients={SAMPLE_RECIPE.ingredients} slots={SAMPLE_SLOTS} />
              <RecipeBar ingredients={SAMPLE_RECIPE.ingredients} slots={SAMPLE_SLOTS} height={12} />
              <SectionHeader title="ColorProgress — 재료 색 진행 막대" level={3} />
              {SAMPLE_RECIPE.ingredients.map((i, idx) => (
                <ColorProgress
                  key={i.pump}
                  value={[1, 0.62, 0.15][idx]}
                  color={idx === 0 ? 'var(--green)' : colorFor(i.pump, SAMPLE_SLOTS)}
                  label={`펌프 ${i.pump} · ${i.name}`}
                  valueText={`${Math.round(i.ml * [1, 0.62, 0.15][idx])} / ${i.ml}ml`}
                />
              ))}
            </Stack>
          </Card>
          <Card>
            <Stack gap={16}>
              <SectionHeader title="FlavorBars — 맛 프로필" level={3} />
              <FlavorBars flavor={SAMPLE_RECIPE.flavor} />
              <SectionHeader title="PumpNumber · 재료 종류 아이콘" level={3} />
              <Row wrap gap={12}>
                {FULL_SLOTS.map((s) => (
                  <PumpNumber key={s.pump} n={s.pump} color={s.color} />
                ))}
                <PumpNumber n={5} color="var(--border-strong)" />
                <PumpNumber n={2} color="#FF9F43" size={52} />
              </Row>
              <Row wrap>
                {CATEGORIES.map((c) => (
                  <Badge key={c} icon={categoryIcon(c)} label={CATEGORY_INFO[c].label} />
                ))}
              </Row>
            </Stack>
          </Card>
        </Columns>

        <SectionHeader title="PumpCard — 보통 · 잔량 부족 · 캘리브레이션 권장 · 비어 있음" level={3} />
        <Columns>
          {SAMPLE_SLOTS.map((s) => (
            <PumpCard key={s.pump} slot={s} mlps={s.pump === 1 ? 4.2 : undefined} onPress={() => toast(`펌프 ${s.pump} 편집 (예시)`)} />
          ))}
        </Columns>

        <SectionHeader title="ExploreCard — 빈 펌프 추천 · 가장 적게 쓴 펌프 추천(재료 2개 필요)" level={3} />
        <Columns>
          <ExploreCard item={EXPLORE_EMPTY} slots={SAMPLE_SLOTS} entries={[]} onInstall={(it, pick) => toast(`${it.addIngredient} → 펌프 ${pick.pump} 장착 화면 (예시)`)} />
          <ExploreCard item={EXPLORE_TWO} slots={FULL_SLOTS} entries={[]} compact onInstall={(it, pick) => toast(`${it.addIngredient} → 펌프 ${pick.pump} 장착 화면 (예시)`)} />
        </Columns>

        <SectionHeader title="CalibrationBanner" level={3} />
        <Stack>
          <CalibrationNotice pumps={[2, 3]} onCalibrate={() => toast('캘리브레이션 마법사로 (예시)')} onDismiss={() => toast('나중에 (예시)')} />
          <Text variant="caption">
            아래는 실제 기기 상태로 그린 배너예요. 기기가 연결돼 있고 측정 안 한 펌프가 있을 때만 보여요(없으면 아무것도 안 그림).
          </Text>
          <CalibrationBanner dismissible={false} />
        </Stack>

        <Card flat>
          <Text variant="label">
            {APP_NAME} v{APP_VERSION}
          </Text>
          <Text variant="caption">오픈소스: {OSS_NOTICES.map((o) => `${o.name} (${o.license})`).join(' · ')}</Text>
        </Card>
      </Section>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="모달 제목"
        description="설명 한 줄"
        footer={
          <>
            <Button variant="secondary" label="취소" onClick={() => setModal(false)} />
            <Button label="확인" onClick={() => setModal(false)} />
          </>
        }>
        <Text>모달 본문이에요. Esc·바깥 누름·X 로 닫혀요. Tab 은 창 안에서만 돌아요.</Text>
      </Modal>
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="시트"
        footer={<Button label="닫기" full onClick={() => setSheet(false)} />}>
        <Stack>
          <Text>모바일에서는 아래에서 올라오고, PC 에서는 가운데 창이에요.</Text>
          <TextField label="입력" value={text} onChange={setText} />
        </Stack>
      </Sheet>
    </Page>
  );
}
