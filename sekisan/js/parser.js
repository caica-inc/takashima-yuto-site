/*
 * 入力データリスト パーサ
 * 新土木工事積算システムが出力する「入力データリスト」(PDF / Excel変換 / テキスト)を
 * 構造化データに変換する。
 *
 * 行の種類(区分列):
 *   1〜4        … 工事区分・工種・種別・細別 の階層
 *   独自 (n)    … 独自歩掛かりの単価表 (WY○○○○○)
 *   6P (n)      … 1次単価 (施工歩掛。CB/WB等の基準書コード)
 *   市場 (n)    … 市場単価 (WB7/WB8系)
 *   労務/材料/損料/雑費 (n) … 構成要素 (R/Z/M/X系コード)
 * ページヘッダ(工事名・工事区分・区分…)は自動でスキップし、
 * 工事名・事業区分・当初/変更をメタ情報として拾う。
 */
(function (global) {
  'use strict';

  const LEVEL_KINDS = { '1': 1, '2': 2, '3': 3, '4': 4 };
  const COMP_KINDS = ['労務', '材料', '損料', '雑費', '機械', '歩掛', '賃料', '運賃'];

  // 区分トークン判定
  const ROW_START = new RegExp(
    '^(?:(\\d)|((?:6P|独自|市場|' + COMP_KINDS.join('|') + '))\\s*(?:\\((\\d+)\\))?)$'
  );

  const UNIT_RE = /^(式|ｍ３|ｍ２|ｍ|m3|m2|mm|m|ha|t|kg|L|ℓ|個|本|基|枚|組|箇所|ヶ所|か所|列|面|日|人日|人|回|台|門|径間|空m3|掛m2|掛ｍ２|袋|缶|束|双|部|冊|％|%)$/;
  const NUM_RE = /^-?[\d,]+(?:\.\d+)?$/;

  // 摘要欄・条件欄で拾うメタ情報
  const META_PATTERNS = {
    tanka_hyo: /第\s*(\d+)\s*号単価表/,
    tanka_nashi: /単価表なし/,
    code: /\b([A-Z]{1,2}[A-Z0-9]\d{5,7})\b/,
    ikkatsu: /一括割増率\s*(\d+)\s*%/,
    tani_suryo: /単位数量\s+([\d,.]+)/,
    tanka_tekiyo: /単価適用\s+([\d.]+)/,
    bukakari_tekiyo: /歩掛適用\s+([\d.]+)/,
    kikai_hosei: /機械補正\s+([\d.]+)/,
    zairyo_hosei: /材料補正\s+([\d.]+)(.*)$/m,
    hensyuko: /(\d{2}編\d{2}章\d{3}項)/,
    hyojun_tanka: /標準単価\s*\(?\s*([\d,.]+)\s*\)?/,
  };

  function parseNumber(s) {
    if (s == null) return null;
    const t = String(s).replace(/,/g, '').trim();
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    return parseFloat(t);
  }

  // 1レコード = 区分トークンで始まる一連の行(セル)群
  function newRecord(kind, sub) {
    return {
      kind,            // '1'..'4' | '独自' | '6P' | '市場' | '労務' | '材料' | '損料' | '雑費' | ...
      sub,             // (n) の n
      name: '',        // 名称(工種・種別・細別・歩掛名など)
      spec: '',        // 名称に続く規格・条件の要約行
      unit: '',
      qty: null,
      qty2: null,      // 変更後数量(前回/今回の2段がある場合)
      price: null,
      amount: null,
      ratio: null,     // 構成比率(%) … 労務/材料/損料/雑費
      ratioRef: null,  // ( ) 内の参考比率
      conds: [],       // {no:'Q01'|'J01', label, value}
      remarkLines: [], // 摘要欄の生テキスト
      meta: {},        // 摘要から抽出したメタ
      raw: [],
    };
  }

  const KNOWN_UNITS_INLINE = /(?:ｍ３|ｍ２|ｍ|m3|m2)\s*$/;

  function classifyCells(rec, cells) {
    // cells: 行内のタブ区切りセル(先頭の区分セルは除去済み)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i].trim();
      if (!c) continue;
      if (!rec.name) { rec.name = c.split('\n')[0].trim(); pushOverflow(rec, c); continue; }
      if (!rec.unit && UNIT_RE.test(c)) { rec.unit = normalizeUnit(c); continue; }
      if (rec.unit && rec.qty == null && NUM_RE.test(c)) { rec.qty = parseNumber(c); continue; }
      // 単価/金額セル: "305.6                 305,600" のように空白区切り
      const pm = c.match(/^(-?[\d,]+(?:\.\d+)?)\s{2,}(-?[\d,]+(?:\.\d+)?)$/);
      if (pm && rec.price == null) { rec.price = parseNumber(pm[1]); rec.amount = parseNumber(pm[2]); continue; }
      if (rec.qty != null && rec.price == null && NUM_RE.test(c)) { rec.price = parseNumber(c); continue; }
      pushOverflow(rec, c);
    }
  }

  function pushOverflow(rec, cellText) {
    // セル内の2行目以降・分類不能テキストは条件/摘要行として蓄積
    const lines = String(cellText).split('\n');
    for (let j = 0; j < lines.length; j++) {
      const ln = lines[j].trim();
      if (!ln) continue;
      if (j === 0 && ln === rec.name) continue;
      rec.remarkLines.push(ln);
    }
  }

  function normalizeUnit(u) {
    return u.replace('ｍ３', 'm3').replace('ｍ２', 'm2').replace('％', '%')
      .replace(/^ｍ$/, 'm').replace('掛ｍ２', '掛m2');
  }

  function finalizeRecord(rec) {
    const text = rec.remarkLines.join('\n');
    // Q/J条件
    const condRe = /([QJ]\d{2})\s+(\S[^\n]*?)(?:\s{2,}([^\n]*))?$/gm;
    let m;
    while ((m = condRe.exec(text)) !== null) {
      rec.conds.push({ no: m[1], label: (m[2] || '').trim(), value: (m[3] || '').trim() });
    }
    // メタ
    for (const key in META_PATTERNS) {
      const mm = text.match(META_PATTERNS[key]);
      if (mm) rec.meta[key] = mm[1] !== undefined ? mm[1] : true;
    }
    // 材料補正の後ろ書き(「４週８休以上」「日当り作業量」等)
    const zh = text.match(/材料補正\s+[\d.]+\s+(\S+)/);
    if (zh) rec.meta.hosei_note = zh[1];
    // 規格要約: 名称行直後の非条件・非摘要行
    const specLines = [];
    for (const ln of rec.remarkLines) {
      if (/^[QJ]\d{2}\s/.test(ln)) break;
      if (/単価表|単位数量|単価適用|歩掛適用|労務調整|超過-規制|一括割増率|機械補正|材料補正|管理費区分|標準単価|構成比率|工種区分|地区\s/.test(ln)) continue;
      // 行中に Q/J 条件が混ざっている場合は手前まで
      specLines.push(ln.split(/\s[QJ]\d{2}\s/)[0].trim());
      if (specLines.length >= 2) break;
    }
    rec.spec = specLines.join(' ');
    // 構成比率: 労務/材料/損料/雑費は qty が比率
    if (COMP_KINDS.indexOf(rec.kind) >= 0) {
      rec.ratio = rec.qty;
      const rm = text.match(/^\(?\s*([\d.]+)\s*\)?$/m);
      if (rm) rec.ratioRef = parseFloat(rm[1]);
      // "98.91\n(-17.61)" 型: ( )内は増減
    }
    // 工種区分(第3レベルに付く)
    const km = text.match(/工種区分\s+(\S+)/);
    if (km) rec.meta.koshu_kubun = km[1];
    const chiku = text.match(/地区\s+(\S+)/);
    if (chiku) rec.meta.chiku = chiku[1];
    return rec;
  }

  /**
   * タブ区切りテキスト(Excel変換 or PDF再構成)をレコード列にパースする
   * @returns {header, records}
   */
  function parseText(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const header = { kojiName: '', jigyoKubun: '', kojiKubun: '', stage: '当初' };
    const records = [];
    let cur = null;

    const flush = () => { if (cur) { records.push(finalizeRecord(cur)); cur = null; } };

    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      const cells = rawLine.split('\t').map((c) => c);
      // 先頭セルが空のことが多い(行頭タブ)。最初の非空セルを区分候補に。
      let idx = 0;
      while (idx < cells.length && !cells[idx].trim()) idx++;
      const first = idx < cells.length ? cells[idx].trim() : '';

      // ページヘッダ
      if (first === '工事名') {
        const rest = cells.slice(idx + 1).join(' ');
        const nm = rest.match(/^\s*(.+?)\s*\(\s*(当\s*初|変\s*更|第\s*\d+\s*回変更)\s*\)/);
        if (nm) { header.kojiName = nm[1].trim(); header.stage = nm[2].replace(/\s/g, ''); }
        else if (!header.kojiName) header.kojiName = rest.replace(/事業区分.*$/, '').trim();
        const jk = rest.match(/事業区分\s*\t?\s*(\S+)/);
        if (jk && !header.jigyoKubun) header.jigyoKubun = jk[1];
        continue;
      }
      if (first === '工事区分') {
        const rest = cells.slice(idx + 1).map((s) => s.trim()).filter(Boolean);
        if (rest[0] && !header.kojiKubun) header.kojiKubun = rest[0];
        continue;
      }
      if (first === '区分' || /^工事区分・工種/.test(first) || first === '摘 要' || first === '摘　要') continue;
      if (/^(単\s*位|数\s*量|単\s*価|前回／今回|入\s*力\s*条\s*件)/.test(first)) continue;

      // 区分トークン?
      const startM = first.match(ROW_START);
      if (startM) {
        flush();
        const kind = startM[1] || startM[2];
        cur = newRecord(kind, startM[3] ? parseInt(startM[3], 10) : null);
        classifyCells(cur, cells.slice(idx + 1));
        continue;
      }
      // 継続行
      if (cur) {
        // 継続行にもタブがあることがある("Q06 掘削費 ... ｍ３\t第 1号単価表 ...")
        for (const c of cells) {
          const t = c.trim();
          if (t) cur.remarkLines.push(t);
        }
      }
    }
    flush();
    return { header, records };
  }

  /** レコード列 → 階層ツリー */
  function buildTree(parsed) {
    const { header, records } = parsed;
    const root = { level: 0, name: header.kojiName || '(工事)', children: [], rec: null };
    const stack = [root];
    let currentSaibetsu = null;

    for (const rec of records) {
      if (LEVEL_KINDS[rec.kind]) {
        const level = LEVEL_KINDS[rec.kind];
        while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
        const node = { level, name: rec.name, rec, children: [], prices: [] };
        stack[stack.length - 1].children.push(node);
        stack.push(node);
        currentSaibetsu = level === 4 ? node : null;
      } else if (rec.kind === '独自' || rec.kind === '6P' || rec.kind === '市場') {
        const holder = currentSaibetsu || stack[stack.length - 1];
        if (holder.prices) holder.prices.push({ rec, comps: [] });
        else (holder.children = holder.children || []).push({ level: 5, name: rec.name, rec, children: [] });
      } else {
        // 労務/材料/損料/雑費 … 直前の単価の構成要素
        const holder = currentSaibetsu || stack[stack.length - 1];
        const prices = holder.prices || [];
        if (prices.length) prices[prices.length - 1].comps.push(rec);
      }
    }
    return { header, root, records };
  }

  /** 整合チェック(旧システムの赤色相当) */
  function runChecks(tree) {
    const issues = [];
    const walk = (node, path) => {
      if (node.level === 4 && node.prices && node.prices.length) {
        const baseUnit = node.rec ? node.rec.unit : '';
        for (const p of node.prices) {
          if (p.rec.kind === '6P' && p.rec.unit && baseUnit && p.rec.unit !== baseUnit) {
            issues.push({
              type: '単位不一致',
              path: path.concat(node.name).join(' > '),
              detail: `細別[${baseUnit}] と 1次単価[${p.rec.unit}] (${p.rec.name})`,
            });
          }
        }
        const tani = node.rec && node.rec.meta.tani_suryo ? parseNumber(node.rec.meta.tani_suryo) : null;
        const sum = node.prices
          .filter((p) => p.rec.kind === '6P' && p.rec.unit === baseUnit)
          .reduce((a, p) => a + (p.rec.qty || 0), 0);
        if (tani != null && sum > 0 && Math.abs(sum - tani) > 1e-9) {
          issues.push({
            type: '単位数量不一致',
            path: path.concat(node.name).join(' > '),
            detail: `単位数量 ${tani} に対し同一単位の1次単価数量合計 ${sum}`,
          });
        }
      }
      for (const ch of node.children || []) walk(ch, path.concat(node.name));
    };
    walk(tree.root, []);
    return issues;
  }

  const api = { parseText, buildTree, runChecks, parseNumber, normalizeUnit, UNIT_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SekisanParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
