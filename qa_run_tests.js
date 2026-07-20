/**
 * QA 测试脚本 —— 税金计算浏览器扩展
 *
 * 测试策略（不修改用户源码）：
 *  1. 直接从 popup.js 提取真实函数源码（round2 / calcFromInclusive /
 *     calcFromExclusive / validate），并以 new Function 在同一作用域执行，
 *     断言跑的是「真正的源码逻辑」而非手写的副本。
 *  2. 校验公式文字与实现一致（证明测的是同一套逻辑）。
 *  3. 用最小 DOM stub 真实加载 popup.js（IIFE 会执行 init → recalculate），
 *     模拟点击「计算 / 切换模式」按钮，验证渲染输出与输入校验。
 *
 * 运行：node qa_run_tests.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, 'popup.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

// ===== 极小测试框架 =====
let pass = 0;
let fail = 0;
const failures = [];
const cases = []; // {input, expected, actual, ok}

function check(cond, msg, expected, actual) {
  const ok = !!cond;
  if (ok) pass++;
  else {
    fail++;
    failures.push({ msg, expected, actual });
  }
  cases.push({ msg, expected, actual, ok });
  return ok;
}

function eqNum(a, b, msg, tol = 1e-9) {
  check(Math.abs(a - b) <= tol, msg, b, a);
}
function eqStr(a, b, msg) {
  check(a === b, msg, b, a);
}

// ===== 从源码提取真实函数定义 =====
function extractFunction(source, name) {
  const idx = source.indexOf('function ' + name + '(');
  if (idx === -1) throw new Error('未找到函数定义: ' + name);
  const open = source.indexOf('{', idx);
  if (open === -1) throw new Error('函数缺少 { : ' + name);
  let depth = 0;
  let i = open;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return source.slice(idx, i);
}

const round2Src = extractFunction(SRC, 'round2');
const calcInSrc = extractFunction(SRC, 'calcFromInclusive');
const calcExSrc = extractFunction(SRC, 'calcFromExclusive');
const validateSrc = extractFunction(SRC, 'validate');

// 在隔离作用域内执行真实源码，拿到函数引用
const getFns = new Function(
  [round2Src, calcInSrc, calcExSrc, validateSrc].join('\n') +
    '\nreturn { round2, calcFromInclusive, calcFromExclusive, validate };'
);
const { round2, calcFromInclusive, calcFromExclusive, validate } = getFns();

// ===== 公式一致性校验（证明测的是同一套逻辑）=====
check(
  calcInSrc.includes('inclusive / (1 + rate)'),
  'calcFromInclusive 含公式 inclusive / (1 + rate)',
  true,
  calcInSrc.includes('inclusive / (1 + rate)')
);
check(
  calcInSrc.includes('inclusive - exclusive'),
  'calcFromInclusive 含公式 inclusive - exclusive',
  true,
  calcInSrc.includes('inclusive - exclusive')
);
check(
  calcExSrc.includes('exclusive * (1 + rate)'),
  'calcFromExclusive 含公式 exclusive * (1 + rate)',
  true,
  calcExSrc.includes('exclusive * (1 + rate)')
);
check(
  calcExSrc.includes('exclusive * rate'),
  'calcFromExclusive 含公式 exclusive * rate',
  true,
  calcExSrc.includes('exclusive * rate')
);
check(
  round2Src.includes('Math.round((value + Number.EPSILON) * 100) / 100'),
  'round2 使用 EPSILON 规避浮点误差',
  true,
  round2Src.includes('Math.round((value + Number.EPSILON) * 100) / 100')
);

// ===== 已知样例 =====
(function knownSamples() {
  const r = calcFromInclusive(113, 0.13);
  eqNum(r.exclusive, 100, '含税113/13% → 不含税=100');
  eqNum(r.tax, 13, '含税113/13% → 税额=13');

  const r2 = calcFromExclusive(100, 0.13);
  eqNum(r2.inclusive, 113, '不含税100/13% → 含税=113');
  eqNum(r2.tax, 13, '不含税100/13% → 税额=13');
})();

// ===== 多税率（百分比数值 → /100）=====
(function multiRate() {
  // 含税 → 不含税
  const inc = [
    [101, 0.01, 100, 1],
    [103, 0.03, 100, 3],
    [106, 0.06, 100, 6],
    [109, 0.09, 100, 9],
    [105, 0.05, 100, 5], // 自定义 5%
    [201.5, 0.015, 198.52, 2.98], // 自定义 1.5%
  ];
  for (const [inc_, rate, exExp, taxExp] of inc) {
    const r = calcFromInclusive(inc_, rate);
    eqNum(r.exclusive, exExp, `含税${inc_}/${rate * 100}% → 不含税=${exExp}`);
    eqNum(r.tax, taxExp, `含税${inc_}/${rate * 100}% → 税额=${taxExp}`);
  }
  // 不含税 → 含税
  const exc = [
    [100, 0.01, 101, 1],
    [100, 0.03, 103, 3],
    [100, 0.06, 106, 6],
    [100, 0.09, 109, 9],
    [100, 0.05, 105, 5],
    [100, 0.015, 101.5, 1.5],
    [100, 0, 100, 0], // 自定义 0%
  ];
  for (const [ex, rate, incExp, taxExp] of exc) {
    const r = calcFromExclusive(ex, rate);
    eqNum(r.inclusive, incExp, `不含税${ex}/${rate * 100}% → 含税=${incExp}`);
    eqNum(r.tax, taxExp, `不含税${ex}/${rate * 100}% → 税额=${taxExp}`);
  }
})();

// ===== 边界：金额 0 / 税率 0 =====
(function boundary() {
  const z1 = calcFromInclusive(0, 0.13);
  eqNum(z1.exclusive, 0, '含税0/13% → 不含税=0');
  eqNum(z1.tax, 0, '含税0/13% → 税额=0');

  const z2 = calcFromExclusive(0, 0.13);
  eqNum(z2.inclusive, 0, '不含税0/13% → 含税=0');
  eqNum(z2.tax, 0, '不含税0/13% → 税额=0');

  const r1 = calcFromInclusive(50, 0); // 税率 0
  eqNum(r1.exclusive, 50, '含税50/0% → 不含税=50');
  eqNum(r1.tax, 0, '含税50/0% → 税额=0');

  const r2 = calcFromExclusive(50, 0);
  eqNum(r2.inclusive, 50, '不含税50/0% → 含税=50');
  eqNum(r2.tax, 0, '不含税50/0% → 税额=0');
})();

// ===== 四舍五入边界：含税 100/3% =====
(function rounding() {
  const r = calcFromInclusive(100, 0.03);
  // 100 / 1.03 = 97.08737864...  → 97.09
  eqNum(r.exclusive, 97.09, '含税100/3% → 不含税=97.09');
  // 100 - 97.08737864... = 2.91262136... → 2.91
  eqNum(r.tax, 2.91, '含税100/3% → 税额=2.91');
  // 不含税+税额 应还原为含税（2 位精度内）
  eqNum(r.exclusive + r.tax, 100, '含税100/3% → 不含税+税额=含税');

  const r2 = calcFromInclusive(1000, 0.03);
  eqNum(r2.exclusive, 970.87, '含税1000/3% → 不含税=970.87');
  eqNum(r2.tax, 29.13, '含税1000/3% → 税额=29.13');

  // round2 保留 2 位
  eqNum(round2(2.005), 2.01, 'round2(2.005) 保留2位 (四舍五入进位→2.01)');
  eqNum(round2(97.0873786), 97.09, 'round2(97.0873786)=97.09');
})();

// ===== 校验函数（非法输入应被拦截）=====
(function validation() {
  eqStr(validate(NaN, 0.13), '请输入有效的金额', 'validate(NaN) → 提示金额');
  eqStr(validate(-5, 0.13), '金额必须为非负数', 'validate(-5) → 提示非负');
  eqStr(validate(100, NaN), '请输入有效的税率（≥ 0）', 'validate(rate=NaN) → 提示税率');
  eqStr(validate(100, -0.05), '请输入有效的税率（≥ 0）', 'validate(rate<0) → 提示税率');
  check(validate(0, 0) === null, 'validate(0, 0) → 通过', null, validate(0, 0));
  check(validate(100, 0.13) === null, 'validate(100, 0.13) → 通过', null, validate(100, 0.13));
})();

// ===== DOM stub 集成测试：真实加载 popup.js =====
(function domIntegration() {
  const elements = {};
  function makeEl() {
    return {
      _h: {},
      textContent: '',
      hidden: true,
      value: '',
      placeholder: '',
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {},
      getAttribute() {
        return null;
      },
      removeAttribute() {},
      addEventListener(type, fn) {
        this._h[type] = fn;
      },
      focus() {},
    };
  }
  function getEl(id) {
    return elements[id] || (elements[id] = makeEl());
  }
  const fakeDocument = { getElementById: getEl };

  // 真实执行源码（IIFE 会执行 init → 绑定事件 → recalculate）
  const runner = new Function('document', SRC);
  runner(fakeDocument);

  // 用例 A：含税 113 / 13%
  elements['amount-input'].value = '113';
  elements['rate-select'].value = '13';
  elements['calc-btn']._h['click']();
  eqStr(elements['result-main'].textContent, '100.00 元', 'DOM 含税113/13% → 主结果 不含税=100.00 元');
  eqStr(elements['result-tax'].textContent, '13.00 元', 'DOM 含税113/13% → 税额=13.00 元');
  check(elements['error-msg'].hidden === true, 'DOM 合法输入 → 错误提示隐藏', true, elements['error-msg'].hidden);

  // 用例 B：切换到「不含税 → 含税」，金额 100 / 13%
  elements['amount-input'].value = '100';
  elements['rate-select'].value = '13';
  elements['mode-exclusive']._h['click'](); // setMode('exclusive') + recalculate
  eqStr(elements['result-main'].textContent, '113.00 元', 'DOM 不含税100/13% → 主结果 含税=113.00 元');
  eqStr(elements['result-tax'].textContent, '13.00 元', 'DOM 不含税100/13% → 税额=13.00 元');

  // 用例 C：非法输入（负金额）
  elements['amount-input'].value = '-5';
  elements['rate-select'].value = '13';
  elements['calc-btn']._h['click']();
  eqStr(elements['error-msg'].textContent, '金额必须为非负数', 'DOM 负金额 → 错误提示');
  check(elements['error-msg'].hidden === false, 'DOM 负金额 → 错误提示显示', false, elements['error-msg'].hidden);
  eqStr(elements['result-main'].textContent, '—', 'DOM 负金额 → 主结果重置为 —');
})();

// ===== 静态检查：DOM id 与 getElementById 一致性 =====
(function staticCheck() {
  const html = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
  const idsInHtml = new Set();
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) idsInHtml.add(m[1]);

  const expectIds = [
    'mode-inclusive', 'mode-exclusive', 'amount-label', 'amount-input',
    'rate-select', 'rate-custom', 'error-msg', 'calc-btn',
    'result-main-label', 'result-sub-label', 'result-main', 'result-sub', 'result-tax',
  ];
  let allMatch = true;
  for (const id of expectIds) {
    if (!idsInHtml.has(id)) {
      allMatch = false;
      failures.push({ msg: 'HTML 缺少 id: ' + id, expected: id, actual: '缺失' });
    }
  }
  check(allMatch, 'popup.html 含全部 13 个所需 id', true, allMatch);

  // manifest → popup.html → css/js 引用
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  check(manifest.action.default_popup === 'popup.html', 'manifest default_popup 指向 popup.html', 'popup.html', manifest.action.default_popup);
  check(html.includes('href="popup.css"'), 'popup.html 引用 popup.css', true, html.includes('href="popup.css"'));
  check(html.includes('src="popup.js"'), 'popup.html 引用 popup.js', true, html.includes('src="popup.js"'));
})();

// ===== 输出报告 =====
const total = pass + fail;
const rate = total === 0 ? 0 : (pass / total) * 100;

console.log('\n================ QA 测试报告 ================');
console.log(`通过: ${pass} / 总数: ${total}  (通过率: ${rate.toFixed(1)}%)`);
if (fail > 0) {
  console.log('\n--- 失败用例 ---');
  for (const f of failures) {
    console.log(`✗ ${f.msg}\n    期望: ${JSON.stringify(f.expected)}  实际: ${JSON.stringify(f.actual)}`);
  }
}
console.log('\n--- 关键断言用例 ---');
const highlights = cases.filter(
  (c) =>
    c.msg.includes('113') ||
    c.msg.includes('100') ||
    c.msg.includes('3%') ||
    c.msg.includes('validate') ||
    c.msg.includes('DOM')
);
for (const c of highlights) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.msg}  (期望 ${JSON.stringify(c.expected)}, 实际 ${JSON.stringify(c.actual)})`);
}
console.log('============================================\n');

process.exit(fail > 0 ? 1 : 0);
