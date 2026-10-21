package com.english.daily;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate() 之前注册：
        // BridgeActivity.onCreate() 末尾会调用 load() → bridgeBuilder.create() 创建 Bridge，
        // 之后 registerPlugin 只会改 builder，Bridge 已用不上，插件将显示"not implemented"。
        registerPlugin(TtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
