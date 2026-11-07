# 공용 도메인 컴포넌트 (`src/components/`) — 화면 작업자용 안내

여러 화면이 같이 쓰는 **칵테일·펌프 전용 조각**입니다(v2.1 `src/components/{RecipeBar,FlavorBars,ExploreCard,PumpCard,CalibrationBanner}.tsx` 를 밝은 톤으로 옮김). 기능·문구는 v2.1 과 같습니다. 일반 UI(버튼·카드·배너…)는 `src/ui` 키트(`src/ui/README.md`)를 쓰세요.

```tsx
import { CalibrationBanner, ExploreCard, FlavorBars, PumpCard, PumpNumber, RecipeBar, colorFor } from '@/components';
```

- 화면 폴더에서는 **가져다 쓰기만** 하고 이 폴더는 고치지 마세요(필요하면 보고). 모든 모양은 `#/ui` 맨 아래 **"도메인 컴포넌트"** 에서 예시 데이터로 볼 수 있어요.
- 클래스는 `dc-` 로 시작(이 폴더 전용 — 화면 CSS 에서 덮어쓰지 않기). 바깥 여백·배치는 화면이 `className` 이나 감싸는 `Stack`/`Columns` 로 정하세요.
- 재료 색은 사용자가 고른 `#RRGGBB` 라서 우유·탄산수처럼 아주 옅을 수 있어요. 컴포넌트가 점·막대에 옅은 테두리를 넣고, 진행 막대·펌프 번호 테두리는 자동으로 조금 진하게 그려요(`edgeColor`).

## 어디서 쓰나 (v2.1 과 같음)

| 컴포넌트 | 화면 |
|---|---|
| `RecipeBar` | 추천 레시피(`height={22} legend={false}`), 기록·즐겨찾기 카드(`height={12}`) |
| `colorFor` | 추천 레시피 재료 줄의 색 점, 제조 진행 펌프별 색(점·`ColorProgress`) |
| `FlavorBars` | 추천 레시피 "맛 프로필" |
| `ExploreCard` | 새 재료 탐색(전체 카드), 추천 레시피 안 "새 재료로 이런 것도 만들 수 있어요"(`compact`) |
| `PumpCard` | 재료 목록 |
| `PumpNumber` | 캘리브레이션 펌프 고르기(44), 재료 편집 머리(`size={52}`) |
| `CalibrationBanner` | 바텐더 홈(`<CalibrationBanner />`), 기기 화면(`<CalibrationBanner dismissible={false} />`) |
| `ColorProgress` | 펌프 잔량(PumpCard 안), 제조 중 펌프별 진행 |
| `categoryIcon` | 재료 종류 아이콘(재료 목록·편집의 종류 칩 등) |

---

## `RecipeBar`
재료 비율 스택 막대 + 범례(● 이름 25%). 비율 = `Math.round(ml / 합계 × 100)`.

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `ingredients` | `{ pump, name, ml }[]` (`RecipeIngredient[]`) | – | 순서대로 왼쪽부터 칠함. ml 0 인 줄은 막대에서 빠짐(범례에는 0%) |
| `slots` | `PumpSlot[]` | – | 색을 펌프 번호로 찾음 (`useSlots((s) => s.slots)`) |
| `height` | number | 18 | 막대 두께 px. 레시피 22, 기록 12 |
| `legend` | boolean | true | 범례 표시. `false` 면 막대 자체가 `role="img"` + `aria-label="재료 비율: 보드카 20%, …"` |
| `className` | string | – | |

```tsx
const slots = useSlots((s) => s.slots);
<RecipeBar ingredients={r.ingredients} slots={slots} height={22} legend={false} />   // 추천 레시피
<RecipeBar ingredients={entry.recipe.ingredients} slots={slots} height={12} />         // 기록·즐겨찾기
```

### `colorFor(pump, slots)` → string
펌프 재료 색(`#RRGGBB`), 펌프·색이 없으면 회색 `FALLBACK_COLOR`(`#9AA0A8`). v2.1 `colorFor` 와 같음.

