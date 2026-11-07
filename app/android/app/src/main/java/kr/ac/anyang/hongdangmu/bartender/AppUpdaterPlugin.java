package kr.ac.anyang.hongdangmu.bartender;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 앱 업데이트 (src/lib/update.ts · src/platform/capacitor/updater.ts)
 *  - download: 이 저장소의 GitHub 릴리스 APK 만 (주소 전체 형식·태그와 파일 버전 일치·지금보다 높은 버전) 캐시 폴더 updates/ 에 받아 SHA-256 확인.
 *    진행률은 "progress" 이벤트. 한 번에 하나만 — 같은 파일을 받는 중에 다시 부르면 그 내려받기에 이어 붙음(화면 쪽 시간 초과 뒤 "다시 시도").
 *    같은 파일을 이미 받아 두었으면 다시 받지 않음. 실패는 원인별 안내(파일 없음·저장 공간 부족·저장 실패·인터넷)
 *  - canInstall / openInstallSettings: 설정의 "이 출처 허용"(안드로이드 8+)
 *  - install: 받은 APK 가 이 앱(같은 패키지)의 더 높은 버전인지 확인한 뒤 안드로이드 설치 창을 띄움
 *    → 사용자가 "업데이트"(또는 "설치")를 눌러야 설치됨 (Play 스토어 밖 앱은 확인 없이 설치할 수 없음)
 *    안드로이드가 서명이 지금 앱과 같은지 다시 확인하므로, 다른 사람이 만든 APK 로는 바꿔치기할 수 없음
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** .../download/v<버전>/SmartBartender-<버전>.apk (다른 경로·쿼리·인코딩 없이) */
    private static final Pattern URL_RE = Pattern.compile(
        "^https://github\\.com/paperji/smart-bartender/releases/download/v(\\d+\\.\\d+\\.\\d+)/(SmartBartender-(\\d+\\.\\d+\\.\\d+)\\.apk)$");
    private static final Pattern NAME = Pattern.compile("^SmartBartender-\\d+\\.\\d+\\.\\d+\\.apk$");
    private static final Pattern SHA = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern VERSION = Pattern.compile("^v?(\\d+)\\.(\\d+)\\.(\\d+)");
    private static final String DIR = "updates";
    private static final String BAD = "잘못된 업데이트 파일 정보예요";
    private static final String NET = "새 버전을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.";
    private static final String STORAGE = "저장 공간이 부족해요. 휴대폰 저장 공간을 비운 뒤 다시 시도해 주세요.";
    private static final String SAVE = "업데이트 파일을 저장하지 못했어요. 다시 시도해 주세요.";
    private static final long SPACE_MARGIN = 5L * 1024 * 1024;

    /** 지금 내려받는 파일(url|sha) 과 결과를 기다리는 호출들 */
    private final Object lock = new Object();
    private String currentKey = null;
    private final List<PluginCall> waiters = new ArrayList<>();

    /** 사용자에게 그대로 보여 줄 실패 */
    private static class UserError extends Exception {
        UserError(String msg) {
            super(msg);
        }
    }

    private File updatesDir() {
        File d = new File(getContext().getCacheDir(), DIR);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static int[] parseVersion(String v) {
        if (v == null) return null;
        Matcher m = VERSION.matcher(v.trim());
        if (!m.find()) return null;
        try {
            return new int[] { Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)) };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** a 가 b 보다 높은 버전인지 (b 를 모르면 true — 설치할 때 versionCode 로 다시 확인) */
    private static boolean isNewer(String a, String b) {
        int[] x = parseVersion(a);
        int[] y = parseVersion(b);
        if (x == null) return false;
        if (y == null) return true;
        for (int i = 0; i < 3; i++) if (x[i] != y[i]) return x[i] > y[i];
        return false;
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo pi) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
    }

    private PackageInfo selfInfo() {
        try {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException e) {
            return null;
        }
    }

    private static String sha256Hex(File f) {
        try (InputStream in = new BufferedInputStream(new FileInputStream(f))) {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            return hex(md.digest());
        } catch (Exception e) {
            return null;
        }
    }

    private static String hex(byte[] d) {
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    private void progress(long loaded, long total) {
        JSObject p = new JSObject();
        p.put("loaded", loaded);
        p.put("total", total);
        notifyListeners("progress", p);
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url", "");
        final String sha = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        final String name = call.getString("fileName", "");
        Matcher m = URL_RE.matcher(url);
        if (!m.matches() || !name.equals(m.group(2)) || !m.group(1).equals(m.group(3)) || !SHA.matcher(sha).matches()) {
            call.reject(BAD);
            return;
        }
        PackageInfo self = selfInfo();
        if (!isNewer(m.group(3), self != null ? self.versionName : null)) {
            call.reject("지금 버전보다 새 버전이 아니에요");
            return;
        }
        final String key = url + "|" + sha;
        synchronized (lock) {
            if (currentKey != null) {
                if (currentKey.equals(key)) {
                    waiters.add(call); // 받던 것에 이어 붙음
                } else {
                    call.reject("이미 다른 새 버전을 내려받는 중이에요. 잠시 뒤 다시 시도해 주세요.");
                }
                return;
            }
            currentKey = key;
            waiters.add(call);
        }
        new Thread(() -> {
            String path = null;
            String err;
            try {
                path = fetchVerified(url, sha, name);
                err = null;
            } catch (UserError e) {
                err = e.getMessage();
            } catch (Throwable e) {
                // 인터넷 문제 말고도 OutOfMemoryError 등 무엇이든 — 기다리는 호출을 모두 끝내고 다음 내려받기를 막지 않게
                err = e instanceof Exception ? NET : SAVE;
            }
            List<PluginCall> calls;
            synchronized (lock) {
                calls = new ArrayList<>(waiters);
                waiters.clear();
                currentKey = null;
            }
            for (PluginCall c : calls) {
                if (path != null) {
                    JSObject r = new JSObject();
                    r.put("path", path);
                    c.resolve(r);
                } else {
                    c.reject(err);
                }
            }
        }).start();
    }

    /** 내려받아 SHA-256 을 확인하고 저장한 경로 (실패: UserError = 원인별 안내, 그 밖 = 인터넷 문제) */
    private String fetchVerified(String url, String sha, String name) throws Exception {
        File dir = updatesDir();
        File tmp = new File(dir, name + ".download");
        File dest = new File(dir, name);
        // 같은 파일을 이미 받아 두었으면 그대로 (설치 창을 닫았다가 다시 하는 경우 등)
        if (dest.isFile() && sha.equals(sha256Hex(dest))) {
            progress(dest.length(), dest.length());
            return dest.getAbsolutePath();
        }
        // 예전에 받아 둔 파일 정리
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        HttpURLConnection c = null;
        boolean ok = false;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "SmartBartender-Updater");
            int code = c.getResponseCode();
            if (code == 404 || code == 410) throw new UserError("업데이트 파일을 찾지 못했어요(HTTP " + code + "). 잠시 뒤 다시 확인해 주세요.");
            if (code >= 400) throw new UserError("업데이트 파일을 받지 못했어요(HTTP " + code + "). 잠시 뒤 다시 시도해 주세요.");
            if (code != 200) throw new Exception("HTTP " + code);
            if (!"https".equals(c.getURL().getProtocol())) throw new Exception("not https");
            long total = c.getContentLengthLong();
            if (total > 0 && dir.getUsableSpace() < total + SPACE_MARGIN) throw new UserError(STORAGE);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long loaded = 0;
            long lastSent = 0;
            FileOutputStream opened;
            try {
                opened = new FileOutputStream(tmp);
            } catch (java.io.IOException oe) {
                String m = String.valueOf(oe.getMessage());
                throw new UserError(m.contains("ENOSPC") || m.contains("No space") ? STORAGE : SAVE);
            }
            try (FileOutputStream out = opened; InputStream in = new BufferedInputStream(c.getInputStream())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    md.update(buf, 0, n);
                    try {
                        out.write(buf, 0, n);
                    } catch (java.io.IOException we) {
                        String m = String.valueOf(we.getMessage());
                        throw new UserError(m.contains("ENOSPC") || m.contains("No space") ? STORAGE : SAVE);
                    }
                    loaded += n;
                    long now = System.currentTimeMillis();
                    if (now - lastSent > 150) {
                        lastSent = now;
                        progress(loaded, total);
                    }
                }
            }
            if (!hex(md.digest()).equals(sha)) throw new UserError("내려받은 파일이 원본과 달라요(SHA-256 불일치). 다시 시도해 주세요.");
            if (dest.exists()) dest.delete();
            if (!tmp.renameTo(dest)) throw new UserError(SAVE);
            progress(loaded, total > 0 ? total : loaded);
            ok = true;
            return dest.getAbsolutePath();
        } finally {
            if (!ok) tmp.delete();
            if (c != null) c.disconnect();
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        boolean ok = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        JSObject r = new JSObject();
        r.put("value", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("설정 화면을 열지 못했어요. 휴대폰 설정 › 애플리케이션 › AI 스마트 바텐더 › \"출처를 알 수 없는 앱 설치\"에서 허용해 주세요.");
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "");
        File f = new File(path);
        Context ctx = getContext();
        try {
            // 우리가 받아 둔 업데이트 폴더 안의 APK 만
            if (!f.getCanonicalPath().startsWith(updatesDir().getCanonicalPath() + File.separator) || !NAME.matcher(f.getName()).matches() || !f.isFile()) {
                call.reject("설치할 파일을 찾지 못했어요. 다시 내려받아 주세요.");
                return;
            }
            // 이 앱(같은 패키지)의 더 높은 버전인지 — 다른 앱이거나 예전 버전이면 설치 창을 띄우지 않음
            PackageManager pm = ctx.getPackageManager();
            PackageInfo apk = pm.getPackageArchiveInfo(f.getAbsolutePath(), 0);
            PackageInfo self = selfInfo();
            if (apk == null || !ctx.getPackageName().equals(apk.packageName)) {
                f.delete();
                call.reject("이 앱의 업데이트 파일이 아니에요. 다시 내려받아 주세요.");
                return;
            }
            if (self != null && versionCodeOf(apk) <= versionCodeOf(self)) {
                call.reject("지금 버전보다 새 버전이 아니에요");
                return;
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("설치 창을 열지 못했어요.");
        }
    }
}
