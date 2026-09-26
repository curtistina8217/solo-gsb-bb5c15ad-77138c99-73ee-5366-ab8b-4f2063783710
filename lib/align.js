'use strict';

const { parseSrt } = require('./srt');
const { formatMs } = require('./time');
const { convertSrt } = require('./convert');

// 单次对齐的 DP 格子数上限（n*m），防止超长字幕把内存吃光
const MAX_CELLS = 20000000;

// DP 回溯动作：1=跳过主轨条目，2=跳过副轨条目，3=两轨配对
const ACT_SKIP_MAIN = 1;
const ACT_SKIP_SEC = 2;
const ACT_MATCH = 3;

/** 两条字幕时间区间的交叠毫秒数；返回值 <= 0 表示无交叠。 */
function overlapMs(a, b) {
  return Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
}

/**
 * 候选方案择优：交叠毫秒总和最大；平分时起点差总和较小；
 * 再平分时配对序号（i+j）总和较小，即序号靠前的配对优先。
 */
function better(o, d, e, bo, bd, be) {
  return o > bo || (o === bo && d < bd) || (o === bo && d === bd && e < be);
}

/**
 * 顺序保持的动态规划对齐：
 * dp[i][j] 表示主轨前 i 条、副轨前 j 条的最优方案，
 * 可以跳过任一侧条目；配对只允许交叠 > 0 且严格一对一。
 * 分数只需上一行，动作用 Uint8Array 全量保存供回溯，内存 O(n*m) 字节。
 * 返回 { pairs:[[mainIdx, secIdx, overlap]], unmatchedMain:[idx], unmatchedSecondary:[idx] }。
 */
function alignEntries(main, secondary) {
  const n = main.length;
  const m = secondary.length;
  if (n * m > MAX_CELLS) {
    return {
      error: `两轨条目数量过多（主轨 ${n} 条、副轨 ${m} 条），超出单次对齐上限，请拆分后再试`,
    };
  }

  const w = m + 1;
  const actions = new Uint8Array((n + 1) * w);
  for (let j = 1; j <= m; j++) actions[j] = ACT_SKIP_SEC;
  for (let i = 1; i <= n; i++) actions[i * w] = ACT_SKIP_MAIN;

  // 三个分数分量：O=交叠总和（最大） D=起点差绝对值总和（最小） E=配对序号总和（最小）
  let prevO = new Float64Array(w);
  let prevD = new Float64Array(w);
  let prevE = new Float64Array(w);

  for (let i = 1; i <= n; i++) {
    const curO = new Float64Array(w);
    const curD = new Float64Array(w);
    const curE = new Float64Array(w);
    for (let j = 1; j <= m; j++) {
      // 候选 1：跳过主轨第 i 条
      let bestO = prevO[j];
      let bestD = prevD[j];
      let bestE = prevE[j];
      let bestAct = ACT_SKIP_MAIN;

      // 候选 2：跳过副轨第 j 条
      if (better(curO[j - 1], curD[j - 1], curE[j - 1], bestO, bestD, bestE)) {
        bestO = curO[j - 1];
        bestD = curD[j - 1];
        bestE = curE[j - 1];
        bestAct = ACT_SKIP_SEC;
      }

      // 候选 3：主轨第 i 条与副轨第 j 条配对（交叠必须严格大于 0）
      const ov = overlapMs(main[i - 1], secondary[j - 1]);
      if (ov > 0) {
        const o3 = prevO[j - 1] + ov;
        const d3 = prevD[j - 1] + Math.abs(main[i - 1].startMs - secondary[j - 1].startMs);
        const e3 = prevE[j - 1] + i + j;
        if (better(o3, d3, e3, bestO, bestD, bestE)) {
          bestO = o3;
          bestD = d3;
          bestE = e3;
          bestAct = ACT_MATCH;
        }
      }

      curO[j] = bestO;
      curD[j] = bestD;
      curE[j] = bestE;
      actions[i * w + j] = bestAct;
    }
    prevO = curO;
    prevD = curD;
    prevE = curE;
  }

  // 回溯配对
  const pairRev = [];
  const matchedMain = new Set();
  const matchedSec = new Set();
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    switch (actions[i * w + j]) {
      case ACT_MATCH:
        pairRev.push([i - 1, j - 1, overlapMs(main[i - 1], secondary[j - 1])]);
        matchedMain.add(i - 1);
        matchedSec.add(j - 1);
        i--;
        j--;
        break;
      case ACT_SKIP_MAIN:
        i--;
        break;
      case ACT_SKIP_SEC:
        j--;
        break;
      default:
        i = 0;
        j = 0;
    }
  }

  const pairs = pairRev.reverse();
  const unmatchedMain = [];
  const unmatchedSecondary = [];
  for (let k = 0; k < n; k++) if (!matchedMain.has(k)) unmatchedMain.push(k);
  for (let k = 0; k < m; k++) if (!matchedSec.has(k)) unmatchedSecondary.push(k);
  return { pairs, unmatchedMain, unmatchedSecondary };
}

