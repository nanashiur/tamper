// ==UserScript==
// @name         TDR TDHRCU0001 20251221 M23
// @namespace    tdr-fixed-room-date-rank
// @version      1.01
// @description  /hotel/reserve/ のPOSTで 部屋HOTDHRCU0001N・useDate=20251221・hotelPriceFrameID=M23 を強制。QueueItヘッダも同部屋に同期。
// @match        https://reserve.tokyodisneyresort.jp/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve_TDHRCU0001.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve_TDHRCU0001.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__tdr_fixed_installed) return;
  window.__tdr_fixed_installed = true;

  // 固定値
  const TARGET   = 'HOTDHRCU0001N'; // 部屋ID（commodityCD）
  const FIX_DATE = '20251221';      // useDate（YYYYMMDD）
  const FIX_PF   = 'M23';           // ランク（hotelPriceFrameID）

  const SYNC_QUEUE_HEADER = true;   // x-queueit-ajaxpageurl を同部屋に同期
  const INJECT_IF_MISSING = true;   // 未設定なら注入

  // 派生コード
  const PARTS = {
    commodityCD:    TARGET,
    searchHotelCD:  TARGET.slice(2,5),  // TDH
    roomLetterCD:   TARGET.slice(5,8),  // RCU
    roomMaterialCD: TARGET.slice(2,12)  // TDHRCU0001
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
          const v = rewriteQueueHeaderValue(isEncoded(l
