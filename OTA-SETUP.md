# 在线自动升级配置指南（地址已内置）

App 内置了在线更新功能：**更新地址已烧进 APK，无需任何配置**——启动时自动检查线上新版本，后台下载并校验，**下次启动自动生效，无需安装 APK**。按下面两步操作即可开通。

---

## 第一步：把项目推送到 GitHub

在项目根目录（本目录）执行：

```bash
git init
git add .
git commit -m "英语随身学 v1.19"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 仓库名建议用英文，如 `yingyu-suishenxue`。推送前确认 `.gitignore` 已排除 `cap/www`、`*.apk` 等生成物（本项目已配好）。

## 第二步：开启 GitHub Pages

1. 打开仓库页面 → **Settings** → **Pages**
2. **Source** 选择 **GitHub Actions**
3. 等待 1～2 分钟，页面顶部会出现 `Your site is live at https://<用户名>.github.io/<仓库名>/`

推送完成后，App 内置的更新地址 `https://taoxj324.github.io/yingyu-suishenxue/version.json` 即可访问，已安装 App 的用户下次打开就会收到更新。

---

## 以后如何发布新版本

1. 改完代码后，升级 `cap/android/app/build.gradle` 里的 `versionCode`（只增不减，如 19 → 20）和 `versionName`（如 "1.19" → "1.20"），并同步 `index.html` 的页脚版本号与 `<meta name="app-version-name">`
2. `git push` —— GitHub Actions 自动打包并发布，**已安装 App 的用户下次打开就会收到更新**

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
