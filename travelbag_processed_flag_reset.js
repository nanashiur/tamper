// ==UserScript==
// @name         TravelBag processed flag reset
// @namespace    tampermonkey.travelbag.processedflag
// @version      1.00
// @match        https://reserve.tokyodisneyresort.jp/online/travelbag/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  const markingElemId = '__travelbag_processed_flag_reset';
  if (document.getElementById(markingElemId)) {
    alert('すでに実行されています');
    return;
  };

  if (!document.querySelector('#js-travelBagComponent') || typeof travelbag === 'undefined' || !travelbag?.getResrvStatusDetail) {
    // 対象外ページ
    alert('このページでは実行できません');
    return;
  };

  const markingElem = document.createElement('div');
  markingElem.id = markingElemId;
  markingElem.style.display = 'none';
  document.body.appendChild(markingElem);

  const callInit = () => {
    if (typeof promiseCheck !== 'undefined' && typeof promiseCheck?.init === 'function') {
      promiseCheck.init();
    };
  };
  const orig_getResrvStatusDetail = travelbag.getResrvStatusDetail;
  travelbag.getResrvStatusDetail = function () {
    callInit();
    return orig_getResrvStatusDetail.apply(this, arguments);
  };
  callInit();
})();
