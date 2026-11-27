/* ==========================================================================
   英语随身学 —— 核心逻辑（人教版4-9年级+高一至高三+新概念1-4册）
   - 每日5词（轮换，含朗读与中文）
   - 每日一句
   - 单词消消乐（当天学习的5个单词，配对消除）
   - 听写前一天的5词（中文提示）
  - 错题本（每日列出 + 累计复习）
  - 进度本地保存（localStorage）
  - 学习进度可自主选择：顶部 ‹ › 逐天切换、「📅 进度」面板支持
    跳到第 N 天 / 设定计划开始日期 / 跳到某单元第几组
    （一旦手动选定就不再随系统日期自动推进，可在面板中恢复跟随日期）
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------- 配置与状态 ---------------------- */
  const WORDS_PER_DAY = 5;
  const LS = {
    start: "wb_start",
    grade: "wb_grade",
    errors: "wb_errors",
    dict: "wb_dict_", // + dayIndex
    day: "wb_day",    // 用户自选的学习天序号（0 起）
    sync: "wb_sync"   // "0"=自选进度；其余/缺省=跟随日期自动推进
  };

  const DOW = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  let state = {
    dayIndex: 0,
    grade: 0,        // 0 = 全部
    errors: [],      // [{en, zh, g, date}]
    todayDict: null, // 当日听写结果
    startTs: 0,      // 学习计划起始日期（毫秒）
    follow: true     // true=跟随日期自动推进；false=用户自选进度
  };

  /* ---------------------- 工具函数 ---------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function todayMidnight() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function fmtDate(d) {
    return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 " + DOW[d.getDay()];
  }

  function activeBank() {
    return state.grade ? WORD_BANK.filter(w => w.g === state.grade) : WORD_BANK;
  }

  // 音标索引：英文 -> 音标（词库未收录或为空时返回 ""）
  const PH_BY_EN = (function () {
    const m = Object.create(null);
    WORD_BANK.forEach(function (w) { if (w.ph) m[w.en] = w.ph; });
    return m;
  })();
  function phOf(en) { return PH_BY_EN[en] || ""; }
  function phHtml(en, cls) {
    const p = phOf(en);
    return p ? '<div class="' + (cls || "word-ph") + '">/' + escapeHtml(p) + "/</div>" : "";
  }

  // 年级代号 -> 显示名称
  function gradeName(g) {
    if (g === 10) return "高一";
    if (g === 11) return "高二";
    if (g === 12) return "高三";
    if (g === 21) return "新概念1册";
    if (g === 22) return "新概念2册";
    if (g === 23) return "新概念3册";
    if (g === 24) return "新概念4册";
    return g + " 年级";
  }

  // 第 dayIndex 天的 5 个单词（顺序轮换，整轮循环）
  function dayWords(dayIndex) {
    const bank = activeBank();
    const n = bank.length;
    if (n === 0) return [];
    let d = Number(dayIndex);
    if (!isFinite(d) || d < 0) d = 0; // 防御：localStorage 数据异常时回退第 1 天
    d = Math.floor(d);
    const start = d * WORDS_PER_DAY;
    const res = [];
    for (let i = 0; i < WORDS_PER_DAY; i++) res.push(bank[(start + i) % n]);
    return res;
  }

  // 当前单词所属课内单元 + 组内学习进度（如：必修一 Unit 1 …（第 3/6 组））
  function unitProgress(words) {
    if (!words || !words.length || !words[0]) return "";
    if (typeof UNIT_NAMES === "undefined") return "";
    const bank = activeBank();
    const g = words[0].g;
    const names = UNIT_NAMES[g];
    if (!names) return "";
    const label = w => {
      const unitWords = bank.filter(x => x.g === g && x.u === w.u);
      const pos = unitWords.indexOf(w);
      const group = Math.floor(Math.max(0, pos) / WORDS_PER_DAY) + 1;
      const total = Math.max(1, Math.ceil(unitWords.length / WORDS_PER_DAY));
      return names[w.u] + "（第 " + group + "/" + total + " 组）";
    };
    const us = [];
    words.forEach(w => { if (us.indexOf(w.u) < 0) us.push(w.u); });
    if (us.length <= 1) return label(words[0]);
    return label(words[0]) + " → " + label(words[words.length - 1]);
  }

  function daySentence(dayIndex) {
    return SENTENCES[dayIndex % SENTENCES.length];
  }

  // 语音朗读（rate 可选：用于慢速跟读）
  // 优先使用 Capacitor 原生 TTS（APK 内，安卓 WebView 无 Web Speech API），回退 Web Speech（桌面浏览器）
  function nativeTTS() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TextToSpeech) {
        return window.Capacitor.Plugins.TextToSpeech;
      }
    } catch (e) {}
    return null;
  }

  // 原生 TTS 是否可用（检测/调用失败后自动置 false，切换在线发音兜底）
  let nativeTtsAvailable = true;
  let remoteAudio = null;

  // 在线发音兜底：原生 TTS 不可用时使用（鸿蒙等无英语语音包的设备也能发声，需联网）
  function speakRemote(text, rate) {
    const tts = nativeTTS();
    if (tts && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      // APK 内：原生 HTTP 下载 + MediaPlayer 播放（绕开 WebView 网络限制）
      Promise.resolve(tts.playOnline({ text: String(text), rate: (rate != null ? rate : 0.95) }))
        .then(() => {})
        .catch((err) => {
          showToast("在线发音失败（" + (err && err.message ? err.message : err) + "）。请检查网络；若本机装有英语语音包，也可点「去设置」。", "去设置");
        });
      return;
    }
    // 桌面浏览器：audio 元素直接播放在线音频
    try {
      if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.preload = "auto";
      }
      const spd = (rate != null && rate <= 0.6) ? 2 : 3; // 2=慢速 3=常速
      remoteAudio.src = "https://fanyi.baidu.com/gettts?lan=en&spd=" + spd + "&source=web&text=" + encodeURIComponent(String(text));
      remoteAudio.play().then(() => {}).catch((err) => {
        showToast("在线发音加载失败（" + (err && err.message ? err.message : "未知错误") + "）。请检查网络；若本机装有英语语音包，也可点「去设置」。", "去设置");
      });
    } catch (e) {}
  }

  function speak(text, rate) {
    const r = (rate != null) ? rate : 0.95; // 默认语速
    const tts = nativeTtsAvailable ? nativeTTS() : null;
    if (tts && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      // 原生 TTS：走系统语音引擎。
      // 注意：部分设备（尤其国产/鸿蒙）有引擎但缺英语语音包，调用不报错却无声，
      // 因此以「真正开始发音(onStart)」为成功判据，3 秒未启动则取消并切在线发音。
      speakNativeWatchdog(tts, text, r).catch(() => {
        nativeTtsAvailable = false;
        speakRemote(text, r);
      });
      return;
    }
    if (nativeTtsAvailable && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = r;
      u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      return;
    }
    // 安卓 WebView 无 Web Speech，或原生引擎已判定不可用 → 在线发音
    speakRemote(text, r);
  }

  // 原生朗读 + 超时看门狗：3 秒内未真正开始发音即视为失败
  function speakNativeWatchdog(tts, text, rate) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // 取消可能正在排队/播放的原生发音，避免与在线发音重音
        try { tts.stop(); } catch (e) {}
        reject("timeout");
      }, 3000);
      Promise.resolve(tts.speak({
        text: String(text),
        lang: "en-US",
        rate: rate,
        pitch: 1.0,
        volume: 1.0
      })).then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function stopSpeak() {
    const tts = nativeTTS();
    if (tts && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      tts.stop().catch(() => {});
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (remoteAudio) { try { remoteAudio.pause(); remoteAudio.currentTime = 0; } catch (e) {} }
  }

  // 轻量提示（不常驻，自动消失），用于朗读失败/语音包缺失提示
  // actionLabel 可选：传入后显示一个操作按钮（如“去设置”）
  function showToast(msg, actionLabel) {
    let box = document.getElementById("wb-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "wb-toast";
      document.body.appendChild(box);
    }
    box.innerHTML = "";
    const span = document.createElement("span");
    span.className = "toast-msg";
    span.textContent = msg;
    box.appendChild(span);
    if (actionLabel) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-btn";
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => openTtsSettings());
      box.appendChild(btn);
    }
    box.style.display = "flex";
    clearTimeout(box._t);
    box._t = setTimeout(() => { box.style.display = "none"; }, 10000);
  }

  // 跳转系统「文字转语音(TTS)输出」设置页（鸿蒙/华为可在此安装英语语音包）
  function openTtsSettings() {
    const tts = nativeTTS();
    if (tts && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      Promise.resolve(tts.openTtsSettings()).catch(() => {
        showToast("无法自动打开设置页，请手动前往：设置 → 系统和更新 → 语言和输入法 → 文字转语音(TTS)输出。");
      });
    } else {
      alert("请在系统设置中安装英语语音包（设置 → 语言和输入法 → 文字转语音输出）。");
    }
  }

  function normalize(s) {
    return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  /* ---------------------- 持久化 ---------------------- */
  function loadState() {
    // 起始日期
    let start = localStorage.getItem(LS.start);
    const t = todayMidnight();
    if (!start) {
      start = t.getTime();
      localStorage.setItem(LS.start, start);
    } else {
      start = Number(start);
    }
    state.startTs = isFinite(start) ? start : t.getTime();

    // 学习到第几天：
    //  - 跟随日期（默认）：由起始日期与今天相差天数推算
    //  - 自选进度：以用户选定的 wb_day 为准，不再随系统日期变化
    const follow = localStorage.getItem(LS.sync) !== "0";
    state.follow = follow;
    if (follow) {
      let dayIndex = Math.floor((t.getTime() - start) / 86400000);
      if (!isFinite(dayIndex) || dayIndex < 0) dayIndex = 0; // 防御：起始日期异常时回退第 1 天
      state.dayIndex = dayIndex;
    } else {
      let d = Number(localStorage.getItem(LS.day));
      if (!isFinite(d) || d < 0) d = 0;
      state.dayIndex = Math.floor(d);
    }

    // 年级筛选
    state.grade = Number(localStorage.getItem(LS.grade) || 0);

    // 错题
    try {
      state.errors = JSON.parse(localStorage.getItem(LS.errors) || "[]");
    } catch (e) { state.errors = []; }

    // 当日听写结果
    try {
      state.todayDict = JSON.parse(localStorage.getItem(LS.dict + state.dayIndex) || "null");
    } catch (e) { state.todayDict = null; }
  }

  function saveErrors() {
    localStorage.setItem(LS.errors, JSON.stringify(state.errors));
  }

  function saveDict(result) {
    state.todayDict = result;
    localStorage.setItem(LS.dict + state.dayIndex, JSON.stringify(result));
  }

  function addError(word) {
    // 去重：同一单词只保留一条
    if (state.errors.some(e => normalize(e.en) === normalize(word.en))) return;
    state.errors.unshift({
      en: word.en, zh: word.zh, g: word.g,
      date: fmtDate(todayMidnight())
    });
    saveErrors();
  }

  function removeError(en) {
    state.errors = state.errors.filter(e => normalize(e.en) !== normalize(en));
    saveErrors();
  }

  /* ---------------------- 学习进度：自主选择 ---------------------- */
  // 当前词库学完一轮共多少天
  function totalDays() {
    return Math.max(1, Math.ceil(activeBank().length / WORDS_PER_DAY));
  }

  // 某年级的单元名称列表
  function unitNamesOf(g) {
    return (typeof UNIT_NAMES !== "undefined" && UNIT_NAMES[g]) ? UNIT_NAMES[g] : [];
  }

  function unitWordCount(g, u) {
    return WORD_BANK.filter(w => w.g === g && w.u === u).length;
  }

  // 某单元第 group 组的第一个词出现在第几天（0 起）
  function unitGroupDayIndex(g, u, group) {
    const bank = g ? WORD_BANK.filter(w => w.g === g) : WORD_BANK;
    const idx = bank.findIndex(w => w.g === g && w.u === u);
    if (idx < 0) return 0;
    return Math.max(0, Math.floor((idx + (group - 1) * WORDS_PER_DAY) / WORDS_PER_DAY));
  }

  function loadDictOf(dayIndex) {
    try {
      return JSON.parse(localStorage.getItem(LS.dict + dayIndex) || "null");
    } catch (e) { return null; }
  }

  // 统一重渲染（切换天数/年级后调用）
  function renderPanels() {
    renderStudy();
    renderMatch();
    renderDictation();
    renderErrors();
    renderHeader();
  }

  // 跳到第 n+1 天（0 起为 n），并切换为「自选模式」
  function gotoDay(n) {
    const max = totalDays() - 1;
    let d = Number(n);
    if (!isFinite(d)) d = state.dayIndex;
    d = Math.min(max, Math.max(0, Math.floor(d)));
    state.dayIndex = d;
    state.follow = false;
    localStorage.setItem(LS.day, d);
    localStorage.setItem(LS.sync, "0"); // 手动选定后不再随系统日期推进
    state.todayDict = loadDictOf(d);
    renderPanels();
    updatePlanTip();
  }

  // 恢复/切换为「跟随日期」模式，并按起始日期重新推算天数
  function followFrom(startTs) {
    const ts = isFinite(startTs) ? startTs : state.startTs;
    localStorage.setItem(LS.start, ts);
    localStorage.setItem(LS.sync, "1");
    state.startTs = ts;
    state.follow = true;
    let d = Math.floor((todayMidnight().getTime() - ts) / 86400000);
    if (!isFinite(d) || d < 0) d = 0;
    state.dayIndex = d;
    state.todayDict = loadDictOf(d);
    renderPanels();
    updatePlanTip();
  }

  /* ---------------------- 进度面板 ---------------------- */
  function planModal() { return $("#plan-modal"); }
  function planOpen() { return planModal() && !planModal().hidden; }

  // 时间戳 -> <input type="date"> 需要的 YYYY-MM-DD
  function tsToInputDate(ts) {
    const d = new Date(isFinite(ts) ? ts : todayMidnight().getTime());
    if (!isFinite(d.getTime())) return tsToInputDate(todayMidnight().getTime());
    const p = n => (n < 10 ? "0" : "") + n;
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function updatePlanTip() {
    const tip = $("#plan-tip");
    if (!tip) return;
    tip.textContent = state.follow
      ? "当前：跟随日期自动推进（第 " + (state.dayIndex + 1) + " 天）"
      : "当前：自选进度，第 " + (state.dayIndex + 1) + " 天（不再随日期变化）";
  }

  function fillPlanGrade() {
    const sel = $("#plan-grade");
    if (!sel) return;
    const grades = [4, 5, 6, 7, 8, 9, 10, 11, 12, 21, 22, 23, 24].filter(g => unitNamesOf(g).length);
    if (!grades.length) return;
    sel.innerHTML = grades.map(g => `<option value="${g}">${gradeName(g)}</option>`).join("");
    sel.value = grades.indexOf(state.grade) >= 0 ? state.grade : grades[0];
    fillPlanUnits();
  }

  function fillPlanUnits() {
    const g = Number($("#plan-grade").value);
    const sel = $("#plan-unit");
    const names = unitNamesOf(g);
    sel.innerHTML = names.map((n, i) => `<option value="${i}">${escapeHtml(n)}</option>`).join("");
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    fillPlanGroups();
  }

  function fillPlanGroups() {
    const g = Number($("#plan-grade").value);
    const u = Number($("#plan-unit").value);
    const sel = $("#plan-group");
    if (!sel) return;
    const total = Math.max(1, Math.ceil(unitWordCount(g, u) / WORDS_PER_DAY));
    const opts = [];
    for (let i = 1; i <= total; i++) opts.push(`<option value="${i}">第 ${i}/${total} 组</option>`);
    sel.innerHTML = opts.join("");
  }

  function openPlan() {
    const m = planModal();
    if (!m) return;
    $("#plan-day").value = state.dayIndex + 1;
    $("#plan-day").max = totalDays();
    $("#plan-day-max").textContent = "本轮共 " + totalDays() + " 天";
    $("#plan-start").value = tsToInputDate(state.startTs);
    fillPlanGrade();
    updatePlanTip();
    m.hidden = false;
  }

  function closePlan() { if (planModal()) planModal().hidden = true; }

  function bindDayNav() {
    const prev = $("#day-prev"), next = $("#day-next"), cur = $("#hdr-day"), open = $("#plan-open");
    if (prev) prev.addEventListener("click", () => gotoDay(state.dayIndex - 1));
    if (next) next.addEventListener("click", () => gotoDay(state.dayIndex + 1));
    if (cur) cur.addEventListener("click", openPlan);
    if (open) open.addEventListener("click", openPlan);
  }

  function bindPlanModal() {
    if (!planModal()) return;
    // 关闭：按钮 / 点遮罩空白处 / Esc
    $("#plan-close").addEventListener("click", closePlan);
    planModal().addEventListener("click", e => { if (e.target === planModal()) closePlan(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && planOpen()) closePlan(); });

    $("#plan-grade").addEventListener("change", fillPlanUnits);
    $("#plan-unit").addEventListener("change", fillPlanGroups);

    // 跳到第 N 天
    const dayGo = () => {
      const n = Number($("#plan-day").value);
      if (!isFinite(n)) { closePlan(); return; }
      gotoDay(n - 1);
      closePlan();
    };
    $("#plan-day-go").addEventListener("click", dayGo);
    $("#plan-day").addEventListener("keydown", e => { if (e.key === "Enter") dayGo(); });

    // 跳到某单元第几组（同时同步主界面年级筛选，否则天数算不准）
    $("#plan-unit-go").addEventListener("click", () => {
      const g = Number($("#plan-grade").value);
      const u = Number($("#plan-unit").value);
      const grp = Number($("#plan-group").value);
      if (g !== state.grade) {
        state.grade = g;
        localStorage.setItem(LS.grade, g);
        $("#grade-select").value = g;
        state.todayDict = null;
      }
      gotoDay(unitGroupDayIndex(g, u, grp));
      closePlan();
    });

    // 设定计划开始日期（顺带恢复为跟随日期模式）
    $("#plan-start-go").addEventListener("click", () => {
      const v = $("#plan-start").value;
      const d = new Date((v || tsToInputDate(todayMidnight().getTime())) + "T00:00:00");
      if (!isFinite(d.getTime())) { closePlan(); return; }
      followFrom(d.getTime());
      closePlan();
    });

    // 恢复跟随日期
    $("#plan-reset").addEventListener("click", () => {
      followFrom(state.startTs);
      closePlan();
    });
  }

  /* ---------------------- 设置与在线更新 ---------------------- */
  function settingsModal() { return $("#settings-modal"); }
  function settingsOpen() { return settingsModal() && !settingsModal().hidden; }
  function closeSettings() { if (settingsModal()) settingsModal().hidden = true; }

  function otaStatusClass(s) {
    if (s === "latest" || s === "ready") return "ok";
    if (s === "checking" || s === "downloading") return "info";
    return "warn";
  }
  function getEffectiveUrl() { return window.OTA ? OTA.getUrl() : ""; }

  function renderSettings() {
    const cur = $("#set-curver");
    if (cur) {
      let t = "v" + (window.__BUNDLED_VN__ || window.__BUNDLED_VC__ || "?");
      if (window.__OTA_APPLIED__) {
        t += " → 在线 v" + (window.__OTA_BUNDLE_INFO__ ? window.__OTA_BUNDLE_INFO__.vn : window.__OTA_APPLIED__);
      }
      cur.textContent = t;
    }
    const st = window.OTA ? OTA.getStatus() : { state: "error", msg: "更新模块未加载" };
    const el = $("#set-status");
    if (el) { el.textContent = st.msg || "—"; el.className = "set-status " + otaStatusClass(st.state); }
    const url = $("#set-url");
    if (url && document.activeElement !== url) url.value = window.OTA ? OTA.getUrl() : "";
    const clear = $("#set-clear"), restart = $("#set-restart"), def = $("#set-default");
    if (clear) clear.hidden = !window.__OTA_APPLIED__;
    if (restart) restart.hidden = st.state !== "ready";
    if (def) def.hidden = !!getEffectiveUrl();
  }

  function bindSettingsModal() {
    const modal = settingsModal();
    if (!modal) return;
    $("#settings-open").addEventListener("click", () => { renderSettings(); modal.hidden = false; });
    $("#set-close").addEventListener("click", closeSettings);
    modal.addEventListener("click", e => { if (e.target === modal) closeSettings(); });

    // 保存更新地址
    $("#set-url-save").addEventListener("click", () => {
      OTA.setUrl($("#set-url").value);
      renderSettings();
      const v = OTA.getUrl();
      showToast(v
        ? (v === OTA.DEFAULT_URL ? "已恢复内置默认更新地址" : "更新地址已保存，将自动检查更新")
        : "已关闭自动更新（地址已清空）");
    });

    // 手动检查更新
    $("#set-check").addEventListener("click", () => {
      const btn = $("#set-check");
      if (btn) { btn.disabled = true; btn.textContent = "检查中…"; }
      OTA.checkNow().then(() => {
        renderSettings();
        if (btn) { btn.disabled = false; btn.textContent = "检查更新"; }
      });
    });

    // 恢复内置版本 / 立即重启使已下载更新生效
    $("#set-clear").addEventListener("click", () => {
      if (confirm("恢复使用 App 内置版本？已下载的在线更新内容将被清除。")) OTA.clearBundle();
    });
    $("#set-restart").addEventListener("click", () => OTA.restartNow());

    // 关闭自动更新后，可一键恢复内置默认地址
    $("#set-default").addEventListener("click", () => {
      OTA.setUrl(OTA.DEFAULT_URL);
      renderSettings();
      showToast("已恢复内置默认更新地址");
    });

    document.addEventListener("keydown", e => { if (e.key === "Escape" && settingsOpen()) closeSettings(); });
  }

  /* ---------------------- 渲染：学习模块 ---------------------- */
  function renderStudy() {
    const words = dayWords(state.dayIndex);
    const sent = daySentence(state.dayIndex);

    const unitEl = $("#study-unit");
    if (unitEl) unitEl.textContent = "📚 正在学：" + (unitProgress(words) || gradeName(state.grade || 0));

    const wordsHtml = words.map((w, i) => `
      <div class="word-card" data-en="${escapeAttr(w.en)}">
        <div class="word-no">${i + 1}</div>
        <button class="speak-btn" data-speak="${escapeAttr(w.en)}" title="点击听发音">🔊</button>
        <div class="word-en" data-speak="${escapeAttr(w.en)}">${escapeHtml(w.en)}</div>
        ${w.ph ? `<div class="word-ph">/${escapeHtml(w.ph)}/</div>` : ""}
        <div class="word-zh">${escapeHtml(w.zh)}</div>
        <div class="word-g">${gradeName(w.g)}</div>
      </div>
    `).join("");

    $("#study-words").innerHTML = wordsHtml;

    $("#study-sentence").innerHTML = `
      <div class="sentence-box">
        <button class="speak-btn big" data-speak="${escapeAttr(sent.en)}" title="点击听发音">🔊</button>
        <div class="sentence-en" data-speak="${escapeAttr(sent.en)}">${escapeHtml(sent.en)}</div>
        <div class="sentence-zh">${escapeHtml(sent.zh)}</div>
      </div>`;

    // 绑定朗读
    $all("[data-speak]").forEach(el => {
      el.addEventListener("click", () => speak(el.getAttribute("data-speak")));
    });
  }

  /* ---------------------- 渲染：听写模块 ---------------------- */
  function renderDictation() {
    const prevDay = state.dayIndex - 1;
    const box = $("#dict-body");
    const head = $("#dict-head");

    if (state.dayIndex === 0) {
      head.textContent = "听写练习（第 1 天）";
      box.innerHTML = `<div class="empty-tip">🎉 今天是第一天，还没有要复习的单词。<br>从明天开始，这里会听写前一天学过的 5 个单词！</div>`;
      return;
    }

    const words = dayWords(prevDay);
    head.textContent = `听写练习（复习第 ${prevDay + 1} 天的单词）`;
    const unitTip = unitProgress(words);
    if (unitTip) head.textContent += " · " + unitTip;

    if (state.todayDict) {
      // 已提交：展示结果
      box.innerHTML = resultHtml(state.todayDict);
      bindResult();
      return;
    }

    const rows = words.map((w, i) => `
      <div class="dict-row">
        <div class="dict-hint">
          <span class="dict-idx">${i + 1}.</span>
          <span class="dict-zh">${escapeHtml(w.zh)}</span>
          <button class="mini-speak" data-speak="${escapeAttr(w.en)}" title="听发音">🔊</button>
        </div>
        <input class="dict-input" type="text" placeholder="写出英文单词…" data-en="${escapeAttr(w.en)}" autocomplete="off" />
      </div>
    `).join("");

    box.innerHTML = `
      <p class="dict-tip">根据中文提示写出对应的英文单词（共 ${words.length} 个）。</p>
      ${rows}
      <div class="dict-actions">
        <button id="dict-submit" class="btn primary">提交听写</button>
        <button id="dict-replay" class="btn ghost">全部朗读一遍</button>
      </div>
      <div id="dict-result"></div>
    `;

    $all("[data-speak]", box).forEach(el => {
      el.addEventListener("click", () => speak(el.getAttribute("data-speak")));
    });

    $("#dict-replay").addEventListener("click", () => {
      words.forEach((w, i) => setTimeout(() => speak(w.en), i * 900));
    });

    $("#dict-submit").addEventListener("click", () => submitDictation(words));
  }

  function submitDictation(words) {
    const inputs = $all(".dict-input");
    const results = inputs.map((inp, i) => {
      const correct = normalize(inp.value) === normalize(words[i].en);
      return {
        en: words[i].en, zh: words[i].zh, g: words[i].g,
        answer: inp.value.trim(), correct: correct
      };
    });

    const wrong = results.filter(r => !r.correct);
    wrong.forEach(r => addError({ en: r.en, zh: r.zh, g: r.g }));

    const payload = {
      date: fmtDate(todayMidnight()),
      results: results,
      wrongCount: wrong.length
    };
    saveDict(payload);

    const box = $("#dict-body");
    box.innerHTML = resultHtml(payload);
    bindResult();
    renderErrors(); // 错题本同步更新
    renderHeader();
  }

  function resultHtml(payload) {
    const items = payload.results.map(r => `
      <div class="result-row ${r.correct ? "ok" : "bad"}">
        <span class="r-mark">${r.correct ? "✅" : "❌"}</span>
        <span class="r-zh">${escapeHtml(r.zh)}</span>
        <span class="r-answer">你的答案：${escapeHtml(r.answer || "（空）")}</span>
        ${r.correct ? "" : `<span class="r-correct">正确答案：<b data-speak="${escapeAttr(r.en)}" class="link">${escapeHtml(r.en)}</b> 🔊${phOf(r.en) ? ` <span class="r-ph">/${escapeHtml(phOf(r.en))}/</span>` : ""}</span>`}
      </div>
    `).join("");

    const score = payload.results.length - payload.wrongCount;
    return `
      <div class="result-summary">
        听写得分：<b>${score} / ${payload.results.length}</b>
        ${payload.wrongCount === 0 ? "🏆 全对，太棒了！" : `，错题已加入错题本。`}
      </div>
      <div class="result-list">${items}</div>
      <div class="dict-actions">
        <button id="dict-redo" class="btn ghost">重新听写</button>
      </div>`;
  }

  function bindResult() {
    $all("[data-speak]").forEach(el => {
      el.addEventListener("click", () => speak(el.getAttribute("data-speak")));
    });
    const redo = $("#dict-redo");
    if (redo) {
      redo.addEventListener("click", () => {
        localStorage.removeItem(LS.dict + state.dayIndex);
        state.todayDict = null;
        renderDictation();
      });
    }
  }

  /* ---------------------- 渲染：错题本 ---------------------- */
  function renderErrors() {
    const box = $("#error-body");
    if (state.errors.length === 0) {
      box.innerHTML = `<div class="empty-tip">📭 还没有错题，继续加油！</div>`;
      return;
    }

    // 今日错题（与今日听写结果相关）
    const todayWrong = state.todayDict ? state.todayDict.results.filter(r => !r.correct) : [];
    const todaySet = new Set(todayWrong.map(r => normalize(r.en)));

    const items = state.errors.map(e => {
      const isToday = todaySet.has(normalize(e.en));
      return `
        <div class="error-card ${isToday ? "today" : ""}">
          <button class="speak-btn" data-speak="${escapeAttr(e.en)}" title="听发音">🔊</button>
          <div class="error-en" data-speak="${escapeAttr(e.en)}">${escapeHtml(e.en)}</div>
          <div class="error-zh">${escapeHtml(e.zh)}</div>
          <div class="error-meta">${gradeName(e.g)} · 错于 ${escapeHtml(e.date)} ${isToday ? "· <span class='tag'>今日</span>" : ""}</div>
          <button class="mini-remove" data-remove="${escapeAttr(e.en)}">已掌握✓</button>
        </div>`;
    }).join("");

    box.innerHTML = `
      <div class="error-head">累计错题：<b>${state.errors.length}</b> 个
        ${state.errors.length ? `<button id="error-clear" class="btn ghost small">清空错题本</button>` : ""}</div>
      <div class="error-grid">${items}</div>`;

    $all("[data-speak]", box).forEach(el => {
      el.addEventListener("click", () => speak(el.getAttribute("data-speak")));
    });
    $all("[data-remove]", box).forEach(btn => {
      btn.addEventListener("click", () => {
        removeError(btn.getAttribute("data-remove"));
        renderErrors();
        renderHeader();
      });
    });
    const clearBtn = $("#error-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (confirm("确定要清空整个错题本吗？")) {
          state.errors = [];
          saveErrors();
          renderErrors();
          renderHeader();
        }
      });
    }
  }

  /* ---------------------- 顶部状态栏 ---------------------- */
  function renderHeader() {
    $("#hdr-date").textContent = fmtDate(todayMidnight());
    const cur = $("#hdr-day");
    cur.textContent = "第 " + (state.dayIndex + 1) + " 天";
    cur.classList.toggle("manual", !state.follow);
    cur.title = state.follow
      ? "跟随日期自动推进 · 点击可选择要学的第几天"
      : "自选进度（不随日期变化）· 点击可重新选择";
    $("#hdr-errors").textContent = "错题 " + state.errors.length + " 个";
    // 词库学完一轮后是循环复习，封顶避免显示超过词库总量的数字
    const learned = Math.min((state.dayIndex + 1) * WORDS_PER_DAY, activeBank().length);
    $("#hdr-words").textContent = "已学单词约 " + learned + " 个";
    const prev = $("#day-prev");
    if (prev) prev.disabled = state.dayIndex <= 0;
    renderFooterVersion();
  }

  /* 页脚版本：内置版本 + 在线更新标识（由 OTA 加载时显示） */
  function renderFooterVersion() {
    const el = $("#foot-version");
    if (!el) return;
    let t = "v" + (window.__BUNDLED_VN__ || window.__BUNDLED_VC__ || "?");
    if (window.__OTA_APPLIED__) {
      const info = window.__OTA_BUNDLE_INFO__;
      t += "（在线更新 v" + ((info && info.vn) || window.__OTA_APPLIED__) + "）";
    }
    el.textContent = t;
  }

  /* ---------------------- 渲染：单词消消乐（当天学习的5个单词） ---------------------- */
  let matchState = { cards: [], selected: null, matched: 0, total: 0, steps: 0, locked: false, words: [] };

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function matchCardsHtml() {
    return matchState.cards.map((c, i) => {
      const cls = c.matched ? "matched" : (matchState.selected === i ? "selected" : "");
      const txt = c.type === "en" ? escapeHtml(c.text) : escapeHtml(c.text);
      return `<button class="match-card ${cls}" data-idx="${i}" data-pair="${c.pair}" data-type="${c.type}" ${c.matched ? "disabled" : ""}>${txt}</button>`;
    }).join("");
  }

  function renderMatch() {
    const words = dayWords(state.dayIndex);
    const box = $("#match-body");

    if (!words.length) {
      box.innerHTML = `<div class="empty-tip">当前词库为空，请选择其他年级。</div>`;
      return;
    }

    // 每个单词生成一对卡片（英文 + 中文），打乱后排成网格
    const cards = [];
    words.forEach((w, i) => {
      cards.push({ pair: i, type: "en", text: w.en, word: w, matched: false });
      cards.push({ pair: i, type: "zh", text: w.zh, word: w, matched: false });
    });
    matchState = {
      cards: shuffle(cards),
      selected: null,
      matched: 0,
      total: words.length,
      steps: 0,
      locked: false,
      words: words
    };

    box.innerHTML = `
      <p class="dict-tip">🧩 点击「英文」和「中文」卡片配对，消除今天学的 ${words.length} 个单词。配对成功会自动播放发音！</p>
      <p class="hint unit-line">📚 ${escapeHtml(unitProgress(words))}</p>
      <div class="match-bar">
        <span id="match-steps" class="match-stat">步数 0</span>
        <span id="match-left" class="match-stat">剩余 ${words.length} 对</span>
        <button id="match-restart" class="btn ghost small">🔄 重新开始</button>
      </div>
      <div id="match-grid" class="match-grid">${matchCardsHtml()}</div>
      <div id="match-done"></div>`;

    $("#match-restart").addEventListener("click", renderMatch);
    bindMatchCards();
  }

  function bindMatchCards() {
    $all(".match-card").forEach(btn => {
      btn.addEventListener("click", () => onMatchCard(Number(btn.getAttribute("data-idx"))));
    });
  }

  function updateMatchBar() {
    const steps = $("#match-steps");
    const left = $("#match-left");
    if (steps) steps.textContent = "步数 " + matchState.steps;
    if (left) left.textContent = "剩余 " + (matchState.total - matchState.matched) + " 对";
  }

  function onMatchCard(idx) {
    if (matchState.locked) return;
    const card = matchState.cards[idx];
    if (!card || card.matched) return;

    // 再次点击已选中的卡片 → 取消选中
    if (matchState.selected === idx) {
      matchState.selected = null;
      renderMatchGrid();
      return;
    }

    // 没有选中 → 选中
    if (matchState.selected === null) {
      matchState.selected = idx;
      renderMatchGrid();
      return;
    }

    // 已有选中
    const prev = matchState.cards[matchState.selected];
    if (prev.type === card.type) {
      // 同类型（英-英 / 中-中）→ 切换选中
      matchState.selected = idx;
      renderMatchGrid();
      return;
    }

    matchState.steps++;
    const prevIdx = matchState.selected;
    if (prev.pair === card.pair) {
      // 配对成功：消除 + 播放发音
      prev.matched = true;
      card.matched = true;
      matchState.selected = null;
      matchState.matched++;
      renderMatchGrid();
      updateMatchBar();
      speak(card.word.en);
      if (matchState.matched === matchState.total) showMatchDone();
    } else {
      // 配对失败：立即清除选中高亮，两张卡抖动提示，短暂锁定后恢复
      matchState.locked = true;
      matchState.selected = null;
      renderMatchGrid();
      const grid = $("#match-grid");
      const a = grid.querySelector('[data-idx="' + prevIdx + '"]');
      const b = grid.querySelector('[data-idx="' + idx + '"]');
      if (a) a.classList.add("wrong");
      if (b) b.classList.add("wrong");
      setTimeout(() => {
        matchState.locked = false;
        renderMatchGrid();
        updateMatchBar();
      }, 600);
      updateMatchBar();
    }
  }

  function renderMatchGrid() {
    const grid = $("#match-grid");
    if (grid) grid.innerHTML = matchCardsHtml();
    bindMatchCards();
  }

  function showMatchDone() {
    const done = $("#match-done");
    if (!done) return;
    done.innerHTML = `
      <div class="result-summary">🎉 全部消除！共用 <b>${matchState.steps}</b> 步
        ${matchState.steps <= matchState.total ? "，满分记忆！🏆" : "，再来一局可以更棒！"}</div>
      <div class="dict-actions"><button id="match-again" class="btn primary">🔄 再玩一次</button></div>`;
    const again = $("#match-again");
    if (again) again.addEventListener("click", renderMatch);
  }

  /* ---------------------- 年级筛选 ---------------------- */
  function renderGradeSelect() {
    const sel = $("#grade-select");
    const grades = [{v:0, t:"全部年级"}]
      .concat([4,5,6,7,8,9].map(g => ({v:g, t:g + " 年级"})))
      .concat([{v:10,t:"高一"},{v:11,t:"高二"},{v:12,t:"高三"}])
      .concat([{v:21,t:"新概念1册"},{v:22,t:"新概念2册"},{v:23,t:"新概念3册"},{v:24,t:"新概念4册"}]);
    sel.innerHTML = grades.map(o => `<option value="${o.v}" ${o.v===state.grade?"selected":""}>${o.t}</option>`).join("");
    sel.addEventListener("change", () => {
      state.grade = Number(sel.value);
      localStorage.setItem(LS.grade, state.grade);
      // 切换年级后，当天听写结果基于新词库可能不一致，重置当日听写
      localStorage.removeItem(LS.dict + state.dayIndex);
      state.todayDict = null;
      renderStudy();
      renderMatch();
      renderDictation();
      renderErrors();
      renderHeader();
    });
  }

  /* ---------------------- 转义工具 ---------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ---------------------- 标签页切换 ---------------------- */
  function bindTabs() {
    $all(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-tab");
        $all(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
        $all(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + id));
      });
    });
  }

  /* ---------------------- 语音引擎提示（轻量 toast） ---------------------- */
  const TTS_GUIDE = "🔇 本机没有可用的英语语音引擎或语音包，已自动切换为在线发音（需联网）。\n想用本机发音：鸿蒙/华为设备请到「设置 → 系统和更新 → 语言和输入法 → 文字转语音(TTS)输出」中安装英语语音包，或安装讯飞/华为语音引擎。";

  function ttsToast() {
    showToast(TTS_GUIDE, "去设置");
  }

  function detectTts(useRefresh) {
    const tts = nativeTTS();
    if (!tts) return;
    if (!(window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
    const call = useRefresh ? Promise.resolve(tts.refresh()) : Promise.resolve(tts.check({ lang: "en-US" }));
    call.then(res => {
      if (res && res.available === true) {
        // 用户装好了语音包：恢复本机发音
        nativeTtsAvailable = true;
        showToast("✅ 本机英语语音引擎已就绪，恢复本机发音。");
      } else if (res && res.available === false) {
        // 无英语语音包：自动切换在线发音，并告知如何恢复本机发音
        nativeTtsAvailable = false;
        showToast(TTS_GUIDE, "去设置");
      }
    }).catch(() => {});
  }

  // 从系统设置页返回时自动重新检测（用户可能刚装好英语语音包）
  function bindResumeCheck() {
    try {
      const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
      if (App && App.addListener) {
        App.addListener("resume", () => { setTimeout(() => detectTts(true), 400); });
      }
    } catch (e) {}
  }

  /* ---------------------- 初始化 ---------------------- */
  function init() {
    loadState();
    renderHeader();
    renderGradeSelect();
    renderStudy();
    renderMatch();
    renderDictation();
    renderErrors();
    bindTabs();
    bindDayNav();
    bindPlanModal();
    bindSettingsModal();
    bindResumeCheck();
    // 在线自动升级：启动时静默检查（未配置地址则自动跳过）
    if (window.OTA && OTA.init) OTA.init();
    // 打开后稍等原生 TTS 初始化，主动检测英语语音包并提示
    setTimeout(detectTts, 1200);
  }

  // 供 boot.js 哨兵检测：本 IIFE 完整执行（在线更新版异常时据此回退）
  window.__APP_READY__ = true;
  // 动态加载（boot.js）时 DOMContentLoaded 可能已触发，需按 readyState 兜底
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
