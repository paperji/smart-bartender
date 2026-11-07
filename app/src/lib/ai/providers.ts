/**
 * AI 서비스 목록 (v3.1 — Gemini 말고도 사용자가 가진 다른 AI 키로 레시피 만들기, BYOK)
 *  - 회사별: API 주소·인증 방식·기본 모델·JSON 응답 방식·키 발급 안내(설정 › 키 발급 방법)
 *  - 모두 앱(브라우저·APK·EXE)에서 직접 부를 수 있음(CORS 허용) — 2026-11-07 확인. 키는 그 회사에만 보냄
 *  - 발급 안내·무료 여부·모델 이름은 2026-11-07 각 회사 공식 문서 기준 (바뀔 수 있어 [키 확인]의 모델 목록을 우선)
 * 화면 문구는 해요체. 버튼 이름은 그 회사 화면에 보이는 영어를 따옴표로.
 */

export type AiProviderId = 'gemini' | 'openai' | 'anthropic' | 'xai' | 'deepseek' | 'mistral' | 'groq' | 'openrouter';

/** 요청 방식: Gemini 고유 / OpenAI 호환(chat/completions) / Anthropic Messages */
export type AiProviderKind = 'gemini' | 'openai' | 'anthropic';

/** 무료로 쓸 수 있는지 — free: 결제 없이 키 사용 / partial: 무료 모델만 / paid: 선불 충전 필요 */
export type FreeLevel = 'free' | 'partial' | 'paid';

export interface KeyGuideStep {
  title: string;
  body: string;
}

export interface AiProvider {
  id: AiProviderId;
  /** 화면에 보이는 AI 이름 (예: ChatGPT) */
  label: string;
  /** 이름을 읽을 때 끝소리 받침 (조사 고르기 — 챗지피티 none, 그록 other, 미스트랄 rieul) */
  final: 'none' | 'rieul' | 'other';
  /** 만든 회사 */
  company: string;
  kind: AiProviderKind;
  /** API 기본 주소 (끝 / 없음) */
  apiBase: string;
  /** 콘텐츠 보안 정책(EXE)에 넣을 주소 */
  origin: string;
  /** 기본 모델 (키 확인 전에도 씀) */
  defaultModel: string;
  /** 키 확인 전 모델 칸에 보여 줄 추천 모델 (첫 번째가 기본) */
  suggestedModels: string[];
  /** 키를 만드는 화면 주소 */
  keyPageUrl: string;
  /** [○○ 열기] 버튼 이름 */
  keySiteLabel: string;
  /** 키 모양 (붙여 넣은 키로 어느 회사 키인지 짐작) — 없으면 null */
  keyPattern: RegExp | null;
  /** 키 입력칸 안내 (예: 'sk-proj-… 로 시작') */
  keyShape: string;
  free: FreeLevel;
  /** 무료·비용 한 줄 */
  priceNote: string;
  /** 키 발급 단계 */
  steps: KeyGuideStep[];
  /** 더 알아 둘 것 */
  notes: string[];
}

