/**
 * 설정 > 앱 정보 — 이름·버전·소개, 실행 환경(웹/설치한 웹앱/APK/EXE), v2.1 정보 줄(팀·소속·과목·통신),
 * 앱 설치(웹: 브라우저가 설치 가능하다고 알려 주면 [앱 설치] 버튼, 아니면 설치 방법 안내 — platform/install.ts),
 * 내려받기 링크(주소가 정해졌을 때만), 개인정보 안내, 오픈소스 라이선스 (lib/appInfo.ts)
 */
import { Bluetooth, Download, ExternalLink, FileText, Globe, HardDrive, Info, Lock, MapPin, Shield, Sparkles } from 'lucide-react';
import { Fragment, useState } from 'react';

import {
  APP_DESCRIPTION,
  APP_INFO_LINES,
  APP_NAME,
  APP_VERSION,
  OSS_NOTICES,
  RELEASES_URL,
  WEB_URL,
} from '@/lib/appInfo';
import { isStandalonePwa, isWeb, PLATFORM_LABEL, platformKind } from '@/platform/detect';
import { installHint, usePwaInstall } from '@/platform/install';
import { toast } from '@/store/toast';
import { Badge, Button, Card, Divider, Section, Text } from '@/ui';

import { Disclosure } from './Disclosure';
import { installOutcomeToast } from './installRow';

/** 지금 실행 환경 이름 — 웹 브라우저 / 설치한 웹앱(PWA) / 안드로이드 앱(APK) / Windows 앱(EXE) */
function platformText(): string {
  const k = platformKind();
  if (k === 'web' && isStandalonePwa()) return '설치한 웹앱(PWA)';
  return PLATFORM_LABEL[k];
}

function ExtLink({ href, icon: Icon, label }: { href: string; icon: typeof Download; label: string }) {
  return (
    <a className="sb-btn sb-btn--secondary sb-btn--md sb-btn--full settings-extlink" href={href} target="_blank" rel="noopener noreferrer">
      <Icon size={18} aria-hidden="true" />
      <span className="sb-btn__label">{label}</span>
      <ExternalLink size={16} aria-hidden="true" />
    </a>
  );
}

/**
 * 앱 설치 줄 (웹에서만) — 브라우저가 설치 가능하다고 알려 주면(beforeinstallprompt) [앱 설치] 버튼,
 * 그 밖에는 installHint() 안내(안드로이드 Chrome 메뉴·사파리 공유 버튼·이미 설치됨 등). APK·EXE 에서는 아무것도 안 보임
 * (platform/install.ts 가 Chrome 의 자동 설치 배너를 막고 이 버튼으로 대신함)
 */
function InstallRow() {
  const { canInstall, install } = usePwaInstall();
  const [busy, setBusy] = useState(false);
  if (!isWeb()) return null;
  // installHint() 는 usePwaInstall 과 같은 상태를 읽음 — 상태가 바뀌면 위 훅이 다시 그려 줌
  const hint = installHint();
  const onInstall = async () => {
    setBusy(true);
    try {
      const outcome = await install();
      const t = installOutcomeToast(outcome, installHint());
      if (t) toast(t.message, t.kind);
    } finally {
      setBusy(false);
    }
  };
  if (!canInstall && !hint) return null;
  return (
    <div className="settings-install">
      {canInstall ? <Button icon={Download} label="앱 설치" full loading={busy} onClick={() => void onInstall()} /> : null}
      {hint ? <p className="settings-help">{hint}</p> : null}
    </div>
  );
}

export function AppInfoSection() {
  const env = platformText();
  return (
    <Section title="앱 정보" icon={Info}>
      <div className="settings-stack settings-stack--tight">
        <Card className="settings-card">
          <div className="settings-info-title">
            <Text variant="heading">{APP_NAME}</Text>
            <Badge tone="accent" label={`v${APP_VERSION}`} />
          </div>
          <Text tone="secondary">{APP_DESCRIPTION}</Text>
          <Divider />
          <dl className="settings-info-lines">
            <dt>버전</dt>
            <dd className="sb-num">{APP_VERSION}</dd>
            <dt>실행 환경</dt>
            <dd>{env}</dd>
            {APP_INFO_LINES.map((l) => (
              <Fragment key={l.label}>
                <dt>{l.label}</dt>
                <dd>{l.value}</dd>
              </Fragment>
            ))}
          </dl>
          <InstallRow />
          {WEB_URL || RELEASES_URL ? (
            <>
              <Divider />
              {WEB_URL ? <ExtLink href={WEB_URL} icon={Globe} label="웹앱 주소 열기" /> : null}
              {RELEASES_URL ? <ExtLink href={RELEASES_URL} icon={Download} label="APK·EXE 내려받기" /> : null}
            </>
          ) : null}
        </Card>

        <Card className="settings-card">
          <Text variant="label" as="h3" className="settings-subhead">
            <Shield size={18} aria-hidden="true" className="settings-accent-icon" /> 개인정보 안내
          </Text>
          <ul className="settings-notes">
            <li>
              <HardDrive size={16} aria-hidden="true" />
              <span>
                회원가입·로그인 없이 써요. 재료·기록·즐겨찾기·설정은 <b>이 기기에만</b> 저장돼요.
              </span>
            </li>
            <li>
              <Sparkles size={16} aria-hidden="true" />
              <span>
                Gemini AI 추천을 쓰면 입력한 기분·맛·상황·요청, 장착한 재료 목록, 최근 제조 기록 요약이 <b>내 키로 Google Gemini</b> 에 보내져요. 오프라인 추천은 아무것도 보내지 않아요.
              </span>
            </li>
            <li>
              <MapPin size={16} aria-hidden="true" />
              <span>
                날씨를 불러올 때만 대략적인 위치가 날씨 서비스(Open-Meteo)에 보내져요.
              </span>
            </li>
            <li>
              <Lock size={16} aria-hidden="true" />
              <span>API 키는 이 기기에만 저장되고 팀 서버나 다른 곳으로 보내지 않아요(Google 제외).</span>
            </li>
            <li>
              <Bluetooth size={16} aria-hidden="true" />
              <span>기기와는 블루투스로만 주고받아요.</span>
            </li>
          </ul>
        </Card>

        <Disclosure icon={FileText} title="오픈소스 라이선스" subtitle={`이 앱에 쓰인 오픈소스 ${OSS_NOTICES.length}개`}>
          <ul className="settings-oss">
            {OSS_NOTICES.map((o) => (
              <li key={o.name}>
                <div className="settings-oss__head">
                  <span className="settings-oss__name">{o.name}</span>
                  <Badge label={o.license} tone="neutral" />
                  <span className="settings-help">{o.usage}</span>
                </div>
                <p className="settings-oss__copy">{o.copyright}</p>
                <a className="settings-url" href={o.url} target="_blank" rel="noopener noreferrer">
                  {o.url}
                </a>
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </Section>
  );
}
