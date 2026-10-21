package com.english.daily;

import android.content.Intent;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.TextToSpeech.EngineInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "TextToSpeech")
public class TtsPlugin extends Plugin {
    private TextToSpeech tts;
    private TextToSpeech ttsAlt; // 支持英语的备用引擎（鸿蒙/华为常需切换）
    private boolean ready = false;
    private MediaPlayer mediaPlayer; // 在线发音兜底播放器

    private boolean langOk(int avail) {
        return avail == TextToSpeech.LANG_AVAILABLE
            || avail == TextToSpeech.LANG_COUNTRY_AVAILABLE
            || avail == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE;
    }

    @Override
    public void load() {
        try {
            tts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    tts.setLanguage(Locale.ENGLISH);
                    ensureEnglishEngine();
                    ready = true;
                }
            });
        } catch (Exception e) {
            // 鸿蒙等系统可能没有可用的 TTS 框架
            tts = null;
        }
    }

    // 默认引擎不支持英语时，尝试系统里其它已安装的引擎（如讯飞、华为 TTS）
    private void ensureEnglishEngine() {
        if (tts == null) return;
        if (langOk(tts.isLanguageAvailable(Locale.ENGLISH))) return;
        List<EngineInfo> engines = tts.getEngines();
        if (engines == null) return;
        for (EngineInfo ei : engines) {
            if (ei == null || ei.name == null) continue;
            try {
                TextToSpeech alt = new TextToSpeech(getContext(), null, ei.name);
                if (alt != null && langOk(alt.isLanguageAvailable(Locale.ENGLISH))) {
                    ttsAlt = alt;
                    ttsAlt.setLanguage(Locale.ENGLISH);
                    return;
                }
            } catch (Exception e) { /* 该引擎不可用，跳过 */ }
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String lang = call.getString("lang", "en-US");
        double rate = call.getDouble("rate", 1.0);
        double pitch = call.getDouble("pitch", 1.0);
        double volume = call.getDouble("volume", 1.0);
        if (tts == null) {
            call.reject("TTS_UNAVAILABLE");
            return;
        }
        // 插件首次调用才实例化，引擎初始化可能需要 1-3 秒，轮询等待就绪
        waitReady(() -> {
            if (ready) doSpeak(call, text, parseLocale(lang), (float) rate, (float) pitch, (float) volume);
            else call.reject("TTS_NOT_READY");
        });
    }

    private void waitReady(Runnable r) {
        if (ready) { r.run(); return; }
        final long deadline = System.currentTimeMillis() + 4000;
        final Handler h = new Handler(Looper.getMainLooper());
        h.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (ready || System.currentTimeMillis() >= deadline) {
                    r.run();
                    return;
                }
                h.postDelayed(this, 300);
            }
        }, 300);
    }

    private void doSpeak(PluginCall call, String text, Locale locale, float rate, float pitch, float volume) {
        TextToSpeech engine = (ttsAlt != null) ? ttsAlt : tts;
        engine.setLanguage(locale);
        engine.setSpeechRate(rate <= 0 ? 1.0f : rate);
        engine.setPitch(pitch <= 0 ? 1.0f : pitch);
        // 没有英语语音包 → 明确失败，让前端走在线发音（避免静默无声）
        if (!langOk(engine.isLanguageAvailable(locale))) {
            call.reject("NO_ENGLISH_VOICE");
            return;
        }
        final String utterId = "tts_" + System.currentTimeMillis();
        final boolean[] settled = {false};
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String s) {
                if (settled[0] || !utterId.equals(s)) return;
                settled[0] = true;
                engine.setOnUtteranceProgressListener(null);
                JSObject ret = new JSObject();
                ret.put("value", true);
                ret.put("engine", engine.getDefaultEngine() == null ? "" : engine.getDefaultEngine());
                call.resolve(ret);
            }

            @Override
            public void onDone(String s) { /* 无需处理 */ }

            @Override
            public void onError(String s) {
                if (settled[0]) return;
                settled[0] = true;
                engine.setOnUtteranceProgressListener(null);
                call.reject("SPEAK_ERROR");
            }
        });
        Bundle params = new Bundle();
        params.putString(TextToSpeech.Engine.KEY_PARAM_VOLUME, String.valueOf(volume));
        int q = engine.speak(text, TextToSpeech.QUEUE_FLUSH, params, utterId);
        if (q != TextToSpeech.SUCCESS && !settled[0]) {
            settled[0] = true;
            engine.setOnUtteranceProgressListener(null);
            call.reject("QUEUE_FAIL");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        if (ttsAlt != null) ttsAlt.stop();
        stopOnline();
        call.resolve();
    }

    // 检测语音引擎与英语语音包是否可用
    @PluginMethod
    public void check(PluginCall call) {
        String lang = call.getString("lang", "en-US");
        evaluateCheck(call, lang);
    }

    private void evaluateCheck(PluginCall call, String lang) {
        JSObject ret = new JSObject();
        if (tts == null) {
            ret.put("ready", false);
            ret.put("available", false);
            ret.put("engine", "");
            ret.put("reason", "no_engine");
            call.resolve(ret);
            return;
        }
        if (!ready) {
            new Handler(Looper.getMainLooper()).postDelayed(() -> evaluateCheck(call, lang), 700);
            return;
        }
        TextToSpeech engine = (ttsAlt != null) ? ttsAlt : tts;
        int avail = engine.isLanguageAvailable(parseLocale(lang));
        boolean ok = langOk(avail);
        ret.put("ready", true);
        ret.put("available", ok);
        ret.put("engine", engine.getDefaultEngine() == null ? "" : engine.getDefaultEngine());
        ret.put("reason", ok ? "ok" : "no_language");
        call.resolve(ret);
    }

    // 在线发音兜底：原生 HTTP 下载音频并用 MediaPlayer 播放
    // （鸿蒙 WebView 内加载外部音频常失败，走原生网络栈最稳）
    @PluginMethod
    public void playOnline(PluginCall call) {
        String text = call.getString("text", "");
        double rate = call.getDouble("rate", 1.0);
        int spd = (rate > 0 && rate <= 0.6) ? 2 : 3; // 2=慢速 3=常速
        String url = "https://fanyi.baidu.com/gettts?lan=en&spd=" + spd + "&source=web&text=" + Uri.encode(text == null ? "" : text);
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
                int code = conn.getResponseCode();
                if (code != HttpURLConnection.HTTP_OK) {
                    call.reject("HTTP " + code);
                    return;
                }
                InputStream is = conn.getInputStream();
                File tmp = new File(getContext().getCacheDir(), "tts_online.mp3");
                FileOutputStream fos = new FileOutputStream(tmp);
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) fos.write(buf, 0, n);
                fos.close();
                is.close();
                final String path = tmp.getAbsolutePath();
                getActivity().runOnUiThread(() -> {
                    try {
                        stopOnline();
                        mediaPlayer = new MediaPlayer();
                        mediaPlayer.setDataSource(path);
                        mediaPlayer.setOnCompletionListener(mp -> { mp.release(); if (mediaPlayer == mp) mediaPlayer = null; });
                        mediaPlayer.prepare();
                        mediaPlayer.start();
                        JSObject ret = new JSObject();
                        ret.put("value", true);
                        call.resolve(ret);
                    } catch (Exception e) {
                        call.reject("播放失败: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                call.reject("下载失败: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void stopOnline() {
        try {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
                mediaPlayer = null;
            }
        } catch (Exception e) { /* 忽略 */ }
    }

    private Locale parseLocale(String lang) {
        if (lang == null || lang.isEmpty()) return Locale.ENGLISH;
        String[] parts = lang.split("[-_]");
        if (parts.length >= 2) return new Locale(parts[0], parts[1]);
        return new Locale(lang);
    }

    // 打开系统「文字转语音(TTS)输出」设置页，多级回退以适配鸿蒙/华为
    @PluginMethod
    public void openTtsSettings(PluginCall call) {
        // 必须用 Activity 上下文启动页面（应用上下文在鸿蒙/部分系统会被拒绝）
        android.content.Context ctx = getActivity();
        if (ctx == null) ctx = getContext();
        // 1) 标准「文字转语音输出」设置页
        try {
            Intent i = new Intent("com.android.settings.TTS_SETTINGS");
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
            return;
        } catch (Exception e) { /* 不存在，尝试下一种 */ }
        // 2) 显式指定 TTS 设置 Activity（兼容 EMUI/鸿蒙）
        try {
            Intent i = new Intent();
            i.setClassName("com.android.settings", "com.android.settings.Settings$TextToSpeechSettingsActivity");
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
            return;
        } catch (Exception e) { /* 继续回退 */ }
        // 3) 当前引擎的语音数据下载界面
        try {
            Intent i = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (tts != null && tts.getDefaultEngine() != null) i.setPackage(tts.getDefaultEngine());
            ctx.startActivity(i);
            call.resolve();
            return;
        } catch (Exception e) { /* 继续回退 */ }
        // 4) 辅助功能（部分华为设备的文本转语音在该路径下）
        try {
            Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
            return;
        } catch (Exception e) { /* 继续回退 */ }
        // 5) 系统设置主页
        try {
            Intent i = new Intent(Settings.ACTION_SETTINGS);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("no_settings_page");
        }
    }

    // 重新初始化引擎（用户装完语音包返回后调用），并返回最新检测结果
    @PluginMethod
    public void refresh(PluginCall call) {
        try {
            if (ttsAlt != null) { ttsAlt.stop(); ttsAlt.shutdown(); ttsAlt = null; }
            if (tts != null) { tts.stop(); tts.shutdown(); tts = null; }
            ready = false;
            load();
        } catch (Exception e) {
            call.reject("refresh_failed");
            return;
        }
        // load() 后引擎异步初始化，evaluateCheck 内部会轮询直到就绪
        evaluateCheck(call, "en-US");
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (ttsAlt != null) { ttsAlt.stop(); ttsAlt.shutdown(); }
        stopOnline();
        super.handleOnDestroy();
    }
}
