// ==UserScript==
// @name         🍴🏨宿泊特典レストラン検索
// @version      2.66
// @match        https://reserve.tokyodisneyresort.jp/online/sp/travelbag/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/priviledges_restaurant_reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/priviledges_restaurant_reload.js
// ==/UserScript==

(function () {
  'use strict';

  const win = window;

  const VACANCY_ICON = '❤️';
  const VACANCY_COLOR = 0xff0000;
  const DIFF_ICON = '💙';
  const FRAME_ICON = '🔹';
  const DIFF_COLOR = 0x007bff;
  const ERROR_ICON = '🟠';
  const ERROR_COLOR = 0xffa500;
  const SNAPSHOT_KEY = 'tdr_priv_diff_snapshots_v1';
  const AUTO_CHECK_KEY = 'tdr_priv_autoCheckEnabled';
  const AUTO_NOTICE_KEY = 'tdr_priv_autoNoticeEnabled';
  const AUTO_DUPLICATION_KEY = 'tdr_priv_autoDuplicationEnabled';

  const MEALS = [
    { key: 'breakfast', label: '朝', full: '朝食', storage: 'tdr_priv_searchStatus_breakfast' },
    { key: 'lunch', label: '昼', full: '昼食', storage: 'tdr_priv_searchStatus_lunch' },
    { key: 'dinner', label: '夕', full: '夕食', storage: 'tdr_priv_searchStatus_dinner' }
  ];

  const ranges = {
    S: [15, 6],
    M: [60, 11],
    L: [300, 21]
  };

  function getRandomWait(mode) {
    const r = ranges[mode];
    if (!r) return 15;
    return Math.floor(Math.random() * r[1]) + r[0];
  }

  function normalizeStatus(status) {
    return ranges[status] || status === 'OFF' ? status : 'OFF';
  }

  function loadExcludedTimes() {
    try {
      const arr = JSON.parse(localStorage.getItem('tdr_priv_excludedTimes') || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function loadSnapshots() {
    try {
      const obj = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '{}');
      return obj && typeof obj === 'object' ? obj : {};
    } catch (e) {
      return {};
    }
  }

  const state = {
    notifyEnabled: localStorage.getItem('tdr_priv_notifyEnabled') !== '0',
    autoCheckEnabled: localStorage.getItem(AUTO_CHECK_KEY) === '1',
    autoNoticeEnabled: localStorage.getItem(AUTO_NOTICE_KEY) === '1',
    autoDuplicationEnabled: localStorage.getItem(AUTO_DUPLICATION_KEY) === '1',
    excludedTimes: loadExcludedTimes(),
    mealStates: {},
    activeReloadMeal: '',
    snapshots: loadSnapshots()
  };

  MEALS.forEach(meal => {
    const status = normalizeStatus(localStorage.getItem(meal.storage) || 'OFF');
    state.mealStates[meal.key] = {
      searchStatus: status,
      waitSec: status === 'OFF' ? 15 : getRandomWait(status)
    };
  });

  localStorage.setItem('tdr_priv_searchStatus', 'OFF');

  function getDiscordWebhookUrl() {
    return win.TDR_WEBHOOKS?.restaurant || '';
  }

  function boot() {
    const $ = win.jQuery;

    if (!$ || !document.body) {
      setTimeout(boot, 300);
      return;
    }

    if (win.__tdr_priv_restaurant_notify_installed) return;
    win.__tdr_priv_restaurant_notify_installed = true;

    win.lastClickedRestaurantTitle = 'レストラン名不明';

    $(document).on('click', '.js-selectContents, a.ui-link', function () {
      const titleEl = $(this).closest('li').find('p.title');
      if (titleEl.length) {
        win.lastClickedRestaurantTitle = titleEl.text().trim();
      }
    });

    const getTextNode = ($target) => {
      let result = '';
      $($target).contents().each(function () {
        if (this.nodeType === 3 && /\S/.test(this.data)) {
          result += this.nodeValue;
        }
      });
      return result;
    };

    let opened_headers = [];
    let reloadLock = false;
    let reservationNoticePopupActive = false;
    let duplicationTimePopupActive = false;

    const actionPanels = {
      check: null,
      notice: null,
      duplication: null
    };

    const save_accordion_status = () => {
      opened_headers = [];
      $('#timeContent section.js-accordion header.open h1').each((i, el) => {
        opened_headers.push(getTextNode(el));
      });
    };

    function normalizeMealKey(text) {
      const t = String(text || '').replace(/\s+/g, '').trim();
      if (t.includes('朝食')) return 'breakfast';
      if (t.includes('昼食')) return 'lunch';
      if (t.includes('夕食')) return 'dinner';
      return '';
    }

    function getMealByKey(key) {
      return MEALS.find(m => m.key === key) || null;
    }

    function getMealNameBySectionClass(sectionClass) {
      if (!sectionClass) return '';

      try {
        const $section = $('#timeContent section').filter((_, el) => {
          return el.classList && el.classList.contains(sectionClass);
        }).first();

        const text = $section.find('h1#mealDivName').first().text().trim();

        if (text.includes('朝食') && text.includes('客室特典')) return '朝食・客室特典';
        if (text.includes('朝食')) return '朝食';
        if (text.includes('昼食')) return '昼食';
        if (text.includes('夕食')) return '夕食';
      } catch (e) {
        console.error('食事区分取得エラー:', e);
      }

      return '';
    }

    function getSectionMealKey(section) {
      const text = $(section).find('h1#mealDivName').first().text().trim();
      return normalizeMealKey(text);
    }

    function getMealSectionByKey(mealKey) {
      return $('#timeContent section.js-accordion, #timeContent section').filter((_, section) => {
        return getSectionMealKey(section) === mealKey;
      }).first();
    }

    function getTimeType() {
      const val = String($('#timeType').val() || '').trim();
      if (val) return val;

      const cls = [];
      $('#timeContent section').each((_, section) => {
        section.classList.forEach(c => cls.push(c));
      });

      const found = cls.find(c => /^[0-9]+Times$/.test(c));
      return found ? found.replace(/^[0-9]+/, '') : 'Times';
    }

    function restoreHiddenMealSections($sections) {
      $sections.each((id, el) => {
        Array.from(el.classList).forEach(cls => {
          if (cls.startsWith('__')) {
            $(el).removeClass(cls).addClass(cls.replace(/^__/, ''));
          }
        });
      });
    }

    function hideOtherMealSections($targetSection) {
      const timeType = getTimeType();

      const $siblings = $targetSection.siblings('section').filter((_, section) => {
        return Array.from(section.classList).some(cls => cls.endsWith(timeType));
      });

      $siblings.each((id, el) => {
        Array.from(el.classList).forEach(cls => {
          if (cls.endsWith(timeType) && !cls.startsWith('__')) {
            $(el).removeClass(cls).addClass(`__${cls}`);
          }
        });
      });

      return $siblings;
    }

    function reloadOnlyMeal(mealKey, manual) {
      if (reloadLock) {
        if (!manual) {
          const m = getMealByKey(mealKey);
          if (m) {
            const ms = state.mealStates[m.key];
            if (ms.searchStatus !== 'OFF') ms.waitSec = getRandomWait(ms.searchStatus);
          }
        }
        updatePanels();
        return;
      }

      const $section = getMealSectionByKey(mealKey);

      if (!$section.length) {
        console.warn('対象食事区分 section が見つかりません:', mealKey);
        return;
      }

      if (!win.controller || typeof win.controller.getTimeInfo !== 'function') {
        console.warn('controller.getTimeInfo が見つかりません');
        return;
      }

      reloadLock = true;
      state.activeReloadMeal = mealKey;

      save_accordion_status();

      const $hiddenSections = hideOtherMealSections($section);
      let task = null;

      try {
        task = win.controller.getTimeInfo();
      } catch (e) {
        restoreHiddenMealSections($hiddenSections);
        state.activeReloadMeal = '';
        reloadLock = false;
        throw e;
      }

      const finish = () => {
        restoreHiddenMealSections($hiddenSections);
        state.activeReloadMeal = '';
        reloadLock = false;
        updatePanels();
      };

      if (task && typeof task.always === 'function') {
        task.always(finish);
      } else if (task && typeof task.done === 'function') {
        task.done(finish);
      } else {
        setTimeout(finish, 1200);
      }

      updatePanels();
    }

    function hookSetupAccordion() {
      if (win.setupAccordion && !win.__hooked_setupAccordion) {
        const orig_setupAccordion = win.setupAccordion;

        win.setupAccordion = function () {
          $('#timeContent section.js-accordion header').each((idx, el) => {
            const headerCaption = $(el).find('h1');
            if (opened_headers.includes(getTextNode(headerCaption))) {
              $(el).addClass('open');
            }
          });

          return orig_setupAccordion.apply(this, arguments);
        };

        win.__hooked_setupAccordion = true;
      }
    }

    const hookTimer = setInterval(() => {
      if (win.setupAccordion) {
        hookSetupAccordion();
        clearInterval(hookTimer);
      }
    }, 100);

    function hookTimeGetRefreshForMeal() {
      if (!win.timeGet || !win.timeGet.refresh || win.__hooked_timeGet_refresh_meal) return;

      const origRefresh = win.timeGet.refresh;

      win.timeGet.refresh = function (b, a) {
        if (!$(`#timeContent section.${b}`).length) {
          const e = $.Deferred();
          e.resolve();
          return e.promise();
        }

        const mealName = getMealNameBySectionClass(b);
        win.__tdr_currentMealName = mealName || '';

        try {
          return origRefresh.apply(this, arguments);
        } finally {
          setTimeout(() => {
            win.__tdr_currentMealName = '';
          }, 0);
        }
      };

      win.__hooked_timeGet_refresh_meal = true;
    }

    $.ajaxPrefilter(function (options) {
      if (!options || !options.url) return;
      if (!String(options.url).includes('timeGet')) return;

      const mealName = win.__tdr_currentMealName || '';

      if (mealName) {
        options.__tdrMealName = mealName;

        const origBeforeSend = options.beforeSend;

        options.beforeSend = function (jqXHR, settings) {
          jqXHR.__tdrMealName = mealName;

          if (typeof origBeforeSend === 'function') {
            return origBeforeSend.apply(this, arguments);
          }
        };
      }
    });

    const mealHookTimer = setInterval(() => {
      if (win.timeGet && win.timeGet.refresh) {
        hookTimeGetRefreshForMeal();
        clearInterval(mealHookTimer);
      }
    }, 100);

    function parseAjaxData(data) {
      const obj = {};

      try {
        if (!data) return obj;

        if (typeof data === 'string') {
          const params = new URLSearchParams(data);
          for (const [k, v] of params.entries()) {
            obj[k] = v;
          }
          return obj;
        }

        if (typeof data === 'object') {
          Object.keys(data).forEach(k => {
            obj[k] = data[k];
          });
        }
      } catch (e) {
        console.error('ajax data parse error:', e);
      }

      return obj;
    }

    function getValue(row, key) {
      if (!row || typeof row !== 'object') return '';
      if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];

      const k = Object.keys(row).find(x => String(x).trim() === key);
      return k ? row[k] : '';
    }

    function salesStatus(row) {
      const a = getValue(row, 'salesStatus');
      if (a !== '' && a != null) return String(a).trim();

      const b = getValue(row, 'saleStatus');
      return b !== '' && b != null ? String(b).trim() : '';
    }

    function timeClosing(row) {
      const v = getValue(row, 'timeClosing');
      return v === true || String(v).trim().toLowerCase() === 'true';
    }

    function statusLabel(row) {
      const s = salesStatus(row);

      if (timeClosing(row)) return '締切';
      if (s === '0') return '空席';
      if (s === '1') return '満席';
      if (s === '2') return '吸収';

      return `不明(${s || '空'})`;
    }

    function statusStyle(status) {
      return status === '空席' ? 'color:red;font-weight:bold;'
        : status === '満席' ? ''
        : status === '吸収' ? 'color:blue;font-weight:bold;'
        : status === '締切' ? 'color:gray;font-weight:bold;'
        : 'color:purple;font-weight:bold;';
    }

    function formatStatusForNotice(status) {
      if (status === '空席') return `${VACANCY_ICON}空席`;
      return status || '不明';
    }

    function splitCommodityCD(code) {
      const base = String(code || '').split('_')[0].trim();

      let m = base.match(/^(XXXR)([A-Z])([A-Z0-9]{3})([A-Z]{2})(\d{3})$/);
      if (m) return { base, display: `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` };

      m = base.match(/^(XSS\d{2}R)([A-Z0-9]{3})(\d{4})$/);
      if (m) return { base, display: `${m[1]} ${m[2]} ${m[3]}` };

      return { base, display: base };
    }

    function formatConsoleDate(yyyymmdd) {
      const s = String(yyyymmdd || '').trim();
      return /^\d{8}$/.test(s)
        ? `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}`
        : s;
    }

    function snapshotSave() {
      try {
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(state.snapshots));
      } catch (e) {
        console.warn('スナップショット保存失敗:', e);
      }
    }

    function snapshotKey(useDate, mealName, commodityCD) {
      return `${useDate || ''}|${mealName || ''}|${commodityCD || ''}`;
    }

    function buildRowsMap(rows) {
      const map = {};

      rows.forEach(r => {
        if (!r.time) return;

        map[r.time] = {
          time: r.time,
          status: r.status,
          salesStatus: r.salesStatus,
          openNumKey: String(r.openNumKey ?? ''),
          commodityCD: r.commodityCD,
          commodityDisplay: r.commodityDisplay
        };
      });

      return map;
    }

    function makeDiffLine(type, time, oldRow, curRow) {
      if (type === 'absorb') {
        return `${time} ${DIFF_ICON}吸収（${formatStatusForNotice(oldRow?.status)}）`;
      }

      if (type === 'release') {
        return `${time} ${DIFF_ICON}解除（${formatStatusForNotice(curRow?.status)}）`;
      }

      if (type === 'add') {
        return `${time} ${FRAME_ICON}新規（${formatStatusForNotice(curRow?.status)}）`;
      }

      if (type === 'delete') {
        return `${time} ${FRAME_ICON}削除`;
      }

      return `${time} ${formatStatusForNotice(oldRow?.status)} → ${formatStatusForNotice(curRow?.status)}`;
    }

    function buildDiffTitle(restaurantName, mealName, ajaxOptions) {
      const displayDate = getDisplayDateLong(ajaxOptions);

      return [
        getDetectTime(DIFF_ICON),
        `【宿泊特典】${restaurantName}`,
        `${displayDate}${mealName ? ` 【${mealName}】` : ''}`
      ].join('\n');
    }

    function sendDiffDiscord(restaurantName, mealName, ajaxOptions, noticeGroups) {
      if (!noticeGroups.length) return;

      const lines = [];

      noticeGroups.forEach(group => {
        if (noticeGroups.length > 1) {
          lines.push(`【${group.commodityDisplay || splitCommodityCD(group.commodityCD).display}】`);
        }

        group.lines.forEach(line => lines.push(line));
      });

      let body = lines.join('\n');

      if (!body) return;
      if (body.length > 4000) body = `${body.slice(0, 3990)}\n…`;

      const title = buildDiffTitle(restaurantName, mealName, ajaxOptions);

      sendDiscord(title, body, DIFF_COLOR);
    }

    function notifyDiffIfChanged(info, ajaxOptions, jqXHR, mealName) {
      if (!info) return;

      const dataObj = info.dataObj || {};
      const useDate = dataObj.useDate || '';
      const restaurantName = getRawRestaurantName(ajaxOptions);
      const commodityCodes = new Set(Object.keys(info.grouped || {}));

      if (dataObj.commodityCD) {
        commodityCodes.add(String(dataObj.commodityCD));
      }

      const noticeGroups = [];
      let changedSnapshot = false;

      commodityCodes.forEach(commodityCD => {
        if (!commodityCD) return;

        const rows = info.grouped[commodityCD] || [];
        const currentRows = buildRowsMap(rows);
        const key = snapshotKey(useDate, mealName, commodityCD);
        const prev = state.snapshots[key];

        if (!prev) {
          state.snapshots[key] = {
            useDate,
            mealName,
            restaurantName,
            commodityCD,
            commodityDisplay: splitCommodityCD(commodityCD).display,
            rows: currentRows
          };
          changedSnapshot = true;
          return;
        }

        const lines = [];
        const prevRows = prev.rows || {};
        const allTimes = new Set([
          ...Object.keys(prevRows),
          ...Object.keys(currentRows)
        ]);

        Array.from(allTimes).sort((a, b) => a.localeCompare(b)).forEach(time => {
          if (state.excludedTimes.includes(time)) return;

          const oldRow = prevRows[time];
          const curRow = currentRows[time];

          if (!oldRow && curRow) {
            lines.push(makeDiffLine('add', time, oldRow, curRow));
            return;
          }

          if (oldRow && !curRow) {
            lines.push(makeDiffLine('delete', time, oldRow, curRow));
            return;
          }

          if (!oldRow || !curRow) return;
          if (oldRow.status === curRow.status) return;

          if (oldRow.status !== '吸収' && curRow.status === '吸収') {
            lines.push(makeDiffLine('absorb', time, oldRow, curRow));
          } else if (oldRow.status === '吸収' && curRow.status !== '吸収') {
            lines.push(makeDiffLine('release', time, oldRow, curRow));
          } else {
            lines.push(makeDiffLine('change', time, oldRow, curRow));
          }
        });

        state.snapshots[key] = {
          useDate,
          mealName,
          restaurantName,
          commodityCD,
          commodityDisplay: splitCommodityCD(commodityCD).display,
          rows: currentRows
        };
        changedSnapshot = true;

        if (lines.length) {
          noticeGroups.push({
            commodityCD,
            commodityDisplay: splitCommodityCD(commodityCD).display,
            lines
          });
        }
      });

      if (changedSnapshot) {
        snapshotSave();
      }

      sendDiffDiscord(restaurantName, mealName, ajaxOptions, noticeGroups);
    }

    function printTimeGet(source, url, responseText, body, mealName) {
      let data;

      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.warn('[宿泊特典 timeGet] JSON解析失敗', { source, url, responseText });
        return null;
      }

      const groups = Array.isArray(data) ? data : [data];
      const dataObj = parseAjaxData(body);
      const displayDate = formatConsoleDate(dataObj.useDate) || '日付不明';
      const mealSuffix = mealName ? `【${mealName}】` : '';
      const rows = [];
      const grouped = {};

      groups.forEach(group => {
        const list = Array.isArray(group.timeGetDtoList) ? group.timeGetDtoList : [];

        list.forEach(slot => {
          const commodityCD = String(getValue(slot, 'commodityCD') || '').trim();
          const time = String(getValue(slot, 'exhibitionTime') || '').trim();

          if (!commodityCD || !time) return;

          const item = {
            time,
            status: statusLabel(slot),
            openNumKey: getValue(slot, 'openNumKey'),
            salesStatus: salesStatus(slot),
            commodityCD,
            commodityDisplay: splitCommodityCD(commodityCD).display,
            remainStockNum: getValue(slot, 'remainStockNum'),
            raw: slot
          };

          rows.push(item);
          (grouped[commodityCD] ??= []).push(item);
        });
      });

      rows.sort((a, b) => {
        return a.commodityCD.localeCompare(b.commodityCD) || a.time.localeCompare(b.time);
      });

      Object.values(grouped).forEach(arr => {
        arr.sort((a, b) => a.time.localeCompare(b.time));
      });

      if (rows.length) {
        const now = new Date().toLocaleTimeString();

        Object.keys(grouped).forEach(code => {
          console.log(
            `%c${now}${mealSuffix}`,
            'background:#333;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px'
          );

          console.log(
            `%c${displayDate} ${splitCommodityCD(code).display}`,
            'font-weight:bold;'
          );

          grouped[code].forEach(r => {
            console.log(
              `%c${r.time} ${r.status} ${r.openNumKey}`,
              statusStyle(r.status)
            );
          });
        });
      }

      const info = {
        data,
        groups,
        dataObj,
        displayDate,
        mealName,
        rows,
        grouped
      };

      window.tdr_priv_last_timeget = {
        at: new Date().toISOString(),
        source,
        url: String(url || ''),
        mealName,
        payload: dataObj,
        rows,
        grouped,
        raw: data
      };

      return info;
    }

    function getRawRestaurantName(ajaxOptions) {
      let restaurantName = 'レストラン名不明';

      try {
        if (ajaxOptions && ajaxOptions.data) {
          const dataObj = parseAjaxData(ajaxOptions.data);
          const commodityCD = dataObj.commodityCD || '';

          if (commodityCD) {
            const targetTitle = $('input[name="commodityCD"][value="' + commodityCD + '"]').closest('li').find('p.title');
            if (targetTitle.length) {
              return targetTitle.text().trim();
            }
          }
        }

        if (win.lastClickedRestaurantTitle && win.lastClickedRestaurantTitle !== 'レストラン名不明') {
          return win.lastClickedRestaurantTitle;
        }

        const visibleTitle = $('ul.timeDiv:visible').closest('li').find('p.title');
        if (visibleTitle.length) {
          return visibleTitle.first().text().trim();
        }
      } catch (e) {
        console.error('レストラン名取得エラー:', e);
      }

      return restaurantName;
    }

    function getDetectTime(icon) {
      const d = new Date();
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      const s = d.getSeconds().toString().padStart(2, '0');
      return `${icon}${d.getMonth() + 1}/${d.getDate()} ${h}:${m}:${s}`;
    }

    function formatUseDateLong(yyyymmdd) {
      const raw = String(yyyymmdd || '').trim();
      const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!m) return '';

      const y = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const date = new Date(y, month - 1, day);
      const week = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];

      return `${y}年${month}月${day}日（${week}）`;
    }

    function normalizeDisplayDateLong(raw, ajaxOptions) {
      const text = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';

      const jp = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*[（(]([日月火水木金土])[）)]/);
      if (jp) {
        return `${Number(jp[1])}年${Number(jp[2])}月${Number(jp[3])}日（${jp[4]}）`;
      }

      const dataObj = parseAjaxData(ajaxOptions?.data);
      const yearFromUseDate = String(dataObj.useDate || '').slice(0, 4);

      const mdw = text.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*(?:日)?\s*[（(]?([日月火水木金土])?[）)]?/);
      if (mdw && yearFromUseDate) {
        const y = Number(yearFromUseDate);
        const month = Number(mdw[1]);
        const day = Number(mdw[2]);
        const week = mdw[3] || ['日', '月', '火', '水', '木', '金', '土'][new Date(y, month - 1, day).getDay()];
        return `${y}年${month}月${day}日（${week}）`;
      }

      return text.replace(/\s*\((.)\)/, '（$1）');
    }

    function getDisplayDateLong(ajaxOptions) {
      const dataObj = parseAjaxData(ajaxOptions?.data);

      if (dataObj.useDate) {
        const formatted = formatUseDateLong(dataObj.useDate);
        if (formatted) return formatted;
      }

      const selectors = [
        '#reservationOfDateDisp1',
        '#reservationOfDateDisp',
        '#appointDateDisp',
        '#useDateDisp'
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const text = normalizeDisplayDateLong(el?.textContent || '', ajaxOptions);
        if (text) return text;
      }

      try {
        const pageText = $('#content').text() || $('body').text();
        const text = normalizeDisplayDateLong(pageText, ajaxOptions);
        if (text) return text;
      } catch (e) {
        console.error('日付取得エラー:', e);
      }

      return '日付不明';
    }

    function sendDiscord(title, description, color) {
      if (!state.notifyEnabled) return;

      const url = getDiscordWebhookUrl();

      if (!url) {
        console.warn('TDR_WEBHOOKS.restaurant が未設定です');
        return;
      }

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: '🍴🏨宿泊特典レストラン検索',
          embeds: [
            {
              title: title,
              description: description,
              color: color
            }
          ]
        })
      }).catch(e => console.error('Discord通知エラー:', e));
    }

    const panels = {};

    function createPanel(top, right, bg, onClick) {
      const p = document.createElement('div');

      Object.assign(p.style, {
        position: 'fixed',
        top: `${top}px`,
        right: `${right}px`,
        zIndex: '2147483647',
        width: '60px',
        height: '35px',
        padding: '0',
        borderRadius: '7px 0 0 7px',
        fontSize: '18px',
        fontWeight: 'bold',
        cursor: 'pointer',
        background: bg,
        color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        opacity: '0.95',
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        userSelect: 'none'
      });

      p.onclick = onClick;
      document.body.appendChild(p);
      return p;
    }

    function createActionPanel(bottom, label, onClick) {
      const p = document.createElement('div');

      Object.assign(p.style, {
        position: 'fixed',
        right: '10px',
        bottom: `${bottom}px`,
        zIndex: '2147483647',
        width: '86px',
        height: '34px',
        padding: '0',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 'bold',
        cursor: 'pointer',
        background: '#000',
        color: '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        opacity: '0.95',
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
        userSelect: 'none'
      });

      p.dataset.label = label;
      p.onclick = onClick;
      document.body.appendChild(p);
      return p;
    }

    function updateActionPanels() {
      if (actionPanels.check) {
        actionPanels.check.textContent = state.autoCheckEnabled ? '入力ON' : '入力OFF';
        actionPanels.check.style.background = state.autoCheckEnabled ? '#198754' : '#000';
      }

      if (actionPanels.notice) {
        actionPanels.notice.textContent = state.autoNoticeEnabled ? '注意ON' : '注意OFF';
        actionPanels.notice.style.background = state.autoNoticeEnabled ? '#198754' : '#000';
      }

      if (actionPanels.duplication) {
        actionPanels.duplication.textContent = state.autoDuplicationEnabled ? '重複ON' : '重複OFF';
        actionPanels.duplication.style.background = state.autoDuplicationEnabled ? '#198754' : '#000';
      }
    }

    function createActionPanels() {
      actionPanels.check = createActionPanel(86, '入力', () => {
        state.autoCheckEnabled = !state.autoCheckEnabled;
        localStorage.setItem(AUTO_CHECK_KEY, state.autoCheckEnabled ? '1' : '0');
        updateActionPanels();

        if (state.autoCheckEnabled) {
          checkInputPageCheckboxes();
        }
      });

      actionPanels.notice = createActionPanel(48, '注意', () => {
        state.autoNoticeEnabled = !state.autoNoticeEnabled;
        localStorage.setItem(AUTO_NOTICE_KEY, state.autoNoticeEnabled ? '1' : '0');
        updateActionPanels();

        if (state.autoNoticeEnabled) {
          processReservationNoticePopup();
        }
      });

      actionPanels.duplication = createActionPanel(10, '重複', () => {
        state.autoDuplicationEnabled = !state.autoDuplicationEnabled;
        localStorage.setItem(AUTO_DUPLICATION_KEY, state.autoDuplicationEnabled ? '1' : '0');
        updateActionPanels();

        if (state.autoDuplicationEnabled) {
          processDuplicationTimePopup();
        }
      });

      updateActionPanels();
    }

    function panelText(meal) {
      const ms = state.mealStates[meal.key];

      if (state.activeReloadMeal === meal.key) return `${meal.label}読`;
      if (ms.searchStatus === 'OFF') return `${meal.label}OFF`;

      return `${meal.label}${String(ms.waitSec).padStart(2, '0')}`;
    }

    function updatePanels() {
      MEALS.forEach(meal => {
        const ms = state.mealStates[meal.key];
        const panel = panels[meal.key];
        if (!panel) return;

        panel.textContent = panelText(meal);

        if (state.activeReloadMeal === meal.key) {
          panel.style.background = '#7b2cbf';
        } else {
          panel.style.background = ms.searchStatus === 'OFF'
            ? '#000'
            : { L: '#007bff', M: '#ff8c00', S: '#e83e8c' }[ms.searchStatus];
        }

        panel.style.color = '#fff';
      });

      panels.notify.textContent = '🔔';
      panels.notify.style.background = state.notifyEnabled ? '#ffc107' : '#000';
      panels.notify.style.color = state.notifyEnabled ? '#000' : '#fff';

      panels.reset.textContent = '🗑️';
      panels.reset.style.background = state.excludedTimes.length ? '#8e44ad' : '#000';
      panels.reset.style.color = '#fff';
    }

    MEALS.forEach((meal, index) => {
      panels[meal.key] = createPanel(index * 35, 0, '#000', () => {
        const ms = state.mealStates[meal.key];
        const next = { OFF: 'L', L: 'M', M: 'S', S: 'OFF' };

        ms.searchStatus = next[ms.searchStatus] || 'OFF';
        localStorage.setItem(meal.storage, ms.searchStatus);

        if (ms.searchStatus !== 'OFF') {
          ms.waitSec = getRandomWait(ms.searchStatus);
        }

        updatePanels();
      });
    });

    panels.notify = createPanel(0, 60, '#000', () => {
      state.notifyEnabled = !state.notifyEnabled;
      localStorage.setItem('tdr_priv_notifyEnabled', state.notifyEnabled ? '1' : '0');
      updatePanels();
    });

    panels.reset = createPanel(35, 60, '#000', () => {
      state.excludedTimes = [];
      localStorage.removeItem('tdr_priv_excludedTimes');

      document.querySelectorAll('.ex-switch-wrap').forEach(el => el.remove());

      drawExclusionSwitches();
      updatePanels();
    });

    createActionPanels();

    $(document).ajaxComplete(function (event, jqXHR, ajaxOptions) {
      if (!ajaxOptions || !ajaxOptions.url) return;
      if (!String(ajaxOptions.url).includes('timeGet')) return;

      const mealName = ajaxOptions.__tdrMealName || jqXHR.__tdrMealName || '';

      const info = printTimeGet('ajaxComplete', ajaxOptions.url, jqXHR.responseText, ajaxOptions.data, mealName);
      notifyDiffIfChanged(info, ajaxOptions, jqXHR, mealName);
    });

    function attachMealBarClickEvents() {
      $('h1#mealDivName').not('.click-hooked').each((_, el) => {
        const mealKey = normalizeMealKey($(el).text());

        $(el)
          .addClass('click-hooked')
          .css({ cursor: 'pointer', userSelect: 'none' })
          .on('click', function () {
            const key = normalizeMealKey($(this).text()) || mealKey;
            if (key) reloadOnlyMeal(key, true);
          });
      });
    }

    function drawExclusionSwitches() {
      $('#timeContentMain tbody[id="timeSliderTbody"] tr, #timeContent tbody[id="timeSliderTbody"] tr').each((_, tr) => {
        const $tr = $(tr);
        const $th = $tr.children('th').first();
        const $state = $tr.children('td.state').first();

        if (!$th.length || !$state.length) return;
        if ($state.find('.ex-switch-wrap').length > 0) return;

        const timeStr = $th
          .text()
          .replace(/\s+/g, '')
          .trim();

        if (!/^\d{1,2}:\d{2}$/.test(timeStr)) return;

        const box = document.createElement('span');
        box.className = 'ex-switch-wrap';
        box.dataset.time = timeStr;

        box.style.cssText = [
          'display:inline-flex',
          'align-items:center',
          'justify-content:center',
          'width:13px',
          'height:13px',
          'margin-left:8px',
          'border:1px solid #4d7cff',
          'border-radius:2px',
          'font-size:11px',
          'font-weight:bold',
          'line-height:13px',
          'cursor:pointer',
          'user-select:none',
          'vertical-align:middle',
          'position:relative',
          'z-index:2147483647',
          'box-sizing:border-box'
        ].join(';');

        const render = () => {
          const excluded = state.excludedTimes.includes(timeStr);

          if (excluded) {
            box.textContent = '';
            box.style.background = '#fff';
            box.style.borderColor = '#999';
            box.style.color = '#fff';
            box.title = `${timeStr} は通知除外中`;
          } else {
            box.textContent = '✓';
            box.style.background = '#4d7cff';
            box.style.borderColor = '#4d7cff';
            box.style.color = '#fff';
            box.title = `${timeStr} は通知対象`;
          }
        };

        box.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (state.excludedTimes.includes(timeStr)) {
            state.excludedTimes = state.excludedTimes.filter(t => t !== timeStr);
          } else {
            state.excludedTimes.push(timeStr);
          }

          localStorage.setItem('tdr_priv_excludedTimes', JSON.stringify(state.excludedTimes));
          render();
          updatePanels();
        };

        render();
        $state.append(box);
      });
    }

    function isReservationInputPage() {
      return location.href.includes('/online/sp/travelbag/reservation/search/');
    }

    function checkInputPageCheckboxes() {
      if (!state.autoCheckEnabled) return false;
      if (!isReservationInputPage()) return false;

      const targets = [
        document.querySelector('#checker-sameReserv, input[name="sameReserv"]'),
        document.querySelector('#checker-agreement, input[name="agreement"]')
      ].filter(Boolean);

      let changed = false;

      targets.forEach(chk => {
        if (!chk.checked) {
          chk.click();
          changed = true;
        }
      });

      return changed;
    }

    function installInputPageNextAutoCheck() {
      if (win.__tdr_priv_input_next_autocheck_installed) return;
      win.__tdr_priv_input_next_autocheck_installed = true;

      document.addEventListener('click', function (e) {
        if (!state.autoCheckEnabled) return;
        if (!(e.target instanceof Element)) return;

        const btn = e.target.closest('a, button, input[type="button"], input[type="submit"]');
        if (!btn) return;
        if (!isReservationInputPage()) return;

        const text = normalizePopupText(btn.innerText || btn.value || '');
        const isNext = text === '次へ' || btn.id === 'btnNext' || btn.classList.contains('next');

        if (!isNext) return;

        checkInputPageCheckboxes();
      }, true);
    }

    function normalizePopupText(s) {
      return String(s || '').replace(/\s+/g, '').trim();
    }

    function isVisiblePopup(el) {
      if (!el) return false;

      const style = getComputedStyle(el);

      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0;
    }

    function findVisiblePopupBySelectors(selectors) {
      return selectors
        .map(selector => document.querySelector(selector))
        .find(el => el && isVisiblePopup(el)) || null;
    }

    function findNextButtonInNoticePopup(popup) {
      if (!popup) return null;

      return popup.querySelector('#btnNext') ||
        popup.querySelector('button.js-conf.next') ||
        popup.querySelector('a.next, button.next, .next') ||
        Array.from(popup.querySelectorAll('a, button, input[type="button"], input[type="submit"]'))
          .find(btn => normalizePopupText(btn.innerText || btn.value || '') === '次へ') ||
        null;
    }

    function findReservationNoticePopup() {
      const popup = findVisiblePopupBySelectors([
        '#noticeMessage-popup',
        '#noticeMessage'
      ]);

      if (!popup) return null;

      const text = normalizePopupText(popup.innerText || popup.textContent || '');

      if (!text.includes('ご予約の際のご注意')) return null;
      if (!popup.querySelector('#accept, input[name="accept"]')) return null;
      if (!findNextButtonInNoticePopup(popup)) return null;

      return popup;
    }

    function processReservationNoticePopup() {
      if (!state.autoNoticeEnabled) {
        reservationNoticePopupActive = false;
        return;
      }

      const popup = findReservationNoticePopup();

      if (!popup) {
        reservationNoticePopupActive = false;
        return;
      }

      if (reservationNoticePopupActive) return;
      reservationNoticePopupActive = true;

      const accept = popup.querySelector('#accept, input[name="accept"]');

      if (!accept) {
        reservationNoticePopupActive = false;
        return;
      }

      if (!accept.checked) {
        accept.click();
      }

      setTimeout(() => {
        if (!state.autoNoticeEnabled) {
          reservationNoticePopupActive = false;
          return;
        }

        const latestPopup = findReservationNoticePopup();

        if (!latestPopup) {
          reservationNoticePopupActive = false;
          return;
        }

        const nextBtn = findNextButtonInNoticePopup(latestPopup);

        if (!nextBtn) {
          reservationNoticePopupActive = false;
          return;
        }

        console.log('[宿泊特典] ご予約の際のご注意: 同意ON → 次へ');
        nextBtn.click();

        setTimeout(() => {
          reservationNoticePopupActive = false;
        }, 300);
      }, 100);
    }

    function findDuplicationTimePopup() {
      const popup = findVisiblePopupBySelectors([
        '#duplicationTimeDialog-popup',
        '#duplicationTimeDialog'
      ]);

      if (!popup) return null;

      const text = normalizePopupText(popup.innerText || popup.textContent || '');

      if (!text.includes('選択されたご予約時間が')) return null;
      if (!text.includes('下記のご予約時間と重なっています')) return null;
      if (!text.includes('時間が重複しているご予約')) return null;

      const okBtn =
        popup.querySelector('a.next, button.next, .next') ||
        document.querySelector('#duplicationTimeDialog a.next, #duplicationTimeDialog button.next');

      if (!okBtn) return null;

      return popup;
    }

    function processDuplicationTimePopup() {
      if (!state.autoDuplicationEnabled) {
        duplicationTimePopupActive = false;
        return;
      }

      const popup = findDuplicationTimePopup();

      if (!popup) {
        duplicationTimePopupActive = false;
        return;
      }

      if (duplicationTimePopupActive) return;
      duplicationTimePopupActive = true;

      const okBtn =
        popup.querySelector('a.next, button.next, .next') ||
        document.querySelector('#duplicationTimeDialog a.next, #duplicationTimeDialog button.next');

      if (!okBtn) {
        duplicationTimePopupActive = false;
        return;
      }

      console.log('[宿泊特典] 時間干渉警告: 確認しました');
      okBtn.click();

      setTimeout(() => {
        duplicationTimePopupActive = false;
      }, 300);
    }

    new MutationObserver(() => {
      attachMealBarClickEvents();
      drawExclusionSwitches();

      if (state.autoCheckEnabled) {
        checkInputPageCheckboxes();
      }

      if (state.autoNoticeEnabled) {
        processReservationNoticePopup();
      }

      if (state.autoDuplicationEnabled) {
        processDuplicationTimePopup();
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    setInterval(() => {
      MEALS.forEach(meal => {
        const ms = state.mealStates[meal.key];

        if (ms.searchStatus === 'OFF') return;
        if (reloadLock) return;

        ms.waitSec--;

        if (ms.waitSec <= 0) {
          ms.waitSec = getRandomWait(ms.searchStatus);
          reloadOnlyMeal(meal.key, false);
        }
      });

      updatePanels();
    }, 1000);

    updatePanels();
    updateActionPanels();
    attachMealBarClickEvents();
    drawExclusionSwitches();
    installInputPageNextAutoCheck();

    if (state.autoCheckEnabled) {
      checkInputPageCheckboxes();
    }

    if (state.autoNoticeEnabled) {
      processReservationNoticePopup();
    }

    if (state.autoDuplicationEnabled) {
      processDuplicationTimePopup();
    }
  }

  boot();
})();
