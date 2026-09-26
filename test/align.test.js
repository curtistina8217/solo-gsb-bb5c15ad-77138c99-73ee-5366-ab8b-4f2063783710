'use strict';

const assert = require('assert');
const { alignEntries, alignSrt, buildAlignCsv, overlapMs } = require('../lib/align');

function E(start, end, index) {
  return { index: index == null ? 0 : index, startMs: start, endMs: end, text: [] };
}

// 交叠毫秒数
assert.strictEqual(overlapMs(E(1000, 3000), E(2000, 4000)), 1000);
assert.strictEqual(overlapMs(E(1000, 3000), E(3000, 5000)), 0, '仅端点相接不算交叠');
assert.strictEqual(overlapMs(E(1000, 3000), E(4000, 5000)), -1000);

// 仅端点相接（交叠 = 0）不允许配对，两侧均未配对
{
  const r = alignEntries([E(1000, 3000, 1)], [E(3000, 5000, 1)]);
  assert.strictEqual(r.pairs.length, 0);
  assert.deepStrictEqual(r.unmatchedMain, [0]);
  assert.deepStrictEqual(r.unmatchedSecondary, [0]);
}

// 一对一：主轨一条覆盖副轨两条时只选交叠更大的那条
{
  const main = [E(0, 10000, 1)];
  const sec = [E(0, 2000, 1), E(1500, 9500, 2)];
  const r = alignEntries(main, sec);
  assert.strictEqual(r.pairs.length, 1);
  assert.deepStrictEqual(r.pairs[0], [0, 1, 8000]);
  assert.deepStrictEqual(r.unmatchedSecondary, [0]);
  assert.deepStrictEqual(r.unmatchedMain, []);
}

// 同样保持顺序、两侧都允许跳过
{
  // 主：  [1-3] [4-6] [7-9]
  // 副：        [4-6]       [10-11](不相交)
  const main = [E(1000, 3000, 1), E(4000, 6000, 2), E(7000, 9000, 3)];
  const sec = [E(4000, 6000, 1), E(10000, 11000, 2)];
  const r = alignEntries(main, sec);
  assert.deepStrictEqual(r.pairs.map((p) => [p[0], p[1]]), [[1, 0]]);
  assert.deepStrictEqual(r.unmatchedMain, [0, 2]);
  assert.deepStrictEqual(r.unmatchedSecondary, [1]);
}

// 交叠总和平分：取起点差总和较小的方案
{
  // 主：A[0-4] B[5-9] C[10-14]；副：X[3-6] Y[10-14]
  // 方案P (A,X)+(C,Y)：X 与 A 交叠 [3,4]=1、起点差 3；Y 与 C 交叠 4、起点差 0 → 交 5 / 差 3
  // 方案Q (B,X)+(C,Y)：X 与 B 交叠 [5,6]=1、起点差 2；Y 同上        → 交 5 / 差 2 → Q 胜
  const main = [E(0, 4000), E(5000, 9000), E(10000, 14000)];
  const sec = [E(3000, 6000), E(10000, 14000)];
  const r = alignEntries(main, sec);
  assert.deepStrictEqual(r.pairs.map((p) => [p[0], p[1]]), [[1, 0], [2, 1]]);
  assert.deepStrictEqual(r.unmatchedMain, [0]);
  assert.deepStrictEqual(r.unmatchedSecondary, []);
}

// 交叠、起点差均平分：取序号靠前的配对（配对序号 i+j 总和较小）
{
  // 主：A[0-6] B[6-12] C[20-26]；副：X[3-9] Y[20-26]
  // X 与 A、B 交叠均为 3，起点差均为 3；Y 只能配 C（交 6 差 0）
  // 方案P (A,X)+(C,Y)：序号和 (1+1)+(3+2)=7
  // 方案Q (B,X)+(C,Y)：序号和 (2+1)+(3+2)=8 → P 胜
  const main = [E(0, 6000), E(6000, 12000), E(20000, 26000)];
  const sec = [E(3000, 9000), E(20000, 26000)];
  const r = alignEntries(main, sec);
  assert.deepStrictEqual(r.pairs.map((p) => [p[0], p[1]]), [[0, 0], [2, 1]]);
  assert.deepStrictEqual(r.unmatchedMain, [1]);
}

// 一般的顺序匹配
{
  const main = [E(0, 5000), E(10000, 15000)];
  const sec = [E(1000, 6000), E(9000, 14000)];
  const r = alignEntries(main, sec);
  assert.deepStrictEqual(r.pairs.map((p) => [p[0], p[1]]), [[0, 0], [1, 1]]);
  assert.strictEqual(r.pairs[0][2], 4000);
}

