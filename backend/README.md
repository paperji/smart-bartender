# AI 스마트 바텐더 v2.1 — AI 레시피 백엔드 (기준 구현 · 배포하지 않음)

팀 홍당무 · 캡스톤디자인 Ⅱ (2026/2학기)

> **v3.0 부터 앱은 이 서버를 쓰지 않습니다.** 앱이 사용자 본인 Gemini 키(BYOK)로 Gemini 를 직접 부르고, 같은 보정 규칙(SPEC §3.3)을 앱 안에서 적용합니다(`../app/README.md` 5장, `../docs/WEBAPP_DESIGN.md` §4).
> 이 폴더는 SPEC §3.3·§5.4 보정 규칙의 **기준 구현(reference implementation)** 으로 남겨 두며, 앱의 `npm test`(`tests/parity.test.ts`)가 `lib/*.js` 를 직접 불러와 앱 결과와 같은지 비교합니다.
> 아래 내용은 v2.1 서버의 설명이며, 배포 절차(3장)는 **참고용**입니다 — 3장 맨 앞의 경고를 먼저 읽으세요.

앱에서 **기분·맛·도수·날씨·상황·성향 + 기기에 장착된 재료(펌프 1~8)** 를 보내면, Google **Gemini** 가 장착 재료만으로 레시피를 만들고, 서버가 **SPEC §3.3 규칙 1~9 로 검증·보정**해서 돌려줍니다.
v2.1 부터는 **탐색(explore) 모드**가 추가되어 "새 재료 하나만 더 장착하면 만들 수 있는 레시피" 카드도 함께 줍니다.
AI 키가 없거나 Gemini 가 실패해도 **규칙기반 추천(`source: "fallback"`)으로 항상 200 응답**합니다.

- 설계 명세: `../docs/SPEC.md` §3 (요청/응답/검증 규칙), §5.3 (거절 처리), §5.4 (탐색 모드)
- 외부 패키지 **없음** (Node 18+ 내장 `fetch` 사용) → `npm install` 필요 없음
- 예전 앱 v2.1(`../legacy/app-expo-v2.1/`)이 쓰던 서버입니다. v3.0 앱에는 서버 주소 설정이 없습니다.

---

## 1. 폴더 구조

```
backend/
├─ api/index.js          ← Vercel 함수 (/api). CORS, GET 상태, POST v2 레시피(+탐색), 예전 prompt 방식
├─ lib/recipe.js         ← 요청 검증 + 레시피 검증·보정 (SPEC §3.3 규칙 1~9) — 앱과 같은 규칙
├─ lib/explore.js        ← 탐색(explore) 카드 검증·보정 (SPEC §5.4)
├─ lib/flavor.js         ← 재료 맛 프로필(단/신/쓴/탄산) 추정
├─ lib/fallback.js       ← 규칙기반 추천 (AI 실패 시 대체) + 거절 조합 피하기 + 탐색 후보 목록 + 성향 제외 재료
├─ lib/alcohol.js        ← 이름으로 술인지 추정 (recipe·explore 공통, 앱 재료 프리셋의 술 이름·별칭 — 피치트리·말리부 등 — 포함, 문장 속 '럼을·진을 …'도 판정. 앱 alcohol.ts 와 같은 정규식 문자열)
├─ lib/prompt.js         ← Gemini 시스템 지시문(바텐더 페르소나), 사용자 프롬프트, 응답 JSON 스키마
├─ lib/gemini.js         ← Gemini REST 호출 (타임아웃·재시도·호환 모드)
├─ test/local-test.js    ← 네트워크 없이 도는 자동 테스트 (fetch 모킹, 실제 Gemini 호출 없음)
├─ test/sample-request.json          ← curl 테스트용 요청 (normal)
├─ test/sample-explore-request.json  ← curl 테스트용 요청 (explore)
├─ test/sample-explore-empty.json    ← curl 테스트용 요청 (explore + 빈 기기)
├─ scripts/dev-server.js ← 로컬 개발 서버 (npm run dev)
├─ vercel.json           ← 서울 리전(icn1), 최대 실행 60초
├─ package.json          ← CommonJS, Node >= 18, version 2.1.0
└─ .env.example          ← 환경변수 예시 (실제 키는 절대 커밋 금지)
```

---

## 2. 빠르게 시험해 보기 (PC)

```bash
cd smart-bartender/backend
node test/local-test.js      # 자동 테스트 (실제 Gemini 호출 없음) → "결과: 68 통과 / 0 실패 (총 68)"
npm run dev                  # http://localhost:3000/api 로컬 서버
```

- 로컬 서버에서 실제 AI 를 쓰려면 `.env.example` 을 `.env.local` 로 복사하고 `GEMINI_API_KEY=` 뒤에 키를 넣으세요. (`.env.local` 은 git·Vercel 업로드에서 제외됨)
- 키가 없으면 규칙기반 추천으로 응답합니다(`warningCode: "NO_API_KEY"`). 탐색 모드도 키 없이 동작합니다.
- (예전 앱 v2.1 로만) 같은 Wi-Fi 의 휴대폰에서 시험하려면 v2.1 앱 설정의 AI 서버 주소를 `http://<PC IP>:3000/api` 로(주소 끝 `/api` 까지 입력 — 앱은 넣은 주소를 그대로 호출). v3.0 앱에는 이 설정이 없습니다.
- 앱 v3.0 쪽에서 이 폴더의 규칙과 같은지 확인: `cd ../app && npm test` (`tests/parity.test.ts`, 네트워크 없음).

---

## 3. 배포 (Vercel) — 참고용 (v3.0 에서는 하지 않음)

> ⚠️ **실제(특히 결제가 연결된) Gemini 키를 넣어 이 서버를 공개 주소에 다시 배포하지 마세요.**
> `api/index.js` 는 **인증이 없고**(누구나 POST 가능) 모든 출처를 허용(`Access-Control-Allow-Origin: *`)하며, 사용자별 요청 제한도 없습니다(`RATE_LIMIT` 은 Gemini 의 429 를 구분하는 코드일 뿐).
> 주소가 알려지면 다른 사람이 그 키의 무료 한도나 크레딧을 써 버릴 수 있습니다. v3.0 앱은 서버가 필요 없으니(BYOK) 배포할 이유가 없습니다.
> 꼭 다시 배포해야 한다면 먼저 **공유 비밀 헤더 검사**(예: 요청 헤더의 값을 Vercel 환경변수와 비교해 다르면 401)나 **Vercel 방화벽 요청 제한(rate limit)** 을 추가하고, 결제가 연결되지 않은 무료 등급 키만 쓰세요.
> 예전 v2.1 배포가 아직 살아 있다면 팀장이 Vercel 대시보드에서 해당 프로젝트를 일시 중지하거나 삭제하는 것을 권합니다(사람이 직접 하는 작업).

> 배포·로그인·키 등록은 **본인이 직접** 해야 합니다. (이 저장소의 자동 작업은 배포하지 않습니다.)

준비: Node.js 설치, Vercel 계정, Google AI Studio 의 Gemini API 키.

### 3-1. 순서 (v2.1 때 쓰던 방법)
예전 v2.1 앱은 Vercel 프로젝트 **`backend`** 의 주소를 기본값으로 썼습니다. 같은 프로젝트에 덮어쓰면 v2.1 앱의 기본 주소가 그대로 유지됩니다.

