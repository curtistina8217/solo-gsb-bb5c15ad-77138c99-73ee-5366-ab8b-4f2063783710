'use strict';

(function () {
  var srtInput = document.getElementById('srtInput');
  var fileInput = document.getElementById('fileInput');
  var anchorBody = document.getElementById('anchorBody');
  var addAnchorBtn = document.getElementById('addAnchorBtn');
  var convertBtn = document.getElementById('convertBtn');
  var downloadBtn = document.getElementById('downloadBtn');
  var loadSampleBtn = document.getElementById('loadSampleBtn');
  var clearBtn = document.getElementById('clearBtn');
  var messageBox = document.getElementById('message');
  var resultCard = document.getElementById('resultCard');
  var resultBody = document.getElementById('resultBody');
  var entryCount = document.getElementById('entryCount');

  var secondaryInput = document.getElementById('secondaryInput');
  var secondaryFileInput = document.getElementById('secondaryFileInput');
  var secondaryClearBtn = document.getElementById('secondaryClearBtn');
  var alignBtn = document.getElementById('alignBtn');
  var downloadCsvBtn = document.getElementById('downloadCsvBtn');
  var alignMessageBox = document.getElementById('alignMessage');
  var alignCard = document.getElementById('alignCard');
  var alignBody = document.getElementById('alignBody');
  var pairCount = document.getElementById('pairCount');
  var unmatchedMainCount = document.getElementById('unmatchedMainCount');
  var unmatchedSecCount = document.getElementById('unmatchedSecCount');

  var correctedSrt = null;
  var alignCsv = null;

  // ---------- 锚点行 ----------

  function addAnchorRow(src, dst) {
    var tr = document.createElement('tr');

    var tdNo = document.createElement('td');
    var tdSrc = document.createElement('td');
    var tdDst = document.createElement('td');
    var tdOp = document.createElement('td');

    var srcInput = document.createElement('input');
    srcInput.type = 'text';
    srcInput.placeholder = '00:00:00,000';
    srcInput.className = 'anchor-src';
    if (src) srcInput.value = src;

    var dstInput = document.createElement('input');
    dstInput.type = 'text';
    dstInput.placeholder = '00:00:00,000';
    dstInput.className = 'anchor-dst';
    if (dst) dstInput.value = dst;

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = '删除';
    delBtn.addEventListener('click', function () {
      tr.remove();
      renumber();
    });

    tdSrc.appendChild(srcInput);
    tdDst.appendChild(dstInput);
    tdOp.appendChild(delBtn);
    tr.appendChild(tdNo);
    tr.appendChild(tdSrc);
    tr.appendChild(tdDst);
    tr.appendChild(tdOp);
    anchorBody.appendChild(tr);
    renumber();
  }

  function renumber() {
    var rows = anchorBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      rows[i].firstChild.textContent = String(i + 1);
    }
  }

  function collectAnchors() {
    var anchors = [];
    var rows = anchorBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      anchors.push({
        src: rows[i].querySelector('.anchor-src').value.trim(),
        dst: rows[i].querySelector('.anchor-dst').value.trim()
      });
    }
    return anchors;
  }

  // ---------- 消息 ----------

  function showMessage(box, kind, lines) {
    box.hidden = false;
    box.className = 'message ' + kind;
    box.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
  }

  function hideMessage(box) {
    box.hidden = true;
    box.textContent = '';
  }

  // ---------- 结果表 ----------

  function renderEntries(entries, errors) {
    resultBody.innerHTML = '';
    entryCount.textContent = String(entries.length);
    entries.forEach(function (e) {
      var tr = document.createElement('tr');
      if (errors && errors.length && errors.some(function (msg) {
        return msg.indexOf('字幕 ' + e.index + '：') === 0 || msg.indexOf('字幕 ' + e.index + '（') !== -1;
      })) {
        tr.className = 'problem';
      }
      ['index', 'oldStart', 'oldEnd', 'newStart', 'newEnd'].forEach(function (k) {
        var td = document.createElement('td');
        td.textContent = String(e[k]);
        if (k !== 'index') td.className = 'time';
        tr.appendChild(td);
      });
      var tdText = document.createElement('td');
      tdText.className = 'text';
      tdText.textContent = e.text;
      tr.appendChild(tdText);
      resultBody.appendChild(tr);
    });
    resultCard.hidden = entries.length === 0;
  }

  // ---------- 校正请求 ----------

  function resetAlignState() {
    alignCsv = null;
    downloadCsvBtn.disabled = true;
    alignCard.hidden = true;
    hideMessage(alignMessageBox);
  }

  function convert() {
    hideMessage(messageBox);
    correctedSrt = null;
    downloadBtn.disabled = true;
    alignBtn.disabled = true;
    resetAlignState();

    var payload = { srt: srtInput.value, anchors: collectAnchors() };
    fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.anchorErrors) {
          resultCard.hidden = true;
          showMessage(messageBox, 'error', ['锚点设置有误：'].concat(data.anchorErrors));
          return;
        }
        if (data.parseErrors) {
          resultCard.hidden = true;
          showMessage(messageBox, 'error', ['SRT 解析失败：'].concat(data.parseErrors));
          return;
        }
        renderEntries(data.entries || [], data.errors);
        if (data.errors && data.errors.length) {
          showMessage(messageBox, 'error', ['校正结果存在问题，已阻止导出：'].concat(data.errors));
          return;
        }
        correctedSrt = data.srt;
        downloadBtn.disabled = false;
        alignBtn.disabled = false;
        showMessage(messageBox, 'ok', '校正完成，共 ' + (data.entries ? data.entries.length : 0) + ' 条字幕，可下载导出，也可继续做双语对齐。');
      })
      .catch(function (err) {
        showMessage(messageBox, 'error', '请求失败：' + err.message);
      });
  }

  // ---------- 双语对齐 ----------

  function alignCells(kind, e) {
    var cells = [];
    var keys = ['index', 'start', 'end', 'text'];
    keys.forEach(function (k) {
      var td = document.createElement('td');
      td.textContent = e && e[k] != null ? String(e[k]) : '';
      if (k !== 'text') td.className = 'time';
      cells.push(td);
    });
    cells.forEach(function (td) {
      td.className = (td.className ? td.className + ' ' : '') + kind;
    });
    return cells;
  }

  function appendAlignRow(cells, rowClass) {
    var tr = document.createElement('tr');
    if (rowClass) tr.className = rowClass;
    cells.forEach(function (td) { tr.appendChild(td); });
    alignBody.appendChild(tr);
  }

  function renderAlignResult(data) {
    alignBody.innerHTML = '';
    pairCount.textContent = String(data.pairs.length);
    unmatchedMainCount.textContent = String(data.unmatchedMain.length);
    unmatchedSecCount.textContent = String(data.unmatchedSecondary.length);

    var mainUnmatched = data.unmatchedMain.slice();
    var secUnmatched = data.unmatchedSecondary.slice();
    var p = 0;
    var mi = 0;
    var si = 0;

    // 按两轨顺序合并展示：配对优先，任一侧到达配对位置前先列出其未配对条目
    while (p < data.pairs.length) {
      var pair = data.pairs[p];
      while (mi < pair.mainPos) {
        var m = mainUnmatched.filter(function (e) { return e.pos === mi; })[0];
        appendAlignRow(alignCells('main-col', m).concat(alignCells('sec-col', null)), 'unmatched-main');
        mi++;
      }
      while (si < pair.secPos) {
        var s = secUnmatched.filter(function (e) { return e.pos === si; })[0];
        appendAlignRow(alignCells('main-col', null).concat(alignCells('sec-col', s)), 'unmatched-sec');
        si++;
      }
      var pairCells = [];
      ['mainIndex', 'mainStart', 'mainEnd', 'mainText'].forEach(function (k, idx) {
        var td = document.createElement('td');
        td.textContent = String(pair[k]);
        td.className = 'main-col' + (idx !== 3 ? ' time' : '');
        pairCells.push(td);
      });
      ['secIndex', 'secStart', 'secEnd', 'secText'].forEach(function (k, idx) {
        var td = document.createElement('td');
        td.textContent = String(pair[k]);
        td.className = 'sec-col' + (idx !== 3 ? ' time' : '');
        pairCells.push(td);
      });
      appendAlignRow(pairCells, 'paired');
      p++;
      mi++;
      si++;
    }
    mainUnmatched
      .filter(function (e) { return e.pos >= mi; })
      .forEach(function (e) {
        appendAlignRow(alignCells('main-col', e).concat(alignCells('sec-col', null)), 'unmatched-main');
      });
    secUnmatched
      .filter(function (e) { return e.pos >= si; })
      .forEach(function (e) {
        appendAlignRow(alignCells('main-col', null).concat(alignCells('sec-col', e)), 'unmatched-sec');
      });

    alignCard.hidden = false;
  }

  function align() {
    if (!correctedSrt) return;
    hideMessage(alignMessageBox);
    alignCsv = null;
    downloadCsvBtn.disabled = true;
    alignBtn.disabled = true;

    var payload = {
      srt: srtInput.value,
      anchors: collectAnchors(),
      secondarySrt: secondaryInput.value
    };
    fetch('/api/align', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        // 主轨问题：与 /api/convert 相同的错误形式，主轨 SRT 也不可导出
        if (data.anchorErrors) {
          alignCard.hidden = true;
          showMessage(alignMessageBox, 'error', ['锚点设置有误：'].concat(data.anchorErrors));
          return;
        }
        if (data.parseErrors) {
          alignCard.hidden = true;
          showMessage(alignMessageBox, 'error', ['主轨 SRT 解析失败：'].concat(data.parseErrors));
          return;
        }
        if (data.errors && data.errors.length) {
          alignCard.hidden = true;
          showMessage(alignMessageBox, 'error', ['无法对齐：'].concat(data.errors));
          return;
        }
        // 副轨无效：给出解析错误；校正后的主轨 SRT 仍可下载，不受影响
        if (data.secondaryParseErrors) {
          alignCard.hidden = true;
          if (data.srt) {
            correctedSrt = data.srt;
            downloadBtn.disabled = false;
          }
          showMessage(alignMessageBox, 'error', ['副轨 SRT 解析失败（不影响主轨 SRT 导出）：'].concat(data.secondaryParseErrors));
          return;
        }
        correctedSrt = data.srt;
        downloadBtn.disabled = false;
        renderAlignResult(data);
        alignCsv = data.csv;
        downloadCsvBtn.disabled = false;
        showMessage(
          alignMessageBox,
          'ok',
          '对齐完成：配对 ' + data.pairs.length + ' 对，主轨未配对 ' + data.unmatchedMain.length +
          ' 条，副轨未配对 ' + data.unmatchedSecondary.length + ' 条。'
        );
      })
      .catch(function (err) {
        showMessage(alignMessageBox, 'error', '请求失败：' + err.message);
      })
      .then(function () {
        alignBtn.disabled = !correctedSrt;
      });
  }

  // ---------- 下载 ----------

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- 事件绑定 ----------

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { srtInput.value = String(reader.result || ''); };
    reader.readAsText(file, 'utf-8');
  });

  secondaryFileInput.addEventListener('change', function () {
    var file = secondaryFileInput.files && secondaryFileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { secondaryInput.value = String(reader.result || ''); };
    reader.readAsText(file, 'utf-8');
  });

  secondaryClearBtn.addEventListener('click', function () {
    secondaryInput.value = '';
    secondaryFileInput.value = '';
    resetAlignState();
  });

  loadSampleBtn.addEventListener('click', function () {
    srtInput.value = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      '第一行字幕',
      '跨两行显示',
      '',
      '2',
      '00:00:05,000 --> 00:00:07,000',
      '第二段对白',
      '',
      '3',
      '00:00:12,000 --> 00:00:14,500',
      '第三段对白'
    ].join('\n');
  });

  clearBtn.addEventListener('click', function () {
    srtInput.value = '';
    fileInput.value = '';
    resultCard.hidden = true;
    correctedSrt = null;
    downloadBtn.disabled = true;
    hideMessage(messageBox);
    resetAlignState();
  });

  addAnchorBtn.addEventListener('click', function () { addAnchorRow(); });
  convertBtn.addEventListener('click', convert);
  downloadBtn.addEventListener('click', function () {
    if (correctedSrt) downloadText('corrected.srt', correctedSrt);
  });
  alignBtn.addEventListener('click', align);
  downloadCsvBtn.addEventListener('click', function () {
    if (alignCsv) downloadText('bilingual-align.csv', alignCsv, 'text/csv;charset=utf-8');
  });

  // 默认两个锚点行
  addAnchorRow('00:00:01,000', '00:00:02,000');
  addAnchorRow('00:00:12,000', '00:00:15,000');
})();
