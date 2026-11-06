/**
 * Expo config plugin — 블루투스(BLE) 권한 설정
 *
 * react-native-ble-manager 기본 플러그인 대신 직접 작성한 이유:
 *  - 날씨 기능(expo-location)이 위치 권한을 모든 안드로이드 버전에서 써야 하는데,
 *    기본 플러그인의 neverForLocation 옵션은 위치 권한에 maxSdkVersion=30 을 붙여
 *    안드로이드 12+ 에서 날씨용 위치 권한까지 사라지게 만들 수 있음.
 *  - 그래서 블루투스 검색(BLUETOOTH_SCAN)에만 neverForLocation 을 붙이고 위치 권한은 그대로 둠.
 *
 * 결과(AndroidManifest.xml):
 *  - BLUETOOTH, BLUETOOTH_ADMIN           (maxSdkVersion 30, 안드로이드 11 이하)
 *  - BLUETOOTH_SCAN (neverForLocation)    (안드로이드 12+)
 *  - BLUETOOTH_CONNECT                    (안드로이드 12+)
 *  - ACCESS_FINE/COARSE_LOCATION          (안드로이드 11 이하 BLE 검색 + 날씨, expo-location 이 추가)
 *  - uses-feature bluetooth_le required=false
 */
const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

function upsertPermission(manifest, name, attrs = {}) {
  const list = (manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'] || []);
  const existing = list.find((p) => p.$ && p.$['android:name'] === name);
  if (existing) {
    Object.assign(existing.$, attrs);
  } else {
    list.push({ $: { 'android:name': name, ...attrs } });
  }
}

const withBleAndroid = (config) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    AndroidConfig.Manifest.ensureToolsAvailable(manifest);
    upsertPermission(manifest, 'android.permission.BLUETOOTH', { 'android:maxSdkVersion': '30' });
    upsertPermission(manifest, 'android.permission.BLUETOOTH_ADMIN', { 'android:maxSdkVersion': '30' });
    upsertPermission(manifest, 'android.permission.BLUETOOTH_SCAN', {
      'android:usesPermissionFlags': 'neverForLocation',
      'tools:targetApi': '31',
    });
    upsertPermission(manifest, 'android.permission.BLUETOOTH_CONNECT');
    const features = (manifest.manifest['uses-feature'] = manifest.manifest['uses-feature'] || []);
    if (!features.some((f) => f.$ && f.$['android:name'] === 'android.hardware.bluetooth_le')) {
      features.push({ $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'false' } });
    }
    return cfg;
  });

const withBleIos = (config, { bluetoothText }) =>
  withInfoPlist(config, (cfg) => {
    cfg.modResults.NSBluetoothAlwaysUsageDescription = bluetoothText;
    cfg.modResults.NSBluetoothPeripheralUsageDescription = bluetoothText;
    return cfg;
  });

module.exports = function withBlePermissions(config, props = {}) {
  const bluetoothText = props.bluetoothText || '칵테일 메이커와 블루투스로 연결하기 위해 사용합니다.';
  config = withBleAndroid(config);
  config = withBleIos(config, { bluetoothText });
  return config;
};
