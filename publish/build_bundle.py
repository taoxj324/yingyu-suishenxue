#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包 Web 资源为在线更新包（OTA bundle）并生成 version.json。

版本号从 cap/android/app/build.gradle 读取（versionCode / versionName），
输出目录结构（默认 ./ota-site）：

    ota-site/
      version.json          # 更新清单（App 启动时检查）
      v{versionCode}/       # 该版本的全部 Web 资源
        js/data.js
        js/_unit_names.js
        js/ota.js
        js/app.js
        css/style.css

用法：
    python3 publish/build_bundle.py                     # 用 build.gradle 当前版本
    python3 publish/build_bundle.py --notes "第一行\\n第二行"
    python3 publish/build_bundle.py --out /tmp/ota-site

部署：把 ota-site 整个目录发布为静态网站（GitHub Pages / 任意静态托管），
App「设置 → 更新地址」填 https://你的域名/version.json 即可。
"""
import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRADLE = ROOT / "cap" / "android" / "app" / "build.gradle"
FILES = [
    "js/data.js",
    "js/_unit_names.js",
    "js/ota.js",
    "js/app.js",
    "css/style.css",
]


def read_gradle_version():
    txt = GRADLE.read_text(encoding="utf-8")
    m_vc = re.search(r"versionCode\s+(\d+)", txt)
    m_vn = re.search(r'versionName\s+"([^"]+)"', txt)
    if not m_vc or not m_vn:
        sys.exit("错误：未能从 build.gradle 读取 versionCode / versionName")
    return int(m_vc.group(1)), m_vn.group(1)


def main():
    ap = argparse.ArgumentParser(description="打包在线更新包（OTA）")
    ap.add_argument("--notes", default="", help="更新说明，多行用 \\n 分隔")
    ap.add_argument("--out", default=str(ROOT / "ota-site"), help="输出目录")
    args = ap.parse_args()

    version_code, version_name = read_gradle_version()
    out = Path(args.out)
    ver_dir = out / ("v%d" % version_code)

    missing = [p for p in FILES if not (ROOT / p).is_file()]
    if missing:
        sys.exit("错误：缺少待打包文件：%s" % ", ".join(missing))

    files = {}
    for rel in FILES:
        data = (ROOT / rel).read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        dst = ver_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / rel, dst)
        files[rel] = {"url": "v%d/%s" % (version_code, rel), "sha256": sha}

    manifest = {
        "version": version_name,
        "versionCode": version_code,
        "date": date.today().isoformat(),
        "notes": args.notes.replace("\\n", "\n"),
        "files": files,
    }
    (out / "version.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    total = sum((ver_dir / rel).stat().st_size for rel in FILES)
    print("OK 版本 v%s（versionCode %d）→ %s" % (version_name, version_code, out / "version.json"))
    print("   包含 %d 个文件，共 %.1f KB" % (len(FILES), total / 1024))


if __name__ == "__main__":
    main()
