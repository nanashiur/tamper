// ==UserScript==
// @name         🍴レストラン検索（宿泊特典）
// @namespace    st.tdr
// @version      1.3.1
// @description  「時間の選択」画面で時間帯別再検索／「人数・時間の選択」で2回目以降は全時間帯再検索。右上パネルで30～50秒ランダム間隔の自動再検索ON/OFF（OFF時は「OFF」と表示）。
// @match        https://reserve.tokyodisneyresort.jp/online/sp/travelbag/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/priviledges_restaurant_reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/priviledges_restaurant_reload.js
// ==/UserScript==

(function () {
  'use strict';

  const MARK_ID = '__privileges_restaurant_reload';
  const ready = () =>
    window.jQuery &&
    window.controller && controller.getTimeInfo &&
    window.timeGet && timeGet.refresh &&
    window.setupAccordion &&
    document.getElementById('timeContent') &&
    document.getElementById('timeType');

  const boot = () => {
    if (document.getElementById(MARK_ID)) return;
    if (!ready()) { setTimeout(boot, 300); return; }

    (function () {
      const markingElemId = '__privileges_restaurant_reload';
      if (document.getElementById(markingElemId)) return;
      if (!document.getElementById('timeContent') || !document.getElementById('timeType')) return;

      const markingElem = document.createElement('div');
      markingElem.id = markingElemId;
      markingElem.style.display = 'none';
      document.body.appendChild(markingElem);

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
          const headerText = getTextNode(el);
          opened_headers.push(headerText);
        });
      };

      const timeRanges = document.querySelectorAll('#timeContent section h1#mealDivName');
      timeRanges.forEach((el_timeRange) => {
        el_timeRange.addEventListener('click', () => {
          save_accordion_status();
          const timeType = $("#timeType").val();
          const el_sections = $(el_timeRange).closest(`section[class$=${timeType}]`).siblings(`section[class$=${timeType}]`);
          el_sections.each((id, el) => {
            for (const cls of el.classList) {
              if (cls.endsWith(timeType)) {
                $(el).removeClass(cls).addClass(`__${cls}`);
              }
            }
          });
          const task = controller.getTimeInfo();
          task.done(() => {
            el_sections.each((id, el) => {
              for (const cls of el.classList) {
                if (cls.startsWith('__')) {
                  $(el).removeClass(cls).addClass(cls.replace(/^__/, ''));
                }
              }
            });
          });
        });
        el_timeRange.style.cursor = 'pointer';
      });

      const orig_timeGet_refresh = timeGet.refresh;
      timeGet.refresh = function (b, a) {
        if ($(`#timeContent section.${b}`).length) {
          return orig_timeGet_refresh.apply(this, arguments);
        } else {
          const e = $.Deferred();
          e.resolve();
          return e.promise();
        }
      };

      const orig_setupAccordion = setupAccordion;
      setupAccordion = function () {
        $('#timeContent section.js-accordion header').each((idx, el) => {
          const headerCaption = $(el).find('h1');
          if (opened_headers.includes(getTextNode(headerCaption))) {
            $(el).addClass('open');
          }
        });
        orig_setupAccordion.apply(this, arguments);
      };

      document.querySelectorAll('#timeContent > header a.cancel, #timeContentMain > ul.listBtn01 a.back').forEach((el) => {
        el.addEventListener('click', () => {
          opened_headers = [];
          if (!document.querySelector('#timeContent table tr.selected')) {
            timeGet.isSearch = false;
          }
        });
      });

      // ====== 追加: 右上パネルで30～50秒ランダム間隔の自動再検索 ======
      (function(){
        const PANEL_ID = '__tdr_auto_search_panel';
        if (document.getElementById(PANEL_ID)) return;

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        Object.assign(panel.style, {
          position: 'fixed',
          top: '10px',
          right: '10px',
          zIndex: '2147483647',
          padding: '8px 12px',
          borderRadius: '10px',
          fontSize: '14px',
          fontWeight: '600',
          lineHeight: '1',
          cursor: 'pointer',
          userSelect: 'none',
          background: '#333',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          opacity: '0.9'
        });
        panel.textContent = 'OFF';
        document.body.appendChild(panel);

        let running = false;
        let timer = null;
        let nextAt = 0;
        let intervalSec = 30;

        const updatePanel = () => {
          if (!running) {
            panel.textContent = 'OFF';
            panel.style.background = '#333';
            return;
          }
          const remain = Math.max(0, Math.ceil((nextAt - Date.now())/1000));
          panel.textContent = `${remain}s`;
          panel.style.background = '#0064d2';
        };

        const setNextInterval = () => {
          intervalSec = Math.floor(Math.random() * 21) + 30; // 30～50秒
          nextAt = Date.now() + intervalSec * 1000;
        };

        const doFullSearch = () => {
          try { save_accordion_status(); } catch(e) {}
          const task = controller.getTimeInfo();
          if (task && typeof task.always === 'function') task.always(()=>{});
          setNextInterval();
        };

        const start = () => {
          if (running) return;
          running = true;
          doFullSearch();
          updatePanel();
          timer = setInterval(() => {
            const now = Date.now();
            if (now >= nextAt) {
              doFullSearch();
            }
            updatePanel();
          }, 250);
        };

        const stop = () => {
          running = false;
          if (timer) { clearInterval(timer); timer = null; }
          updatePanel();
        };

        panel.addEventListener('click', () => {
          running ? stop() : start();
        });
      })();
      // ====== 追加ここまで ======
    })();
  };

  boot();
})();
