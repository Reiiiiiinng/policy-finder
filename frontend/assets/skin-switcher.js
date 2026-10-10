/**
 * 视觉方案切换器（仅用于 C / B 双方案对比，不属于产品功能）
 * ------------------------------------------------
 * - 三态：方案 C（默认）/ 方案 B / 原版
 * - 状态存 sessionStorage 的独立 key（pf_skin），不碰业务会话数据
 * - 默认方案 C：没有 URL 参数、也没有已保存选择时，直接进入方案 C
 * - 支持 URL 参数直连：?skin=c / ?skin=b / ?skin=default
 *   （用于分享预览与自动化截图）URL 参数优先级最高：
 *   显式参数会覆盖已保存状态并写回存储；?skin=default 表示明确进入原版，
 *   会把「空串」作为一次有效选择存下（区别于「从未选择过」的 null）。
 * - 只切换 body 上的 skin-c / skin-b 类，样式全部由 skins.css 提供，
 *   不修改任何业务逻辑、接口与数据。
 */
(function () {
  'use strict';

  var KEY = 'pf_skin';

  function readSaved() {
    // 返回 null 表示从未选择过（此时用默认方案 C）；
    // 返回 '' 表示用户明确选择过「原版」，必须尊重。
    try { return sessionStorage.getItem(KEY); } catch (e) { return null; }
  }

  function save(v) {
    try { sessionStorage.setItem(KEY, v); } catch (e) { /* 隐私模式下忽略 */ }
  }

  // URL 参数优先级最高：显式指定时覆盖已存状态并写回
  var qs = null;
  try { qs = new URLSearchParams(location.search).get('skin'); } catch (e) { /* ignore */ }

  var current;
  if (qs === 'c' || qs === 'b') {
    save(qs);
    current = qs;
  } else if (qs === 'default') {
    save('');            // 明确进入原版，作为一次有效选择记录
    current = '';
  } else {
    var saved = readSaved();
    current = (saved === null || saved === undefined) ? 'c' : saved;
  }

  function apply(v) {
    current = v;
    document.body.classList.remove('skin-c', 'skin-b');
    if (v === 'c' || v === 'b') document.body.classList.add('skin-' + v);
  }

  // 尽早应用，减少换肤闪烁；body 在脚本执行时一定已存在（脚本在 body 末尾）
  apply(current);

  var OPTIONS = [
    ['', '原版'],
    ['c', '方案 C'],
    ['b', '方案 B'],
  ];

  function mount() {
    if (document.getElementById('pfSkinSwitch')) return;
    var bar = document.createElement('div');
    bar.id = 'pfSkinSwitch';
    bar.className = 'skin-switch';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '视觉方案切换（仅用于方案对比）');
    bar.innerHTML = OPTIONS.map(function (o) {
      var on = (current || '') === o[0];
      return '<button type="button" class="ss-btn' + (on ? ' is-on' : '') + '"'
        + ' data-skin="' + o[0] + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '">'
        + o[1] + '</button>';
    }).join('');

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.ss-btn');
      if (!btn) return;
      var v = btn.dataset.skin || '';
      save(v);
      apply(v);
      bar.querySelectorAll('.ss-btn').forEach(function (b) {
        var on = (b.dataset.skin || '') === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    });

    document.body.appendChild(bar);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
