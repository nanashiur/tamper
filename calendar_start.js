// ==UserScript==
// @name         📅カレンダー開始読込2026/01
// @namespace    tdr-next-then-december
// @version      1.6
// @description  カレンダー表示で自動「次へ」→ #boxCalendarSelect を 2026/01 に設定
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

  // 2026年1月（value 形式は "YYYY,M"）
  const TARGET_VALUE = '2026,1';
  const MAX_WAIT_NEXT_MS = 15000;

  let armed = false;
  let nextClicked = false;

  // 「次へ」クリック後に #boxCalendarSelect を 2026/01 にする
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
        const opts = [...sel.options];
        let target =
          // value 厳密一致（2026,1）
          opts.find(o => (o.value || '').trim() === TARGET_VALUE)
          // テキスト厳密一致（2026/01）
          || opts.find(o => (o.textContent || '').trim() === '2026/01')
          // フォールバック：末尾が「,1」または「/01（/1）」の最後の項目
          || opts.filter(o =>
               /,\s*0?1$/.test((o.value || '').trim()) ||
               /\/0?1$/.test((o.textContent || '').trim())
             ).pop();

        if (target) {
          sel.value = target.value;
          sel.selectedIndex = opts.indexOf(target);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        clearInterval(timer);
      }
      if (Date.now() - t0 > 10000) clearInterval(timer); // 最大10秒
    }, 100); // 0.1秒間隔
  }, true);

  // 自動で「次へ」を押す（0.1秒待って人間っぽく）
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