// 空轨
assert.deepStrictEqual(alignEntries([], []).pairs, []);
assert.deepStrictEqual(alignEntries([E(0, 1000, 1)], []).unmatchedMain, [0]);

// ---------- alignSrt 端到端（复用 /api/convert 的校正结果作为主轨） ----------

const mainSrt = [
  '1',
  '00:00:01,000 --> 00:00:03,000',
  '你好',
  '',
  '2',
  '00:00:05,000 --> 00:00:07,000',
  '再见',
].join('\n');

const identityAnchors = [
  { src: '00:00:01,000', dst: '00:00:01,000' },
  { src: '00:00:07,000', dst: '00:00:07,000' },
];

// 正常对齐：主轨校正 SRT 仍返回，配对/未配对/CSV 齐全
{
  const secSrt = [
    '1',
    '00:00:01,200 --> 00:00:02,800',
    'Hello',
    '',
    '2',
    '00:00:09,000 --> 00:00:10,000',
    'No match',
  ].join('\n');
  const r = alignSrt(mainSrt, identityAnchors, secSrt);
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(r.srt.includes('你好'), '主轨校正 SRT 应保留');
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.pairs[0].mainIndex, 1);
  assert.strictEqual(r.pairs[0].secIndex, 1);
  assert.strictEqual(r.pairs[0].mainText, '你好');
  assert.strictEqual(r.pairs[0].secText, 'Hello');
  assert.strictEqual(r.pairs[0].overlapMs, 1600);
  assert.deepStrictEqual(r.unmatchedMain.map((e) => e.index), [2]);
  assert.deepStrictEqual(r.unmatchedSecondary.map((e) => e.index), [2]);
  assert.ok(r.csv.includes('主轨序号,主轨开始'));
  assert.ok(r.csv.includes('\uFEFF'), 'CSV 应带 UTF-8 BOM');
  assert.ok(r.csv.indexOf('你好') !== -1 && r.csv.indexOf('Hello') !== -1);
}

// 主轨经锚点平移后才能与成片时间轴上的副轨对上
{
  const shiftedAnchors = [
    { src: '00:00:01,000', dst: '00:00:03,000' },
    { src: '00:00:07,000', dst: '00:00:09,000' },
  ];
  const secSrt = '1\n00:00:03,200 --> 00:00:04,800\nHello\n';
  const r = alignSrt(mainSrt, shiftedAnchors, secSrt);
  assert.strictEqual(r.ok, true, JSON.stringify(r.secondaryParseErrors || r.errors));
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.pairs[0].mainStart, '00:00:03,000');
}

// 副轨为空 / 解析失败：给出 secondaryParseErrors，主轨 SRT 照常返回
{
  const r = alignSrt(mainSrt, identityAnchors, '');
  assert.strictEqual(r.ok, false);
  assert.ok(r.secondaryParseErrors.length >= 1);
  assert.ok(r.srt && r.srt.includes('你好'), '副轨无效不应影响主轨 SRT 导出');
}
{
  const r = alignSrt(mainSrt, identityAnchors, '这不是 SRT\n没有时间行');
  assert.strictEqual(r.ok, false);
  assert.ok(r.secondaryParseErrors.length >= 1);
  assert.ok(r.srt.includes('再见'));
}

// 主轨锚点无效：原样透传 convert 的错误形式
{
  const r = alignSrt(mainSrt, [{ src: 'x', dst: 'y' }], '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
  assert.strictEqual(r.ok, false);
  assert.ok(r.anchorErrors);
  assert.strictEqual(r.srt, undefined);
}

// CSV 转义：引号、逗号、换行
{
  const csv = buildAlignCsv({
    pairs: [{
      mainIndex: 1, mainStart: '00:00:01,000', mainEnd: '00:00:02,000', mainText: '甲,乙',
      secIndex: 1, secStart: '00:00:01,000', secEnd: '00:00:02,000', secText: 'He said "hi"\nbye',
    }],
    unmatchedMain: [{ index: 2, start: '00:00:03,000', end: '00:00:04,000', text: '丙' }],
    unmatchedSecondary: [],
  });
  assert.ok(csv.includes('"甲,乙"'), '逗号需加引号');
  assert.ok(csv.includes('"He said ""hi""\nbye"'), '引号需双写、换行保留在引号内');
  // 去掉引号内字段后再数列数（时间字段本身含逗号，已被引号包裹）
  const pairLine = csv.split('\r\n')[1].replace(/"[^"]*" /g, '""').replace(/"[^"]*"/g, '""');
  assert.strictEqual(pairLine.split(',').length, 8, '配对行应为 8 列');
}

console.log('对齐模块全部测试通过 ✔');
