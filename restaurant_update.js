// ==UserScript==
// @name         🍴📱レストラン 時間帯別リロード
// @version      1.00
// @match        https://reserve.tokyodisneyresort.jp/online/sp/restaurant/update/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_update.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_update.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const markingElemId = '__sp_restaurant_update_reload';

  if (document.getElementById(markingElemId)) {
    alert('すでに実行されています');
    return;
  }

  // timeTypeは新規予約ページのため存在していたら対象外
  if (
    !document.getElementById('timeContent') ||
    !document.getElementById('mealDivName') ||
    document.getElementById('timeType')
  ) {
    alert('このページでは実行できません');
    return;
  }

  if (
    typeof window.jQuery !== 'function' ||
    typeof window.setupAccordion !== 'function' ||
    !window.timeGet ||
    typeof window.timeGet.refresh !== 'function'
  ) {
    alert('ページの読み込みが完了していません。再読み込み後に実行してください');
    return;
  }

  const $ = window.jQuery;

  const markingElem = document.createElement('div');
  markingElem.id = markingElemId;
  markingElem.style.display = 'none';
  document.body.appendChild(markingElem);

  const getTextNode = ($target) => {
    let result = '';

    $($target)
      .contents()
      .each(function () {
        if (this.nodeType === Node.TEXT_NODE && /\S/.test(this.data)) {
          result += this.nodeValue;
        }
      });

    return result.trim();
  };

  let openedHeaders = [];

  const saveAccordionStatus = () => {
    openedHeaders = [];

    $('#timeContent section.js-accordion header.open h1').each((i, el) => {
      const headerText = getTextNode(el);

      if (headerText) {
        openedHeaders.push(headerText);
      }
    });
  };

  // 時間帯別ヘッダをタップしたときに対象時間帯のみをリロード
  const timeRanges = document.querySelectorAll(
    '#timeContent section h1#mealDivName'
  );

  timeRanges.forEach((elTimeRange) => {
    elTimeRange.addEventListener('click', () => {
      saveAccordionStatus();

      // 変更ページの場合は時間帯1つのため
      window.timeGet.refresh();
    });

    elTimeRange.style.cursor = 'pointer';
  });

  // アコーディオンの状態を復元
  const originalSetupAccordion = window.setupAccordion;

  window.setupAccordion = function () {
    $('#timeContent section.js-accordion header').each((idx, el) => {
      const headerCaption = $(el).find('h1');

      if (openedHeaders.includes(getTextNode(headerCaption))) {
        $(el).addClass('open');
      }
    });

    return originalSetupAccordion.apply(this, arguments);
  };

  // 「時間の選択」から戻るを押したときに、検索済みフラグをリセット
  // すでに時間を選択している場合を除く
  document
    .querySelectorAll(
      '#timeContent > header a.cancel, #timeContentMain > ul.listBtn01 a.back'
    )
    .forEach((el) => {
      el.addEventListener('click', () => {
        // 戻るときはアコーディオン状態をリセットする
        openedHeaders = [];

        if (!document.querySelector('#timeContent table tr.selected')) {
          window.timeGet.isSearch = false;
        }
      });
    });
})();
