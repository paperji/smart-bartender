# UI 키트 (`src/ui/`) — 화면 작업자용 안내

밝은 톤 디자인(WEBAPP_DESIGN §3)의 공용 컴포넌트입니다. **화면 폴더(`src/screens/<이름>/`)에서는 이 키트를 가져다 쓰기만 하고, `src/ui`·`src/lib`·`src/store`·`src/platform` 은 고치지 마세요.** 모든 컴포넌트·모양은 앱에서 `#/ui` 로 열어 볼 수 있습니다(메뉴에는 없는 숨은 화면).

```tsx
import { Button, Card, Page, PageHeader, Section } from '@/ui';
import { Sparkles } from 'lucide-react'; // 아이콘은 lucide-react 컴포넌트를 그대로 넘김
```

## 규칙

- 색·간격·모서리는 `theme.css` 의 CSS 변수만 사용: `var(--accent)`, `var(--text-2)`, `var(--space-4)`, `var(--radius-card)` 등. 숫자 색(`#FF7A2F`)을 직접 쓰지 않기.
- **글자 대비 WCAG AA**(보통 글자 4.5:1) — 글자 색과 채움 색을 구분해서 쓰기 (`tests/ui-fixes.test.ts` 가 토큰 짝을 계산해 검사):
  - 글자 색: `--text` · `--text-2` · `--text-3`(가장 옅은 정보 글자 — 힌트·안전 안내도 OK) · `--accent-strong`(오렌지 글자) · `--green` · `--red` · `--blue` · `--yellow-strong`(노란 글자). 흰색·`--bg`·`--surface-2`·각 `-soft` 바탕 위 모두 4.5:1 이상.
  - 채움·아이콘·테두리 전용(글자 색으로 쓰지 않기): `--accent`(당근색, 흰 바탕 2.6:1) · `--yellow` · `--text-decor`(장식 회색).
  - 채움 위 글자: `--accent` 위에는 `var(--on-accent)`(진한 글자 — 흰 글자 금지), `--yellow` 위에는 `var(--text)`, `--red`·`--green`·`--blue` 위에는 흰색. 빨강 hover 는 `--red-hover`, 당근 hover 는 `--accent-hover`.
- 화면 전용 스타일이 필요하면 화면 폴더에 `XxxScreen.css` 를 만들고 클래스 이름은 화면 이름으로 시작(예: `.home-mood-grid`). `sb-` 로 시작하는 클래스는 키트 전용이라 덮어쓰지 않기.
- 터치 영역 44px 이상, 키보드 초점 표시는 키트가 처리합니다(전역 `:focus-visible` = `outline: 2px solid var(--focus-color)`, 2px 띄움 — box-shadow 와 겹치지 않음). 화면 CSS 에서 `outline: none` 으로 끄면 대신 `box-shadow: var(--focus-ring)` 을 그 요소나 감싸는 칸에 꼭 그리기. 직접 `<button>` 을 만들 때도 `type="button"` 과 이름(글자 또는 `aria-label`)을 꼭 넣기.
- 문구는 해요체(legacy 앱과 같은 문구). 숫자는 `.sb-num`(또는 `<Text numeric>`)으로 고정폭.
- `prefers-reduced-motion` 이면 애니메이션이 자동으로 꺼집니다. 직접 애니메이션을 넣으면 같은 미디어 쿼리로 끄기.
- 다크 모드 없음(밝은 톤 고정).

## 화면 틀

### `Page`
화면 한 장의 틀(가운데 정렬·최대 폭·여백·세로 간격).

| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `header` | ReactNode | – | 맨 위 제목 줄 (`<PageHeader>`) |
| `width` | `'narrow' \| 'normal' \| 'wide'` | `'normal'` | 최대 폭 640 / 880 / 1120px |
| `footer` | ReactNode | – | 아래 버튼 줄. 모바일은 화면 아래(탭바 위)에 붙고(토스트는 자동으로 그 위에 떠요), PC 는 본문 끝 오른쪽 |
| `gap` | number | 20 | 요소 사이 세로 간격(px) |

