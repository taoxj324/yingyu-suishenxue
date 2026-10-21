/* ==========================================================================
   英语随身学 · 启动加载器（boot.js）
   职责：按序加载业务脚本（data → _unit_names → ota → app）。
   若本地存有在线更新包（localStorage: wb_ota_bundle），优先加载在线版
   （内联执行），否则加载 App 内置版；在线样式以 <style> 追加覆盖。
   在线版异常（执行后哨兵缺失）→ 回退对应内置版；启动后白屏 → 整体回退
   （一次性，sessionStorage 防循环）。
   注意：本文件自身不参与在线更新（加载器须保持稳定）。
   ========================================================================== */
(function () {
  "use strict";

  var JS_QUEUE = ["js/data.js", "js/_unit_names.js", "js/ota.js", "js/app.js"];
  var CSS_PATH = "css/style.css";
  var KEY_BUNDLE = "wb_ota_bundle";
  var KEY_ROLLBACK = "wb_ota_rb"; // sessionStorage：本轮已回退过，防循环

  function meta(name, fallback) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return m && m.getAttribute("content") ? m.getAttribute("content") : fallback;
  }
  window.__BUNDLED_VC__ = Number(meta("app-version-code", "0")) || 0;
  window.__BUNDLED_VN__ = meta("app-version-name", "");

  function log() { try { console.log.apply(console, arguments); } catch (e) {} }
  function warn() { try { console.warn.apply(console, arguments); } catch (e) {} }

  /* 读取在线更新包；损坏或不高于内置版本的包直接清除 */
  function readBundle() {
    var raw = null;
    try { raw = localStorage.getItem(KEY_BUNDLE); } catch (e) { return null; }
    if (!raw) return null;
    var b = null;
    try { b = JSON.parse(raw); } catch (e) { b = null; }
    if (!b || typeof b !== "object" || !b.files || typeof b.files !== "object") {
      try { localStorage.removeItem(KEY_BUNDLE); } catch (e) {}
      return null;
    }
    if (!b.v || b.v <= window.__BUNDLED_VC__) {
      // 不高于内置版本：冗余包，清理
      try { localStorage.removeItem(KEY_BUNDLE); } catch (e) {}
      return null;
    }
    return b;
  }

  var bundle = readBundle();
  window.__OTA_APPLIED__ = bundle ? bundle.v : 0;
  window.__OTA_BUNDLE_INFO__ = bundle
    ? { v: bundle.v, vn: bundle.vn || String(bundle.v), date: bundle.date || "", notes: bundle.notes || "" }
    : null;
  var rolledBack = false;
  try { rolledBack = sessionStorage.getItem(KEY_ROLLBACK) === "1"; } catch (e) {}

  /* 回退：清除在线包并重载（一次性） */
  function rollback(reason) {
    warn("[OTA] 回退内置版本：" + reason);
    try { localStorage.removeItem(KEY_BUNDLE); } catch (e) {}
    if (rolledBack) {
      warn("[OTA] 已回退过一次仍异常，停止重试（内置版本问题需更新 APK）");
      return;
    }
    try { sessionStorage.setItem(KEY_ROLLBACK, "1"); } catch (e) {}
    location.reload();
  }

  /* 内联执行（转义 </script 防止意外闭合标签） */
  function runInline(text) {
    var s = document.createElement("script");
    s.textContent = String(text).replace(/<\/script/gi, "<\\/script");
    document.head.appendChild(s);
  }

  /* 加载内置版脚本 */
  function loadBundled(path) {
    return new Promise(function (resolve) {
      var s = document.createElement("script");
      s.src = path;
      s.addEventListener("load", function () { resolve(true); });
      s.addEventListener("error", function () {
        warn("[boot] 内置脚本加载失败：" + path);
        resolve(false);
      });
      document.head.appendChild(s);
    });
  }

  /* 在线版就绪哨兵：执行后必须存在对应全局对象 */
  function sentinelOk(path) {
    try {
      if (path === "js/data.js") return typeof WORD_BANK !== "undefined" && !!WORD_BANK.length;
      if (path === "js/_unit_names.js") return typeof UNIT_NAMES !== "undefined" && UNIT_NAMES !== null;
      if (path === "js/ota.js") return typeof window.OTA !== "undefined" && !!window.OTA;
      if (path === "js/app.js") return window.__APP_READY__ === true;
    } catch (e) {}
    return false;
  }

  /* 在线样式注入（boot.js 位于内置 <link> 之后，级联规则自然覆盖） */
  if (bundle && typeof bundle.files[CSS_PATH] === "string" && bundle.files[CSS_PATH].length > 0) {
    try {
      var st = document.createElement("style");
      st.textContent = bundle.files[CSS_PATH];
      document.head.appendChild(st);
    } catch (e) { warn("[OTA] 在线样式注入失败，使用内置样式"); }
  }

  /* 按序加载（串行，保证 data → unit_names → ota → app 依赖顺序） */
  var chain = Promise.resolve();
  JS_QUEUE.forEach(function (path) {
    chain = chain.then(function () {
      var ov = bundle && typeof bundle.files[path] === "string" ? bundle.files[path] : null;
      if (ov && ov.length > 0) {
        runInline(ov);
        if (!sentinelOk(path)) {
          rollback("在线版异常：" + path);
          return loadBundled(path); // 已回退过（不重载）时兜底继续
        }
        return;
      }
      return loadBundled(path);
    });
  });
  chain["catch"](function (e) { warn("[boot] 加载链异常", e); });

  /* 健康检查：在线版导致页面空白时整体回退（一次性） */
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () {
      if (!window.__OTA_APPLIED__) return;
      var box = document.getElementById("study-words");
      if (box && box.children.length > 0) return;
      rollback("在线版启动后页面空白");
    }, 600);
  });

  log("[boot] 内置 v" + (window.__BUNDLED_VN__ || window.__BUNDLED_VC__) +
    (bundle ? " · 在线更新包 v" + (bundle.vn || bundle.v) + " 已加载" : " · 无在线更新包"));
})();