function serializeEntry(e) {
  return {
    index: e.index,
    start: formatMs(e.startMs),
    end: formatMs(e.endMs),
    text: e.text.join('\n'),
  };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 由对齐结果生成 CSV（含双方序号、时间、正文；未配对条目另一侧留空）。
 * 带 UTF-8 BOM，Excel 直接打开不乱码。
 */
function buildAlignCsv({ pairs, unmatchedMain, unmatchedSecondary }) {
  const rows = [
    ['主轨序号', '主轨开始', '主轨结束', '主轨正文', '副轨序号', '副轨开始', '副轨结束', '副轨正文'],
  ];
  pairs.forEach((p) => {
    rows.push([
      p.mainIndex, p.mainStart, p.mainEnd, p.mainText,
      p.secIndex, p.secStart, p.secEnd, p.secText,
    ]);
  });
  unmatchedMain.forEach((e) => {
    rows.push([e.index, e.start, e.end, e.text, '', '', '', '']);
  });
  unmatchedSecondary.forEach((e) => {
    rows.push(['', '', '', '', e.index, e.start, e.end, e.text]);
  });
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * 对齐主入口：
 * 1. 复用 /api/convert 的 convertSrt 得到校正后主轨（失败则原样透传错误）；
 * 2. 复用 parseSrt 解析成片时间轴上的副轨 SRT；
 * 3. 两轨做顺序保持 DP 对齐。
 * 副轨解析失败时返回 secondaryParseErrors，但仍附带校正后主轨 srt，不影响主轨导出。
 */
function alignSrt(mainText, rawAnchors, secondaryText) {
  const converted = convertSrt(mainText, rawAnchors);
  if (!converted.ok) return converted;

  const mainView = converted.entries;
  const srt = converted.srt;

  // 校正后的主轨 SRT 经同一解析器回到毫秒结构
  const mainParsed = parseSrt(srt);
  if (mainParsed.errors.length || !mainParsed.entries.length) {
    return { ok: false, parseErrors: mainParsed.errors.length ? mainParsed.errors : ['主轨校正结果无法解析'] };
  }

  if (typeof secondaryText !== 'string' || secondaryText.trim() === '') {
    return { ok: false, secondaryParseErrors: ['副轨 SRT 内容为空，请粘贴或上传成片时间轴上的字幕文件'], srt, entries: mainView };
  }

  const { entries: secondaryEntries, errors: secondaryErrors } = parseSrt(secondaryText);
  if (secondaryErrors.length) {
    return { ok: false, secondaryParseErrors: secondaryErrors, srt, entries: mainView };
  }
  if (!secondaryEntries.length) {
    return { ok: false, secondaryParseErrors: ['副轨未解析到任何字幕条目'], srt, entries: mainView };
  }

  const aligned = alignEntries(mainParsed.entries, secondaryEntries);
  if (aligned.error) {
    return { ok: false, errors: [aligned.error], srt, entries: mainView };
  }

  const pairs = aligned.pairs.map(([mi, si, ov]) => ({
    mainPos: mi,
    secPos: si,
    mainIndex: mainParsed.entries[mi].index,
    mainStart: formatMs(mainParsed.entries[mi].startMs),
    mainEnd: formatMs(mainParsed.entries[mi].endMs),
    mainText: mainParsed.entries[mi].text.join('\n'),
    secIndex: secondaryEntries[si].index,
    secStart: formatMs(secondaryEntries[si].startMs),
    secEnd: formatMs(secondaryEntries[si].endMs),
    secText: secondaryEntries[si].text.join('\n'),
    overlapMs: ov,
  }));

  const unmatchedMain = aligned.unmatchedMain.map((k) => ({ pos: k, ...serializeEntry(mainParsed.entries[k]) }));
  const unmatchedSecondary = aligned.unmatchedSecondary.map((k) => ({ pos: k, ...serializeEntry(secondaryEntries[k]) }));

  return {
    ok: true,
    entries: mainView,
    srt,
    pairs,
    unmatchedMain,
    unmatchedSecondary,
    csv: buildAlignCsv({ pairs, unmatchedMain, unmatchedSecondary }),
  };
}

module.exports = { alignEntries, alignSrt, buildAlignCsv, overlapMs };