```tsx
<Page header={<PageHeader title="바텐더" />} footer={<Button label="레시피 추천받기" size="lg" icon={Sparkles} />}>
  <Section title="오늘 기분">…</Section>
</Page>
```

### `PageHeader`
| prop | 타입 | 설명 |
|---|---|---|
| `title` | ReactNode | 제목 (h1) |
| `subtitle` | ReactNode | 작은 설명 |
| `back` | `boolean \| string` | 뒤로 버튼. `true` = 앱 안 이전 화면(없으면 `/`), 문자열 = 기록이 없을 때 갈 경로(예: `'/ingredients'`) |
| `onBack` | `() => void` | 뒤로 버튼 동작 직접 지정 |
| `actions` | ReactNode | 오른쪽 버튼들(`IconButton` 등) |
| `size` | `'page' \| 'sub'` | 제목 크기 28px / 22px (기본: back 이 있으면 sub) |

```tsx
<PageHeader title="추천 레시피" back actions={<IconButton icon={Heart} label="즐겨찾기" />} />
```

### `Columns`, `Stack`, `Row`, `Divider`
- `Columns` — PC(≥900px) 2열, 모바일 1열. `template`(기본 `'1fr 1fr'`, 예 `'3fr 2fr'`), `gap`.
- `Stack` — 세로 쌓기. `gap`(12), `direction`(`'column'|'row'`), `align`, `justify`, `wrap`, 나머지 div 속성.
- `Row` — 가로 쌓기(`Stack direction="row" gap={8}`, 세로 가운데 맞춤).
- `Divider` — 구분선. `inset` 이면 왼쪽 들여쓰기.

```tsx
<Columns template="3fr 2fr">
  <Stack>…입력…</Stack>
  <Card>…미리보기…</Card>
</Columns>
```

### `Section`, `SectionHeader`
| prop | 타입 | 설명 |
|---|---|---|
| `title` | ReactNode | 구역 제목 |
| `icon` | LucideIcon | 제목 왼쪽 아이콘(당근색) |
| `description` | ReactNode | 제목 아래 보조 설명 |
| `action` | ReactNode | 오른쪽 끝(버튼·링크) |
| `gap` | number | (Section) 안쪽 간격, 기본 12 |
| `level` | `2 \| 3` | (SectionHeader) 제목 태그 |

```tsx
<Section title="맛 취향" icon={Candy} action={<Button variant="ghost" size="sm" label="초기화" />}>…</Section>
```

## 기본 요소

### `Text`
`variant`: `display`(28) · `title`(22) · `heading`(18) · `body`(15, 기본) · `label`(14 굵게) · `caption`(13 보조색) · `small`(12)
`tone`: `default` · `secondary` · `muted` · `accent` · `success` · `warning` · `danger` · `info` · `inherit`
그 밖: `as`(태그), `align`, `weight`, `numeric`(고정폭 숫자), `truncate`(한 줄 …).

```tsx
<Text variant="title">스크루드라이버</Text>
<Text variant="caption" tone="muted" numeric>200ml · 도수 6%</Text>
```

