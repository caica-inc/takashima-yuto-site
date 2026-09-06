/*
 * 帳票生成モジュール
 * パース済みの入力データリストから、旧「設計積算条件リスト作成システム Ver2.2.2」
 * (長野支店・矢野氏作成のExcel VBAツール) と同等の帳票を ExcelJS で生成する。
 *
 * 色分けルール(旧システム踏襲):
 *   オレンジ … 市場単価 (WB7〜/WB8〜) → 夜間作業の有無を確認して「○」
 *   赤       … 単位・単位数量の不一致(要確認)
 *   青       … 独自歩掛かり(内容・根拠の入力要)
 *   ピンク   … 登録材料・処分費(単価出典の入力要)
 */
(function (global) {
  'use strict';

  const COLORS = {
    orange: 'FFF4B084', // 市場単価
    red: 'FFFF7B7B',    // 単位・単位数量異常値
    blue: 'FF9DC3E6',   // 独自歩掛かり
    pink: 'FFF8CBDC',   // 登録材料・処分費
    head: 'FFD9D9D9',
    section: 'FFEDEDED',
  };

  const CONTENT_LIST = ['歩掛かりの選定', '材料単価', '機械損料', '新規追加', '変更無し', '数量精査', '数量ゼロ', '処分費'];
  const REASON_LIST = [
    '積算基準書(赤本)どおり', '独自歩掛', '工事費調査', '橋梁架設工事の積算どおり', '見積書',
    '工事費調査中', '工事費調査中ダミー計上', '局統一単価', '局特別単価', '物価版資料',
    '工事費調査(資材)', '見積り単価', '賃料', '再資源化施設の処分費（H24.4版）による', '資材調査価格', '資材調査中', '機械経費本',
  ];

  function isMarketPrice(rec) {
    return !!(rec.meta && rec.meta.code && /^WB[78]/.test(rec.meta.code));
  }
  function isOriginal(rec) {
    return rec.kind === '独自' || (rec.meta && rec.meta.code && /^WY/.test(rec.meta.code)) || /ダミー/.test(rec.name || '');
  }
  function isDisposal(rec) {
    return /処分/.test(rec.name || '');
  }
  function condsText(rec) {
    return (rec.conds || []).map((c) => `${c.no} ${c.label}${c.value ? '   ' + c.value : ''}`).join('\n');
  }
  function codeText(rec) {
    const parts = [];
    if (rec.meta && rec.meta.code) parts.push(rec.meta.code);
    if (rec.meta && rec.meta.hensyuko) parts.push(rec.meta.hensyuko);
    return parts.join('\n');
  }

  function border(cell) {
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    };
  }
  function fill(cell, argb) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  }

  /** ①設計積算条件リスト(行モデルから生成。編集画面での修正が反映される) */
  function buildJoukenListFromRows(wb, header, rows) {
    const ws = wb.addWorksheet('設計積算条件リスト', {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = [
      { width: 26 }, { width: 6 }, { width: 10 }, { width: 10 }, { width: 10 },
      { width: 9 }, { width: 7 }, { width: 10 }, { width: 10 },
      { width: 14 }, { width: 20 }, { width: 34 }, { width: 24 }, { width: 14 },
    ];
    ws.addRow(['設計積算条件リスト']).font = { size: 14, bold: true };
    ws.addRow([`工事名：　${header.kojiName}（${header.stage}）`]).font = { size: 11 };
    ws.addRow([]);
    const head = ws.addRow(['種　　別', '夜間○', '項　目　１', '項　目　２', '項　目　３', '単位数量', '単　位', '数　　量', '数　量\n(変更)', '内　　容', '根拠又は理由', '設計の考え方及び措置', '摘　　要', '基準書コード']);
    head.eachCell((c) => { c.font = { bold: true }; fill(c, COLORS.head); border(c); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];

    for (const r of rows) {
      const indent = r.kind === 'section' ? '' : r.kind === 'price' ? '　' : r.kind === 'material' ? '　　' : '';
      const name = indent + r.name + (r.kind === 'price' && r.spec ? '\n' + indent + r.spec : '');
      const row = ws.addRow([
        name, r.yakan === '－' ? '' : r.yakan, '', '', '',
        r.taniSuryo, r.unit, r.qty, r.qty2,
        r.content, r.reason, r.measure, r.remark, r.code,
      ]);
      row.eachCell({ includeEmpty: true }, (c, col) => {
        if (col > 14) return;
        border(c);
        c.alignment = { vertical: 'top', wrapText: true };
      });
      if (r.kind === 'section') {
        fill(row.getCell(1), COLORS.section);
        row.getCell(1).font = { bold: true };
        row.getCell(1).alignment = { vertical: 'top', wrapText: true, indent: Math.max(0, r.level - 1) };
      }
      if (r.kind === 'saibetsu') {
        row.getCell(1).font = { bold: true };
        if (r.flags.market) { fill(row.getCell(1), COLORS.orange); fill(row.getCell(2), COLORS.orange); }
        if (r.flags.unitIssue && !r.resolved) fill(row.getCell(7), COLORS.red);
        if (r.flags.taniIssue && !r.resolved) fill(row.getCell(6), COLORS.red);
      }
      if (r.kind === 'price') {
        if (r.flags.original) { fill(row.getCell(10), COLORS.blue); fill(row.getCell(11), COLORS.blue); }
        if (r.flags.market) fill(row.getCell(1), COLORS.orange);
      }
      if (r.kind === 'material' && r.flags.disposal) {
        fill(row.getCell(10), COLORS.pink); fill(row.getCell(11), COLORS.pink);
      }
    }

    const last = ws.rowCount;
    if (last > 5) {
      ws.dataValidations.add(`J5:J${last}`, { type: 'list', allowBlank: true, formulae: ['"' + CONTENT_LIST.join(',') + '"'] });
      ws.dataValidations.add(`K5:K${last}`, { type: 'list', allowBlank: true, formulae: ['"' + REASON_LIST.join(',') + '"'] });
    }
    ws.addRow([]);
    const legend = [
      ['市場単価（夜間作業の有無を確認して「○」）', COLORS.orange],
      ['単位・単位数量の不一致（要確認）', COLORS.red],
      ['独自歩掛かり（内容を確認して入力）', COLORS.blue],
      ['登録材料・処分費（単価出典を入力）', COLORS.pink],
    ];
    for (const [label, color] of legend) {
      const r = ws.addRow(['', label]);
      fill(r.getCell(1), color);
    }
    return ws;
  }

  /** ①設計積算条件リスト(旧: ツリー直接走査版。互換のため残置) */
  function buildJoukenList(wb, tree, issues) {
    const ws = wb.addWorksheet('設計積算条件リスト', {
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = [
      { width: 26 }, { width: 6 }, { width: 10 }, { width: 10 }, { width: 10 },
      { width: 9 }, { width: 7 }, { width: 10 }, { width: 10 },
      { width: 14 }, { width: 20 }, { width: 34 }, { width: 24 }, { width: 14 },
    ];
    ws.addRow(['設計積算条件リスト']).font = { size: 14, bold: true };
    ws.addRow([`工事名：　${tree.header.kojiName}（${tree.header.stage}）`]).font = { size: 11 };
    ws.addRow([]);
    const head = ws.addRow(['種　　別', '夜間○', '項　目　１', '項　目　２', '項　目　３', '単位数量', '単　位', '数　　量', '数　量\n(変更)', '内　　容', '根拠又は理由', '設計の考え方及び措置', '摘　　要', '基準書コード']);
    head.eachCell((c) => { c.font = { bold: true }; fill(c, COLORS.head); border(c); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];

    const issuePaths = new Set(issues.map((i) => i.path + '::' + i.type));
    const hasIssue = (path, type) => issuePaths.has(path + '::' + type);

    const addStyled = (values, opt) => {
      const row = ws.addRow(values);
      row.eachCell({ includeEmpty: true }, (c, col) => {
        if (col > 14) return;
        border(c);
        c.alignment = { vertical: 'top', wrapText: true };
      });
      return row;
    };

    const walk = (node, path) => {
      const p = path.concat(node.name);
      if (node.level >= 1 && node.level <= 3) {
        const row = addStyled([node.name, '', '', '', '', '', node.rec.unit || '式', node.rec.qty != null ? node.rec.qty : 1]);
        fill(row.getCell(1), COLORS.section);
        row.getCell(1).font = { bold: true };
        row.getCell(1).alignment = { vertical: 'top', wrapText: true, indent: Math.max(0, node.level - 1) };
      }
      if (node.level === 4) {
        const rec = node.rec;
        const market = isMarketPrice(rec);
        const yakan = rec.meta && rec.meta.ikkatsu === '50' ? '○' : '';
        const row = addStyled([
          node.name, yakan, '', '', '',
          rec.meta && rec.meta.tani_suryo ? rec.meta.tani_suryo : '',
          rec.unit, rec.qty, '',
          '', '', '', rec.spec || '', codeText(rec),
        ]);
        row.getCell(1).font = { bold: true };
        if (market) { fill(row.getCell(1), COLORS.orange); fill(row.getCell(2), COLORS.orange); }
        if (hasIssue(p.join(' > '), '単位不一致')) fill(row.getCell(7), COLORS.red);
        if (hasIssue(p.join(' > '), '単位数量不一致')) fill(row.getCell(6), COLORS.red);

        for (const price of node.prices || []) {
          const pr = price.rec;
          const original = isOriginal(pr);
          const prow = addStyled([
            '　' + pr.name + (pr.spec ? '\n　' + pr.spec : ''), '', '', '', '',
            '', pr.unit || '', pr.qty != null ? pr.qty : '', '',
            '歩掛かりの選定',
            original ? '独自歩掛' : '積算基準書(赤本)どおり',
            condsText(pr),
            pr.meta && pr.meta.tanka_hyo ? `第${pr.meta.tanka_hyo}号単価表` : (pr.meta && pr.meta.tanka_nashi ? '単価表なし' : ''),
            codeText(pr),
          ]);
          if (original) { fill(prow.getCell(10), COLORS.blue); fill(prow.getCell(11), COLORS.blue); }
          if (isMarketPrice(pr)) { fill(prow.getCell(1), COLORS.orange); }
          // 材料構成(軽油・生コン等)
          for (const comp of price.comps || []) {
            if (comp.kind !== '材料') continue;
            const nm = comp.name.split(/\s+/);
            const crow = addStyled([
              '　　' + nm[0], '', '', '', '',
              comp.meta && comp.meta.zairyo_hosei ? comp.meta.zairyo_hosei : '',
              comp.unit || '%', comp.ratio != null ? comp.ratio : '', '',
              isDisposal(comp) ? '処分費' : '材料単価',
              '', '', nm.slice(1).join(' '), codeText(comp),
            ]);
            if (isDisposal(comp) || /^Z[9X]/.test((comp.meta && comp.meta.code) || '')) {
              fill(crow.getCell(10), COLORS.pink); fill(crow.getCell(11), COLORS.pink);
            }
          }
        }
      }
      for (const ch of node.children || []) walk(ch, p);
    };
    walk(tree.root, []);

    // プルダウン(データの入力規則)
    const last = ws.rowCount;
    if (last > 5) {
      ws.dataValidations.add(`J5:J${last}`, { type: 'list', allowBlank: true, formulae: ['"' + CONTENT_LIST.join(',') + '"'] });
      ws.dataValidations.add(`K5:K${last}`, { type: 'list', allowBlank: true, formulae: ['"' + REASON_LIST.join(',') + '"'] });
    }
    // 凡例
    ws.addRow([]);
    const legend = [
      ['市場単価（夜間作業の有無を確認して「○」）', COLORS.orange],
      ['単位・単位数量の不一致（要確認）', COLORS.red],
      ['独自歩掛かり（内容を確認して入力）', COLORS.blue],
      ['登録材料・処分費（単価出典を入力）', COLORS.pink],
    ];
    for (const [label, color] of legend) {
      const r = ws.addRow(['', label]);
      fill(r.getCell(1), color);
    }
    return ws;
  }

  /** ⑤数量総括表 */
  function buildSoukatsu(wb, tree) {
    const ws = wb.addWorksheet('数量総括表', {
      pageSetup: { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.columns = [{ width: 8 }, { width: 12 }, { width: 14 }, { width: 22 }, { width: 30 }, { width: 8 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 20 }];
    ws.addRow(['数　量　総　括　表']).font = { size: 14, bold: true };
    ws.addRow([`工事名：　${tree.header.kojiName}`]).font = { size: 11 };
    ws.addRow([]);
    const isChange = /変更/.test(tree.header.stage);
    const head = ws.addRow(['工事区分', '工種', '種別', '細別', '規格', '単位', isChange ? '当初数量' : '数量', isChange ? '変更数量' : '', isChange ? '増減' : '', '摘要']);
    head.eachCell((c) => { c.font = { bold: true }; fill(c, COLORS.head); border(c); c.alignment = { horizontal: 'center', wrapText: true }; });
    ws.views = [{ state: 'frozen', ySplit: 4 }];

    const walk = (node) => {
      if (node.level >= 1) {
        const rec = node.rec;
        const vals = ['', '', '', '', '', rec.unit || '', '', '', '', ''];
        vals[node.level - 1] = node.name;
        if (node.level === 4) vals[4] = rec.spec || '';
        if (isChange) { vals[7] = rec.qty != null ? rec.qty : ''; }
        else { vals[6] = rec.qty != null ? rec.qty : ''; }
        const row = ws.addRow(vals);
        row.eachCell({ includeEmpty: true }, (c, col) => { if (col <= 10) { border(c); c.alignment = { vertical: 'top', wrapText: true }; } });
        if (node.level <= 2) row.getCell(node.level).font = { bold: true };
        if (isChange && node.level === 4) {
          row.getCell(9).value = { formula: `H${row.number}-G${row.number}` };
        }
      }
      for (const ch of node.children || []) walk(ch);
    };
    walk(tree.root);
    return ws;
  }

  /** ②交通誘導員集計 */
  function buildYuudou(wb, tree) {
    const ws = wb.addWorksheet('交通誘導員集計');
    ws.columns = [{ width: 24 }, { width: 24 }, { width: 30 }, { width: 8 }, { width: 12 }, { width: 16 }];
    ws.addRow(['交通誘導警備員　集計']).font = { size: 14, bold: true };
    ws.addRow([`工事名：　${tree.header.kojiName}`]);
    ws.addRow([]);
    const head = ws.addRow(['工種', '種別', '名称', '単位', '数量', '基準書コード']);
    head.eachCell((c) => { c.font = { bold: true }; fill(c, COLORS.head); border(c); });
    let found = 0;
    const walk = (node, lineage) => {
      const lin = node.level >= 1 ? lineage.concat([node]) : lineage;
      if (/誘導/.test(node.name || '')) {
        const koushu = lin.find((n) => n.level === 2);
        const shubetsu = lin.find((n) => n.level === 3);
        const r = ws.addRow([
          koushu ? koushu.name : '', shubetsu ? shubetsu.name : '', node.name,
          node.rec.unit, node.rec.qty, (node.rec.meta && node.rec.meta.code) || '',
        ]);
        r.eachCell({ includeEmpty: true }, (c, col) => { if (col <= 6) border(c); });
        found++;
      }
      for (const ch of node.children || []) walk(ch, lin);
    };
    walk(tree.root, []);
    if (!found) ws.addRow(['（交通誘導警備員の項目はありません）']);
    return ws;
  }

  /** チェック結果 */
  function buildChecks(wb, tree, issues) {
    const ws = wb.addWorksheet('チェック結果');
    ws.columns = [{ width: 16 }, { width: 60 }, { width: 50 }];
    ws.addRow(['自動チェック結果']).font = { size: 14, bold: true };
    ws.addRow([`工事名：　${tree.header.kojiName}（${tree.header.stage}）`]);
    ws.addRow([]);
    const head = ws.addRow(['種類', '箇所', '内容']);
    head.eachCell((c) => { c.font = { bold: true }; fill(c, COLORS.head); border(c); });
    if (!issues.length) {
      ws.addRow(['-', '指摘事項はありません', '']);
    }
    for (const i of issues) {
      const r = ws.addRow([i.type, i.path, i.detail]);
      r.eachCell({ includeEmpty: true }, (c, col) => { if (col <= 3) { border(c); c.alignment = { vertical: 'top', wrapText: true }; } });
      fill(r.getCell(1), COLORS.red);
    }
    return ws;
  }

  /**
   * ワークブックを生成する
   * @param ExcelJS ExcelJSモジュール
   * @param tree    SekisanParser.buildTree の結果
   * @param issues  SekisanParser.runChecks の結果
   */
  async function buildWorkbook(ExcelJS, tree, issues, rows) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KCM積算ツール';
    wb.created = new Date();
    if (rows) buildJoukenListFromRows(wb, tree.header, rows);
    else buildJoukenList(wb, tree, issues);
    buildSoukatsu(wb, tree);
    buildYuudou(wb, tree);
    buildChecks(wb, tree, issues);
    return wb;
  }

  const api = { buildWorkbook, isMarketPrice, isOriginal, COLORS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SekisanGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis);
