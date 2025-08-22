// ==UserScript==
// @name         TDR DHMTGD0004 20251223 M16
// @namespace    tdr-fixed-room-date-rank
// @version      1.10
// @description  /hotel/reserve/ のPOSTで 部屋HODHMTGD0004N・useDate=20251223・hotelPriceFrameID=M16 を強制。QueueItヘッダも同部屋に同期。
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve_DHMTGD0004.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve_DHMTGD0004.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__tdr_fixed_installed) return;
  window.__tdr_fixed_installed = true;

  const TARGET   = 'HODHMTGD0004N';
  const FIX_DATE = '20251223';
  const FIX_PF   = 'M16';

  const SYNC_QUEUE_HEADER = true;
  const INJECT_IF_MISSING = true;

  const PARTS = {
    commodityCD:    TARGET,
    searchHotelCD:  TARGET.slice(2,5),
    roomLetterCD:   TARGET.slice(5,8),
    roomMaterialCD: TARGET.slice(2,12)
  };

  const isReservePost = (url, m) =>
    /\/hotel\/reserve\/?$/.test(String(url||'')) &&
    String(m||'GET').toUpperCase() === 'POST';

  const toSendableString = (body) => {
    if (body == null) return '';
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof body === 'string') return body;
    if (body instanceof FormData || body instanceof Blob ||
        body instanceof ArrayBuffer ||
        (typeof Document !== 'undefined' && body instanceof Document)) return body;
    try { return String(body); } catch { return body; }
  };

  const rewriteBody = (orig) => {
    const sendable = toSendableString(orig);
    if (sendable !== orig && typeof sendable !== 'string') return orig;
    const txt = (typeof sendable === 'string') ? sendable : '';
    if (!txt) return orig;

    const p = new URLSearchParams(txt);
    p.set('commodityCD',    PARTS.commodityCD);
    p.set('searchHotelCD',  PARTS.searchHotelCD);
    p.set('roomLetterCD',   PARTS.roomLetterCD);
    p.set('roomMaterialCD', PARTS.roomMaterialCD);
    p.set('useDate', FIX_DATE);
    p.set('hotelPriceFrameID', FIX_PF);

    return p.toString();
  };

  const HDR  = 'x-queueit-ajaxpageurl';
  const BASE = 'https://reserve.tokyodisneyresort.jp';
  const isEncoded = (s) => /%[0-9A-F]{2}/i.test(s);

  const rewriteQueueHeaderValue = (value) => {
    if (!SYNC_QUEUE_HEADER || !value) return value;
    return value.split(/\s*,\s*/).map(v => {
      let orig = v, decoded = v;
      for (let i=0;i<2;i++){ try{ const d=decodeURIComponent(decoded); if(d===decoded)break; decoded=d; }catch{break;} }
      const urlStr = decoded.startsWith('http') ? decoded : BASE + decoded;
      let u; try { u = new URL(urlStr); } catch { return orig; }
      u.searchParams.set('hotelRoomCd', PARTS.commodityCD);
      const out = u.href.startsWith(BASE) ? u.href.slice(BASE.length) : u.href;
      return isEncoded(orig) ? encodeURIComponent(out) : out;
    }).join(', ');
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _set  = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url){
    this.__u=url; this.__m=method; this.__hdrs={};
    return _open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value){
    const key = String(name||''); let val=value;
    if (key.toLowerCase()===HDR) val = rewriteQueueHeaderValue(value);
    this.__hdrs[key.toLowerCase()] = val;
    return _set.call(this, key, val);
  };
  XMLHttpRequest.prototype.send = function(body){
    try{
      if (isReservePost(this.__u, this.__m)){
        body = rewriteBody(body);
        if (SYNC_QUEUE_HEADER && INJECT_IF_MISSING && !(HDR in (this.__hdrs||{}))){
          const loc = location.pathname + location.search;
          const v = rewriteQueueHeaderValue(isEncoded(loc) ? loc : encodeURIComponent(loc));
          try { _set.call(this, HDR, v); } catch {}
        }
      }
    }catch{}
    return _send.call(this, body);
  };

  if (window.fetch){
    const _fetch = window.fetch;
    window.fetch = function(input, init){
      try{
        const url = (typeof input==='string') ? input : (input&&input.url);
        const method = (init&&init.method) || (input&&input.method) || 'GET';
        if (isReservePost(url, method) && init){
          if ('body' in init) init = Object.assign({}, init, { body: rewriteBody(init.body) });
          if (init.headers){
            const h = new Headers(init.headers);
            if (h.has(HDR)) h.set(HDR, rewriteQueueHeaderValue(h.get(HDR)));
            else if (INJECT_IF_MISSING){
              const loc = location.pathname + location.search;
              const v = rewriteQueueHeaderValue(isEncoded(loc) ? loc : encodeURIComponent(loc));
              h.set(HDR, v);
            }
            init.headers = h;
          }
        }
      }catch{}
      return _fetch(input, init);
    };
  }

  // 起動パネル（左上密着・半透明0.75・フォント少し大きめ）
  (function showPanel(){
    try{
      const lines = [PARTS.roomLetterCD, FIX_DATE.slice(4), FIX_PF];
      const el = document.createElement('div');
      el.id = 'tdr-fixed-panel';
      el.innerHTML = lines.join('<br>');
      const s = el.style;
      s.position = 'fixed';
      s.top = '0';
      s.left = '0';
      s.zIndex = '2147483647';
      s.background = 'rgba(22, 163, 74, 0.75)';
      s.color = '#fff';
      s.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans JP", Meiryo, sans-serif';
      s.fontWeight = '700';
      s.fontSize = '16px';
      s.padding = '6px 8px';
      s.borderRadius = '6px';
      s.lineHeight = '1.2';
      s.boxShadow = '0 2px 8px rgba(0,0,0,.15)';
      s.pointerEvents = 'none';
      const append = () => (document.body || document.documentElement).appendChild(el);
      (document.readyState === 'loading') ? document.addEventListener('DOMContentLoaded', append, { once:true }) : append();
    }catch{}
  })();

  console.log('[tdr-fixed] room=HODHMTGD0004N, date=20251223, rank=M16 (queue sync ON)');
})();