```bash
cd smart-bartender/backend
npx vercel login         # ① 브라우저가 열리면 본인 계정으로 로그인
npx vercel link          # ② "Link to existing project?" → Y → 프로젝트 이름: backend
npx vercel env add GEMINI_API_KEY production   # ③ 새 키를 붙여넣기 (아래 3-3 참고)
npx vercel --prod        # ④ 운영(Production) 배포
```
- ③ 은 대시보드에서 해도 됩니다: https://vercel.com → 프로젝트 `backend` → **Settings → Environment Variables** → `GEMINI_API_KEY` 추가(Environment: **Production** 체크) → Save. 이미 있으면 **Edit** 로 새 키로 바꿉니다.
- (선택) `GEMINI_MODEL` = `gemini-3.8-flash` 처럼 다른 모델로 바꾸고 싶을 때만 추가.
- **환경변수를 바꾼 뒤에는 반드시 다시 배포**해야 적용됩니다: `npx vercel --prod` (또는 대시보드 Deployments → Redeploy)
- 예전 앱(`{prompt}` 요청)도 계속 동작하므로 덮어써도 기존 앱이 깨지지 않습니다.
- 새 프로젝트로 따로 운영하고 싶으면 ② 에서 N → 새 이름(예: `smart-bartender-ai`) → 새 주소 뒤에 `/api` 를 붙여(예: `https://smart-bartender-ai.vercel.app/api`) v2.1 앱 설정의 **AI 서버 주소**에 입력 (앱은 넣은 주소를 그대로 호출). 이때도 3장 맨 앞의 경고(인증·요청 제한)를 먼저 해결하세요.

### 3-2. 배포 확인
브라우저로 `https://<주소>/api` 를 열면:
```json
{"ok":true,"service":"smart-bartender-ai","version":"2.1.0","model":"gemini-3.6-flash","keyConfigured":true}
```
- `version` 이 `2.1.0` 이 아니면 배포가 안 된 것, `keyConfigured:false` 면 키가 없거나 재배포를 안 한 것입니다.
- 그다음 `test/sample-request.json` 으로 POST 해 보고(6번 curl 예시), 응답의 `source` 가 `"gemini"` 인지 확인하세요. `"fallback"` 이면 `warningCode` 를 5번 절의 warningCode 표에서 찾으세요.

### 3-3. ⚠️ 기존 서버의 "Your prepayment credits are depleted" 오류
기존 배포 서버는 Gemini 호출 시 **"Your prepayment credits are depleted"** (선불 크레딧 소진) 오류를 냈습니다.
키가 연결된 Google 결제 계정이 **선불(Prepay) 결제**로 바뀌었는데 잔액이 0 이 되면, 그 결제 계정에 연결된 **모든 프로젝트의 키가 한꺼번에 멈춥니다**(HTTP 402). 기다려도 풀리지 않습니다.

