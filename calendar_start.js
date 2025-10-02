// ==UserScript==
// @name         📅カレンダー開始読込+4ヶ月
// @namespace    tdr-next-then-december
// @version      1.7
// @description  カレンダー表示で自動「次へ」→ #boxCalendarSelect を「現在月+4ヶ月」に設定（例: 2025/10/02なら 2026/02）
// @match        https://reserve.tokyodisneyresort.jp/hotel/list/*
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/main/calendar_start.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/main/calendar_start.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (!/\/hotel\/list/.test(location.pathname)) return;

  // ---- 目標年月：現在月 + 4ヶ月 ----
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1; // 1-12
  let tgtY = curY;
  let tgtM = curM + 4;
  tgtY += Math.floor((tgtM - 1) / 12);
  tgtM = ((tgtM - 1) % 12) + 1;

  // select の value 形式は "YYYY,M"（例: 2026,2）、表示テキストは "YYYY/MM"（ゼロ埋め）想定
  const TARGET_VALUE = `${tgtY},${tgtM}`;                         // 厳密一致用
  const TARGET_TEXT  = `${tgtY}/${String(tgtM).padStart(2, '0')}`; // 表示一致用

  const MAX_WAIT_NEXT_MS = 15000; // 「次へ」探索は最大15秒（0.1秒間隔）
  let armed = false;        // 目標月セット処理の一度きり起動
  let nextClicked = false;  // 「次へ」一度きりクリック

  // --- 「次へ」クリック後に #boxCalendarSelect を 目標年月 にする ---
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
    if (!el) return;
    const t = ((el.textContent || '') + ' ' + (el.value || '') + ' ' +
               (el.getAttribute('aria-label') || '') + ' ' + (el.title || '')).trim();
    if (!/次へ|次|next/i.test(t) || armed) return;

    armed = true;
    const t0 = Date.now();
    const timer = setInterval(() => {
      const sel = document.getElementById('boxCalendarSelect');
      if (sel && sel.tagName === 'SELECT' && sel.options.length > 1) {
        if (sel.dataset._ymSet === '1') { clearInterval(timer); return; }

        const opts = [...sel.options];
        let target =
          // 1) value 厳密一致（YYYY,M）
          opts.find(o => (o.value || '').trim() === TARGET_VALUE)
          // 2) テキスト厳密一致（YYYY/MM）
          || opts.find(o => (o.textContent || '').trim() === TARGET_TEXT)
          // 3) フォールバック：末尾が「,M」または「/MM（/M）」の最後の項目
          || opts.filter(o =>
               new RegExp(`,\\s*${tgtM}$`).test((o.value || '').trim()) ||
               new RegExp(`/0?${tgtM}$`).test((o.textContent || '').trim())
             ).pop();

        if (target) {
          // 0.1秒だけ待ってから変更（描画安定用）
          setTimeout(() => {
            sel.value = target.value;
            sel.selectedIndex = opts.indexOf(target);
            sel.dataset._ymSet = '1';
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }, 100);
        }
        clearInterval(timer);
      }
      if (Date.now() - t0 > 10000) clearInterval(timer); // 最大10秒
    }, 100); // 0.1秒間隔
  }, true);

  // --- 自動で「次へ」を押す（0.1秒待って人間っぽく） ---
  const visible = el => !!el && el.offsetParent !== null && el.getClientRects().length > 0;

  function findNextButton() {
    const roots = Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],.ui-dialog'));
    roots.push(document);
    for (const r of roots) {
      const nodes = r.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
      for (const el of nodes) {
        if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
        const t = ((el.textContent || '') + ' ' + (el.value || '') + ' ' +
                   (el.getAttribute('aria-label') || '') + ' ' + (el.title || '')).trim();
        if (/次へ|次|next/i.test(t)) return el;
      }
    }
    return null;
  }

  function clickLikeHuman(el) {
    const ev = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', ev));
    el.dispatchEvent(new MouseEvent('mousedown', ev));
    el.dispatchEvent(new PointerEvent('pointerup', ev));
    el.dispatchEvent(new MouseEvent('mouseup', ev));
    el.click();
  }

  const start = Date.now();
  const probe = setInterval(() => {
    if (Date.now() - start > MAX_WAIT_NEXT_MS || nextClicked) {
      clearInterval(probe);
      return;
    }
    const btn = findNextButton();
    if (btn) {
      nextClicked = true;
      setTimeout(() => clickLikeHuman(btn), 100); // 0.1秒待ってクリック
    }
  }, 100); // 0.1秒間隔
})();
