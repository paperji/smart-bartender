/**
 * 앱 업데이트 추천 창 (APK·EXE — 상태와 순서는 src/lib/update.ts)
 *  - 새 버전 → "업데이트 / 나중에 / 이 버전 건너뛰기"
 *  - (APK) 설정의 "이 출처 허용"이 꺼져 있으면 설정 열기 → 켜고 돌아오면 바로 이어서
 *  - 내려받는 중 진행률(창을 닫아도 계속) → 다 받으면 (APK) 안드로이드 설치 창에서 "업데이트"(또는 "설치") / (EXE) 새 버전을 켜고 이 창은 닫힘
 *  - 창을 닫아 둔 채 다 받았거나, 그사이 제조를 시작했거나, 앱이 화면 뒤에 있었으면 "받아 둠 — 지금 설치"로 물어봄
 *  - 제조·세척·구동 중에는 어떤 업데이트 창도 띄우지 않음(끝난 뒤에 — 비상 정지 버튼을 가리지 않게)
 *  - 다른 창(확인 창·기기 찾기 등)이 열려 있으면 그 창이 닫힌 뒤에 (내려받기는 계속)
 * 웹·PWA 는 업데이트 구현이 없어 아무것도 그리지 않음(서비스 워커가 자동 적용)
 */
import { Download, RefreshCw, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { APP_VERSION } from '@/lib/appInfo';
import {
  hideUpdatePrompt,
  openInstallPermission,
  OTHER_DIALOG_SELECTOR,
  shouldShowUpdatePrompt,
  skipUpdateVersion,
  snoozeUpdate,
  startUpdate,
  updaterAvailable,
  useUpdate,
} from '@/lib/update';
import { isBusy, useDevice } from '@/store/device';
import { Banner, Button, Modal, ProgressBar, Stack, Text } from '@/ui';

/** lib/update.ts 의 OTHER_DIALOG_SELECTOR 가 이 이름을 뺌 */
const OWN_CLASS = 'update-prompt';

const mb = (bytes: number) => (bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : '');

/** 이 창 말고 다른 모달 창이 열려 있는지 (열리고 닫힐 때마다 다시 봄) */
function useOtherDialogOpen(): boolean {
  const query = () => typeof document !== 'undefined' && !!document.querySelector(OTHER_DIALOG_SELECTOR);
  const [open, setOpen] = useState(query);
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const ob = new MutationObserver(() => setOpen(query()));
    ob.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal'] });
    setOpen(query());
    return () => ob.disconnect();
  }, []);
  return open;
}

