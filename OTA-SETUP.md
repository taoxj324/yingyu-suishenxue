# 在线自动升级配置（已完成 ✅）

App 内置了在线更新功能：**更新地址已烧进 APK，无需任何配置**——启动时自动检查线上新版本，后台下载并校验，**下次启动自动生效，无需安装 APK**。

本配置已于 **2026-10-21** 完成并验证通过：

| 项目 | 值 |
| --- | --- |
| GitHub 仓库 | https://github.com/taoxj324/yingyu-suishenxue |
| 更新地址（App 内置） | `https://taoxj324.github.io/yingyu-suishenxue/version.json` |
| 当前线上版本 | versionCode 19（v1.19），含 5 个文件（js×4 + css×1），sha256 已校验 |
| 发布方式 | 推送到 main → GitHub Actions 自动打包发布（Pages 源已设为 GitHub Actions） |

---

## 以后如何发布新版本

1. 改完代码后，升级 `cap/android/app/build.gradle` 里的 `versionCode`（只增不减，如 19 → 20）和 `versionName`（如 "1.19" → "1.20"），并同步 `index.html` 的页脚版本号与 `<meta name="app-version-name">` / `<meta name="app-version-code">`
2. `git push` —— GitHub Actions 自动打包并发布，**已安装 App 的用户下次打开就会收到更新**

> 当前 v1.19 的线上包与 APK 内置版本一致，因此 App 会显示「已是最新版本」；下次发布 versionCode ≥ 20 的包时，用户才会收到更新。

也可以在本地手动打包预览：

```bash
python3 publish/build_bundle.py --notes "· 更新内容一
· 更新内容二"
```

产出在 `ota-site/` 目录，可传到任意静态托管（服务器 / OSS / 网盘直链均可）。

## 想换更新地址 / 关闭自动更新？

打开 App → **⚙️ 设置**：

- **更换地址**：在「更新地址」输入框填新地址 → 保存
- **关闭自动更新**：清空输入框 → 保存（设置里会出现「恢复默认地址」按钮，可随时一键开启）

## 注意事项

- **versionCode 必须只增不减**：App 只认比当前版本新的更新包
- 在线更新只覆盖 `js/`、`css/` 共 5 个文件（词库、脚本、样式）；**index.html 界面结构变化仍需发新 APK**
- 用户侧安全机制：更新包逐文件 sha256 校验；在线版启动异常会自动回退到 App 内置版本；设置里也可手动「恢复内置版本」
- 回退某个线上版本：把该版本的文件重新打包发布即可（versionCode 不变则不会重复推送）
