/* KCM積算ツール UI */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const AUTOSAVE_KEY = 'sekisan-autosave-v1';

  let currentTree = null;
  let currentIssues = null;
  let currentRows = null;
  let currentSourceText = null;
  let currentSourceName = null;
  let autosaveTimer = null;

  // ---------- 入力の読み込み ----------

  async function pdfToText(arrayBuffer) {
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = new Map();
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        let key = null;
        for (const k of rows.keys()) { if (Math.abs(k - y) < 2.5) { key = k; break; } }
        if (key == null) { key = y; rows.set(key, []); }
        rows.get(key).push({ x, w: item.width || 0, s: item.str });
      }
      const ys = Array.from(rows.keys()).sort((a, b) => b - a);
      for (const y of ys) {
        const items = rows.get(y).sort((a, b) => a.x - b.x);
        let line = '';
        let prevEnd = null;
        for (const it of items) {
          if (prevEnd == null) line += '\t' + it.s;
          else {
            const gap = it.x - prevEnd;
            line += (gap > 7 ? '\t' : gap > 1 ? ' ' : '') + it.s;
          }
          prevEnd = it.x + it.w;
        }
        out.push(line);
      }
      out.push('');
    }
    return out.join('\n');
  }

  async function xlsxToText(arrayBuffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);
    const out = [];
    wb.eachSheet((ws) => {
      ws.eachRow({ includeEmpty: false }, (row) => {
        const cells = [];
        for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
        out.push(cells.join('\t'));
      });
      out.push('');
    });
    return out.join('\n');
  }

  function cellText(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((t) => t.text).join('');
      if (v.text) return String(v.text);
      if (v.result != null) return String(v.result);
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return '';
    }
    return String(v);
  }

  async function handleFile(file) {
    setStatus(`読み込み中… ${file.name}`);
    try {
      if (/\.json$/i.test(file.name)) { await loadProject(file); return; }
      const buf = await file.arrayBuffer();
      let text;
      if (/\.pdf$/i.test(file.name)) text = await pdfToText(buf);
      else if (/\.(xlsx|xlsm)$/i.test(file.name)) text = await xlsxToText(buf);
      else text = new TextDecoder('utf-8').decode(buf);
      processText(text, file.name, null);
    } catch (e) {
      console.error(e);
      setStatus(`読み込みに失敗しました: ${e.message}`, true);
    }
  }

  // ---------- 解析 ----------

  function processText(text, sourceName, savedRows) {
    const parsed = SekisanParser.parseText(text);
    if (!parsed.records.length) {
      setStatus('入力データリストの行を検出できませんでした。ファイル形式をご確認ください。', true);
      return;
    }
    currentTree = SekisanParser.buildTree(parsed);
    currentIssues = SekisanParser.runChecks(currentTree);
    currentSourceText = text;
    currentSourceName = sourceName;
    const freshRows = SekisanModel.buildRows(currentTree, currentIssues);
    if (savedRows && savedRows.length === freshRows.length) {
      currentRows = savedRows;
    } else {
      if (savedRows) setStatus('保存時と行構成が変わっていたため、編集内容の一部は引き継げませんでした。', true);
      currentRows = savedRows || freshRows;
    }
    renderAll();
    if (!savedRows) setStatus('');
  }

  // ---------- 表示 ----------

  function renderAll() {
    const t = currentTree;
    $('result').hidden = false;
    $('editorSec').hidden = false;
    $('meta').innerHTML = `
      <dl>
        <dt>読込元</dt><dd>${esc(currentSourceName || '-')}</dd>
        <dt>工事名</dt><dd>${esc(t.header.kojiName || '(取得できず)')}</dd>
        <dt>事業区分</dt><dd>${esc(t.header.jigyoKubun || '-')}</dd>
        <dt>工事区分</dt><dd>${esc(t.header.kojiKubun || '-')}</dd>
        <dt>当初/変更</dt><dd>${esc(t.header.stage)}</dd>
      </dl>`;
    const counts = {};
    for (const r of t.records) counts[r.kind] = (counts[r.kind] || 0) + 1;
    $('counts').textContent =
      `工事区分 ${counts['1'] || 0} ／ 工種 ${counts['2'] || 0} ／ 種別 ${counts['3'] || 0} ／ 細別 ${counts['4'] || 0}` +
      ` ／ 1次単価 ${(counts['6P'] || 0) + (counts['独自'] || 0) + (counts['市場'] || 0)}` +
      ` ／ 構成要素 ${(counts['労務'] || 0) + (counts['材料'] || 0) + (counts['損料'] || 0) + (counts['雑費'] || 0) + (counts['賃料'] || 0)}`;
    renderEditor();
    renderPending();
  }

  function selectHtml(cls, idx, field, options, value, allowEmpty) {
    const opts = (allowEmpty ? [''] : []).concat(options)
      .map((o) => `<option value="${esc(o)}"${o === value ? ' selected' : ''}>${o === '' ? '（未選択）' : esc(o)}</option>`)
      .join('');
    return `<select class="${cls}" data-i="${idx}" data-f="${field}">${opts}</select>`;
  }
  function editCell(idx, field, value, cls) {
    return `<td class="edit ${cls || ''}" contenteditable="plaintext-only" data-i="${idx}" data-f="${field}">${esc(value || '')}</td>`;
  }

  function renderEditor() {
    const body = [];
    currentRows.forEach((r, i) => {
      const cls = ['r-' + r.kind];
      if (r.flags.market) cls.push('f-market');
      if (r.flags.original) cls.push('f-orig');
      if (r.flags.disposal) cls.push('f-disp');
      if ((r.flags.unitIssue || r.flags.taniIssue) && !r.resolved) cls.push('f-issue');
      const indent = r.kind === 'section' ? (r.level - 1) : r.kind === 'price' ? 3.4 : r.kind === 'material' ? 4.4 : 3;

      let yakanCell;
      if (r.kind === 'saibetsu' && r.flags.market) {
        yakanCell = `<td class="yakan">${selectHtml('', i, 'yakan', ['○', '－'], r.yakan, true)}</td>`;
      } else {
        yakanCell = `<td class="yakan">${esc(r.yakan === '－' ? '' : r.yakan)}</td>`;
      }

      const contentCell = r.kind === 'section'
        ? '<td></td>'
        : `<td>${selectHtml('', i, 'content', SekisanModel.CONTENT_LIST, r.content, true)}</td>`;
      const reasonCell = r.kind === 'section'
        ? '<td></td>'
        : `<td>${selectHtml('', i, 'reason', SekisanModel.REASON_LIST, r.reason, true)}</td>`;

      const resolveCell = (r.flags.unitIssue || r.flags.taniIssue)
        ? `<td class="resolve"><label><input type="checkbox" data-i="${i}" data-f="resolved"${r.resolved ? ' checked' : ''}>確認済</label></td>`
        : '<td></td>';

      body.push(
        `<tr id="row-${i}" class="${cls.join(' ')}">` +
        `<td class="nm" style="padding-left:${indent}em">${esc(r.name)}${r.kind === 'price' && r.spec ? `<br><small>${esc(r.spec)}</small>` : ''}</td>` +
        yakanCell +
        `<td class="num">${esc(String(r.taniSuryo || ''))}</td>` +
        `<td>${esc(r.unit || '')}</td>` +
        `<td class="num">${r.qty !== '' && r.qty != null ? Number(r.qty).toLocaleString() : ''}</td>` +
        editCell(i, 'qty2', r.qty2, 'num') +
        contentCell + reasonCell +
        editCell(i, 'measure', r.measure, 'wide') +
        editCell(i, 'remark', r.remark, '') +
        `<td class="code">${esc(r.code || '').replace(/\n/g, '<br>')}</td>` +
        resolveCell +
        '</tr>'
      );
    });
    $('editorBody').innerHTML = body.join('');
  }

  function renderPending() {
    const items = SekisanModel.pendingItems(currentRows);
    $('pendingCount').textContent = items.length;
    $('pendingBadge').classList.toggle('done', items.length === 0);
    $('pendingList').innerHTML = items.length
      ? items.map((it) => `<li><a href="#row-${it.index}" data-jump="${it.index}"><b>[${esc(it.type)}]</b> ${esc(it.label)}</a></li>`).join('')
      : '<li class="ok">すべての入力・確認が完了しています</li>';
  }

  function onEdit(idx, field, value) {
    const r = currentRows[idx];
    if (!r) return;
    if (field === 'resolved') r.resolved = !!value;
    else r[field] = value;
    renderPending();
    // 行の色状態を更新
    const tr = $('row-' + idx);
    if (tr) tr.classList.toggle('f-issue', !!(r.flags.unitIssue || r.flags.taniIssue) && !r.resolved);
    scheduleAutosave();
  }

  // ---------- 保存・復元 ----------

  function projectData() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      sourceName: currentSourceName,
      sourceText: currentSourceText,
      rows: currentRows,
    };
  }

  function saveProject() {
    if (!currentRows) return;
    const blob = new Blob([JSON.stringify(projectData())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = (currentTree.header.kojiName || '案件').replace(/[\\/:*?"<>|]/g, '_');
    a.download = `積算作業_${name}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    setStatus('作業ファイル(.json)を保存しました。次回はこのファイルを読み込むと続きから再開できます。');
  }

  async function loadProject(file) {
    const data = JSON.parse(await file.text());
    if (!data.sourceText || !data.rows) throw new Error('作業ファイルの形式が不正です');
    processText(data.sourceText, data.sourceName || file.name, data.rows);
    setStatus(`作業ファイルを復元しました（保存日時: ${data.savedAt ? data.savedAt.replace('T', ' ').slice(0, 16) : '不明'}）`);
  }

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(projectData())); } catch (e) { /* 容量超過等は無視 */ }
    }, 800);
  }

  function tryRestoreAutosave() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)); } catch (e) { return; }
    if (!data || !data.sourceText) return;
    const when = data.savedAt ? data.savedAt.replace('T', ' ').slice(0, 16) : '';
    const bar = $('restoreBar');
    bar.hidden = false;
    $('restoreInfo').textContent = `前回の作業（${data.sourceName || ''} ${when}）が残っています。`;
    $('restoreBtn').onclick = () => { bar.hidden = true; processText(data.sourceText, data.sourceName, data.rows); };
    $('restoreDismiss').onclick = () => { bar.hidden = true; localStorage.removeItem(AUTOSAVE_KEY); };
  }

  // ---------- 出力 ----------

  async function exportExcel() {
    if (!currentTree) return;
    setStatus('Excelを生成しています…');
    try {
      const wb = await SekisanGenerator.buildWorkbook(ExcelJS, currentTree, currentIssues, currentRows);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const name = (currentTree.header.kojiName || '積算ツール出力').replace(/[\\/:*?"<>|]/g, '_');
      a.download = `積算ツール出力_${name}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setStatus('Excelを出力しました。');
    } catch (e) {
      console.error(e);
      setStatus(`出力に失敗しました: ${e.message}`, true);
    }
  }

  // ---------- ユーティリティ ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function setStatus(msg, isError) {
    const el = $('status');
    el.textContent = msg;
    el.className = isError ? 'error' : '';
  }

  // ---------- イベント ----------

  window.addEventListener('DOMContentLoaded', () => {
    const drop = $('dropzone');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    $('fileInput').addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });
    $('parsePaste').addEventListener('click', () => {
      const text = $('pasteArea').value;
      if (text.trim()) processText(text, '貼り付けテキスト', null);
    });
    $('exportBtn').addEventListener('click', exportExcel);
    $('saveBtn').addEventListener('click', saveProject);

    const editor = $('editorBody');
    editor.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.f) onEdit(+t.dataset.i, t.dataset.f, t.type === 'checkbox' ? t.checked : t.value);
    });
    editor.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList && t.classList.contains('edit')) onEdit(+t.dataset.i, t.dataset.f, t.textContent);
    });
    $('pendingList').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-jump]');
      if (!a) return;
      e.preventDefault();
      const tr = $('row-' + a.dataset.jump);
      if (tr) { tr.scrollIntoView({ behavior: 'smooth', block: 'center' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1600); }
    });

    tryRestoreAutosave();
  });
})();
