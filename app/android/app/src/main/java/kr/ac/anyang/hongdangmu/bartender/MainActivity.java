package kr.ac.anyang.hongdangmu.bartender;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 앱 안 플러그인(npm 패키지가 아닌 것)은 super.onCreate 전에 등록 — 앱 업데이트(src/platform/capacitor/updater.ts)
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
