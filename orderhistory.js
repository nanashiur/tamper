// ==UserScript==
// @name         📋️🏨🍴予約履歴カウンター
// @version      1.40
// @match        https://reserve.tokyodisneyresort.jp/order/list/*
// @match        https://reserve.tokyodisneyresort.jp/orderhistory/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/main/orderhistory.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/main/orderhistory.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = '__tdr_order_count_panel';
  const STORAGE_PREFIX = '__tdr_order_count_v1_';

  function cleanText(element) {
    return (element?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getCurrentPage() {
    const urlPage = new URL(location.href)
      .searchParams
      .get('pagingNo');

    const formPage = document.querySelector(
      '#toDetailForm input[name="pagingNo"]'
    )?.value;

    return Number(urlPage || formPage || 1);
  }

  function getDisplayCondition() {
    const form = document.querySelector('#toDetailForm');

    const value = name =>
      form?.querySelector(`input[name="${name}"]`)?.value || '';

    return [
      value('displayMethod'),
      value('cancelReservation'),
      value('pastReservation')
    ].join('_');
  }

  function countCurrentPage() {
    let hotel = 0;
    let restaurant = 0;
    const fingerprint = [];

    document
      .querySelectorAll(
        '.area-page-transition ' +
        'table.module-table tr:not(.heading)'
      )
      .forEach(row => {
        const isUsed = [...row.querySelectorAll('.status')]
          .some(status =>
            cleanText(status).includes('ご利用済み')
          );

        const section = row.closest('.section-module');

        const receiptNo = cleanText(
          section?.querySelector('.reserve-number')
        ).match(/\d+/)?.[0] || '';

        const type = row.querySelector('.ico-hotel-bl')
          ? 'hotel'
          : row.querySelector('.ico-restaurant-bl')
            ? 'restaurant'
            : 'other';

        fingerprint.push([
          receiptNo,
          type,
          cleanText(row.querySelector('td:last-child')),
          getProductName(row),
          isUsed ? 'used' : 'active'
        ].join('|'));

        if (isUsed) return;

        if (row.querySelector('.ico-hotel-bl')) {
          hotel++;
        }

        if (row.querySelector('.ico-restaurant-bl')) {
          restaurant++;
        }
      });

    return {
      hotel,
      restaurant,
      fingerprint: fingerprint.join('\n')
    };
  }

  function getProductName(row) {
    const cell = row.querySelector('th');

    if (!cell) return '';

    const copy = cell.cloneNode(true);

    copy
      .querySelectorAll('i, .status')
      .forEach(element => element.remove());

    return cleanText(copy);
  }

  function outputProductLists() {
    const hotels = [];
    const restaurants = [];

    document
      .querySelectorAll(
        '.area-page-transition > .section-module'
      )
      .forEach(section => {
        const receiptText = cleanText(
          section.querySelector('.reserve-number')
        );

        const receiptNo = receiptText.match(/\d+/)?.[0];

        if (!receiptNo) return;

        section
          .querySelectorAll(
            'table.module-table tr:not(.heading)'
          )
          .forEach(row => {
            const isUsed = [...row.querySelectorAll('.status')]
              .some(status =>
                cleanText(status).includes('ご利用済み')
              );

            if (isUsed) return;

            const base = {
              受付番号: receiptNo,
              利用日: cleanText(
                row.querySelector('td:last-child')
              )
            };

            if (row.querySelector('.ico-hotel-bl')) {
              hotels.push({
                '№': hotels.length + 1,
                ...base,
                'ホテル・内容': getProductName(row)
              });
            }

            if (row.querySelector('.ico-restaurant-bl')) {
              restaurants.push({
                '№': restaurants.length + 1,
                ...base,
                'レストラン・内容': getProductName(row)
              });
            }
          });
      });

    outputCompactList(
      'ホテル',
      hotels,
      'ホテル・内容'
    );

    outputCompactList(
      'レストラン',
      restaurants,
      'レストラン・内容'
    );
  }

  function compactDate(dateText) {
    const match = dateText.match(
      /(\d{4})年(\d{1,2})月(\d{1,2})日/
    );

    if (!match) return dateText;

    return (
      `${match[1]}/` +
      `${match[2].padStart(2, '0')}/` +
      `${match[3].padStart(2, '0')}`
    );
  }

  function outputCompactList(title, items, contentKey) {
    const lines = items.map(item => [
      String(item['№']).padStart(2, '0'),
      item.受付番号,
      compactDate(item.利用日),
      item[contentKey]
    ].join('｜'));

    console.log([
      `【${title}一覧：${items.length}件（ご利用済み除外）】`,
      `No｜受付番号｜利用日｜${contentKey}`,
      ...lines
    ].join('\n'));
  }

  function readSaved(condition, page) {
    try {
      return JSON.parse(
        localStorage.getItem(
          `${STORAGE_PREFIX}${condition}_${page}`
        )
      );
    } catch {
      return null;
    }
  }

  function saveCurrent(condition, page, count) {
    if (page !== 1 && page !== 2) return;

    const previous = readSaved(condition, page);

    if (
      previous &&
      previous.fingerprint !== count.fingerprint
    ) {
      const otherPage = page === 1 ? 2 : 1;

      localStorage.removeItem(
        `${STORAGE_PREFIX}${condition}_${otherPage}`
      );

      console.log(
        `[予約履歴カウンター] ` +
        `${page}ページの変更を検出：` +
        `${otherPage}ページを未取得に戻しました`
      );
    }

    localStorage.setItem(
      `${STORAGE_PREFIX}${condition}_${page}`,
      JSON.stringify(count)
    );
  }

  function formatPage(page, count, currentPage) {
    const mark = page === currentPage ? '●' : '○';

    if (!count) {
      return `${mark} ${page}ページ：未取得`;
    }

    return (
      `${mark} ${page}ページ：` +
      `🏨 ${count.hotel}件　` +
      `🍴 ${count.restaurant}件`
    );
  }

  function render() {
    if (document.getElementById(PANEL_ID)) {
      return true;
    }

    const list = document.querySelector(
      '.area-page-transition'
    );

    if (!list) {
      return false;
    }

    const page = getCurrentPage();
    const condition = getDisplayCondition();
    const currentCount = countCurrentPage();

    saveCurrent(
      condition,
      page,
      currentCount
    );

    const page1 =
      page === 1
        ? currentCount
        : readSaved(condition, 1);

    const page2 =
      page === 2
        ? currentCount
        : readSaved(condition, 2);

    const total =
      page1 && page2
        ? (
          `合計：` +
          `🏨 ${page1.hotel + page2.hotel}件　` +
          `🍴 ${
            page1.restaurant + page2.restaurant
          }件`
        )
        : '合計：1・2ページを開くと表示';

    const panel = document.createElement('div');

    panel.id = PANEL_ID;

    panel.innerHTML = `
      <div class="tdr-count-title">
        予約件数（ご利用済み除外）
      </div>
      <div>
        ${formatPage(1, page1, page)}
      </div>
      <div>
        ${formatPage(2, page2, page)}
      </div>
      <div class="tdr-count-total">
        ${total}
      </div>
    `;

    panel.style.cssText = [
      'position:fixed',
      'top:12px',
      'right:12px',
      'z-index:2147483647',
      'min-width:310px',
      'padding:12px 14px',
      'border:2px solid #23416d',
      'border-radius:8px',
      'background:#fff',
      'color:#17345d',
      'font:700 14px/1.8 sans-serif',
      'box-shadow:0 3px 12px rgba(0,0,0,.25)'
    ].join(';');

    const style = document.createElement('style');

    style.textContent = `
      #${PANEL_ID} .tdr-count-title {
        font-size:15px;
        border-bottom:1px solid #b9c8dc;
        margin-bottom:4px;
      }

      #${PANEL_ID} .tdr-count-total {
        border-top:1px solid #b9c8dc;
        margin-top:4px;
        padding-top:4px;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    outputProductLists();

    console.log(
      `[予約履歴カウンター] ${page}ページ：` +
      `ホテル${currentCount.hotel}件 / ` +
      `レストラン${currentCount.restaurant}件` +
      `（ご利用済み除外）`
    );

    return true;
  }

  function start() {
    console.log(
      '[予約履歴カウンター] 起動：' +
      '予約一覧の表示を待っています'
    );

    if (render()) return;

    const observer = new MutationObserver(() => {
      if (!render()) return;

      observer.disconnect();
    });

    observer.observe(
      document.documentElement || document,
      {
        childList: true,
        subtree: true
      }
    );

    setTimeout(() => {
      observer.disconnect();

      if (!document.getElementById(PANEL_ID)) {
        console.warn(
          '[予約履歴カウンター] ' +
          '予約一覧を検出できませんでした'
        );
      }
    }, 120000);
  }

  start();
})();