```tsx
<span className="dc-dot" style={{ backgroundColor: colorFor(i.pump, slots) }} aria-hidden="true" />  // 10px 동그란 색 점(옅은 테두리 포함)
```

### 색 도우미 (같이 export)
- `edgeColor(color)` — 옅은 색이면 30% 어둡게(테두리·막대용), 아니면 그대로.
- `withAlpha(color, 0~1)` — `#RRGGBB` → `rgba(…)`, 그 밖은 `color-mix`.
- `isLightColor(color)`, `luminance(color)` — 휘도(WCAG) 판정.
- `sharePct(ml, total)` — 비율 %(정수, v2.1 과 같은 반올림, total 0 이면 1로 나눔).

## `FlavorBars`
맛 프로필 5줄(단맛·신맛·쓴맛·탄산·도수), 줄마다 칸 5개 + 숫자. 값은 0~5 로 자름(빠진 값·NaN 은 0). 화면 읽기: "단맛 3점".

| prop | 타입 | 설명 |
|---|---|---|
| `flavor` | `Partial<Flavor>` (`{ sweet, sour, bitter, fizzy, strength }`) | 레시피 `r.flavor` |
| `className` | string | |

```tsx
<Section title="맛 프로필" icon={PieChart}>
  <Card><FlavorBars flavor={r.flavor} /></Card>
</Section>
```
`FLAVOR_ITEMS`(키·이름·색 목록)도 export — 범례가 따로 필요할 때.

## `ExploreCard`
탐색 카드 — "이 재료를 장착하면 이런 레시피를 만들 수 있어요"(SPEC §5.4). 새 재료 배지·이름·종류/도수, 레시피 이름(`h3`)·설명, 재료 줄(미장착 재료는 당근색 점선 강조, `펌프 N · 장착됨 · 25%` / `미장착 · 새로 넣어야 해요 · 25%`, ml), 메시지, **[펌프 N에 장착하기]** + 이유 문구, 새로 넣을 재료가 2개 이상이면 노란 안내 문구.
펌프 고르기는 v2.1 과 같음: 빈 펌프(번호 순) → 없으면 기록상 가장 적게 쓰인 펌프(이 레시피에 쓰는 장착 재료 펌프는 피함). 슬롯·기록은 스토어(`useSlots`·`useHistory`)에서 알아서 읽어요.

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `item` | `ExploreItem` | – | `result.explore[n]` |
| `onInstall` | `(item: ExploreItem, pick: PumpPick) => void` | – | 보통 `openInstall` (`@/lib/flow`)에 **카드가 나온 요청의 입력값**을 붙여 넘김: `(it, pick) => openInstall(it, pick, { input })` — 장착 후 이 입력으로 다시 추천 |
| `compact` | boolean | false | 레시피 화면 안에 넣을 때(테두리 1px). 기본(탐색 화면)은 당근색 1.5px 테두리 |
| `disabled` | boolean | false | [펌프 N에 장착하기]를 잠시 막음 (제조 시작·다른 추천·다시 탐색 진행 중) |
| `slots` | `PumpSlot[]` | 스토어 | (보통 생략) 예시·테스트용 덮어쓰기 |
| `entries` | `UsageEntry[]` | 스토어 | (보통 생략) 펌프 사용 기록 덮어쓰기 |
| `className` | string | – | |

```tsx
import { openInstall } from '@/lib/flow';

// 새 재료 탐색 화면
<Stack gap={16}>{ex.items.map((item) => <ExploreCard key={item.addIngredient} item={item} onInstall={(it, pick) => openInstall(it, pick, { input: ex.input })} disabled={busy} />)}</Stack>
// PC 에서 2열로: <Columns>{…}</Columns>

// 추천 레시피 화면 (normal 모드 explore 0~1개)
{current.explore?.length ? (
  <Section title="새 재료로 이런 것도 만들 수 있어요" description="재료 1개만 바꿔 끼우면 돼요" icon={Compass}>
    {current.explore.map((x) => <ExploreCard key={x.addIngredient} item={x} onInstall={(it, pick) => openInstall(it, pick, { input: current.input })} disabled={starting || regen} compact />)}
  </Section>
) : null}
```
같이 export: `usePumpPick(item)` → `PumpPick | null` (카드와 같은 펌프 고르기), `pumpPickText(pick)` → "펌프 4번이 비어 있어요." / "펌프 2의 오렌지주스는 기록상 가장 적게 쓰였어요(0회). 바꿔 끼우면 돼요."