해결 방법 (둘 중 하나)
1. **크레딧 확인·충전**: Google AI Studio → **Billing**(https://aistudio.google.com/billing) → "Available credits" 확인 → 필요하면 **Buy credits**(최소 $5). 끊기지 않게 하려면 auto-reload 와 월 한도(Monthly Limit)를 함께 설정.
2. **무료 등급으로 쓰기 (권장 — 졸업작품 시연용으로 충분)**: 결제가 연결되지 않은 **무료 등급(Free Tier) 프로젝트에서 새 API 키를 발급**(https://aistudio.google.com/apikey → Create API key → 결제 없는 프로젝트 선택)해서 3-1 ③ 에 넣고 재배포. `gemini-3.6-flash` 는 무료 등급을 제공합니다(분당/일일 한도 있음). 이미 결제가 켜진 프로젝트는 자동으로 무료로 돌아가지 않으니, 결제 연결을 끊거나 새 프로젝트를 쓰세요.

> **예전 키는 반드시 폐기하세요.** AI Studio → API keys 에서 **예전 키를 삭제**하고, 새 키는 Vercel 환경변수에만 넣으세요. (코드·앱·채팅·텍스트 파일에 붙여넣지 않기)

v2.1 서버는 이 오류를 `warningCode: "BILLING"` 으로 구분하고, 재시도 없이 바로 규칙기반 추천으로 응답합니다.

---

## 4. 모델·요청 형식 (2026-11-06 Google AI Studio 공식 문서로 재확인)

| 모델 | 상태 (공식 Models / Deprecations / Pricing 문서) |
|---|---|
| `gemini-2.5-flash` (예전 코드) | **Deprecated** — **2026-12-01 부터 `gemini-3.5-flash-lite` 로 자동 전환** |
| **`gemini-3.6-flash` (기본값)** | **Stable(정식)**, 종료 일정 없음, **무료 등급 제공**, 구조화 출력·thinking 지원 |
| `gemini-3.8-flash` | 최신 Stable Flash. 원하면 `GEMINI_MODEL=gemini-3.8-flash` |

서버가 보내는 요청 (`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`, 키는 `x-goog-api-key` 헤더)
```json
{
  "systemInstruction": { "parts": [{ "text": "(바텐더 규칙)" }] },
  "contents": [{ "role": "user", "parts": [{ "text": "(사용자 정보·장착 재료·기록·요청 모드)" }] }],
  "generationConfig": {
    "maxOutputTokens": 8192,
    "responseMimeType": "application/json",
    "responseJsonSchema": { "type": "object", "properties": { "...": "레시피 필드 + explore" } },
    "thinkingConfig": { "thinkingLevel": "LOW" }
  }
}
```
- 구조화 출력: `responseMimeType: "application/json"` + `responseJsonSchema`(JSON Schema). 스키마의 `pump` 는 이번 요청에서 **쓸 수 있는 펌프 번호만 enum**, `ml` 은 최대 300, explore 개수는 모드별 `minItems/maxItems`, 무알콜이거나 성인 확인 전(`adultVerified` ≠ true)이면 explore 의 `abv` 최대 0·`category` 에서 술 종류 제외 → 디코딩 단계에서 1차 차단.
- `thinkingConfig.thinkingLevel = "LOW"` (값: `MINIMAL`·`LOW`·`MEDIUM`·`HIGH`, 3.6 Flash 기본은 MEDIUM). **Gemini 3 이상에만** 보냄(이전 모델에 보내면 오류).
- `temperature` 는 **Gemini 3 이상에는 보내지 않습니다**. 공식 문서: 3.6 Flash 이상은 temperature/topP/topK 를 무시하고, 이후 세대에서는 400 오류가 될 예정이라 "요청에서 제거" 권장. (2.x 모델에만 0.9 전송)
- 응답 파싱: `candidates[0].content.parts[].text` 를 이어 붙임(`thought: true` 파트는 제외) → JSON 파싱(코드블록·앞뒤 잡문 허용). `promptFeedback.blockReason` 이나 `finishReason` 이 SAFETY 등이면 차단으로 처리.
- 모델이 스키마·thinking 설정을 거부(HTTP 400)하면 **호환 모드**(스키마·thinking 제거, 프롬프트에 JSON 형식을 글로 명시)로 1회 재요청합니다.
- 참고: Google 은 새 개발에 Interactions API 를 권하지만 `generateContent` 도 "완전히 지원(fully supported)" 상태입니다.

---

## 5. API

### GET `/api` — 상태 확인
`{ ok, service:"smart-bartender-ai", version:"2.1.0", model, keyConfigured }` (키 값 자체는 절대 노출하지 않음)

### OPTIONS `/api` — CORS 사전 요청 → 204
모든 응답에 `Access-Control-Allow-Origin: *`, `Allow-Methods: GET,POST,OPTIONS`, `Allow-Headers: Content-Type`.

### POST `/api` (version 2) — 맞춤 레시피 (+ 탐색 제안)
요청 (SPEC §3.1) — `test/sample-request.json` 참고
```json
{
  "version": 2,
  "mode": "normal",
  "user": {
    "moods": ["피곤함", "설렘"],
    "taste": { "sweet": 3, "sour": 2, "bitter": 1, "fizzy": 4 },
    "strength": "none",
    "weather": { "condition": "맑음", "tempC": 18.5, "humidity": 60 },
    "situation": "혼술",
    "preference": "너무 달지 않았으면 좋겠어요",
    "cupMl": 200,
    "adultVerified": false
  },
  "ingredients": [
    { "pump": 1, "name": "보드카", "category": "spirit", "abv": 40, "remainingMl": 650 },
    { "pump": 2, "name": "오렌지주스", "category": "juice", "abv": 0, "remainingMl": 900 },
    { "pump": 4, "name": "사이다", "category": "soda", "abv": 0, "remainingMl": 1000 }
  ],
  "history": [
    { "name": "선셋 피즈", "liked": true, "rejected": false, "ingredients": [{ "name": "오렌지주스", "ml": 120 }] },
    { "name": "레몬 스파클러", "liked": false, "rejected": true, "ingredients": [{ "name": "레몬주스", "ml": 30 }, { "name": "사이다", "ml": 170 }] }
  ]
}
```
필수/기본값
| 필드 | 규칙 |
|---|---|
| `version` | **2** (필수) |
| `mode` | `"normal"`(기본) \| `"explore"`. **생략 시 normal**, 그 외 값(오타·숫자 등)은 **400**. 대소문자·앞뒤 공백은 허용 |
| `ingredients` | 배열. normal 은 이름 있는 재료 **1개 이상 필수**(없으면 400). **explore 는 빈 배열·생략도 허용**(빈 기기). `pump` 1~8 정수·중복 불가. 이름이 빈 슬롯은 무시. `category` 가 목록 밖이면 `other`(abv≥20 은 `spirit`, 0<abv<20 은 `wine`). `abv` 0~100(없으면 0). `remainingMl` 없으면 "잔량 모름(제한 없음)" |
| `user` | 생략 가능 |
| `user.strength` | `none`\|`light`\|`medium`\|`strong`, **생략 시 `none`(무알콜)** |
| `user.cupMl` | 30~500, **생략 시 200** (범위 밖이면 400) |
| `user.adultVerified` | 앱에서 만 19세 이상 확인을 마쳤는지. **정확히 `true` 일 때만 true**, 생략·`false`·그 밖의 값(`"true"` 문자열, 1 등)은 모두 `false` 로 봄(400 아님). `false` 면 탐색(explore) 제안에서 **술을 새로 장착하라는 카드를 빼고**(AI·fallback 모두), 레시피 `suggestions` 에서도 **술을 장착·대체하라는 `add_ingredient`/`substitute` 를 지우고**(무알콜과 같은 판정, AI·fallback 모두 — 7번 절 '기타'), 프롬프트에 "술 장착 제안 금지" 한 줄을 넣고, explore 스키마의 `category`·`abv` 를 무알콜로 제한. 규칙기반 안내 문구도 술 장착을 권하지 않음(술이 없어 무알콜로 만든 경우 "장착된 주류가 없어 무알콜로 만들었어요." 까지만). 실제 주류 제조 확인은 앱이 제조 직전에 따로 함 |
| `user.taste.*` | 0~5 정수로 반올림·제한, 없으면 "상관없음" |
| `history` | **앞에서부터 10개만** 사용(앱은 최신 기록부터 보냄). `rejected:true` = 레시피 화면에서 "다른 추천"으로 넘긴 레시피 → `liked` 가 없으면 `false` 로 간주 |

응답 (SPEC §3.2) — AI 성공, normal
```json
{
  "ok": true,
  "source": "gemini",
  "model": "gemini-3.6-flash",
  "mode": "normal",
  "recipe": {
    "name": "미드나잇 시트러스",
    "nameEn": "Midnight Citrus",
    "description": "상큼한 오렌지에 탄산을 더한 가벼운 에이드",
    "reason": "피곤하다고 하셔서 비타민C가 풍부한 오렌지와 청량한 탄산으로 기분 전환을 도와드려요. ...",
    "ingredients": [ { "pump": 2, "name": "오렌지주스", "ml": 90 }, { "pump": 4, "name": "사이다", "ml": 110 } ],
    "totalMl": 200,
    "estimatedAbv": 0,
    "flavor": { "sweet": 3, "sour": 2, "bitter": 0, "fizzy": 4, "strength": 0 },
    "garnish": "얼음 + 레몬 슬라이스 (선택)",
    "tips": "잔에 얼음을 먼저 채우고 제조를 시작하세요.",
    "suggestions": [
      { "type": "add_ingredient", "ingredient": "토닉워터", "message": "토닉워터를 추가 장착하면 쌉싸름한 '진토닉 스타일'도 만들 수 있어요." }
    ]
  },
  "explore": [],
  "adjustments": []
}
```
- `recipe.ingredients` 배열 순서 = **붓는 순서** (탄산은 마지막). 앱은 이 순서대로 BLE `make` 의 `steps` 를 만들면 됩니다.
- `explore` 는 **항상 배열**로 옵니다 (normal 0~1개, explore 1~3개).
- `nameEn`(영어 이름), `adjustments`(서버가 보정한 내용, 한국어 문장 배열), `mode`, `notice` 는 **선택 필드**입니다. 앱은 무시해도 됩니다.

### 탐색(explore) 모드 — SPEC §5.4
"한 잔 더?" → **[아니요, 다른 걸 원해요]** 를 누르거나, 거절이 2번 이어졌을 때 앱이 `"mode": "explore"` 로 요청합니다. (`test/sample-explore-request.json`)

응답 — 장착 재료로 만들 수 있을 때 (`recipe` + `explore` 1~3개)
```json
{
  "ok": true,
  "source": "fallback",
  "model": "rule-based",
  "mode": "explore",
  "recipe": {
    "name": "리프레시 스파클링 에이드",
    "ingredients": [ { "pump": 2, "name": "오렌지주스", "ml": 53.8 }, { "pump": 4, "name": "사이다", "ml": 146.2 } ],
    "totalMl": 200, "estimatedAbv": 0, "...": "..."
  },
  "explore": [
    {
      "addIngredient": "설탕시럽",
      "category": "syrup",
      "abv": 0,
      "recipeName": "리프레시 스위트 에이드",
      "description": "설탕시럽·오렌지주스·사이다로 만든 달콤하고 청량한 에이드",
      "ingredients": [
        { "name": "설탕시럽", "ml": 18, "installed": false },
        { "name": "오렌지주스", "ml": 48.9, "installed": true, "pump": 2 },
        { "name": "사이다", "ml": 133.1, "installed": true, "pump": 4 }
      ],
      "message": "설탕시럽을 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요."
    }
  ],
  "warning": "AI 키가 설정되지 않아 기본 추천 규칙으로 레시피를 만들었어요. (관리자: Vercel 환경변수 GEMINI_API_KEY 확인)",
  "warningCode": "NO_API_KEY",
  "adjustments": []
}
```

응답 — 지금 만들 수 있는 재료가 없을 때 (빈 기기·잔량 0·무알콜인데 술만 장착·성향으로 모두 제외·도수를 낮출 무알콜 재료 없음) → **200 + `recipe: null`** (`test/sample-explore-empty.json`)
```json
{
  "ok": true,
  "source": "gemini",
  "model": "gemini-3.6-flash",
  "mode": "explore",
  "recipe": null,
  "explore": [
    {
      "addIngredient": "탄산수", "category": "soda", "abv": 0,
      "recipeName": "해피 스파클링 에이드", "description": "레몬즙·탄산수로 만든 청량한 에이드",
      "ingredients": [ { "name": "레몬즙", "ml": 12.6, "installed": false }, { "name": "탄산수", "ml": 187.4, "installed": false } ],
      "message": "탄산수와 레몬즙을 비어 있거나 잘 안 쓰는 펌프에 장착하면 만들 수 있어요."
    }
  ],
  "adjustments": [],
  "notice": "장착된 재료가 없어요. 아래 재료 중 하나를 펌프에 장착해 보세요."
}
```
- 같은 상황에서 **normal 모드는 기존대로 422** 입니다.
- 앱: explore 카드의 "펌프 N에 장착하기" → 재료 편집 화면에 `addIngredient`·`category`·`abv` 를 미리 채움 → 장착 후 다시 요청.

explore 카드 검증·보정 (서버 `normalizeExplore`, AI·fallback 모두 적용)
1. `addIngredient` 가 비었거나 **이미 장착된 재료**면 카드 제거. 같은 `addIngredient` 중복 제거. 이름 비교는 SPEC §3.1 공통 `normName`(소문자화 + 공백과 기호 `_ - · . , ( ) [ ] ' "` 무시 — 규칙 1 매칭과 같은 함수, 예: 장착 `진저-에일` = `진저 에일` = `진저에일`).
2. 무알콜(`none`)이면 술 카드(abv>0·술 종류·술 이름) 제거, 카드 안의 술 재료 줄도 제거.
   - **성인 확인 전**(`user.adultVerified` 가 `true` 가 아님)이면 술을 새로 장착하라는 카드 제거: `addIngredient` 의 abv>0, 또는 category 가 `spirit`·`liqueur`·`wine`, 또는 미장착(`installed:false`, 3번의 재계산 기준) 재료 이름이 술 이름 목록(`lib/alcohol.js`)에 해당. 이미 **장착된** 술 줄은 허용(새로 장착하는 게 아니므로). 무알콜이면 2번 규칙이 미장착 술 줄을 먼저 빼고 판정.
   - 술 이름 목록은 이름 하나뿐 아니라 문장 속 럼·진도 잡음(`럼을 장착하면…`, `진을 추가로…`, `라이트 럼`, `런던 드라이 진` 등). `처럼`·`드럼`·`진저에일`·`진토닉`·`진로토닉`·`진하게`·`럼주스`·`매실주스` 는 술로 보지 않음. 앱 프리셋에서 무알콜 시럽 별칭인 `블루큐라소` 는 목록에 없음(`오렌지 큐라소` 만).
   - **성향**(알레르기·싫어하는 재료 — SPEC §3.3 규칙 1, 규칙기반 후보와 같은 `excludedByPreference` 판정): `addIngredient` 가 성향 제외 재료면 카드 제거, 성향으로 뺀 **장착** 줄(`excludePumps`)과 성향 제외 **미장착** 줄은 줄만 제거(남은 줄로 5번 보정).
3. 재료 줄의 `installed`·`pump` 는 AI 값을 믿지 않고 **장착 재료와 이름 일치로 다시 계산**. 같은 재료는 합산.
4. `addIngredient` 줄이 없으면 카드 제거. **미장착 재료는 addIngredient 포함 최대 2개**(나머지는 양이 많은 1개만 남김), 줄은 최대 5개.
5. ml: 음수·숫자 아님 → 0, 0ml 줄 제거, **소수 1자리**, 합계를 **cupMl 로 비례 보정**, 도수 상한(규칙 8과 같은 값) 적용, 줄당 300ml. 300ml 로 자른 뒤 도수가 다시 상한을 넘으면 **술 줄만 더 줄임**(이때 합계는 cupMl 보다 작을 수 있음). 무알콜 줄이 없어 도수를 못 낮추는 카드는 제거.
   - 줄별 도수: 장착 줄 = 등록 도수, `addIngredient` 줄 = 카드 `abv`, **그 밖의 미장착 줄 = 앱 재료 프리셋의 술 도수(이름·별칭이 `normName` 으로 정확히 같을 때 — 예: 진 40, 소주 16.5, 말리부 21) / 술 이름 목록이면 40 / 그 외 0** (`uninstalledLineAbv`, 앱 `parseExplore` 와 같은 규칙). 예: light 에서 `화이트 럼 20 + 진 100(미장착) + 오렌지주스 80` → 진도 40% 로 계산해 4.8% 이하로 줄임.
6. 개수: **explore 최대 3개, normal 최대 1개**. explore 모드에서 AI 가 0개를 주면 규칙기반 후보로 채움(1개 이상 보장).
   - 성인 확인 전이라 AI 의 술 카드를 버려(무알콜 요청이라 2번 규칙으로 버린 술 카드 포함 — 기본 요청 `user:{}` 도 해당) **0개가 되면**(normal·explore·빈 기기 `recipe:null` 모두) AI 를 다시 부르지 않고 규칙기반 후보(술 제외)로 채움. 1개 이상 남으면 그대로 둠(0개일 때만).
7. **`NO_MIXER` 로 `recipe:null`** 인 explore 응답(SPEC §3.3 규칙 8 — 섞을 무알콜 재료가 없음: AI 를 부르기 전 `lacksMixer` 판정, 또는 규칙기반 레시피도 `NO_MIXER`)에서는 **무알콜 재료를 새로 하나도 더하지 않는 카드(술만 더하는 카드)를 버림** — AI·규칙기반 모두(`filterNoMixerExplore`). 0개가 되면 AI 를 다시 부르지 않고 규칙기반 후보(같은 필터)로 채움. 빈 기기·잔량 0 처럼 `NO_MIXER` 가 아닌 `recipe:null` 이나 레시피가 있는 응답에는 적용하지 않음.
   - 무알콜 줄이 없어 5번 도수 상한 단계에서 이미 빠진 카드(예: 장착 보드카 + 미장착 트리플섹)도 술만 더하는 카드이므로 같이 셈 → 0개면 역시 AI 재호출 없이 채움.
   - 형식이 깨진 카드(`addIngredient` 없음 등)만 와서 탐색 전용 응답이 0개가 되면 기존대로 AI 를 1회 다시 부르고, 그래도 0개면 `BAD_RESPONSE` 로 규칙기반 응답.
   - 판정 `addsSoftIngredient(card)` (`lib/explore.js`, 앱과 같은 정의): `installed:false` 재료 줄 중 하나라도 ⓐ 술 이름 목록(`lib/alcohol.js` `looksAlcoholic`)에 해당하지 않고 ⓑ 그 줄이 `addIngredient` 와 같은 재료(`normName` 일치)라면 카드의 `abv` 가 0(없으면 0)이고 `category` 가 `spirit`·`liqueur`·`wine` 이 아니면 → "무알콜 재료를 새로 더한다". (`addIngredient` 가 아닌 미장착 줄은 ⓐ만 봄 — 예: 트리플섹 + 토닉워터 카드는 통과, 진 + 화이트 럼 카드는 버림)
   - 이 경우 프롬프트에도 "카드마다 무알콜 재료를 새로 하나 이상 넣으라" 는 한 줄을 넣음. 성인 확인 전에는 2번의 성인 확인 전 규칙으로 이미 술 장착 카드가 빠지므로 실제로는 성인 확인(`adultVerified:true`) 시에 의미가 있음.

### 응답 — AI 실패/키 없음 → 규칙기반 대체 (여전히 HTTP 200)
`source:"fallback"`, `model:"rule-based"`, `warning`(한국어 안내), `warningCode`(아래 표) 가 붙습니다.

| warningCode | 의미 | 재시도 |
|---|---|---|
| `NO_API_KEY` | 서버에 `GEMINI_API_KEY` 없음 | 호출 안 함 |
| `TIMEOUT` | 14초 안에 응답 없음 | 안 함 |
| `RATE_LIMIT` | 429 (무료 등급 분당/일일 한도 등 — 문구에 "check your plan and billing details" 가 있어도 여기) | 1회(3초 이내 대기일 때만) |
| `BILLING` | **선불 크레딧 소진**(402 / "prepayment credits are depleted") → 3-3 참고. 'billing' 단어만 있는 일반 429 는 해당 없음 | 안 함 |
| `AUTH` | 키가 틀림/권한 없음 | 안 함 |
| `MODEL` | 404 모델 이름 오류 (`GEMINI_MODEL` 확인) | 안 함 |
| `BAD_REQUEST` | 400 (호환 모드 재시도까지 실패) | 호환 모드 1회 |
| `BAD_RESPONSE` | 응답이 JSON 이 아니거나 검증 후 재료가 0개 (탐색 전용 요청이면 카드 0개 — 단 성인 확인 전 술 카드나 `NO_MIXER` 의 술만 더하는 카드를 버려 0개가 된 경우는 재요청 없이 규칙기반 카드로 채우고 `source:"gemini"` 유지) | 1회 |
| `BLOCKED` | 안전 필터로 응답 차단 | 1회 |
| `NETWORK` / `UPSTREAM` | 네트워크 오류 / 5xx·기타 서버 오류 | 1회 |

> v2.0 의 `AI_TIMEOUT`, `AI_RATE_LIMIT`, `AI_ERROR` … 는 SPEC §3.2 에 맞춰 `TIMEOUT`, `RATE_LIMIT`, `UPSTREAM` … 으로 이름이 바뀌었습니다.

### 오류 응답 `{ "ok": false, "error": "한국어 메시지" }`
| HTTP | 경우 |
|---|---|
| 400 | JSON 아님/비어 있음, version≠2, **mode 값 오류**, ingredients 배열 아님·(normal 에서) 0개·펌프 번호 오류·중복, cupMl 범위 밖, strength 값 오류 |
| 405 | GET/POST/OPTIONS 외 메서드 |
| 413 | 본문 64KB 초과, prompt 8000자 초과 |
| 422 | (normal 모드만) 만들 수 있는 재료가 없음 (무알콜인데 주류만 장착 / 모든 잔량 0 / 성향의 알레르기·싫어하는 재료를 빼면 남는 재료 없음 / **도수 상한을 맞출 무알콜 재료가 없음** — 상한보다 독한 술만 장착) — AI 를 부르지 않음. AI·규칙기반 레시피가 모두 도수 상한을 못 맞춘 경우(`NO_MIXER`)도 422 |
| 500 | 예기치 못한 서버 오류 |

### POST `/api` (예전 방식, 하위호환)
`version` 이 없고 `prompt` 문자열이 있으면 예전처럼 자유 텍스트를 생성합니다.
```json
요청: { "prompt": "상큼한 무알콜 칵테일을 만들어줘." }
응답: { "ok": true, "result": "....(Gemini 텍스트)", "model": "gemini-3.6-flash" }
실패: { "ok": false, "error": "..." }  (키 없음 503, 시간초과 504, 한도 429, 크레딧 소진·기타 502)
```

---

## 6. curl 테스트 예시

Git Bash / macOS / Linux
```bash
URL=http://localhost:3000/api        # 배포 후에는 https://<주소>/api
curl $URL
curl -X POST $URL -H "Content-Type: application/json" --data-binary @test/sample-request.json
curl -X POST $URL -H "Content-Type: application/json" --data-binary @test/sample-explore-request.json
curl -X POST $URL -H "Content-Type: application/json" --data-binary @test/sample-explore-empty.json
curl -X POST $URL -H "Content-Type: application/json" -d '{"prompt":"안녕하세요"}'
```
Windows PowerShell (한글이 깨지지 않게 파일로 전송)
```powershell
$URL = "http://localhost:3000/api"
Invoke-RestMethod $URL
Invoke-RestMethod -Method Post -Uri $URL -ContentType "application/json; charset=utf-8" -InFile test/sample-explore-request.json | ConvertTo-Json -Depth 8
# 또는: curl.exe -X POST $URL -H "Content-Type: application/json" --data-binary "@test/sample-request.json"
```

---

## 7. 레시피 검증·보정 규칙 — SPEC §3.3 규칙 1~9 (앱과 **동일하게** 구현할 것)

`lib/recipe.js`, `lib/explore.js`, `lib/flavor.js`, `lib/fallback.js` 는 Node 전용 API 를 쓰지 않는 순수 JS 입니다. 앱 v3.0 은 같은 규칙을 TypeScript 로 옮겨(`../app/src/lib/ai/normalize.ts`·`explore.ts`·`offline*.ts`·`preference.ts`·`alcohol.ts`) 쓰고, 앱의 `tests/parity.test.ts` 가 이 파일들을 직접 불러와 결과가 같은지 비교합니다. 규칙을 바꾸면 SPEC → 이 폴더 → 앱 순서로 함께 고치세요.

| 함수 (파일) | 역할 |
|---|---|
| `validateRecipeRequest(body)` (recipe) | 요청 검증·정리 → `{ok:true, value:{mode, user, ingredients, history}}` / `{ok:false, status:400, error}`. `user.adultVerified` 는 `=== true` 일 때만 true |
| `sanitizeIngredients(list, {allowEmpty})` (recipe) | 장착 재료 정리 (빈 슬롯 제외, 펌프 1~8·중복 검사, abv 0~100, remainingMl ≥0 또는 null) |
| `usableIngredients(ingredients, strength, excludePumps?)` (recipe) | 이번에 쓸 수 있는 재료: 잔량>0(또는 모름) 이고, `none` 이면 abv=0 만, 성향으로 뺀 펌프 제외 |
| `lacksMixer(ingredients, strength, excludePumps?)` (recipe) | 도수 상한을 맞출 재료가 아예 없는지(쓸 수 있는 재료가 모두 상한보다 독한 술) → 서버는 AI 를 부르지 않고 422 / explore 는 `recipe:null` |
| **`normalizeRecipe(raw, ingredients, {cupMl, strength, excludePumps, adultVerified})`** (recipe) | **규칙 1~7 + 9** (+ `suggestions` 정리: 무알콜·성인 확인 전이면 술 장착·대체 제안 제거) |
| **`capStrength(recipe, ingredients, strength, excludePumps)`** (recipe) | **규칙 8** (+ 바뀐 양으로 규칙 9 재계산). 섞을 무알콜 재료가 없으면 `{ok:false, code:"NO_MIXER"}` |
| `finalizeRecipe(raw, ingredients, {cupMl, strength, excludePumps, adultVerified})` (recipe) | `normalizeRecipe` → `capStrength` (서버가 실제로 쓰는 파이프라인). 실패 시 `{ok:false, code:"EMPTY_RECIPE"\|"NO_MIXER", error}`. `adultVerified` 는 `=== true` 일 때만 성인 확인(생략 = 성인 확인 전) |
| `sanitizeSuggestions(list, ingredients, byPump, strength, adultVerified)` (recipe) | `suggestions` 정리 (7번 절 '기타'). `blocksAlcoholSuggestions(strength, adultVerified)`(= `strength==='none' \|\| adultVerified!==true`)이면 `isAlcoholSuggestion` 인 제안 제거 |
| `isAlcoholSuggestion(s, ingredients, byPump)` (recipe) | 정리된 제안 하나가 술 장착·대체 제안인지: `type` 이 `add_ingredient`/`substitute` 이고 ⓐ `ingredient` 가 술 이름(`looksAlcoholic`)이거나 장착된 술(abv>0)과 `normName` 일치, ⓑ `pump` 가 장착된 술 펌프, ⓒ `message` 에 술 이름 — 중 하나 |
| `preferenceExcludedPumps(ingredients, preference)` (fallback) | 성향 문장에서 알레르기·싫어하는 재료로 적힌 장착 재료의 펌프 Set → `excludePumps` 로 넘김 |
| `normalizeExplore(list, ingredients, {cupMl, strength, mode, adultVerified, excludePumps, excludeName})` (explore) | 탐색 카드 검증·보정 (5번 절) → `{items, notes, removedAdult, removedNoMixer}` (`removedAdult` = 성인 확인 전이라 버린 술 카드 수(무알콜 규칙으로 버린 것 포함), `removedNoMixer` = 무알콜 줄이 없어 도수 상한을 못 맞춰 버린 카드 수). `excludePumps`·`excludeName(이름)` = 성향 제외(5번 절 2) |
| `uninstalledLineAbv(name)` (explore) | `addIngredient` 가 아닌 미장착 줄의 도수: 앱 프리셋 술 도수 / 술 이름이면 40 / 0 (5번 절 5) |
| `addsSoftIngredient(card)` / `filterNoMixerExplore(items)` (explore) | `NO_MIXER` 로 `recipe:null` 일 때 카드 거르기 (5번 절 7) → `filterNoMixerExplore` 는 `{items, removed}` |
| `estimateFlavor(items, byPump)`, `abvToStrengthLevel(abv)` (flavor) | 맛 추정, 도수 → 체감 0~5 |
| `buildFallbackRecipe(user, ingredients, history)` (fallback) | 규칙기반 원본 레시피 (결과는 반드시 `finalizeRecipe` 로 보정) |
| `buildFallbackExplore(user, ingredients, history, {mode})` (fallback) | 규칙기반 탐색 카드 원본 (결과는 반드시 `normalizeExplore` 로 보정) |

규칙별 구현
1. **재료 매칭**: AI 가 준 `name` 이 장착 재료 이름과(대소문자·공백·기호 무시) **정확히 하나** 일치하면 그 펌프(이름 우선) → 아니면 `pump` 번호가 장착돼 있으면 그 펌프 → 둘 다 아니면 **제거**. 이름은 장착 재료 이름으로 바꿔 씀. **같은 펌프는 합산**(합산 전 음수는 0, 처음 나온 위치 = 붓는 순서 유지). `excludePumps`(성향의 알레르기·싫어하는 재료 — 판정은 8-1 의 2번 `excludedByPreference`, 절 단위·쉼표로는 안 나눔) 펌프는 AI 가 넣었어도 **제거**.
2. `strength = none` → **abv > 0 재료 제거**.
3. **ml < 0 → 0**, 숫자가 아니면 0, **소수 1자리 반올림**, **0ml 재료 제거**.
4. **총량을 cupMl 에 비례 보정**: `ml × cupMl / 합계` 를 소수 1자리 반올림하고, 반올림 나머지는 **가장 많은 재료**에 더해 합계를 정확히 cupMl 로.
5. **잔량 초과** → 그 재료는 `remainingMl` 까지만(소수 1자리 **내림**) 사용하고 `low_stock` 제안(펌프 번호 포함)을 맨 앞에 추가. 이때 totalMl 은 cupMl 보다 작아질 수 있음.
6. **재료당 최대 300ml**(펌웨어 `maxStepMl`) — 초과분은 300 으로 자름(totalMl 이 줄 수 있음). 규칙 8 에서 무알콜 재료를 늘릴 때도 300ml·잔량을 넘지 않음.
7. 남은 재료가 0개면 **오류** `{ok:false, code:"EMPTY_RECIPE"}` (서버는 AI 재요청 → 규칙기반 대체).
8. **도수 상한**(`capStrength`): `light` ≤ 5%, `medium` ≤ 12%, `strong` ≤ 20%. 넘으면 술(abv>0) 양을 줄이고 줄인 만큼 레시피의 무알콜 재료를 비율대로 늘려 **총량 유지**(목표 = 상한 − 0.2%p). 레시피에 무알콜 재료가 없으면 장착된 무알콜 재료(탄산 > 주스 > 물 > 기타 > 유제품 > 시럽, 잔량 10ml 이상, `excludePumps` 제외)를 **하나 추가**(맨 뒤). 무알콜 재료가 잔량·300ml 를 넘으면 그만큼만 쓰고 술을 더 줄여 상한 유지. **섞을 무알콜 재료가 전혀 없으면 상한을 지킬 수 없으므로 실패 `{ok:false, code:"NO_MIXER"}`** (규칙 4 가 술만 든 레시피를 cupMl 까지 늘려 놓았기 때문에 '그대로 두기'는 독한 술 200~500ml 가 됨) → 서버는 AI 재요청 → 규칙기반 → 그래도 실패면 normal 422 / explore `recipe:null`+`notice`+섞을 재료 explore 제안(규칙기반 후보는 탄산수·토닉워터·레몬즙 같은 무알콜 재료가 먼저. AI·규칙기반 카드 모두 **무알콜 재료를 새로 더하는 카드만** 남기고, 0개가 되면 AI 재호출 없이 규칙기반으로 채움 — 5번 절 explore 7). 반올림 뒤 합계가 보정 전 총량을 넘지 않게 나머지를 정리(남으면 가장 많은 술에서 빼고, 모자라면 가장 많은 무알콜 재료에 더함 — cup 500 에서 500.1 이 되면 펌웨어가 LIMIT 으로 거절).
9. **`estimatedAbv = Σ(ml × abv) / 총ml`** 소수 1자리로 다시 계산(AI 값 무시). **`flavor.strength`** = 도수 0→0, ≤5→1, ≤10→2, ≤15→3, ≤20→4, 그 이상→5. `flavor` 의 나머지 값은 AI 값을 0~5 정수로 제한(없으면 추정).
- 기타: 텍스트 길이 제한(name 40, description 120, reason 400, garnish 80, tips 200자), `suggestions` 정리(타입이 목록 밖이면 `info`, 이미 장착된 재료의 `add_ingredient` 제거, **`none`(무알콜)이거나 성인 확인 전(`adultVerified` ≠ true, 생략 포함)이면 술을 장착·대체하라는 `add_ingredient`/`substitute` 제거**(`isAlcoholSuggestion`: 재료 이름이 술·장착된 술이거나, 펌프가 장착된 술 펌프이거나, 문구에 술 이름 — AI·규칙기반 레시피 모두 `finalizeRecipe` 에서), 펌프 없는 `low_stock` 은 이름으로 펌프 찾기 → 없으면 `info`, 같은 펌프 `low_stock` 중복 제거, 최대 5개).

---

## 8. 규칙기반 추천(fallback) — `lib/fallback.js`

### 8-1. 레시피 `buildFallbackRecipe`
1. **원하는 맛 벡터**: taste 값(없으면 2.5) + 보정
   - 기분: 피곤→신맛+1·탄산+1 / 우울→단맛+1 / 스트레스→신맛+1·탄산+1 / 설렘·행복→단맛+1·탄산+1 / 차분·휴식→탄산−1
   - 날씨: 25°C 이상·더움→탄산+1·신맛+1 / 8°C 이하·눈·추움→단맛+1·탄산−1 / 비·흐림→단맛+1
   - 상황: 운동→단맛−1·신맛+1 / 파티→탄산+1 / 데이트→단맛+1 / 공부·작업→단맛−1
   - 성향 문장: "달지 않게"→단맛−2, "달달"→+1, "상큼"→신맛+1, "탄산 싫어"·"탄산은 싫어요"→탄산 0 …
   - 사용자가 **0 을 고른 맛은 보정과 상관없이 0** 유지
2. **제외**: 잔량 5ml 미만, `none` 이면 주류, 성향에서 **그 재료에 걸린** "싫어/빼/알레르기…" 가 적힌 재료(`excludedByPreference`):
   - 문장을 절로 나눔(마침표·느낌표·물음표·`;`·`~`·줄바꿈·`/`, "근데/그런데/하지만/지만/는데/은데/인데"). 쉼표·"그리고"로는 나누지 않음("우유, 사이다는 빼 주세요" 는 둘 다 제외).
   - 같은 절에서 재료 이름 **바로 뒤 10글자 안**에 부정 표현(싫·빼·제외·알레르기·알러지·못먹·안먹·안넣·넣지 마/말/않·없이·안 좋·좋지 않·별로)이 긍정 표현(좋·최고·사랑·원해·넣어)보다 먼저 나오면 제외. 이름 **앞 12글자 안**에 "알레르기/알러지/제외" 가 있고 뒤에 긍정 표현이 없어도 제외("알레르기: 우유, 땅콩").
   - 예: "오렌지주스 정말 좋아해요. 탄산은 싫어요" → 오렌지주스 유지 / "탄산수 좋아요, 우유는 싫어요" → 우유만 제외.
   - 같은 결과(`preferenceExcludedPumps`)를 서버가 `finalizeRecipe` 의 `excludePumps` 로 넘겨, AI 레시피와 도수 보정(규칙 8 의 섞을 재료)에서도 그 재료를 쓰지 않음.
3. **점수** = Σ(재료 맛 프로필 × (원하는 값 − 2.5)) / 5 + 기록 보너스(👍 +0.6, 👎·거절 −0.8) − 물 1 − 잔량 부족 0.5.
4. **무알콜 재료 1~3개** 선택(1위 필수, 2위 점수>−0.3, 3위 점수>0.3). 탄산 원함(≥4)이면 탄산 포함, 탄산 싫음(≤1)이면 제외. 시럽·레몬류만 골랐으면 양을 채울 기본 재료 1개 추가.
5. **술**: 목표 도수 light 4% / medium 9% / strong 16% 가 되도록 `ml = 목표 × cupMl / abv` (증류주 우선, 단맛≥3 이면 리큐르 30% 섞음, 술은 잔의 60% 이하).
6. **분배**: 남은 양을 `e^점수` 비율로 나눔. 시럽 ≤ 15%, 레몬·라임(신맛 5) ≤ 20%.
7. **붓는 순서**: 증류주 → 리큐르 → 발효주 → 시럽 → 주스 → 유제품 → 기타 → 물 → **탄산(마지막)**.
8. **거절 조합 피하기 (SPEC §5.3)**: 결과의 재료 조합(이름 집합, `normName`)이 `history` 의 `rejected:true` 레시피와 **같으면**, 재료를 1개 → 2개 빼 보거나 안 쓴 장착 재료를 1개 넣어 **다른 조합**을 찾습니다(술이 있던 레시피는 술이 남는 조합 우선). 비교는 **`finalizeRecipe` 로 보정한 최종 재료**로 합니다(규칙 8 이 방금 뺀 무알콜 재료를 다시 넣어 거절 조합으로 돌아가는 대안은 쓰지 않음). 비율만 바꾸는 것은 다른 조합이 전혀 없을 때만 하고, 그때는 "새 재료를 장착해 보세요" 안내를 붙입니다.
9. 이름(예: "리프레시 스파클링 에이드"), 설명, 이유(입력한 기분·날씨·맛 언급), 가니시, 팁, `add_ingredient` 제안을 만들고, 마지막에 `finalizeRecipe` 로 보정.
   - 도수를 골랐는데 쓸 수 있는 술이 없어 무알콜로 만든 경우 `info` 안내: 성인 확인 전이면 **"장착된 주류가 없어 무알콜로 만들었어요."** 까지만(`NO_ALCOHOL_INFO`), 성인 확인(`adultVerified:true`)이면 "… 보드카·럼 같은 술을 장착하면 칵테일도 만들 수 있어요." 를 덧붙임(`NO_ALCOHOL_INFO_ADULT`).

### 8-2. 탐색 카드 `buildFallbackExplore` — SPEC §5.4 후보 목록 (위에서부터 우선)
| 후보 | category | abv | 고르는 조건 |
|---|---|---|---|
| 탄산수 | soda | 0 | soda 미장착 + fizzy ≥ 2 |
| 토닉워터 | soda | 0 | soda 미장착 또는 bitter ≥ 2 |
| 레몬즙 | juice | 0 | 산미 재료(레몬·라임·자몽 등) 없음 + sour ≥ 2 |
| 설탕시럽 | syrup | 0 | syrup 미장착 + sweet ≥ 2 |
| 그레나딘 시럽 | syrup | 0 | syrup 미장착 (색감) |
| 크랜베리주스 | juice | 0 | juice 1개 이하 |
| 우유 | dairy | 0 | dairy 미장착 + 휴식/디저트 상황 |
| 진 · 보드카 · 화이트 럼 (먼저 가능한 1개) | spirit | 40 | strength ≠ none 이고 spirit 미장착 이고 `user.adultVerified` |
| 트리플섹 | liqueur | 30 | strength ≠ none 이고 liqueur 미장착 이고 `user.adultVerified` |

- 맛 조건은 사용자 taste 값(상관없음 = 2.5)으로 판단. 개수: explore 최대 3개, normal 1개.
- **제외**: 장착된 재료와 이름이 같은 후보(SPEC §3.1 `normName` — 예: `설탕-시럽` 장착 → `설탕시럽` 제외), **거절 기록에 2번 이상 나온 후보**, 성향에 "싫어/알레르기" 로 적힌 후보(8-1 의 2번 규칙), 무알콜이거나 **성인 확인 전**이면 술 후보(아래 채우기·안전장치에서도 술로 채우지 않음).
- 조건의 정규식(앱 오프라인 탐색도 같은 문자열을 써야 함, `fallback.js` 에서 export): 산미 재료 `SOUR_NAME_RE = /레몬|라임|자몽|유자|깔라만시|매실|lemon|lime|grapefruit/i`(장착 재료 이름에 대해), 휴식/디저트 상황 `RELAX_RE = /휴식|디저트|릴랙스|편안|차분|힐링/`(situation + preference 에 대해).
- 조건을 만족하는 후보가 없으면 **탄산수 → 레몬즙 → 설탕시럽** 순으로 채움.
- 각 후보 + 쓸 수 있는 장착 재료로 8-1 규칙에 따라 레시피를 만듦. 장착 재료를 하나도 못 쓰거나 양을 채울 기본 재료가 없으면(빈 기기 등) **두 번째 새 재료**(예: 탄산수 ↔ 레몬즙, 진 ↔ 토닉워터)를 함께 권함 → 미장착 재료 최대 2개.

---

## 9. Gemini 호출 안정성

| 상황 | 동작 |
|---|---|
| 키 없음 | 호출 안 함 → fallback (`NO_API_KEY`) |
| 1회 호출 | `AbortController` **14초 타임아웃**, 재시도 포함 **전체 한도 20초** (앱의 서버 대기 50초, `vercel.json` maxDuration 60초보다 작음) |
| 429 / 5xx / 네트워크 오류 | **1회 재시도**(0.7초 후). 429 가 3초보다 오래 기다리라고 하면(Retry-After/RetryInfo) 재시도 없이 바로 fallback. 무료 등급의 일반 429 문구("You exceeded your current quota, please check your plan and **billing** details…")도 여기(`RATE_LIMIT`) |
| 크레딧 소진(402·"prepayment credits are depleted") | 재시도 없이 fallback (`BILLING`) — 'billing' 단어만으로는 BILLING 으로 보지 않음 |
| 타임아웃 | 재시도 없이 fallback (사용자를 더 기다리게 하지 않음) |
| 응답 JSON 파싱 실패 / 보정 후 재료 0개 / 안전 차단 | **1회 재요청** |
| 400 (스키마·thinking 미지원 등) | 호환 모드로 1회 재요청 |
| 401·403·키 오류 / 404 모델 없음 | 재시도 없이 fallback |
| 그래도 실패 | **규칙기반 fallback, HTTP 200** + `warning`/`warningCode` |

> v3.0 앱은 서버를 부르지 않으므로(앱이 Gemini 를 직접 부를 때 25초 한도) 아래 관계는 v2.1 앱과 이 서버를 함께 쓸 때만 의미가 있습니다. `app/src/lib/ai/recommend.ts` 에 `SERVER_TIMEOUT_MS` 가 없으면 테스트(r12)는 SPEC 값 50초로 비교합니다.

**시간 한도 불변식 (SPEC §3.1, v2.1)**: 서버 전체 한도(`settings.totalBudgetMs` 20초) + 네트워크·콜드스타트·fallback 생성 여유 **<** 앱이 서버 응답을 기다리는 시간(`app/src/lib/ai/recommend.ts` 의 `SERVER_TIMEOUT_MS` **50초**). Gemini 1회 호출은 14초(`settings.timeoutMs`).
이것이 깨지면 서버의 재요청·재시도 결과나 서버 fallback 이 앱에 도착하기 전에 앱이 끊고 오프라인 추천으로 넘어가, Vercel 실행 시간과 Gemini 할당량만 쓰고 결과는 버려집니다.
최악의 경우(첫 응답이 14초 직전에 불량/503 → 남은 시간 안에서 재시도)에도 서버는 약 20초 안에 응답합니다. 앱의 `AI_TIMEOUT_MS`(25초)는 앱이 Gemini 를 **직접** 부를 때(선택 기능)만 쓰는 값이라 이 관계와 무관합니다. 직접 모드는 Gemini 를 최대 25초 기다린 뒤 실패하면 서버를 다시 최대 50초 기다리므로 최악의 경우 두 시간의 합(75초)입니다.
`settings` 값을 바꾸면 `test/local-test.js` (r12) 가 이 관계를 검사합니다(앱 소스가 옆에 있으면 `SERVER_TIMEOUT_MS` 값을 직접 읽어 비교, 없으면 SPEC 값 50초).

---

## 10. 보안 주의
- **인증·요청 제한이 없는 공개 엔드포인트**입니다(CORS `*`). 실제 키로 공개 배포하지 마세요 — 3장 맨 앞의 경고.
- 키는 **Vercel 환경변수에만** 저장합니다. 코드·앱·텍스트 파일·채팅에 평문으로 두지 마세요. 노출된 적이 있는 키는 AI Studio 에서 **삭제 후 재발급**하세요(3-3).
- 키는 URL 쿼리(`?key=`)가 아니라 `x-goog-api-key` 헤더로 보냅니다. (URL 은 로그에 남기 쉬움)
- 어떤 응답·로그에도 키를 넣지 않습니다(로그는 키 형태 문자열을 `***` 로 가림).
- 사용자 자유 입력(성향)은 "취향 정보로만" 쓰도록 시스템 지시문에 명시했고, 어떤 AI 출력이든 서버가 장착 재료·용량·도수 규칙으로 다시 검증합니다.

## 11. 문제 해결
- `version` 이 `2.0.0` 으로 나옴 → 새 코드가 배포되지 않음. `npx vercel --prod` 다시 실행.
- `keyConfigured:false` → 환경변수 등록 후 **재배포**했는지 확인.
- 항상 `source:"fallback"` → 응답의 `warningCode` 확인(5번 표), Vercel 대시보드 → 프로젝트 → **Logs** 에서 `[gemini] 시도 1: ...` 로그 확인.
- `BILLING` → 3-3 (크레딧 충전 또는 무료 등급 프로젝트의 새 키). 로그에 "prepayment credits are depleted" 또는 HTTP 402 가 있을 때만 이 코드가 나옵니다(무료 등급 한도 초과는 `RATE_LIMIT`).
- `RATE_LIMIT` 이 자주 남 → 무료 등급 분당/일일 한도. 잠시 후 재시도.
- `MODEL` → `GEMINI_MODEL` 철자 확인(비우면 기본값 `gemini-3.6-flash`).
- `AUTH` → 키를 잘못 붙여넣었거나 삭제된 키. 새 키로 교체 후 재배포.
