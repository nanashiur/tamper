// ==UserScript==
// @name         DHMTGD0004 20260506 M12
// @namespace    tdr-fixed-room-date-rank
// @version      1.32
// @description  /hotel/reserve/ OPSTC 部屋HODHMTGD0004N useDate=20260506 hotelPriceFrameID=M12 を強制。Queueはヘッダも同時に同期。 パネルクリックでON/OFFトグル（初期OFF）。ホテルコードに応じてパネル色変更。
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashir/tamper/refs/heads/main/reserve_DHMTGD0004.js
// @downloadURL  https://raw.githubusercontent.com/nanashir/tamper/refs/heads/main/reserve_DHMTGD0004.js
// @grant        none
// ==/UserScript==

if (window.__tdr_fixed_installed) return;
window.__tdr_fixed_installed = true;

// --- トグル用フラグ（初期OFF） ---
let ENABLED = false;
Object.defineProperty(window, '__tdr_fixed_enabled', { get(){ return ENABLED; } });

// --- 固定（部屋・日付・ランク） ---
const TARGET   = 'HODHMTGD0004N';
const FIX_DATE = '20260506';
const FIX_PF   = 'M12';

const SYNC_QUEUE_HEADER = true;
const INJECT_IF_MISSING = true;

// --- 派生コード ---
const PARTS = {
  commodityCD: TARGET,
  searchHotelCD: TARGET.slice(2,5),
};

// --- URL処理 ---
const BASE = location.origin + location.pathname + '?';
function normalizeValue(value){
  if (!SYNC_QUEUE_HEADER || !value) return value;
  return value.split(/\s*,\s*/).map(v=>{
    let orig = v, decoded = v;
    for (let i=0;i<2;i++){ try{ const d=decodeURIComponent(decoded); if (d===decoded) break; decoded=d; }catch{ break; } }
    const urlStr = decoded.startsWith('http') ? decoded : BASE + decoded;
    let u; try{ u = new URL(urlStr); }catch{ return orig; }
    u.searchParams.set('hotelRoomCd', PARTS.commodityCD);
    u.searchParams.set('useDate', FIX_DATE);
    u.searchParams.set('hotelPriceFrameID', FIX_PF);
    return u.search;
  }).join(',');
}

// --- ヘッダ同期 ---
(function(){
  const _set = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(k,v){
    if (SYNC_QUEUE_HEADER && ENABLED && typeof v === 'string'){
      v = normalizeValue(v);
    }
    return _set.call(this,k,v);
  };
})();

// --- UI ---
function applyVisual(){
  const panel = document.getElementById('__tdr_fixed_panel');
  if (!panel) return;
  panel.style.opacity = ENABLED ? '1' : '0.6';
}

function makePanel(){
  if (document.getElementById('__tdr_fixed_panel')) return;
  const d = document.createElement('div');
  d.id = '__tdr_fixed_panel';
  d.textContent = 'FIX ' + FIX_DATE + ' / ' + FIX_PF;
  d.style.cssText = `
    position:fixed; right:12px; bottom:12px; z-index:99999;
    padding:10px 14px; border-radius:10px; cursor:pointer;
    background:#2e8b57; color:#fff; font-weight:bold;
    box-shadow:0 6px 16px rgba(0,0,0,.25);
  `;
  d.addEventListener('click',()=>{
    ENABLED = !ENABLED;
    applyVisual();
  });
  document.body.appendChild(d);
  applyVisual();
}

// --- 起動 ---
(function(){
  try{
    makePanel();
  }catch(e){}
  console.log('[tdr-fixed] loaded (OFF) room=HODHMTGD0004N, date=20260506, rank=M12');
})();