### `Button`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `label` / `children` | ReactNode | – | 글자 |
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` | 당근 채움 / 흰 바탕+테두리 / 배경 없음 / 빨강 |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | 높이 36(터치 44) / 44 / 52px |
| `icon`, `iconRight` | LucideIcon | – | 왼쪽·오른쪽 아이콘 |
| `loading` | boolean | false | 스피너 + 누를 수 없음 |
| `full` | boolean | false | 가로 꽉 채우기 |
| `haptics` | boolean | true | 누를 때 진동 |
| 그 밖 | button 속성 | | `onClick`, `disabled`, `type`, `aria-*` … |

```tsx
<Button label="제조 시작" size="lg" icon={Play} full loading={busy} onClick={start} />
<Button variant="danger" label="비상 정지" icon={OctagonX} />
```

### `IconButton`
아이콘만 있는 버튼. `icon`(필수), `label`(필수 — `aria-label`·툴팁), `variant`(기본 `ghost`), `size`(`sm`36·`md`44·`lg`52), `badge`(오른쪽 위 숫자·`'!'`).

```tsx
<IconButton icon={Settings} label="앱 설정" onClick={() => go('/settings')} />
```

### `Card`
| prop | 타입 | 기본 | 설명 |
|---|---|---|---|
| `tone` | `'neutral' \| 'accent' \| 'success' \| 'warning' \| 'danger' \| 'info'` | `neutral` | 흰 카드 / 연한 색 카드 |
| `padded` | `boolean \| 'lg'` | true | 안쪽 여백 16px / 24px / 0 |
| `dashed` | boolean | – | 점선(빈 슬롯) |
| `flat` | boolean | – | 그림자 없음 + 옅은 회색(카드 안 구역) |
| `onPress` | `() => void` | – | 누를 수 있는 카드(Enter/Space·초점 포함) |
| `pressLabel` | string | – | 누를 수 있는 카드의 화면 읽기 이름 |

```tsx
<Card tone="accent" onPress={() => go('/settings')} pressLabel="AI 키 등록하러 가기">AI 키를 등록하면…</Card>
```

### `Badge`
`label`, `tone`(neutral·accent·success·warning·danger·info), `icon`, `solid`(채운 배경). 예: AI 출처 배지 `<Badge tone="info" icon={Sparkles} label="Gemini AI 추천" />`.

### `Banner`
| prop | 타입 | 설명 |
|---|---|---|
| `tone` | `'info' \| 'success' \| 'warning' \| 'error'` | 파랑·초록·노랑·빨강 (기본 info) |
| `title`, `message` / `children` | ReactNode | 제목·본문 |
| `icon` | LucideIcon | 아이콘 바꾸기 |
| `action` | `{ label, onClick, icon? }` 또는 ReactNode | 아래 버튼 |
| `onClose` | `() => void` | 오른쪽 위 닫기(X) |

```tsx
<Banner tone="warning" title="캘리브레이션 전이에요" message="양이 조금 다를 수 있어요." action={{ label: '지금 하기', onClick: () => go('/calibrate') }} />
```

## 입력

### `Chip`, `ChipGroup`
- `Chip`: `label`, `selected`, `onClick`, `icon`, `dotColor`(재료 색 점), `disabled`, `size`(`sm`|`md`), `ariaLabel`. 단독으로 쓰면 `aria-pressed` 토글 버튼.
- `ChipGroup` — 하나만: `value: T | null`, `onChange(T | null)`, `allowDeselect`. 여러 개: `multiple`, `value: T[]`, `onChange(T[])`, `max`. 공통: `options: { value, label, icon?, dotColor?, disabled? }[]`, `ariaLabel`(필수), `size`.

```tsx
<ChipGroup ariaLabel="기분" multiple max={3} value={input.moods} onChange={(moods) => setInput({ moods })}
  options={MOODS.map((m) => ({ value: m, label: m }))} />
```

### `Segmented`
`options: { value, label, icon?, disabled? }[]`, `value`, `onChange`, `ariaLabel`(필수), `size`(`sm`|`md`), `full`(기본 true). 좌우 화살표 키로 이동.

```tsx
<Segmented ariaLabel="도수" value={strength} onChange={setStrength}
  options={[{ value: 'none', label: '무알콜' }, { value: 'light', label: '약하게' }]} />
