// ==UserScript==
// @name         ⏰📱 39.30 (0-1000)
// @namespace    http://tampermonkey.net/
// @version      4.68-ios
// @description  Auto-calculates info panel based on start time + max delay. iOS(Safari) friendly.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload_ios.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload_ios.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ★ 発火時刻 → 39.300秒に変更
  const main = { h: 10, m: 59, s: 39, ms: 300, max: 1000 };

  // 事前リロード（52:00）
  const pre  = { h: 10, m: 52, s: 0, ms: 0, max: 2000 };

  let trigMain = false, trigPre = false;
  let reloadEnabled = true;

  // 現在時刻の文字列
  const nowStr = () => {
    const d = new Date();
    return (
      d.toLocaleTimeString() +
      "." +
      String(d.getMilliseconds()).padStart(3, "0")
    );
  };

  // ★ 3段目：開始時刻 + max → 自動計算
  const calcInfo = () => {
    const t = new Date();
    t.setHours(main.h, main.m, main.s, main.ms + main.max);
    return (
      t.toLocaleTimeString() +
      "." +
      String(t.getMilliseconds()).padStart(3, "0")
    );
  };

  // パネル生成
  const make = (id, top, bg, txt) => {
    const d = document.createElement("div");
    Object.assign(d.style, {
      position: "fixed",
      right: "0px",
      top: `${top}px`,
      background: bg,
      color: "white",
      padding: "3px 10px",
      fontSize: "18px",
      lineHeight: "18px",
      height: "24px",
      boxSizing: "border-box",
      borderRadius: "0px",
      whiteSpace: "nowrap",
      zIndex: 99999,
      cursor: "pointer",
    });
    d.id = id;
    d.textContent = txt;
    d.onclick = () => d.remove();
    document.body.appendChild(d);
    return d;
  };

  const elClock = make("customClock", 0, "rgba(0,0,0,0.6)", nowStr());
  const elStart = make("customStart", 24, "rgba(0,128,0,0.6)", nowStr());

  // ★ 自動計算された 40.300秒 が入る
  const elInfo = make(
    "customInfo",
    48,
    "rgba(0,0,128,0.6)",
    calcInfo()
  );

  // トグル切替
  const toggleReload = () => {
    reloadEnabled = !reloadEnabled;
    const op = reloadEnabled ? "1" : "0.2";
    elClock.style.opacity = op;
    elStart.style.opacity = op;
    elInfo.style.opacity = op;
  };
  elClock.onclick = elStart.onclick = elInfo.onclick = toggleReload;

  // 発火チェック
  const check = (cfg, triggered, setTrig) => {
    if (!reloadEnabled) return;
    const d = new Date();
    if (triggered()) return;

    if (
      d.getHours() === cfg.h &&
      d.getMinutes() === cfg.m &&
      d.getSeconds() === cfg.s &&
      d.getMilliseconds() >= cfg.ms
    ) {
      const delay = Math.floor(Math.random() * (cfg.max + 1));
      setTrig(true);

      setTimeout(() => {
        // 色変化
        elStart.style.background = "rgba(255,0,0,0.75)";
        elStart.textContent = nowStr();

        elInfo.style.background = "rgba(255,165,0,0.75)";
        elInfo.textContent = nowStr();

        location.reload();
      }, delay);
    }
  };

  // ループ処理
  setInterval(() => {
    elClock.textContent = nowStr();
    elInfo.textContent = calcInfo(); // ★ 自動更新

    check(pre, () => trigPre, (v) => (trigPre = v));
    check(main, () => trigMain, (v) => (trigMain = v));
  }, 50);
})();
