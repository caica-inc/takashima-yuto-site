/* KCM積算ツール UI */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let currentTree = null;
  let currentIssues = null;

  // ---------- 入力の読み込み ----------

  async function pdfToText(arrayBuffer) {
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // y座標(ty)ごとに行へグルーピング
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
      const ys = Array.from(rows.keys()).sort((a, b) => b - a); // 上から下へ
      for (const y of ys) {
        const items = rows.get(y).sort((a, b) => a.x - b.x);
        let line = '';
        let prevEnd = null;
        for (const it of items) {
          if (prevEnd == null) {
            line += '\t' + it.s; // 行頭は区分列想定でタブを打つ
          } else {
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
        const last = row.cellCount;
        for (let c = 1; c <= last; c++) {
          const v = row.getCell(c).value;
          cells.push(cellText(v));
        }
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
      const buf = await file.arrayBuffer();
      let text;
      if (/\.pdf$/i.test(file.name)) text = await pdfToText(buf);
      else if (/\.(xlsx|xlsm)$/i.test(file.name)) text = await xlsxToText(buf);
      else text = new TextDecoder('utf-8').decode(buf);
      processText(text, file.name);
    } catch (e) {
      console.error(e);
      setStatus(`読み込みに失敗しました: ${e.message}`, true);
    }
  }

  // ---------- 解析と表示 ----------

  function processText(text, sourceName) {
    const parsed = SekisanParser.parseText(text);
    if (!parsed.records.length) {
      setStatus('入力データリストの行を検出できませんでした。ファイル形式をご確認ください。', true);
      return;
    }
    currentTree = SekisanParser.buildTree(parsed);
    currentIssues = SekisanParser.runChecks(currentTree);
    renderSummary(sourceName);
    setStatus('');
  }

  function renderSummary(sourceName) {
    const t = currentTree;
    $('result').hidden = false;
    $('meta').innerHTML = `
      <dl>
        <dt>読込元</dt><dd>${esc(sourceName || '-')}</dd>
        <dt>工事名</dt><dd>${esc(t.header.kojiName || '(取得できず)')}</dd>
        <dt>事業区分</dt><dd>${esc(t.header.jigyoKubun || '-')}</dd>
        <dt>工事区分</dt><dd>${esc(t.header.kojiKubun || '-')}</dd>
        <dt>当初/変更</dt><dd>${esc(t.header.stage)}</dd>
      </dl>`;

    const counts = {};
    for (const r of t.records) counts[r.kind] = (counts[r.kind] || 0) + 1;
    $('counts').textContent =
      `工事区分 ${counts['1'] || 0} ／ 工種 ${counts['2'] || 0} ／ 種別 ${counts['3'] || 0} ／ 細別 ${counts['4'] || 0}` +
      ` ／ 1次単価 ${(counts['6P'] || 0) + (counts['独自'] || 0) + (counts['市場'] || 0)}（うち独自 ${counts['独自'] || 0}）` +
      ` ／ 構成要素 ${(counts['労務'] || 0) + (counts['材料'] || 0) + (counts['損料'] || 0) + (counts['雑費'] || 0) + (counts['賃料'] || 0)}`;

    // ツリー
    const lines = [];
    const walk = (n, d) => {
      if (n.level >= 1) {
        const market = n.level === 4 && SekisanGenerator.isMarketPrice(n.rec);
        const orig = n.level === 4 && (n.prices || []).some((p) => SekisanGenerator.isOriginal(p.rec));
        lines.push(
          `<div class="tr lv${n.level}${market ? ' market' : ''}${orig ? ' orig' : ''}">` +
          `<span class="nm" style="padding-left:${(n.level - 1) * 1.2}em">${esc(n.name)}</span>` +
          `<span class="u">${esc(n.rec.unit || '')}</span>` +
          `<span class="q">${n.rec.qty != null ? n.rec.qty.toLocaleString() : ''}</span>` +
          `<span class="tag">${market ? '市場単価' : ''}${orig ? ' 独自歩掛' : ''}</span></div>`
        );
      }
      for (const c of n.children || []) walk(c, d + 1);
    };
    walk(t.root, 0);
    $('tree').innerHTML = lines.join('');

    // チェック
    const iss = currentIssues;
    $('issues').innerHTML = iss.length
      ? iss.map((i) => `<li><b>${esc(i.type)}</b> ${esc(i.path.replace(/^[^>]+> /, ''))}<br><small>${esc(i.detail)}</small></li>`).join('')
      : '<li class="ok">指摘事項はありません</li>';
    $('issueCount').textContent = iss.length;
  }

  // ---------- 出力 ----------

  async function exportExcel() {
    if (!currentTree) return;
    setStatus('Excelを生成しています…');
    try {
      const wb = await SekisanGenerator.buildWorkbook(ExcelJS, currentTree, currentIssues);
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const name = (currentTree.header.kojiName || '積算ツール出力').replace(/[\\/:*?"<>|]/g, '_');
      a.download = `積算ツール出力_${name}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setStatus('Excelを出力しました。');
    } catch (e) {
      console.error(e);
      setStatus(`出力に失敗しました: ${e.message}`, true);
    }
  }

  // ---------- ユーティリティ ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    $('fileInput').addEventListener('change', (e) => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    });
    $('parsePaste').addEventListener('click', () => {
      const text = $('pasteArea').value;
      if (text.trim()) processText(text, '貼り付けテキスト');
    });
    $('exportBtn').addEventListener('click', exportExcel);
  });
})();
