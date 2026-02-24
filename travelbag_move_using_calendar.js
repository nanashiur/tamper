// ==UserScript==
// @name         TravelBag move using calendar
// @namespace    tampermonkey.travelbag.calendar
// @version      1.00
// @match        https://reserve.tokyodisneyresort.jp/online/travelbag/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  const markingElemId = '__travelbag_move_using_calendar';
  if (document.getElementById(markingElemId)) {
    alert('すでに実行されています');
    return;
  }

  if (!document.querySelector('#js-travelBagComponent > div.boxPlan02' || !document.querySelector('.boxPlan03 .header .nav input[name=appointDate]'))) {
    alert('このページでは実行できません');
    return;
  }

  const commonButtonStyle = `border-radius: 4px;padding: 2px 8px;font-weight: bold;text-shadow: 2px 2px 4px #7D7D7D;font-size:14px;`;
  $('#js-travelBagComponent > div.boxPlan02').append(`<p class="nav" style="margin-left: 10px;">
<input type="text" class="datepicker" value="" autocomplete="off" style="width: 80px;padding: 2px 4px;font-size:14px;font-weight:bold;height:20px;" readonly>
<input type="hidden" id="__appointDate" name="appointDate" value="" autocomplete="off">&nbsp;&nbsp;&nbsp;
<button name="__moveTargetDate" style="color:#FFF;border: solid #7CAFFF 1px;background: linear-gradient(to bottom, #5A86FF, #335AD0);width:50px;${commonButtonStyle}">移動</button>&nbsp;&nbsp;&nbsp;

<button name="__moveTargetDate" value="one" style="color:#FFFFFF;border: solid #7CAFFF 1px;background: linear-gradient(to bottom, #B3B5BF, #898EAA);margin-left: 2px;${commonButtonStyle}">1日表示</button>
<button name="__moveTargetDate" value="three" style="color:#FFFFFF;border: solid #7CAFFF 1px;background: linear-gradient(to bottom, #B3B5BF, #898EAA);margin-left: 2px;${commonButtonStyle}">3日表示</button>
<button name="__moveTargetDate" value="month" style="color:#FFFFFF;border: solid #7CAFFF 1px;background: linear-gradient(to bottom, #B3B5BF, #898EAA);margin-left: 2px;${commonButtonStyle}">月表示</button>
</p>`);

  $('#js-travelBagComponent > div.boxPlan03 > .header .nav').append(`<li style="position:absolute;left: 0px;">
<button name="__moveTargetDate" value="0" style="color:#FFFFFF;border: solid #FFD9C5 1px;background: linear-gradient(to bottom, #FF9885, #DA2C0B);width:50px;${commonButtonStyle}margin: 0px 20px">今日</button>
<button name="__moveTargetDate" value="1" style="color:#FFFFFF;border: solid #FFD9C5 1px;background: linear-gradient(to bottom, #FFCF9B, #DA700A);${commonButtonStyle}margin-left: 10px">1ヶ月後</button>
<button name="__moveTargetDate" value="3" style="color:#FFFFFF;border: solid #FFD9C5 1px;background: linear-gradient(to bottom, #FFCF9B, #DA700A);${commonButtonStyle}margin-left: 10px">3ヶ月後</button>
<button name="__moveTargetDate" value="4" style="color:#FFFFFF;border: solid #FFD9C5 1px;background: linear-gradient(to bottom, #FFCF9B, #DA700A);${commonButtonStyle}margin-left: 10px">4ヶ月後</button>
</li>`);

  let initialDate = $('.boxPlan03 .header .nav input[name=appointDate]').eq(0).val();
  initialDate = initialDate.slice(0, 4) + '/' + initialDate.slice(4, 6) + '/' + initialDate.slice(6, 8);

  $('.datepicker').datepicker({
    altField: $('#__appointDate'),
    altFormat: 'yymmdd',
    numberOfMonths: 2,
    stepMonths: 1,
    firstDay: 1,
    buttonImage: '/cgp/images/jp/pc/ico/ico_calender_01.png',
    buttonImageOnly: true,
    buttonText: '日付選択',
    showOn: 'both',
    showButtonPanel: true,
    changeMonth: true,
    currentText: '今月',
  });

  $('.datepicker').datepicker('setDate', initialDate);

  $('button[name="__moveTargetDate"').click((event) => {
    let buttonVal = $(event.currentTarget).val();
    if (buttonVal && Number(buttonVal) >= 0) {
      const targetMonth = new Date();
      targetMonth.setMonth(targetMonth.getMonth() + Number(buttonVal));
      // targetMonth.setDate(targetMonth.getDate() - (Number(buttonVal) > 0 ? 1 : 0));
      $('.datepicker').datepicker('setDate', targetMonth);
      buttonVal = 'three';
    }
    if (!buttonVal) {
      buttonVal = $('.boxPlan02 .nav li:nth-child(1) input[name=method]').val();
    }
    const form = $('<form>', {
      method: 'post',
      class: 'loading2next',
      action: context.path + trans.method[buttonVal],
    })
      .append('<input type="hidden" name="chk" value="1"/>')
      .append($('#__appointDate'));
    $('body').append(form);
    form.submit();
  });

  const inputList = $('tr.cellTime:has(input[name=timeRange][value!="0"]) input[type=hidden][name=contentsCD][value="04"]');
  if (inputList.length) {
    $('#js-travelBagComponent > div.boxPlan03 > .header .nav').append(`<li style="position:absolute;right: 0px; top: 2px;z-index: 100;margin-right:20px" class="_default_contentsCD">
<input type="radio" name="_default_contentsCD" id="_default_contentsCD_1" value="04" checked="">
<label for="_default_contentsCD_1"><span>レストラン</span></label>
<input type="radio" name="_default_contentsCD" id="_default_contentsCD_2" value="05">
<label for="_default_contentsCD_2"><span>ショー<br>レストラン</span></label>
<input type="radio" name="_default_contentsCD" id="_default_contentsCD_3" value="08">
<label for="_default_contentsCD_3"><span>ビビディ・バビディ<br>ブティック</span></label>
</li>`);

    $('head').append(
      $('<style>').text(`
._default_contentsCD input{
  display: none;
}
._default_contentsCD label{
  font-weight: bold;
  font-size:10px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 11px;
  float: left;
  cursor: pointer;
  margin: 0;
  border-right: 1px solid #abb2b7;
  border-top: 1px solid #CDCEB8;
  border-bottom: 1px solid #CDCEB8;
  background: #bdc3c7;
  color: #555e64;
  text-align: center;
  transition: .2s;
  padding: 2px 4px;
  letter-spacing: 0px;
  height: 26px;
  min-width: 60px;
  text-shadow: 2px 2px 4px #7D7D7D;
}
._default_contentsCD label:first-of-type{
  border-radius: 3px 0 0 3px;
  border-left: 1px solid #CDCEB8;
}
._default_contentsCD label:last-of-type{
  border-right: 0px;
  border-radius: 0 3px 3px 0;
  border-right: 1px solid #CDCEB8;
}
._default_contentsCD input[type="radio"]:checked + label {
  background: linear-gradient(to bottom, #C5CE7D, #8BA019);
  color: #fff;
}
._default_contentsCD label span {
  display: inline;
}
`),
    );

    const orig_setDefaultMenu = TravelBagDialog.prototype.setDefaultMenu;
    TravelBagDialog.prototype.setDefaultMenu = function () {
      orig_setDefaultMenu.apply(this, arguments);

      const selectors = {
        '05': 'a.js-showRestaurant',
        '08': 'a.js-vividevavideBoutique',
      };
      const contentsCD = data_cache.contentsCD;
      if (contentsCD !== '04' && contentsCD in selectors) {
        buttonChoice.flipImg($(selectors[contentsCD]));
        if (contentsCD === '08') {
          data_cache.adultNum = 1;
          data_cache.childNum = 0;
        }
      }
    };

    $('._default_contentsCD input[type="radio"][name="_default_contentsCD"]').change(() => {
      const contentsCD = $('input[name="_default_contentsCD"]:checked').val();
      inputList.val(contentsCD);
    });
  }

  const markingElem = document.createElement('div');
  markingElem.id = markingElemId;
  markingElem.style.display = 'none';
  document.body.appendChild(markingElem);
})();