export const AI_PROVIDERS: readonly AiProvider[] = [
  {
    id: 'gemini',
    label: 'Gemini',
    final: 'none',
    company: 'Google',
    kind: 'gemini',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    origin: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.6-flash',
    suggestedModels: ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
    keyPageUrl: 'https://aistudio.google.com/apikey',
    keySiteLabel: 'Google AI Studio',
    keyPattern: /^(AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_.-]{10,})$/,
    keyShape: 'AIza… 또는 AQ.… 로 시작해요',
    free: 'free',
    priceNote: '무료 등급이 있어 결제 없이 바로 쓸 수 있어요(분당·하루 한도 있음).',
    steps: [
      { title: 'Google AI Studio 열기', body: '아래 버튼을 눌러 Google 계정으로 로그인해요. 처음이면 약관에 동의하면 기본 프로젝트가 저절로 만들어져요.' },
      { title: 'API 키 만들기', body: '"Create API key"(API 키 만들기)를 눌러요. 프로젝트를 고르라고 하면 기본 프로젝트를 고르면 돼요.' },
      { title: '복사해서 붙여 넣기', body: '만들어진 키를 복사해 위 API 키 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: [
      '카드 등록 없이 무료로 쓸 수 있어요. 한도를 넘으면 잠시 뒤 다시 되고, 그동안은 오프라인 추천으로 이어서 만들어요.',
      '"기기 확인(verification)"이 필요하다는 오류가 나면 AI Studio 의 Projects 화면에서 "Verify project"를 누르고 휴대폰으로 QR 코드를 찍어 확인해요.',
      '무료 등급에서 보낸 내용은 Google 서비스 개선에 쓰일 수 있어요. 결제(유료 등급)를 연결한 키는 쓴 만큼 요금이 나가요.',
    ],
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    final: 'none',
    company: 'OpenAI',
    kind: 'openai',
    apiBase: 'https://api.openai.com/v1',
    origin: 'https://api.openai.com',
    defaultModel: 'gpt-6-luna',
    suggestedModels: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-5.4-mini'],
    keyPageUrl: 'https://platform.openai.com/settings/organization/api-keys',
    keySiteLabel: 'OpenAI 플랫폼',
    keyPattern: /^sk-(proj|svcacct|None)-[0-9A-Za-z_-]{20,}$/,
    keyShape: 'sk-proj-… 로 시작해요',
    free: 'paid',
    priceNote: '먼저 크레딧을 충전해야 해요(최소 $5). ChatGPT Plus 구독과는 따로예요.',
    steps: [
      { title: 'OpenAI 플랫폼 로그인', body: '아래 버튼으로 platform.openai.com 을 열고 "Sign up" 또는 "Log in"(ChatGPT 계정 그대로 가능)을 눌러요.' },
      { title: '크레딧 충전', body: 'Settings › Billing 에서 결제 수단을 넣고 "Buy credits"(또는 "Add to credit balance")로 충전해요. 최소 $5 예요.' },
      { title: '키 만들기', body: 'API keys 화면에서 "Create new secret key" → 이름 입력 → "Create secret key"를 눌러요. 첫 키는 휴대폰 문자 인증을 할 수 있어요.' },
      { title: '복사해서 붙여 넣기', body: '키(sk-proj-…)는 한 번만 보여요. 바로 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: [
      'ChatGPT 앱의 Plus·Pro 구독으로는 API 를 쓸 수 없어요. API 는 충전한 크레딧에서 쓴 만큼 빠져요.',
      '기본 모델 gpt-6-luna 는 OpenAI 모델 중 가장 저렴해서 레시피 한 잔에 몇 원 정도예요.',
    ],
  },
  {
    id: 'anthropic',
    label: 'Claude',
    final: 'none',
    company: 'Anthropic',
    kind: 'anthropic',
    apiBase: 'https://api.anthropic.com/v1',
    origin: 'https://api.anthropic.com',
    defaultModel: 'claude-haiku-5-5',
    suggestedModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    keyPageUrl: 'https://platform.claude.com/settings/keys',
    keySiteLabel: 'Claude Console',
    keyPattern: /^sk-ant-api[0-9A-Za-z_-]{20,}$/,
    keyShape: 'sk-ant-api… 로 시작해요',
    free: 'paid',
    priceNote: '먼저 크레딧을 사야 해요. claude.ai 의 Pro 구독과는 따로예요.',
    steps: [
      { title: 'Claude Console 로그인', body: '아래 버튼으로 platform.claude.com 을 열고 가입하거나 로그인해요.' },
      { title: '크레딧 구매', body: 'Settings › Billing 에서 "Buy credits"를 눌러 충전해요. 잔액이 없으면 키가 동작하지 않아요.' },
      { title: '키 만들기', body: 'Settings › API keys 에서 "Create key"를 눌러 이름을 적고, 작업 공간(Default Workspace)을 골라요.' },
      { title: '복사해서 붙여 넣기', body: '키(sk-ant-…)는 한 번만 보여요. 바로 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: [
      'claude.ai 앱의 Pro·Max 구독으로는 API 를 쓸 수 없어요. API 는 산 크레딧에서 쓴 만큼 빠져요.',
      '기본 모델 claude-haiku-5-5 는 가장 빠르고 저렴한 Claude 예요.',
    ],
  },
  {
    id: 'xai',
    label: 'Grok',
    final: 'other',
    company: 'xAI',
    kind: 'openai',
    apiBase: 'https://api.x.ai/v1',
    origin: 'https://api.x.ai',
    defaultModel: 'grok-4.3',
    suggestedModels: ['grok-4.3', 'grok-4.7'],
    keyPageUrl: 'https://console.x.ai/team/default/api-keys',
    keySiteLabel: 'xAI 콘솔',
    keyPattern: /^xai-[0-9A-Za-z_-]{20,}$/,
    keyShape: 'xai-… 로 시작해요',
    free: 'paid',
    priceNote: '먼저 선불 크레딧을 충전해야 해요.',
    steps: [
      { title: 'xAI 콘솔 가입', body: '아래 버튼으로 console.x.ai 를 열고 X 계정이나 다른 방법으로 가입·로그인해요.' },
      { title: '크레딧 충전', body: 'Billing 에서 선불 크레딧을 사요(카드 결제). 잔액이 없으면 요청이 거절돼요.' },
      { title: '키 만들기', body: '왼쪽 "API Keys"에서 "Create API Key"를 눌러 이름을 적어요. 쓸 수 있는 기능·모델은 "모두 허용"이 가장 간단해요.' },
      { title: '복사해서 붙여 넣기', body: '키(xai-…)를 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: ['기본 모델 grok-4.3 은 생각(추론)을 끄고 빠르게 답하게 불러요.'],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    final: 'none',
    company: 'DeepSeek',
    kind: 'openai',
    apiBase: 'https://api.deepseek.com',
    origin: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    suggestedModels: ['deepseek-flash', 'deepseek-v4-pro'],
    keyPageUrl: 'https://platform.deepseek.com/api_keys',
    keySiteLabel: 'DeepSeek 플랫폼',
    keyPattern: null,
    keyShape: 'sk-… 로 시작해요',
    free: 'paid',
    priceNote: '먼저 충전해야 해요. 값이 아주 싼 편이에요.',
    steps: [
      { title: 'DeepSeek 플랫폼 가입', body: '아래 버튼으로 platform.deepseek.com 을 열고 이메일로 가입·로그인해요.' },
      { title: '충전', body: '"Top up"에서 충전해요(PayPal·카드). 잔액이 0 이면 "Insufficient Balance" 오류가 나요.' },
      { title: '키 만들기', body: '왼쪽 "API keys"에서 "Create new API key"를 누르고 이름을 적어요.' },
      { title: '복사해서 붙여 넣기', body: '키(sk-…)는 한 번만 보여요. 바로 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: ['보낸 내용은 중국의 DeepSeek 서버에서 처리돼요. 신경 쓰이면 다른 AI 를 골라 주세요.'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    final: 'rieul',
    company: 'Mistral AI',
    kind: 'openai',
    apiBase: 'https://api.mistral.ai/v1',
    origin: 'https://api.mistral.ai',
    defaultModel: 'mistral-small-latest',
    suggestedModels: ['mistral-small-latest', 'mistral-large-4'],
    keyPageUrl: 'https://console.mistral.ai/api-keys',
    keySiteLabel: 'Mistral 콘솔',
    keyPattern: null,
    keyShape: '앞부분 없이 영문·숫자 32자 정도예요',
    free: 'paid',
    priceNote: '결제를 켜고 크레딧을 충전해야 API 키가 동작해요.',
    steps: [
      { title: 'Mistral 콘솔 가입', body: '아래 버튼으로 console.mistral.ai 를 열고 "Create account"로 가입한 뒤 조직 이름을 정해요.' },
      { title: '결제 켜기', body: 'Admin › Billing 에서 "Add payment method"로 카드를 넣고 "Add credits"로 충전한 뒤 pay-as-you-go 를 켜요. 무료 모드에서는 API 키가 동작하지 않아요.' },
      { title: '키 만들기', body: 'Studio › "API Keys"에서 "New key"를 누르고 이름·만료일을 정해요.' },
      { title: '복사해서 붙여 넣기', body: '키는 한 번만 보여요. 바로 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: ['결제를 켜고 2~3분 뒤부터 키가 동작해요.'],
  },
  {
    id: 'groq',
    label: 'Groq',
    final: 'other',
    company: 'Groq',
    kind: 'openai',
    apiBase: 'https://api.groq.com/openai/v1',
    origin: 'https://api.groq.com',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    keyPageUrl: 'https://console.groq.com/keys',
    keySiteLabel: 'Groq 콘솔',
    keyPattern: /^gsk_[0-9A-Za-z]{20,}$/,
    keyShape: 'gsk_… 로 시작해요',
    free: 'free',
    priceNote: '무료 플랜이 있어 카드 없이 쓸 수 있어요(분당·하루 한도 있음).',
    steps: [
      { title: 'Groq 콘솔 가입', body: '아래 버튼으로 console.groq.com 을 열고 Google·GitHub·이메일로 가입·로그인해요.' },
      { title: '키 만들기', body: '"API Keys" 화면에서 "Create API Key"를 누르고 이름을 적어요.' },
      { title: '복사해서 붙여 넣기', body: '키(gsk_…)는 한 번만 보여요. 바로 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: [
      '무료 플랜은 분당 30번, 하루 1,000번 정도까지 불러요. 넘으면 잠시 뒤 다시 돼요.',
      '공개 모델(gpt-oss)을 아주 빠르게 돌려 줘요. 한국어 표현은 Gemini·ChatGPT·Claude 보다 조금 어색할 수 있어요.',
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    final: 'none',
    company: 'OpenRouter',
    kind: 'openai',
    apiBase: 'https://openrouter.ai/api/v1',
    origin: 'https://openrouter.ai',
    defaultModel: 'openrouter/free',
    suggestedModels: ['openrouter/free', 'openai/gpt-6-luna', 'google/gemini-3.5-flash-lite'],
    keyPageUrl: 'https://openrouter.ai/settings/keys',
    keySiteLabel: 'OpenRouter',
    keyPattern: /^sk-or-v1-[0-9A-Za-z]{20,}$/,
    keyShape: 'sk-or-v1-… 로 시작해요',
    free: 'partial',
    priceNote: '무료 모델은 결제 없이 하루 50번까지, 다른 모델은 크레딧을 사야 해요.',
    steps: [
      { title: 'OpenRouter 로그인', body: '아래 버튼으로 openrouter.ai 를 열고 오른쪽 위 "Sign in"을 눌러 Google·GitHub·이메일로 가입해요.' },
      { title: '키 만들기', body: 'Settings › Keys 에서 "Create API Key"를 누르고 이름을 적어요(쓸 수 있는 금액 한도도 정할 수 있어요).' },
      { title: '복사해서 붙여 넣기', body: '키(sk-or-v1-…)는 한 번만 보여요. 바로 복사해 위 칸에 붙여 넣고 [키 확인] → [저장]을 눌러요.' },
    ],
    notes: [
      '여러 회사의 AI 를 키 하나로 골라 쓸 수 있어요. 기본값 openrouter/free 는 무료 모델 중 하나를 골라 줘요.',
      '무료 모델이 "데이터 정책" 오류로 안 되면 openrouter.ai/settings/privacy 에서 무료 모델 사용을 켜 주세요.',
    ],
  },
];

const BY_ID = new Map(AI_PROVIDERS.map((p) => [p.id, p]));

export const DEFAULT_PROVIDER: AiProviderId = 'gemini';

export function isProviderId(v: unknown): v is AiProviderId {
  return typeof v === 'string' && BY_ID.has(v as AiProviderId);
}

/** id → 서비스 정보 (모르는 값이면 Gemini) */
export function providerOf(id: unknown): AiProvider {
  return BY_ID.get(id as AiProviderId) ?? (BY_ID.get(DEFAULT_PROVIDER) as AiProvider);
}

/** 화면 이름 (예: 'ChatGPT') */
export function providerLabel(id: unknown): string {
  return providerOf(id).label;
}

/**
 * 붙여 넣은 키 모양으로 어느 회사 키인지 짐작 (모르면 null).
 * sk-… 만 있는 키(DeepSeek·예전 OpenAI)는 구분할 수 없어 null
 */
export function guessProvider(key: string | null | undefined): AiProviderId | null {
  const k = (key ?? '').trim();
  if (!k) return null;
  for (const p of AI_PROVIDERS) if (p.keyPattern && p.keyPattern.test(k)) return p.id;
  return null;
}

/** 이름 + 조사 (예: withJosa('xai', '으로/로') → 'Grok으로', withJosa('openai', '이/가') → 'ChatGPT가') */
export function withJosa(id: unknown, pair: '이/가' | '을/를' | '은/는' | '으로/로' | '과/와'): string {
  const p = providerOf(id);
  const [hasFinal, noFinal] = pair.split('/');
  // '으로/로' 는 ㄹ 받침도 '로' (미스트랄로)
  const useFinal = pair === '으로/로' ? p.final === 'other' : p.final !== 'none';
  return p.label + (useFinal ? hasFinal : noFinal);
}

/** 무료 표시 */
export const FREE_LABEL: Record<FreeLevel, string> = {
  free: '무료',
  partial: '일부 무료',
  paid: '유료',
};

/** 콘텐츠 보안 정책(connect-src)에 넣을 AI 주소들 */
export const AI_ORIGINS: readonly string[] = AI_PROVIDERS.map((p) => p.origin);
