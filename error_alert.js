// ==UserScript==
// @name         ホテル日付指定検索エラー時のアラート表示
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  東京ディズニーリゾート予約サイトで空室検索時に発生するエラーを黄色のオーバーレイで通知し、10秒後にトップページへ遷移します
// @match        https://reserve.tokyodisneyresort.jp/hotel/list/*
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/error_alert.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/error_alert.js
// @grant        none
// ==/UserScript==

(function () {
  const checkTimeout = 5000;
  const checkInterval = 100;
  let startTime = new Date();
  let intervalId;

  // エラー時の黄色オーバーレイ表示＋リダイレクト
  function showYellowOverlay(message) {
    if (document.getElementById('error-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'error-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = 0;
    overlay.style.left = 0;
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(255, 255, 0, 0.8)';
    overlay.style.zIndex = 99999;
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.fontSize = '20px';
    overlay.style.fontWeight = 'bold';
    overlay.style.color = 'black';
    overlay.style.textAlign = 'center';
    overlay.style.padding = '20px';

    overlay.innerHTML = `
      <div>${message.replace(/\n/g, '<br>')}</div>
      <div style="margin-top:20px;font-size:14px;">10秒後にトップページへ移動します</div>
    `;

    document.body.appendChild(overlay);

    setTimeout(() => {
      window.location.href = 'https://reserve.tokyodisneyresort.jp/';
    }, 10000);
  }

  // ポーリングで定義済みオブジェクトの有無をチェック
  intervalId = setInterval(() => {
    const now = new Date();
    if ((now - startTime) > checkTimeout) {
      clearInterval(intervalId);
      return;
    }
    if (typeof HotelPriceStockQuery !== 'undefined') {
      if (Hotel?.Util?.handleError) {
        const orig_handleError = Hotel.Util.handleError;
        Hotel.Util.handleError = function (data) {
          showYellowOverlay('空室検索でエラーが発生しました\nデータエラー\n\n再検索またはページをリロードしてください');
          return orig_handleError(data);
        }
      }
      if (window.$?.lifeobs?.ajax) {
        const orig_ajax = $.lifeobs.ajax;
        $.lifeobs.ajax = function (e) {
          if (e.url.endsWith('/hotel/api/queryHotelPriceStock/') && !('stockQueryType' in (e.data ?? {})) && !(e.error)) {
            e.error = function (xhr, status, error) {
              if (xhr.readyState === 4) {
                showYellowOverlay(`空室検索でエラーが発生しました\n${xhr.status} ${error}\n\n再検索またはページをリロードしてください`);
              }
            }
          }
          return orig_ajax(e);
        }
      }
      clearInterval(intervalId);
    }
  }, checkInterval);

  // 検索フォームがなければ早期に処理停止
  window.addEventListener('load', () => {
    if (!document.querySelector('form#reserveSearchForm')) {
      clearInterval(intervalId);
      return;
    }
  });
})();
