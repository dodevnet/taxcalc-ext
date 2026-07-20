/**
 * 税金计算工具 —— 弹出页交互与计算逻辑（原生 JS，Manifest V3）
 *
 * 两种模式：
 *   - inclusive（含税 → 不含税）：不含税 = 含税 / (1 + 税率)；税额 = 含税 - 不含税
 *   - exclusive（不含税 → 含税）：含税 = 不含税 * (1 + 税率)；税额 = 不含税 * 税率
 *
 * 约定：UI 中的税率以「百分比数字」录入，计算时统一 ÷100 转为小数。
 */

(function () {
  'use strict';

  // ===== DOM 引用 =====
  const dom = {
    modeInclusive: document.getElementById('mode-inclusive'),
    modeExclusive: document.getElementById('mode-exclusive'),
    amountLabel: document.getElementById('amount-label'),
    amountInput: document.getElementById('amount-input'),
    rateSelect: document.getElementById('rate-select'),
    rateCustom: document.getElementById('rate-custom'),
    errorMsg: document.getElementById('error-msg'),
    calcBtn: document.getElementById('calc-btn'),
    resultMainLabel: document.getElementById('result-main-label'),
    resultSubLabel: document.getElementById('result-sub-label'),
    resultMain: document.getElementById('result-main'),
    resultSub: document.getElementById('result-sub'),
    resultTax: document.getElementById('result-tax'),
    result: document.getElementById('result'),
  };

  /** 当前计算模式：'inclusive' | 'exclusive' */
  let currentMode = 'inclusive';

  // ===== 工具函数 =====

  /**
   * 将数值四舍五入保留 2 位小数，返回 number。
   * 采用「乘 100 → 四舍五入 → 除 100」的方式，规避 toFixed 的边界舍入差异。
   * @param {number} value
   * @returns {number}
   */
  function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  /**
   * 格式化金额：保留 2 位小数并附带「元」单位。
   * @param {number} value
   * @returns {string}
   */
  function formatMoney(value) {
    return round2(value).toFixed(2) + ' 元';
  }

  /**
   * 获取税率（小数形式）。读取下拉框，若为「自定义」则读取自定义输入框。
   * @returns {number} 例如 13% 返回 0.13
   */
  function getRate() {
    let ratePercent;
    if (dom.rateSelect.value === 'custom') {
      ratePercent = parseFloat(dom.rateCustom.value);
    } else {
      ratePercent = parseFloat(dom.rateSelect.value);
    }
    return ratePercent / 100;
  }

  /**
   * 获取金额输入框中的数值。
   * @returns {number}
   */
  function getAmount() {
    return parseFloat(dom.amountInput.value);
  }

  // ===== 校验函数 =====

  /**
   * 校验输入是否合法。
   * @param {number} amount
   * @param {number} rate
   * @returns {string|null} 错误信息；null 表示校验通过
   */
  function validate(amount, rate) {
    if (Number.isNaN(amount)) {
      return '请输入有效的金额';
    }
    if (amount < 0) {
      return '金额必须为非负数';
    }
    if (Number.isNaN(rate) || rate < 0) {
      return '请输入有效的税率（≥ 0）';
    }
    return null;
  }

  // ===== 核心计算函数 =====

  /**
   * 含税金额 → 不含税金额 + 税额。
   * @param {number} inclusive 含税金额
   * @param {number} rate 小数税率（如 0.13）
   * @returns {{exclusive:number, inclusive:number, tax:number}}
   */
  function calcFromInclusive(inclusive, rate) {
    const exclusive = inclusive / (1 + rate);
    const tax = inclusive - exclusive;
    return {
      exclusive: round2(exclusive),
      inclusive: round2(inclusive),
      tax: round2(tax),
    };
  }

  /**
   * 不含税金额 → 含税金额 + 税额。
   * @param {number} exclusive 不含税金额
   * @param {number} rate 小数税率（如 0.13）
   * @returns {{exclusive:number, inclusive:number, tax:number}}
   */
  function calcFromExclusive(exclusive, rate) {
    const tax = exclusive * rate;
    const inclusive = exclusive * (1 + rate);
    return {
      exclusive: round2(exclusive),
      inclusive: round2(inclusive),
      tax: round2(tax),
    };
  }

  // ===== 渲染函数 =====

  /**
   * 将计算结果渲染到结果区。
   * @param {{exclusive:number, inclusive:number, tax:number}} result
   * @param {string} mainLabel 主结果显示标签（随模式变化）
   * @param {string} subLabel 副结果显示标签
   */
  function render(result, mainLabel, subLabel) {
    dom.resultMainLabel.textContent = mainLabel;
    dom.resultSubLabel.textContent = subLabel;
    // inclusive 模式主结果为不含税，副结果为含税；exclusive 模式相反。
    if (currentMode === 'inclusive') {
      setResultValue(dom.resultMain, result.exclusive);
      setResultValue(dom.resultSub, result.inclusive);
    } else {
      setResultValue(dom.resultMain, result.inclusive);
      setResultValue(dom.resultSub, result.exclusive);
    }
    setResultValue(dom.resultTax, result.tax);
  }

  /**
   * 设置结果区某个数值的展示文本，并写入可供复制的纯数值（无「元」单位）。
   * @param {HTMLElement} el 结果数值元素
   * @param {number} rawValue 原始数值（已是保留 2 位小数后的结果）
   */
  function setResultValue(el, rawValue) {
    el.textContent = formatMoney(rawValue);
    el.setAttribute('data-copy', rawValue.toFixed(2));
  }

  /**
   * 显示错误提示并清空结果。
   * @param {string} message
   */
  function showError(message) {
    dom.errorMsg.textContent = message;
    dom.errorMsg.hidden = false;
    dom.resultMain.textContent = '—';
    dom.resultSub.textContent = '—';
    dom.resultTax.textContent = '—';
    dom.resultMain.removeAttribute('data-copy');
    dom.resultSub.removeAttribute('data-copy');
    dom.resultTax.removeAttribute('data-copy');
  }

  /** 隐藏错误提示 */
  function clearError() {
    dom.errorMsg.hidden = true;
    dom.errorMsg.textContent = '';
  }

  // ===== 模式与 UI 更新 =====

  /**
   * 根据当前模式更新 UI 文案与输入框状态。
   */
  function updateModeUI() {
    const isInclusive = currentMode === 'inclusive';

    dom.modeInclusive.classList.toggle('is-active', isInclusive);
    dom.modeExclusive.classList.toggle('is-active', !isInclusive);
    dom.modeInclusive.setAttribute('aria-selected', String(isInclusive));
    dom.modeExclusive.setAttribute('aria-selected', String(!isInclusive));

    dom.amountLabel.textContent = isInclusive
      ? '含税金额（元）'
      : '不含税金额（元）';
    dom.amountInput.placeholder = isInclusive
      ? '请输入含税金额，例如 113'
      : '请输入不含税金额，例如 100';
  }

  /** 切换税率下拉框时，显示/隐藏自定义输入框 */
  function toggleCustomRate() {
    const isCustom = dom.rateSelect.value === 'custom';
    dom.rateCustom.hidden = !isCustom;
    if (isCustom) {
      dom.rateCustom.focus();
    }
    recalculate();
  }

  // ===== 主流程 =====

  /**
   * 读取输入 → 校验 → 计算 → 渲染。供按钮与实时事件统一调用。
   */
  function recalculate() {
    const amount = getAmount();
    const rate = getRate();

    const error = validate(amount, rate);
    if (error) {
      showError(error);
      return;
    }
    clearError();

    const result =
      currentMode === 'inclusive'
        ? calcFromInclusive(amount, rate)
        : calcFromExclusive(amount, rate);

    const mainLabel =
      currentMode === 'inclusive' ? '不含税金额' : '含税金额';
    const subLabel =
      currentMode === 'inclusive' ? '含税金额' : '不含税金额';

    render(result, mainLabel, subLabel);
  }

  /** 设置当前模式并刷新。 */
  function setMode(mode) {
    currentMode = mode;
    updateModeUI();
    recalculate();
  }

  // ===== 复制功能（点击结果区数值复制到剪贴板） =====

  /**
   * 将文本写入剪贴板：优先使用异步 Clipboard API，不可用时回退到
   * 隐藏 textarea + execCommand('copy')。无论成功失败均不抛出，便于上层友好提示。
   * @param {string} text 待复制的纯文本
   * @returns {Promise<boolean>} 是否复制成功
   */
  async function copyText(text) {
    // 方案一：异步剪贴板 API（popup 运行在扩展协议下通常为安全上下文，可用）
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        // 权限被拒或环境不支持，继续走降级方案
      }
    }
    // 方案二：隐藏 textarea + execCommand 兜底
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch (err) {
      return false;
    }
  }

  /** 复制反馈提示的去抖定时器句柄 */
  let copiedTipTimer = null;

  /**
   * 在指定结果行内短暂显示复制反馈提示，约 1 秒后自动消失，不阻断后续点击。
   * @param {HTMLElement} rowEl 结果行元素（.result__row）
   * @param {string} message 提示文案
   * @param {boolean} isError 是否为失败提示（影响配色）
   */
  function showCopied(rowEl, message, isError) {
    let tip = rowEl.querySelector('.result__copied');
    if (!tip) {
      tip = document.createElement('span');
      tip.className = 'result__copied';
      rowEl.appendChild(tip);
    }
    tip.textContent = message;
    tip.classList.toggle('is-error', Boolean(isError));
    // 强制重绘以确保过渡动画稳定触发
    void tip.offsetWidth;
    tip.classList.add('is-visible');

    clearTimeout(copiedTipTimer);
    copiedTipTimer = setTimeout(function () {
      tip.classList.remove('is-visible');
    }, 1000);
  }

  /**
   * 为结果区的数值绑定点击复制交互（事件委托，作用于 #result 容器）。
   */
  function bindCopy() {
    dom.result.addEventListener('click', async function (event) {
      const valueEl = event.target.closest('.result__value');
      if (!valueEl) {
        return;
      }
      const copyValue = valueEl.getAttribute('data-copy');
      if (!copyValue) {
        return; // 无有效数值（如占位符「—」）时不处理
      }
      const ok = await copyText(copyValue);
      if (ok) {
        showCopied(valueEl.parentElement, '已复制 ✓', false);
      } else {
        showCopied(valueEl.parentElement, '复制失败，请手动复制', true);
      }
    });
  }

  // ===== 事件绑定 =====

  function bindEvents() {
    dom.modeInclusive.addEventListener('click', () =>
      setMode('inclusive')
    );
    dom.modeExclusive.addEventListener('click', () =>
      setMode('exclusive')
    );
    dom.rateSelect.addEventListener('change', toggleCustomRate);
    dom.amountInput.addEventListener('input', recalculate);
    dom.rateCustom.addEventListener('input', recalculate);
    dom.calcBtn.addEventListener('click', recalculate);
  }

  // ===== 初始化 =====
  function init() {
    updateModeUI();
    bindEvents();
    bindCopy();
    recalculate();
  }

  // DOM 已通过 defer 加载，可直接初始化
  init();
})();
