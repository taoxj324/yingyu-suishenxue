// 注册原生插件代理：填充 window.Capacitor.Plugins
// 说明：Capacitor 的 Plugins 对象只有加载 @capacitor/core 运行时并调用
// registerPlugin() 后才会包含各原生插件（Android WebView 无 Web Speech API，
// 原生 TTS 必须通过这里的代理调用）。
import { registerPlugin } from "./capacitor-core.js";

try { registerPlugin("TextToSpeech"); } catch (e) { console.warn("TextToSpeech 注册失败", e); }
try { registerPlugin("App"); } catch (e) { console.warn("App 注册失败", e); }
