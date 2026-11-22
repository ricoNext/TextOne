import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isDesktop } from "../lib/vault";
import {
  applySettings,
  readSettings,
  SETTINGS_EVENT,
  writeSettings,
  type Appearance,
  type Settings,
} from "../lib/settings";

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

export function SettingsWindow() {
  const [settings, setSettings] = useState<Settings>(readSettings);

  // Both windows read the same store; applying here keeps this window in step
  // with what it just wrote.
  useEffect(() => {
    applySettings(settings);
  }, [settings]);

  // A zoom from the menu bar changes the store behind this window's back.
  useEffect(() => {
    if (!isDesktop) return;
    const subscription = listen<Settings>(SETTINGS_EVENT, (event) => {
      setSettings(event.payload);
    });
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  const update = (next: Settings) => {
    setSettings(next);
    writeSettings(next);
    applySettings(next);
    if (isDesktop) void emit(SETTINGS_EVENT, next);
  };

  return (
    <main className="settings">
      <h1 className="settings-title">设置</h1>

      <section className="settings-row">
        <div className="settings-label">
          <span className="settings-name">外观</span>
          <span className="settings-hint">纸色不随主题翻转，深浅两套都保留暖调</span>
        </div>
        <div className="settings-segments" role="radiogroup" aria-label="外观">
          {APPEARANCES.map((option) => (
            <button
              key={option.value}
              role="radio"
              aria-checked={settings.appearance === option.value}
              className="settings-segment"
              data-active={settings.appearance === option.value || undefined}
              onClick={() => update({ ...settings, appearance: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-row">
        <div className="settings-label">
          <span className="settings-name">正文字号</span>
          <span className="settings-hint">编辑器与预览同步，13–20</span>
        </div>
        <div className="settings-stepper">
          <button
            className="settings-step"
            aria-label="减小字号"
            disabled={settings.editorSize <= 13}
            onClick={() =>
              update({ ...settings, editorSize: settings.editorSize - 1 })
            }
          >
            −
          </button>
          <span className="settings-size">{settings.editorSize}</span>
          <button
            className="settings-step"
            aria-label="增大字号"
            disabled={settings.editorSize >= 20}
            onClick={() =>
              update({ ...settings, editorSize: settings.editorSize + 1 })
            }
          >
            +
          </button>
        </div>
      </section>

      <p className="settings-sample">
        写作工具能做的只有一件事：别打断。
      </p>

      <footer className="settings-footer">
        <span>TextOne 0.1.0</span>
        <span className="settings-muted">笔记就是文件夹里的 .md 文件</span>
      </footer>
    </main>
  );
}