## `PumpCard`
재료 목록의 펌프 한 칸(누를 수 있는 카드, Enter/Space).
- **빈 펌프**: 점선 카드, 회색 펌프 번호, "비어 있음 / 눌러서 재료를 장착하세요", 당근 ⊕. 화면 읽기: "펌프 4 비어 있음. 눌러서 재료 장착".
- **장착됨**: 펌프 번호(재료 색), 이름, `종류 아이콘 종류 · 40% (또는 · 무알콜) · 4.2 ml/s`, ›, "남은 양 120ml / 1000ml" + % + 재료 색 막대. 잔량 부족(`isLowStock`: 50ml 미만 또는 용량 15% 미만)이면 글자·막대가 노랑 + 배지 "잔량 부족 — 보충 필요". `slot.needsCal` 이면 파란 배지 "캘리브레이션 권장". 화면 읽기: "펌프 2 오렌지주스, 남은 양 120ml".

| prop | 타입 | 설명 |
|---|---|---|
| `slot` | `PumpSlot` | |
| `onPress` | `() => void` | 보통 `go(\`/ingredients/${slot.pump}\`)` (탐색에서 왔으면 `ingredientEditPath(...)`) |
| `mlps` | `number \| null` | 이 펌프 유량 — 있으면 `· 4.2 ml/s` (`useDevice((s) => s.cal)?.[slot.pump - 1]`) |
| `className` | string | |

```tsx
const slots = useSlots((s) => s.slots);
const cal = useDevice((s) => s.cal);
<Columns>{slots.map((s) => <PumpCard key={s.pump} slot={s} mlps={cal?.[s.pump - 1]} onPress={() => go(`/ingredients/${s.pump}`)} />)}</Columns>
```

## `PumpNumber`
동그란 펌프 번호('PUMP' + 번호). 테두리 = 재료 색(옅으면 자동으로 진하게), 배경 = 재료 색 16%. `role="img"`, 이름 "펌프 N".

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `n` | number | – | 펌프 번호 |
| `color` | string | – | 재료 색. 빈 펌프는 `'var(--border-strong)'` |
| `size` | number | 44 | 지름 px (재료 편집 머리 52) |
| `className` | string | – | |

```tsx
<Row gap={12}><PumpNumber n={s.pump} color={s.color} /> …</Row>          // 캘리브레이션 펌프 목록
<PumpNumber n={pump} color={color} size={52} />                           // 재료 편집 머리
```

## `CalibrationBanner`
"캘리브레이션 전" 노란 배너(SPEC §5.6). **기기가 연결돼 있고**(`conn === 'connected'`) 기기가 알려준 `calSet` 에 0 인 펌프가 있을 때만 그림 — 아니면 `null`(자리 차지 안 함). 그대로 넣기만 하면 돼요.
- 제목: "캘리브레이션 전 — 실제보다 적게 나올 수 있어요"
- 본문: "펌프 2·3의 유량을 아직 측정하지 않았어요. 기본값(20ml/초)은 실제(약 3~6ml/초)보다 커서 레시피보다 적게 나와요. 마법사로 10초만 측정해 보세요."
- 버튼: [캘리브레이션 마법사] → `go('/calibrate?pump=<첫 펌프>')`, [나중에](dismissible 일 때) → 앱을 다시 켤 때까지 숨김(저장 안 함, 모든 화면 공통).

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `dismissible` | boolean | true | [나중에] 버튼. 기기 화면은 `false`(항상 보임) |
| `className` | string | – | |

```tsx
<CalibrationBanner />                        // 바텐더 홈
<CalibrationBanner dismissible={false} />    // 기기 화면
```
같이 export:
- `calibratePath(pump?)` → `'/calibrate?pump=2'` (없으면 `'/calibrate'`). **캘리브레이션 화면은 `?pump=N` 쿼리로 그 펌프부터 시작**하면 돼요(v2.1 params.pump).
- `resetCalibrationBanner()` — [나중에]로 숨긴 것을 다시 보이게(데이터 초기화 후 등).
- `CalibrationNotice({ pumps, onCalibrate, onDismiss? })` — 상태와 무관한 배너 모양만(예시·테스트용).

