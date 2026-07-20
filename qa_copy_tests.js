/**
 * QA 测试脚本 —— 税金计算浏览器扩展（点击结果复制功能增量验证）
 *
 * 测试策略（绝不修改用户源码 popup.js / popup.html / popup.css）：
 *  1. 静态检查：HTML id 与 popup.js 的 getElementById 引用一致；
 *     新增 CSS 类在 HTML/JS/CSS 中均被正确使用；原计算逻辑未被破坏。
 *  2. 运行时集成：用最小 DOM stub 真实加载 popup.js（IIFE 执行 init），
 *     通过事件驱动验证本次增量功能：
 *       a. setResultValue 写入正确的纯数值 data-copy
 *       b. showError 清空结果时移除 data-copy（占位符「—」不可复制）
 *       c. copyText 降级：无 navigator.clipboard 时走 execCommand 兜底且不抛异常、
 *          返回 boolean；两者都失败时返回 false
 *       d. bindCopy 点击委托：点击带 data-copy 的行触发复制并提示「已复制 ✓」；
 *          点击空 data-copy 的行被忽略
 *
 * 运行：node qa_copy_tests.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, 'popup.js');
const HTML_PATH = path.join(__dirname, 'popup.html');
const CSS_PATH = path.join(__dirname, 'popup.css');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const CSS = fs.readFileSync(CSS_PATH, 'utf8');

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
function eq(actual, expected, msg) {
  check(actual === expected, msg, expected, actual);
}

// ======================================================================
// 静态检查
// ======================================================================

// --- 1. HTML id 与 popup.js getElementById 引用一致 ---
(function staticCheckIds() {
  const idsInHtml = new Set();
  const re = /id="([^"]+)"/g;
  let m;
  while ((m = re.exec(HTML)) !== null) idsInHtml.add(m[1]);

  const getElRefs = new Set();
  const re2 = /getElementById\(['"]([^'"]+)['"]\)/g;
  while ((m = re2.exec(SRC)) !== null) getElRefs.add(m[1]);

  let allMatch = true;
  for (const id of getElRefs) {
    if (!idsInHtml.has(id)) {
      allMatch = false;
      failures.push({ msg: 'HTML 缺少 popup.js 引用的 id: ' + id, expected: id, actual: '缺失' });
    }
  }
  check(allMatch, 'popup.html 含 popup.js 全部 getElementById 引用的 id', true, allMatch);

  // 关键结果区 id
  for (const id of ['result', 'result-main', 'result-sub', 'result-tax']) {
    check(idsInHtml.has(id) && getElRefs.has(id), `关键 id "${id}" 在 HTML 与 JS 中均存在`, true, true);
  }
})();

// --- 2. 新增 CSS 类在 CSS / HTML / JS 中均被正确使用 ---
(function staticCheckClasses() {
  const newClasses = ['result__row', 'result__value', 'result__copied', 'is-visible', 'is-error'];
  for (const cls of newClasses) {
    check(CSS.includes('.' + cls), `CSS 定义 .${cls}`, true, CSS.includes('.' + cls));
  }
  // HTML 使用
  check(/class="[^"]*result__row/.test(HTML), 'HTML 使用 .result__row', true, true);
  check(/class="[^"]*result__value/.test(HTML), 'HTML 使用 .result__value', true, true);
  // JS 使用（绑定与提示）
  check(SRC.includes("closest('.result__value')"), "popup.js 用 closest('.result__value') 委托", true, true);
  check(SRC.includes("'result__copied'") || SRC.includes('"result__copied"'), 'popup.js 创建 .result__copied 提示', true, true);
  check(SRC.includes('is-visible'), 'popup.js 添加 .is-visible', true, true);
  check(SRC.includes('is-error'), 'popup.js 切换 .is-error', true, true);
})();

// --- 3. 原计算逻辑未被破坏（抽取真实函数源码执行） ---
(function staticCheckCalc() {
  function extractFunction(source, name) {
    const idx = source.indexOf('function ' + name + '(');
    if (idx === -1) throw new Error('未找到函数定义: ' + name);
    const open = source.indexOf('{', idx);
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    return source.slice(idx, i);
  }
  const fns = new Function(
    [extractFunction(SRC, 'round2'), extractFunction(SRC, 'formatMoney'),
     extractFunction(SRC, 'calcFromInclusive'), extractFunction(SRC, 'calcFromExclusive'),
     extractFunction(SRC, 'validate')].join('\n') +
    '\nreturn { round2, formatMoney, calcFromInclusive, calcFromExclusive, validate };'
  )();

  const r = fns.calcFromInclusive(113, 0.13);
  eq(r.exclusive, 100, '原逻辑 含税113/13% → 不含税=100');
  eq(r.tax, 13, '原逻辑 含税113/13% → 税额=13');
  eq(fns.formatMoney(100), '100.00 元', '原逻辑 formatMoney(100)="100.00 元"');
  eq(fns.validate(-5, 0.13), '金额必须为非负数', '原逻辑 validate(-5) 拦截');
})();

// ======================================================================
// 最小 DOM stub
// ======================================================================

class El {
  constructor(tag, id) {
    this.tagName = (tag || 'div').toUpperCase();
    this.id = id || '';
    this._class = '';
    this.attributes = {};
    this.children = [];
    this.parentElement = null;
    this._text = '';
    this.value = '';
    this.hidden = false;
    this.placeholder = '';
    this.style = {};
    this.listeners = {};
    this.offsetWidth = 0;
  }
  get className() { return this._class; }
  set className(v) { this._class = v || ''; }
  _hasClass(c) { return this._class.split(/\s+/).includes(c); }
  get classList() {
    const self = this;
    return {
      add(c) { if (!self._hasClass(c)) self._class = (self._class ? self._class + ' ' : '') + c; },
      remove(c) { self._class = self._class.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle(c, force) {
        const has = self._hasClass(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) self._class = (self._class ? self._class + ' ' : '') + c;
        else if (!want && has) self._class = self._class.split(/\s+/).filter((x) => x && x !== c).join(' ');
        return want;
      },
      contains(c) { return self._hasClass(c); },
    };
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentElement = null;
    return child;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v == null ? '' : String(v); }
  matches(sel) {
    if (sel[0] === '.') return this._hasClass(sel.slice(1));
    if (sel[0] === '#') return this.id === sel.slice(1);
    return this.tagName === sel.toUpperCase();
  }
  closest(sel) {
    let cur = this;
    while (cur) { if (cur.matches(sel)) return cur; cur = cur.parentElement; }
    return null;
  }
  querySelector(sel) {
    const q = [].concat(this.children);
    while (q.length) {
      const n = q.shift();
      if (n.matches && n.matches(sel)) return n;
      if (n.children && n.children.length) q.push(...n.children);
    }
    return null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }
  select() {}
  setSelectionRange() {}
}

const elementsById = {};
function makeRegistered(tag, id, cls) {
  const e = new El(tag, id);
  if (cls) e.className = cls;
  if (id) elementsById[id] = e;
  return e;
}

// 构建与 popup.html 对应的结果区结构（复制功能依赖此嵌套）
const resultRoot = makeRegistered('section', 'result', 'card result');
function buildRow(idLabel, idValue, extraRowCls) {
  const row = new El('div', '');
  row.className = extraRowCls ? 'result__row ' + extraRowCls : 'result__row';
  const label = makeRegistered('span', idLabel, 'result__label');
  const val = makeRegistered('span', idValue, 'result__value');
  val.setAttribute('title', '点击复制');
  row.appendChild(label);
  row.appendChild(val);
  resultRoot.appendChild(row);
  return val;
}
const mainVal = buildRow('result-main-label', 'result-main');
buildRow('result-sub-label', 'result-sub');
buildRow('', 'result-tax', 'result__row--tax');

// 其余被引用的元素
makeRegistered('button', 'mode-inclusive');
makeRegistered('button', 'mode-exclusive');
makeRegistered('label', 'amount-label');
makeRegistered('input', 'amount-input');
makeRegistered('select', 'rate-select');
makeRegistered('input', 'rate-custom');
makeRegistered('p', 'error-msg');
makeRegistered('button', 'calc-btn');
// 默认税率与 HTML 的 selected 一致
elementsById['rate-select'].value = '13';
elementsById['rate-select'].hidden = false;
elementsById['rate-custom'].hidden = true;

const body = new El('body', '');

// 可配置的 execCommand 实现 + 调用记录
let execCommandImpl = () => true;
let execCommandCalls = [];

const fakeDocument = {
  getElementById: (id) => elementsById[id] || makeRegistered('div', id),
  createElement: (tag) => new El(tag, ''),
  body,
  execCommand(cmd) {
    const r = execCommandImpl(cmd);
    execCommandCalls.push({ cmd, result: r });
    return r;
  },
};

// 可配置的 navigator
function setNavigator(obj) {
  try {
    Object.defineProperty(globalThis, 'navigator', { value: obj, configurable: true, writable: true });
  } catch (e) {
    globalThis.navigator = obj;
  }
}

// 事件冒泡分发
function fireEvent(target, type) {
  const ev = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  let cur = target;
  while (cur) {
    const ls = cur.listeners[type];
    if (ls) for (const fn of ls) fn.call(cur, ev);
    cur = cur.parentElement;
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// 在加载 popup.js 前注入 DOM / navigator
global.document = fakeDocument;
setNavigator({}); // 默认无 clipboard，走兜底

// 真实执行源码（IIFE 执行 init → 绑定事件 → bindCopy → recalculate）
require(SRC_PATH);

// ======================================================================
// 运行时集成测试：本次增量功能
// ======================================================================

// a. setResultValue 写入正确的纯数值 data-copy
async function testSetResultValue() {
  elementsById['amount-input'].value = '113';
  elementsById['rate-select'].value = '13';
  fireEvent(elementsById['amount-input'], 'input'); // recalculate → render → setResultValue

  const main = elementsById['result-main'];   // 不含税
  const sub = elementsById['result-sub'];     // 含税
  const tax = elementsById['result-tax'];     // 税额

  eq(main.getAttribute('data-copy'), '100.00', 'a1 不含税行 data-copy="100.00"');
  eq(tax.getAttribute('data-copy'), '13.00', 'a2 税额行 data-copy="13.00"');
  eq(sub.getAttribute('data-copy'), '113.00', 'a3 含税行 data-copy="113.00"');
  eq(main.textContent, '100.00 元', 'a4 不含税行展示 "100.00 元"');
  eq(tax.textContent, '13.00 元', 'a5 税额行展示 "13.00 元"');
}

// b. showError 清空结果时移除 data-copy（占位符「—」不可复制）
async function testShowErrorRemovesCopy() {
  // 先确保有值
  elementsById['amount-input'].value = '113';
  elementsById['rate-select'].value = '13';
  fireEvent(elementsById['amount-input'], 'input');
  // 制造非法输入（空 → NaN）
  elementsById['amount-input'].value = '';
  fireEvent(elementsById['amount-input'], 'input'); // validate 失败 → showError

  const main = elementsById['result-main'];
  check(main.getAttribute('data-copy') === null, 'b1 showError 后 data-copy 被移除', null, main.getAttribute('data-copy'));
  eq(main.textContent, '—', 'b2 占位符重置为 "—"');
}

// c. copyText 降级：无 clipboard 走 execCommand 兜底，返回 boolean、不抛异常
//    c2. 两者都失败返回 false
async function testCopyTextFallback() {
  const main = elementsById['result-main'];
  const row = main.parentElement;

  function ensureValid() {
    elementsById['amount-input'].value = '113';
    elementsById['rate-select'].value = '13';
    fireEvent(elementsById['amount-input'], 'input');
  }
  function clearTip() {
    const t = row.querySelector('.result__copied');
    if (t) row.removeChild(t);
  }

  // 场景 c0：navigator.clipboard.writeText 可用且成功 → 优先走它，不调 execCommand
  ensureValid();
  setNavigator({ clipboard: { writeText: async () => {} } });
  execCommandImpl = () => { throw new Error('不应到达 execCommand'); };
  execCommandCalls.length = 0;
  clearTip();
  let threw0 = false;
  try { fireEvent(main, 'click'); await tick(); } catch (e) { threw0 = true; }
  check(!threw0, 'c0 优先 clipboard 路径不抛异常', false, threw0);
  check(execCommandCalls.length === 0, 'c0 优先 clipboard，未走 execCommand', 0, execCommandCalls.length);
  const tip0 = row.querySelector('.result__copied');
  eq(tip0 && tip0.textContent, '已复制 ✓', 'c0 提示「已复制 ✓」');

  // 场景 c：navigator 无 clipboard，execCommand 返回 true（兜底）
  ensureValid();
  setNavigator({}); // 无 clipboard
  execCommandImpl = () => true;
  execCommandCalls.length = 0;
  clearTip();
  let threw = false;
  try { fireEvent(main, 'click'); await tick(); } catch (e) { threw = true; }
  check(!threw, 'c1 点击复制过程不抛异常', false, threw);
  check(execCommandCalls.some((c) => c.cmd === 'copy'), 'c2 走 execCommand 兜底', true, JSON.stringify(execCommandCalls));
  const tip = row.querySelector('.result__copied');
  eq(tip && tip.textContent, '已复制 ✓', 'c3 提示「已复制 ✓」');
  check(tip && tip.classList.contains('is-visible'), 'c4 提示可见 (is-visible)', true, tip && tip.className);
  check(tip && !tip.classList.contains('is-error'), 'c5 成功提示非错误态', true, tip && tip.className);

  // 场景 c2：clipboard 存在但被拒 + execCommand 抛错 → 返回 false，不抛异常
  ensureValid();
  setNavigator({ clipboard: { writeText: async () => { throw new Error('denied'); } } });
  execCommandImpl = () => { throw new Error('execCommand unsupported'); };
  execCommandCalls.length = 0;
  clearTip();
  let threw2 = false;
  try { fireEvent(main, 'click'); await tick(); } catch (e) { threw2 = true; }
  check(!threw2, 'c6 双失败仍不抛异常', false, threw2);
  const tip2 = row.querySelector('.result__copied');
  eq(tip2 && tip2.textContent, '复制失败，请手动复制', 'c7 双失败提示「复制失败，请手动复制」');
  check(tip2 && tip2.classList.contains('is-error'), 'c8 失败提示为错误态 (is-error)', true, tip2 && tip2.className);
  setNavigator({}); execCommandImpl = () => true; // 复位
}

// d. bindCopy 点击委托：空 data-copy 被忽略
async function testBindCopyIgnoreEmpty() {
  // 进入错误态清空 data-copy
  elementsById['amount-input'].value = '';
  fireEvent(elementsById['amount-input'], 'input');
  setNavigator({});
  execCommandImpl = () => true;
  execCommandCalls.length = 0;

  const main = elementsById['result-main'];
  const row = main.parentElement;
  const oldTip = row.querySelector('.result__copied');
  if (oldTip) row.removeChild(oldTip);

  fireEvent(main, 'click'); // data-copy 为空 → 应被忽略
  await tick();

  check(execCommandCalls.length === 0, 'd1 空 data-copy 点击不触发复制', 0, execCommandCalls.length);
  const tip = row.querySelector('.result__copied');
  check(tip === null, 'd2 空 data-copy 点击不创建提示', null, tip && tip.textContent);
}

// ======================================================================
(async function run() {
  await testSetResultValue();
  await testShowErrorRemovesCopy();
  await testCopyTextFallback();
  await testBindCopyIgnoreEmpty();

  // ===== 输出报告 =====
  const total = pass + fail;
  const rate = total === 0 ? 0 : (pass / total) * 100;

  console.log('\n================ QA 测试报告（点击复制功能） ================');
  console.log(`通过: ${pass} / 总数: ${total}  (通过率: ${rate.toFixed(1)}%)`);
  if (fail > 0) {
    console.log('\n--- 失败用例 ---');
    for (const f of failures) {
      console.log(`✗ ${f.msg}\n    期望: ${JSON.stringify(f.expected)}  实际: ${JSON.stringify(f.actual)}`);
    }
  }
  console.log('\n--- 关键断言用例（输入 → 期望 → 实际）---');
  const highlights = cases.filter((c) =>
    c.msg.startsWith('a') || c.msg.startsWith('b') || c.msg.startsWith('c') || c.msg.startsWith('d') ||
    c.msg.includes('原逻辑')
  );
  for (const c of highlights) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.msg}  | 期望 ${JSON.stringify(c.expected)} / 实际 ${JSON.stringify(c.actual)}`);
  }
  console.log('=============================================================\n');

  process.exit(fail > 0 ? 1 : 0);
})();
