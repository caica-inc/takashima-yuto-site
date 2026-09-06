/*
 * 設計積算条件リストの「行モデル」
 * 解析ツリーから編集画面・Excel出力の両方で使う行データを組み立てる。
 * 編集画面での修正はこの行モデルに反映され、Excel出力はここから生成する。
 */
(function (global) {
  'use strict';

  const CONTENT_LIST = ['歩掛かりの選定', '材料単価', '機械損料', '新規追加', '変更無し', '数量精査', '数量ゼロ', '処分費'];
  const REASON_LIST = [
    '積算基準書(赤本)どおり', '独自歩掛', '工事費調査', '橋梁架設工事の積算どおり', '見積書',
    '工事費調査中', '工事費調査中ダミー計上', '局統一単価', '局特別単価', '物価版資料',
    '工事費調査(資材)', '見積り単価', '賃料', '再資源化施設の処分費（H24.4版）による', '資材調査価格', '資材調査中', '機械経費本',
  ];

  function isMarketPrice(rec) {
    return !!(rec && rec.meta && rec.meta.code && /^WB[78]/.test(rec.meta.code));
  }
  function isOriginal(rec) {
    return !!rec && (rec.kind === '独自' || (rec.meta && rec.meta.code && /^WY/.test(rec.meta.code)) || /ダミー/.test(rec.name || ''));
  }
  function isDisposal(rec) {
    return !!rec && /処分/.test(rec.name || '');
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

  /**
   * ツリー → 行モデル
   * 行: {kind, level, name, spec, yakan, taniSuryo, unit, qty, qty2,
   *      content, reason, measure, remark, code,
   *      flags:{market, original, disposal, unitIssue, taniIssue}}
   */
  function buildRows(tree, issues) {
    const rows = [];
    const issuePaths = new Set((issues || []).map((i) => i.path + '::' + i.type));
    const hasIssue = (path, type) => issuePaths.has(path + '::' + type);

    const walk = (node, path) => {
      const p = path.concat(node.name);
      if (node.level >= 1 && node.level <= 3) {
        rows.push({
          kind: 'section', level: node.level, name: node.name, spec: '',
          yakan: '', taniSuryo: '', unit: node.rec.unit || '式',
          qty: node.rec.qty != null ? node.rec.qty : 1, qty2: '',
          content: '', reason: '', measure: '', remark: '', code: '',
          flags: {},
        });
      }
      if (node.level === 4) {
        const rec = node.rec;
        const market = isMarketPrice(rec);
        rows.push({
          kind: 'saibetsu', level: 4, name: node.name, spec: rec.spec || '',
          yakan: rec.meta && rec.meta.ikkatsu === '50' ? '○' : (market ? '' : '－'),
          taniSuryo: rec.meta && rec.meta.tani_suryo ? rec.meta.tani_suryo : '',
          unit: rec.unit || '', qty: rec.qty != null ? rec.qty : '', qty2: '',
          content: '', reason: '', measure: '', remark: rec.spec || '', code: codeText(rec),
          flags: {
            market,
            unitIssue: hasIssue(p.join(' > '), '単位不一致'),
            taniIssue: hasIssue(p.join(' > '), '単位数量不一致'),
          },
        });
        for (const price of node.prices || []) {
          const pr = price.rec;
          const original = isOriginal(pr);
          rows.push({
            kind: 'price', level: 5, name: pr.name, spec: pr.spec || '',
            yakan: '', taniSuryo: '', unit: pr.unit || '',
            qty: pr.qty != null ? pr.qty : '', qty2: '',
            content: '歩掛かりの選定',
            reason: original ? '独自歩掛' : '積算基準書(赤本)どおり',
            measure: condsText(pr),
            remark: pr.meta && pr.meta.tanka_hyo ? `第${pr.meta.tanka_hyo}号単価表` : (pr.meta && pr.meta.tanka_nashi ? '単価表なし' : ''),
            code: codeText(pr),
            flags: { market: isMarketPrice(pr), original },
          });
          for (const comp of price.comps || []) {
            if (comp.kind !== '材料') continue;
            const nm = (comp.name || '').split(/\s+/);
            const disposal = isDisposal(comp);
            rows.push({
              kind: 'material', level: 6, name: nm[0], spec: '',
              yakan: '', taniSuryo: comp.meta && comp.meta.zairyo_hosei ? comp.meta.zairyo_hosei : '',
              unit: comp.unit || '%', qty: comp.ratio != null ? comp.ratio : '', qty2: '',
              content: disposal ? '処分費' : '材料単価', reason: '',
              measure: '', remark: nm.slice(1).join(' '), code: codeText(comp),
              flags: { disposal: disposal || /^Z[9X]/.test((comp.meta && comp.meta.code) || '') },
            });
          }
        }
      }
      for (const ch of node.children || []) walk(ch, p);
    };
    walk(tree.root, []);
    return rows;
  }

  /** 要入力・要確認の残件を数える */
  function pendingItems(rows) {
    const items = [];
    rows.forEach((r, i) => {
      if (r.kind === 'saibetsu' && r.flags.market && !r.yakan) {
        items.push({ index: i, type: '夜間確認', label: `${r.name} … 市場単価。夜間作業の有無を確認して○/－を選択` });
      }
      if (r.kind === 'price' && r.flags.original && !r.measure.trim()) {
        items.push({ index: i, type: '独自歩掛', label: `${r.name} … 独自歩掛。設計の考え方及び措置を入力` });
      }
      if (r.kind === 'material' && r.flags.disposal && !r.measure.trim()) {
        items.push({ index: i, type: '処分費', label: `${r.name} … 処分場・単価の出典を入力` });
      }
      if (r.kind === 'saibetsu' && (r.flags.unitIssue || r.flags.taniIssue) && !r.resolved) {
        items.push({ index: i, type: '不一致確認', label: `${r.name} … 単位/単位数量の不一致。確認したら行のチェックを入れる` });
      }
    });
    return items;
  }

  const api = { buildRows, pendingItems, isMarketPrice, isOriginal, CONTENT_LIST, REASON_LIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SekisanModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