## `ColorProgress`
재료 색 진행 막대. UI 키트 `ProgressBar` 는 `tone`(당근·초록…)만 받아서, 재료 색이 필요한 곳(v2.1 `<ProgressBar color={…}>`)에 써요. `role="progressbar"`.

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `value` | number | – | 0~1 |
| `color` | string | – | 재료 색 `#RRGGBB` 또는 CSS 색(`'var(--green)'`, `'var(--yellow)'`). 옅은 재료 색은 자동으로 진하게 |
| `height` | number | 8 | px |
| `label` | ReactNode | – | 위 왼쪽 글자 (문자열이면 화면 읽기 이름으로도 씀) |
| `valueText` | ReactNode | – | 위 오른쪽 글자(고정폭 숫자) — 예 `'45 / 120ml'`, `'62%'` |
| `ariaLabel` | string | – | label 이 글자가 아닐 때 화면 읽기 이름 |
| `className` | string | – | |

```tsx
// 제조 중 펌프별 진행 (v2.1 brewing: 끝나면 초록, 아니면 재료 색)
<ColorProgress value={p.done / p.target} color={p.finished ? 'var(--green)' : colorFor(p.p, slots)}
  label={`펌프 ${p.p} · ${name}`} valueText={`${fmtMl(p.done)} / ${fmtMl(p.target)}`} />
```

## `categoryIcon(category)` / `CATEGORY_ICONS`
재료 종류 → lucide 아이콘(v2.1 Ionicons 대응): 증류주 `Flame` · 리큐르 `FlaskConical` · 와인·맥주 `Wine` · 시럽 `PaintBucket` · 주스 `Citrus` · 탄산 `CupSoda` · 유제품 `Milk` · 물 `Droplets` · 기타 `Circle`. 모르는 값은 기타. 이름은 `CATEGORY_INFO[c].label`(`@/lib/presets`).

```tsx
const Icon = categoryIcon(slot.category);
<Chip label={CATEGORY_INFO[c].label} icon={categoryIcon(c)} selected={c === category} onClick={() => setCategory(c)} />
```

---

## 앱 정보 (`@/lib/appInfo`)
설정 > 앱 정보용 상수.

| 이름 | 값 |
|---|---|
| `APP_NAME` | `'AI 스마트 바텐더'` |
| `APP_SHORT_NAME` | `'바텐더'` |
| `APP_VERSION` | `'3.0.1'` |
| `APP_DESCRIPTION` | v2.1 한 줄 소개 ("사용자의 감정 및 취향 분석 기반 AI 맞춤형 음료 및 칵테일 배합 메이커") |
| `WEB_URL` | `string \| null` — 웹앱 주소(GitHub Pages 만든 뒤 채움). `null` 이면 링크 숨기기 |
| `RELEASES_URL` | `string \| null` — APK·EXE 내려받기(GitHub Releases). `null` 이면 숨기기 |
| `APP_INFO_LINES` | `{ label, value }[]` — v2.1 정보 줄(팀·소속·과목·통신) |
| `OSS_NOTICES` | `{ name, usage, license, copyright, url }[]` — Pretendard(OFL-1.1) · lucide-react(ISC) · React(MIT) · zustand(MIT) · react-router(MIT) · Workbox(MIT) |

```tsx
import { APP_DESCRIPTION, APP_INFO_LINES, APP_NAME, APP_VERSION, OSS_NOTICES, RELEASES_URL, WEB_URL } from '@/lib/appInfo';
<Text variant="heading">{APP_NAME} v{APP_VERSION}</Text>
{APP_INFO_LINES.map((l) => <ListRow key={l.label} title={l.label} trailing={l.value} />)}
{RELEASES_URL ? <Button variant="secondary" label="APK·EXE 내려받기" onClick={() => window.open(RELEASES_URL!, '_blank', 'noopener')} /> : null}
```
