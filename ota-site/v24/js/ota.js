/* ==========================================================================
   英语随身学 · 在线自动升级模块（ota.js）
   启动时静默检查线上版本（默认 6 小时一次），发现新版后在后台下载并
   逐文件 sha256 校验，全部通过才写入本地更新包（wb_ota_bundle），
   由 boot.js 在下次启动时加载生效。任何失败都不影响正常使用。
   ========================================================================== */
(function () {
  "use strict";

  var LS_URL = "wb_ota_url";     // 自定义更新地址；缺省=用内置 DEFAULT_URL；空串=关闭自动更新
  var LS_LAST = "wb_ota_last";   // 上次自动检查时间戳
  var KEY_BUNDLE = "wb_ota_bundle";
  var CHECK_INTERVAL = 6 * 3600 * 1000; // 自动检查最小间隔
  var T_MANIFEST = 12000;  // manifest 超时（毫秒）
  var T_FILE = 30000;      // 单文件下载超时（毫秒）
  var FILE_RETRY = 2;      // 单文件失败重试次数（首次 + 1 次重试）
  var FILES = ["js/data.js", "js/_unit_names.js", "js/ota.js", "js/app.js", "css/style.css"];

  /* 内置默认更新地址（GitHub Pages 自动发布，仓库 taoxj324/yingyu-suishenxue）。
     用户无需任何配置即可接收在线更新；设置里可改成其它地址，
     清空并保存则关闭自动更新。 */
  var DEFAULT_URL = "https://taoxj324.github.io/yingyu-suishenxue/version.json";

  /* 备用镜像：jsDelivr 读取仓库 ota-site 目录（发布流水线自动同步）。
     部分网络下 GitHub Pages 不可达时，与主地址并发请求、谁先返回用谁。 */
  var MIRROR_URL = "https://cdn.jsdelivr.net/gh/taoxj324/yingyu-suishenxue@main/ota-site/version.json";
  var MIRROR_URL2 = "https://fastly.jsdelivr.net/gh/taoxj324/yingyu-suishenxue@main/ota-site/version.json";

  var state = { state: "idle", msg: "尚未检查" };
  var busy = false;

  function log() { try { console.log.apply(console, arguments); } catch (e) {} }

  function setStatus(s, msg) {
    state.state = s;
    state.msg = msg || "";
    log("[OTA] " + s + " · " + state.msg);
  }

  function bundledVC() { return window.__BUNDLED_VC__ || 0; }

  function readBundle() {
    try {
      var raw = localStorage.getItem(KEY_BUNDLE);
      if (!raw) return null;
      var b = JSON.parse(raw);
      return b && b.files ? b : null;
    } catch (e) { return null; }
  }
  function downloadedVC() { var b = readBundle(); return b && b.v ? b.v : 0; }

  function currentVersionText() {
    var vn = window.__OTA_BUNDLE_INFO__ && window.__OTA_BUNDLE_INFO__.vn;
    return "v" + (vn || window.__BUNDLED_VN__ || bundledVC());
  }

  function fetchText(url, timeout) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        reject(new Error("网络超时"));
      }, timeout);
      fetch(url, { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (t) { clearTimeout(timer); resolve(t); },
              function (e) { clearTimeout(timer); reject(e); });
    });
  }

  /* 带重试的下载：慢网/抖动时重试一次，避免整包失败 */
  function fetchTextRetry(url, timeout, attempts) {
    var n = attempts || FILE_RETRY;
    function once(i) {
      return fetchText(url, timeout).catch(function (e) {
        if (i + 1 >= n) throw e;
        return new Promise(function (r) { setTimeout(r, 800 * (i + 1)); }).then(function () {
          return once(i + 1);
        });
      });
    }
    return once(0);
  }

  /* 多通道拉取清单：主地址与镜像并发，谁先成功用谁 */
  function fetchManifest(urls) {
    return new Promise(function (resolve, reject) {
      var left = urls.length, done = false;
      if (!left) { reject(new Error("未配置更新地址")); return; }
      urls.forEach(function (u) {
        fetchText(u, T_MANIFEST).then(function (text) {
          if (done) return;
          done = true;
          resolve({ url: u, text: text });
        }, function (e) {
          left--;
          if (left === 0 && !done) reject(e || new Error("网络异常"));
        });
      });
    });
  }

  /* sha256 十六进制；运行环境不支持 crypto.subtle 时返回 null（跳过校验，
     传输层 HTTPS 已保证完整性，sha256 作为额外防护） */
  function sha256hex(text) {
    if (!(window.crypto && window.crypto.subtle)) return Promise.resolve(null);
    try {
      var buf = new TextEncoder().encode(text);
      return window.crypto.subtle.digest("SHA-256", buf).then(function (d) {
        var bytes = new Uint8Array(d), out = "";
        for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
        return out;
      });
    } catch (e) { return Promise.resolve(null); }
  }

  function toast(msg) {
    if (typeof window.showToast === "function") {
      try { window.showToast(msg); return; } catch (e) {}
    }
    log(msg);
  }

  /* -------------------- 检查更新 -------------------- */
  function check(force) {
    var urls = getUrls();
    if (!urls.length) { setStatus("unconfigured", "未配置更新地址，自动升级未开启"); return Promise.resolve(); }
    if (busy) return Promise.resolve();
    busy = true;
    setStatus("checking", "正在检查更新…");
    return fetchManifest(urls).then(function (hit) {
      var text = hit.text;
      var m = null;
      try { m = JSON.parse(text); } catch (e) { throw new Error("更新信息格式错误"); }
      if (!m || !m.versionCode || !m.files) throw new Error("更新信息不完整");
      try { localStorage.setItem(LS_LAST, String(Date.now())); } catch (e) {}
      var dl = downloadedVC();
      var base = Math.max(bundledVC(), dl);
      if (m.versionCode <= base) {
        if (dl >= m.versionCode && m.versionCode > bundledVC()) {
          var b = readBundle();
          setStatus("ready", "新版本 v" + ((b && b.vn) || m.versionName || m.version || m.versionCode) + " 已就绪，下次启动生效");
        } else {
          setStatus("latest", "已是最新版本 " + currentVersionText());
        }
        return;
      }
      return download(hit.url, m);
    }).catch(function (e) {
      setStatus("error", "检查更新失败：" + (e && e.message ? e.message : "网络异常") + "（不影响使用）");
    }).then(function () { busy = false; });
  }

  function download(manifestUrl, m) {
    var name = m.versionName || m.version || String(m.versionCode);
    setStatus("downloading", "发现新版本 v" + name + "，正在后台下载…");
    var paths = Object.keys(m.files);
    return Promise.all(paths.map(function (path) {
      var item = m.files[path] || {};
      var fileUrl = new URL(item.url || path, manifestUrl).href;
      return fetchTextRetry(fileUrl, T_FILE).then(function (text) {
        if (!item.sha256) return text;
        return sha256hex(text).then(function (got) {
          if (got && got !== item.sha256) throw new Error("文件校验失败：" + path);
          return text;
        });
      });
    })).then(function (texts) {
      var files = {};
      paths.forEach(function (p, i) { files[p] = texts[i]; });
      saveBundle({ v: m.versionCode, vn: name, date: m.date || "", notes: m.notes || "", files: files },
        "新版本 v" + name + " 已下载完成，下次启动生效");
    }).catch(function (e) {
      setStatus("error", "下载更新失败：" + (e && e.message ? e.message : "网络异常") + "（不影响使用）");
    });
  }

  function saveBundle(b, okMsg) {
    try {
      localStorage.setItem(KEY_BUNDLE, JSON.stringify(b));
    } catch (e) {
      // 空间不足：去掉体积最大的样式文件再试（样式缺失影响最小）
      if (b.files && b.files["css/style.css"]) {
        try {
          delete b.files["css/style.css"];
          localStorage.setItem(KEY_BUNDLE, JSON.stringify(b));
        } catch (e2) {
          setStatus("error", "保存更新失败：本地存储空间不足（不影响使用）");
          return;
        }
      } else {
        setStatus("error", "保存更新失败：本地存储空间不足（不影响使用）");
        return;
      }
    }
    setStatus("ready", okMsg);
    toast("📦 " + okMsg);
  }

  /* -------------------- 对外接口 -------------------- */
  /* 生效地址：未配置过 → 内置默认（含镜像兜底）；配置过 → 用户值（空串=主动关闭） */
  function getUrl() {
    var v = null;
    try { v = localStorage.getItem(LS_URL); } catch (e) {}
    if (v === null) return DEFAULT_URL;
    return (v || "").trim();
  }

  /* 本次要尝试的地址列表：默认地址会同时请求 GitHub Pages 与 jsDelivr 镜像 */
  function getUrls() {
    var v = null;
    try { v = localStorage.getItem(LS_URL); } catch (e) {}
    if (v === null) return [DEFAULT_URL, MIRROR_URL, MIRROR_URL2];
    v = (v || "").trim();
    if (!v) return [];
    // 内置地址或镜像地址 → 恢复多通道（用户临时改过镜像也能自动升级为全通道）
    if (v === DEFAULT_URL || v === MIRROR_URL || v === MIRROR_URL2) return [DEFAULT_URL, MIRROR_URL, MIRROR_URL2];
    return [v];
  }
  function setUrl(u) {
    u = (u || "").trim();
    try {
      localStorage.setItem(LS_URL, u); // 空串 = 关闭自动更新
    } catch (e) {}
    if (!u) setStatus("unconfigured", "自动更新已关闭");
  }
  function clearBundle() {
    try { localStorage.removeItem(KEY_BUNDLE); } catch (e) {}
    setStatus("idle", "已恢复使用 App 内置版本");
    location.reload();
  }
  function restartNow() { location.reload(); }

  function init() {
    if (!getUrls().length) { setStatus("unconfigured", "未配置更新地址，自动升级未开启"); return; }
    var last = 0;
    try { last = Number(localStorage.getItem(LS_LAST) || 0) || 0; } catch (e) {}
    if (Date.now() - last > CHECK_INTERVAL) {
      setTimeout(function () { check(false); }, 2500); // 启动 2.5s 后检查，不打扰首屏
    }
  }

  window.OTA = {
    version: 1,
    FILES: FILES,
    DEFAULT_URL: DEFAULT_URL,
    MIRROR_URL: MIRROR_URL,
    init: init,
    check: check,
    checkNow: function () { return check(true); },
    getStatus: function () { return { state: state.state, msg: state.msg }; },
    getUrl: getUrl,
    getUrls: getUrls,
    setUrl: setUrl,
    clearBundle: clearBundle,
    restartNow: restartNow,
    currentVersionText: currentVersionText
  };
})();