```

### `ScaleSelector` (맛 0~5)
`label`(필수), `value`(0~5), `onChange`, `color`(채움 색, 기본 당근), `icon`, `words`(단계 이름 6개, 기본 `SCALE_WORDS` = 없음·아주 약하게·약하게·보통·강하게·아주 강하게), `max`(5), `disabled`. `role="slider"` — 화살표·Home·End 키.

```tsx
<ScaleSelector label="단맛" icon={Candy} value={taste.sweet} onChange={(sweet) => setInput({ taste: { ...taste, sweet } })} />
```

### `Slider`
`value`, `onChange`, `min`, `max`, `step`(1), `label`(또는 `ariaLabel`), `unit`, `format`, `marks: { value, label }[]`, `disabled`.

### `NumberStepper`
`value`, `onChange`, `min`, `max`, `step`, `label`(필수, 화면 읽기용), `showLabel`, `unit`, `presets`(빠른 선택), `format`, `disabled`. v2.1 `Stepper` 와 같은 반올림(step 단위·소수 2자리).

```tsx
<NumberStepper label="잔 용량" value={input.cupMl} onChange={(cupMl) => setInput({ cupMl })} min={30} max={500} step={10} unit="ml" presets={[150, 200, 250, 300]} />
```

### `TextField`, `TextArea`
공통: `label`, `hint`, `error`(빨간 테두리 + hint 대신 표시), `value`, `onChange(문자열)`, `counter`(+`maxLength` → `12/300`), `wrapperClassName`, 그 밖 input/textarea 속성.
- `TextField` 추가: `icon`(왼쪽), `trailing`(오른쪽 — 단위·버튼). `ref` 전달 가능.
- `TextArea` 추가: `rows`(3).

```tsx
<TextField label="Gemini API 키" value={key} onChange={setKey} type="password" autoComplete="off" icon={KeyRound} hint="마지막 4자리만 보여요." />
<TextArea label="성향" value={pref} onChange={setPref} maxLength={300} counter />
```

### `Switch`
`checked`, `onChange(boolean)`, `label`(있으면 행 전체가 눌림 영역 — "이름 + 설명 + 스위치"), `description`, `icon`, `ariaLabel`(label 이 없을 때), `disabled`.

```tsx
<Switch label="자동 재연결" description="앱을 켜면 마지막 기기에 다시 연결해요." checked={autoReconnect} onChange={(v) => set({ autoReconnect: v })} />
```

## 목록·상태·진행

### `ListRow`
`title`, `subtitle`, `icon` 또는 `leading`, `trailing`(값·배지·스위치), `onClick`(있으면 행이 버튼), `chevron`(기본: onClick 있으면 표시), `danger`, `disabled`. 카드 안에 여러 개 넣으면 사이에 구분선.

### `EmptyState`
`icon`, `title`, `message`, `action`. 예: `<EmptyState icon={History} title="아직 기록이 없어요" action={<Button label="바텐더로" onClick={() => go('/')} />} />`

### `ProgressBar`
`value`(0~1), `tone`(기본 accent), `label`, `showValue`(%), `indeterminate`, `height`(8), `ariaLabel`.

### `Spinner`
`size`(20), `label`(‘불러오는 중’), `color`.

### `AiLoading`
칵테일 잔이 차오르는 그림 + 바뀌는 문구. `title`, `lines`(1.6초마다 바뀜), `size`(120), `slow`(오래 걸림 안내). 전체 화면 로딩은 직접 그리지 말고 `withAiBusy`(아래)를 쓰세요.

## 창·알림 (App 루트에 이미 1개씩 있음 — 화면에서 다시 넣지 않기)

| 무엇 | 부르는 법 | 화면에 그리는 것 |
|---|---|---|
| 확인창 | `await confirm(title, message, { confirmText?, cancelText?, destructive?, tone? })` → boolean | `DialogHost` |
| 안내창 | `await alert(title, message, opts?)` (v2.1 이름 `alertMessage(title, msg)`, `confirmAsync` 도 있음) | `DialogHost` |
| 토스트 | `toast(message, 'info' \| 'success' \| 'warning' \| 'error')` (`@/store/toast`) — 보통 화면 아래(탭바·버튼 줄 위), 모바일 제조 화면(`/brewing`)은 아래 버튼을 가리지 않게 화면 위 | `ToastHost` |
| AI 로딩 | `withAiBusy(() => 작업, 'normal' \| 'explore')` (`@/store/aiBusy`) — 보통은 `recommendAndShow` 가 알아서 | `AiLoadingHost` |
| 성인 확인 | `await ensureAdult()` (`@/store/adultGate`) — `startBrew` 가 알아서 | `AdultGateHost` |

```tsx
import { confirm } from '@/ui';
if (await confirm('데이터 초기화', '되돌릴 수 없어요.', { confirmText: '모두 초기화', destructive: true })) reset();
```

### `Modal`, `Sheet`
`open`, `onClose`(Esc·바깥·X — 생략하면 닫을 수 없음), `title`, `description`, `children`, `footer`, `size`(`sm`400·`md`520·`lg`720), `closeOnBackdrop`(true), `showClose`, `ariaLabel`, `initialFocus`(선택자), `labelledBy`·`describedBy`(본문에 직접 그린 제목·설명 요소 id → `aria-labelledby`·`aria-describedby`, 여러 개는 공백으로), `role`(`dialog` 기본 · 바로 답해야 하는 확인·경고는 `alertdialog`). 초점 가두기·스크롤 잠금·닫으면 이전 초점 복귀. `Sheet` 는 모바일(<600px)에서 아래에서 올라오는 시트. 첫 초점이 버튼으로 가도 질문·경고를 읽어 주도록, 본문에 질문을 직접 그리면 `describedBy` 로 이어 주세요(`DialogHost`·`AdultGateHost` 가 그렇게 함).

```tsx
<Sheet open={open} onClose={() => setOpen(false)} title="펌프 선택" footer={<Button label="장착" full onClick={install} />}>…</Sheet>
```

### `DeviceChip`, `connLabel(conn, kind)`
상단바의 기기 상태 칩(누르면 `#/device`). `connLabel` 은 v2.1 과 같은 문구(`'데모 기기 연결됨'`, `'연결 끊김'` …)와 `tone` 을 돌려줌 — 기기 화면에서 재사용.

