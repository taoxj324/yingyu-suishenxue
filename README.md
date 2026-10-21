# 人教版英语随身学

安卓背单词 App（Capacitor + WebView）与在线热更新（OTA）托管仓库。

- Web 资源：`index.html`、`js/`、`css/`
- 更新流水线：`publish/build_bundle.py` + `.github/workflows/ota.yml`
- 更新地址：https://taoxj324.github.io/yingyu-suishenxue/version.json
- 安卓工程：`cap/android/`（versionCode 与 index.html 内 meta 保持一致）

推送 Web 资源改动到 main 即自动打包发布，App 启动时自动检查更新。