export function UpdatePrompt() {
  const st = useUpdate();
  const busy = useDevice((s) => isBusy(s.job));
  const otherDialog = useOtherDialogOpen();
  if (!updaterAvailable() || !shouldShowUpdatePrompt(st, busy, otherDialog)) return null;
  const info = st.info!;
  const apk = /\.apk$/i.test(info.asset.name);
  const androidInstallText = '안드로이드 설치 창에서 "업데이트"(또는 "설치")를 눌러 주세요.';

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;
  let onClose: (() => void) | undefined = () => snoozeUpdate();
  let title = '앱 업데이트';

  if (st.status === 'available') {
    title = '새 버전이 나왔어요';
    body = (
      <Stack gap={10}>
        {info.highlights.length ? (
          <ul className="update-notes">
            {info.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}
        <Text variant="caption" tone="muted">
          {apk
            ? `파일 크기 ${mb(info.asset.size)}. 내려받은 뒤 ${androidInstallText} 기록·설정은 그대로 남아요.`
            : `파일 크기 ${mb(info.asset.size)}. 새 버전을 지금 EXE 와 같은 폴더(안 되면 다운로드 폴더)에 받아서 켜고, 이 창은 닫혀요. 기록·설정은 그대로예요. 바탕화면 바로 가기는 새 EXE 로 다시 만들어 주세요.`}
        </Text>
      </Stack>
    );
    footer = (
      <Stack gap={8}>
        <Button icon={Download} label="업데이트" full onClick={() => void startUpdate()} />
        <Button variant="secondary" label="나중에" full onClick={() => snoozeUpdate()} />
        <Button variant="ghost" size="sm" label="이 버전 건너뛰기" full onClick={() => skipUpdateVersion()} />
      </Stack>
    );
  } else if (st.status === 'ready') {
    title = '새 버전을 받아 두었어요';
    body = (
      <Text>
        {apk
          ? `지금 설치할까요? ${androidInstallText}`
          : '지금 설치할까요? 새 버전을 켜고 이 창은 닫혀요.'}
      </Text>
    );
    footer = (
      <Stack gap={8}>
        <Button icon={Download} label="지금 설치" full onClick={() => void startUpdate()} />
        <Button variant="secondary" label="나중에" full onClick={() => snoozeUpdate()} />
      </Stack>
    );
  } else if (st.status === 'needs-permission') {
    // 갤럭시(One UI)는 설정 열기가 이 앱 전용 화면이 아니라 "출처를 알 수 없는 앱 설치" 목록을 엶 (2026-11-07 실기 확인)
    body = (
      <Stack gap={8}>
        <Text>이 앱이 새 버전을 설치하려면 처음 한 번만 허용이 필요해요.</Text>
        <ol className="update-steps">
          <li>
            아래 <b>[설정 열기]</b>를 눌러요.
          </li>
          <li>
            <b>"이 출처 허용"</b>을 켜요. 갤럭시처럼 <b>"출처를 알 수 없는 앱 설치"</b> 목록이 열리면 목록에서 <b>AI 스마트 바텐더</b>를 눌러 켜요.
          </li>
          <li>뒤로 돌아오면 바로 이어서 업데이트해요. 이어지지 않으면 "허용했어요, 계속"을 눌러요.</li>
        </ol>
      </Stack>
    );
    footer = (
      <Stack gap={8}>
        <Button icon={SettingsIcon} label="설정 열기" full onClick={() => void openInstallPermission()} />
        <Button variant="secondary" label="허용했어요, 계속" full onClick={() => void startUpdate()} />
        <Button variant="ghost" size="sm" label="나중에" full onClick={() => snoozeUpdate()} />
      </Stack>
    );
  } else if (st.status === 'downloading') {
    onClose = hideUpdatePrompt; // 창만 닫음 — 내려받기는 계속, 다 받으면 다시 물어봄
    body = (
      <Stack gap={10}>
        <ProgressBar value={st.progress ?? 0} indeterminate={st.progress == null} showValue={st.progress != null} label="새 버전 내려받는 중" />
        <Text variant="caption" tone="muted">
          다 받으면 파일이 원본과 같은지(SHA-256) 확인한 뒤 설치해요. 이 창을 닫아도 계속 받아요.
        </Text>
      </Stack>
    );
  } else if (st.status === 'installing') {
    onClose = hideUpdatePrompt;
    body = apk ? (
      <Text>{androidInstallText} 설치 창을 닫았다면 아래 버튼으로 다시 열 수 있어요.</Text>
    ) : (
      <Text>새 버전을 여는 중이에요. 잠시 뒤 이 창은 닫혀요.</Text>
    );
    footer = apk ? (
      <Stack gap={8}>
        <Button icon={RefreshCw} label="설치 창 다시 열기" full onClick={() => void startUpdate()} />
        <Button variant="secondary" label="닫기" full onClick={hideUpdatePrompt} />
      </Stack>
    ) : null;
  } else if (st.status === 'error') {
    onClose = hideUpdatePrompt;
    body = <Banner tone="error" message={st.error ?? '업데이트하지 못했어요.'} />;
    footer = (
      <Stack gap={8}>
        <Button icon={RefreshCw} label="다시 시도" full onClick={() => void startUpdate()} />
        <Button variant="secondary" label="닫기" full onClick={hideUpdatePrompt} />
      </Stack>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="sm"
      className={OWN_CLASS}
      title={title}
      description={`v${info.version} (지금 v${APP_VERSION})`}
      footer={footer}>
      {body}
    </Modal>
  );
}