## 화면 밖 로직 (화면에서 부르기만)

- 이동: `go(path, { replace? })`, `back(fallback?)` — `@/lib/nav` (react-router 의 `useNavigate` 도 써도 됨). 재료 편집 주소는 `ingredientEditPath(pump, { suggest, category, abv, from, done })` — `@/lib/flow`.
- 추천: `recommendAndShow(args, opts)`, `requestRecommendation`, `showResult`, `openInstall`, `fallbackToast` — `@/lib/flow`.
- 제조: `startBrew`, `remapSavedRecipe`, `removalNotes`, `brewSnapshotOf`, `jobHistoryId`, `setBrewingScreenOpen`, `stopReasonText`, `jobEndMessage` — `@/lib/brew`.
- 기기: `deviceClient` — `@/lib/device/client`, 상태 `useDevice` — `@/store/device`, Web Bluetooth 안내 문구 `WEB_BLE_NOTES` — `@/platform/transport/factory`.
- AI 키: `saveGeminiKey(key)`, `deleteGeminiKey()`, `useEffectiveAiMode()` — `@/store/settings`; `checkGeminiKey(key, model)`, `listModels(key)`, `AI_STUDIO_KEY_URL` — `@/lib/ai/gemini`; `getDevGeminiKey()`·`hasDevGeminiKey()` — `@/platform/devKey`(개발 서버에서만 값이 있음, 값을 화면·로그에 출력 금지); `secretStorageLabel()` — `@/platform/secrets`; 안내 문구 `aiModeCaption(aiMode, hasKey)` — `@/lib/ai/mode`.
- 포맷: `fmtMl`, `fmtDuration`, `fmtDate`, `maskKey`, `maskKeyHint` — `@/lib/format`. 진동: `haptic.tap()` 등 — `@/platform/haptics`. 날씨: `fetchCurrentWeather()` — `@/platform/weather`. 화면 켜 두기: `useWakeLock(active)` — `@/platform/useWakeLock`.
