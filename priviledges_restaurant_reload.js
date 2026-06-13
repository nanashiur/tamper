// ==UserScript==
// @name         🍴🏨宿泊特典レストラン検索
// @version      2.40
// @match        https://reserve.tokyodisneyresort.jp/online/sp/travelbag/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/priviledges_restaurant_reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/priviledges_restaurant_reload.js
// ==/UserScript==

(function () {
  'use strict';

  const win = window;

  const ranges = {
    S: [5, 6],
    M: [15, 11],
    L: [30, 21]
  };

  function getRandomWait(mode) {
    const r = ranges[mode];
    if (!r) return 15;
    return Math.floor(Math.random() * r[1]) + r[0];
  }

  function loadExcludedTimes() {
    try {
      const arr = JSON.parse(localStorage.getItem('tdr_priv_excludedTimes') || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  const state = {
    notifyEnabled: localStorage.getItem('tdr_priv_notifyEnabled') !== '0',
    searchStatus: localStorage.getItem('tdr_priv_searchStatus') || 'OFF',
    excludedTimes: loadExcludedTimes(),
    waitSec: 15
  };

  if (!ranges[state.searchStatus] && state.searchStatus !== 'OFF') {
    state.searchStatus = 'OFF';
    localStorage.setItem('tdr_priv_searchStatus', 'OFF');
  }

  if (state.searchStatus !== 'OFF') {
    state.waitSec = getRandomWait(state.searchStatus);
  }

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

    win.lastClickedRestaurantTitle = "レストラン名不明";

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

    const save_accordion_status = () => {
      opened_headers = [];
      $('#timeContent section.js-accordion header.open h1').each((i, el) => {
        opened_headers.push(getTextNode(el));
      });
    };

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

    function getRawRestaurantName(ajaxOptions) {
      let restaurantName = "レストラン名不明";

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

        if (win.lastClickedRestaurantTitle && win.lastClickedRestaurantTitle !== "レストラン名不明") {
          return win.lastClickedRestaurantTitle;
        }

        const visibleTitle = $('ul.timeDiv:visible').closest('li').find('p.title');
        if (visibleTitle.length) {
          return visibleTitle.first().text().trim();
        }
      } catch (e) {
        console.error("レストラン名取得エラー:", e);
      }

      return restaurantName;
    }

    function getDetectDateTime() {
      const d = new Date();
      const h = d.getHours().toString().padStart(2, '0');
      const m = d.getMinutes().toString().padStart(2, '0');
      const s = d.getSeconds().toString().padStart(2, '0');
      return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}:${s}`;
    }

    function formatUseDate(yyyymmdd) {
      const raw = String(yyyymmdd || '').trim();
      const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (!m) return '';

      const y = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const date = new Date(y, month - 1, day);
      const week = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];

      return `${month}/${day}（${week}）`;
    }

    function normalizeDisplayDate(raw) {
      const text = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';

      const jp = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*[（(]([日月火水木金土])[）)]/);
      if (jp) {
        return `${Number(jp[2])}/${Number(jp[3])}（${jp[4]}）`;
      }

      const mdw = text.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*(?:日)?\s*[（(]?([日月火水木金土])?[）)]?/);
      if (mdw) {
        return `${Number(mdw[1])}/${Number(mdw[2])}${mdw[3] ? `（${mdw[3]}）` : ''}`;
      }

      return text.replace(/\s*\((.)\)/, '（$1）');
    }

    function getDisplayDate(ajaxOptions) {
      const selectors = [
        '#reservationOfDateDisp1',
        '#reservationOfDateDisp',
        '#appointDateDisp',
        '#useDateDisp'
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const text = normalizeDisplayDate(el?.textContent || '');
        if (text) return text;
      }

      const dataObj = parseAjaxData(ajaxOptions?.data);
      if (dataObj.useDate) {
        const formatted = formatUseDate(dataObj.useDate);
        if (formatted) return formatted;
      }

      try {
        const pageText = $('#content').text() || $('body').text();
        const text = normalizeDisplayDate(pageText);
        if (text) return text;
      } catch (e) {
        console.error("日付取得エラー:", e);
      }

      return "日付不明";
    }

    function formatSlotLines(availableSlots) {
      const groups = {};

      availableSlots.forEach(time => {
        const hour = String(time).split(':')[0];
        if (!groups[hour]) groups[hour] = [];
        groups[hour].push(time);
      });

      return Object.keys(groups)
        .sort((a, b) => Number(a) - Number(b))
        .map(hour => `⏰ ${groups[hour].join(' ')}`);
    }

    function buildVacancyMessage(restaurantName, availableSlots, mealName, ajaxOptions) {
      const displayDate = getDisplayDate(ajaxOptions);

      const lines = [
        `🍴🏨 ${restaurantName}`,
        `📅 ${displayDate}${mealName ? ` 【${mealName}】` : ''}`
      ];

      lines.push(...formatSlotLines(availableSlots));

      return lines.join('\n');
    }

    function sendDiscord(description) {
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
          username: "🍴🏨宿泊特典レストラン検索",
          embeds: [
            {
              title: `🔔${getDetectDateTime()}`,
              description: description,
              color: 16776960
            }
          ]
        })
      }).catch(e => console.error('Discord通知エラー:', e));
    }

    const panels = {};

    function createPanel(top, bg, onClick) {
      const p = document.createElement('div');

      Object.assign(p.style, {
        position: 'fixed',
        top: `${top}px`,
        right: '0px',
        zIndex: '2147483647',
        width: '60px',
        height: '35px',
        padding: '0',
        borderRadius: '8px 0 0 8px',
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

    function updatePanels() {
      panels.main.textContent = state.searchStatus === 'OFF'
        ? 'OFF'
        : String(state.waitSec);

      panels.main.style.background = state.searchStatus === 'OFF'
        ? '#000'
        : { L: '#007bff', M: '#ff8c00', S: '#e83e8c' }[state.searchStatus];

      panels.notify.textContent = '🔔';
      panels.notify.style.background = state.notifyEnabled ? '#ffc107' : '#000';
      panels.notify.style.color = state.notifyEnabled ? '#000' : '#fff';

      panels.reset.textContent = '🗑️';
      panels.reset.style.background = state.excludedTimes.length ? '#8e44ad' : '#000';
      panels.reset.style.color = '#fff';
    }

    panels.main = createPanel(0, '#000', () => {
      const next = { OFF: 'L', L: 'M', M: 'S', S: 'OFF' };
      state.searchStatus = next[state.searchStatus] || 'OFF';

      localStorage.setItem('tdr_priv_searchStatus', state.searchStatus);

      if (state.searchStatus !== 'OFF') {
        state.waitSec = getRandomWait(state.searchStatus);
      }

      updatePanels();
    });

    panels.notify = createPanel(35, '#000', () => {
      state.notifyEnabled = !state.notifyEnabled;
      localStorage.setItem('tdr_priv_notifyEnabled', state.notifyEnabled ? '1' : '0');
      updatePanels();
    });

    panels.reset = createPanel(70, '#000', () => {
      state.excludedTimes = [];
      localStorage.removeItem('tdr_priv_excludedTimes');

      document.querySelectorAll('.ex-switch-wrap').forEach(el => el.remove());

      drawExclusionSwitches();
      updatePanels();
    });

    function notifyIfVacant(responseText, ajaxOptions, jqXHR) {
      try {
        const parsed = JSON.parse(responseText);
        const data = Array.isArray(parsed) ? parsed : [parsed];

        const availableSlots = [];

        data.forEach(group => {
          if (!group.timeGetDtoList) return;

          group.timeGetDtoList.forEach(slot => {
            if (String(slot.saleStatus) === "0") {
              const time = slot.exhibitionTime || slot.time || '';

              if (time && !state.excludedTimes.includes(time) && !availableSlots.includes(time)) {
                availableSlots.push(time);
              }
            }
          });
        });

        if (!availableSlots.length) return;

        availableSlots.sort((a, b) => a.localeCompare(b));

        const detectedName = getRawRestaurantName(ajaxOptions);
        const mealName = ajaxOptions.__tdrMealName || jqXHR.__tdrMealName || '';

        const finalMsg = buildVacancyMessage(detectedName, availableSlots, mealName, ajaxOptions);

        sendDiscord(finalMsg);
      } catch (e) {
        console.error('空席判定エラー:', e);
      }
    }

    $(document).ajaxComplete(function (event, jqXHR, ajaxOptions) {
      if (!ajaxOptions || !ajaxOptions.url) return;
      if (!String(ajaxOptions.url).includes('timeGet')) return;

      notifyIfVacant(jqXHR.responseText, ajaxOptions, jqXHR);
    });

    function attachMealBarClickEvents() {
      $('h1#mealDivName').not('.click-hooked').each((_, el) => {
        $(el)
          .addClass('click-hooked')
          .css({ cursor: 'pointer', userSelect: 'none' })
          .on('click', function () {
            save_accordion_status();

            if (win.controller && typeof win.controller.getTimeInfo === 'function') {
              win.controller.getTimeInfo();
            }
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

    new MutationObserver(() => {
      attachMealBarClickEvents();
      drawExclusionSwitches();
    }).observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
      if (state.searchStatus === 'OFF') return;

      state.waitSec--;

      if (state.waitSec <= 0) {
        state.waitSec = getRandomWait(state.searchStatus);

        save_accordion_status();

        if (win.controller && typeof win.controller.getTimeInfo === 'function') {
          win.controller.getTimeInfo();
        }
      }

      updatePanels();
    }, 1000);

    updatePanels();
    attachMealBarClickEvents();
    drawExclusionSwitches();
  }

  boot();
})();
