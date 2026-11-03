/* ==========================================================================
   B 版本 UI 兼容层（theme-cb 展示层原样移植）
   - 只包含展示层：图标表、头像位图/SVG、选择卡头像、底部导航
   - 业务逻辑仍由 partner-v1.1 的 assets/app.js 提供
   - 本文件不定义 API / store / 流程条 / 演示等业务函数，避免重复定义
   ========================================================================== */
const ICONS = {
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
  compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  user: '<circle cx="12" cy="8" r="3.4"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<path d="M5 12h14"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  'arrow-left': '<path d="M19 12H5"/><path d="m11.5 18.5-6.5-6.5 6.5-6.5"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.6 12.2 2.4 2.4 4.6-5"/>',
};

const ICONF = {
  home: '<path fill="currentColor" d="M12 3.1 3.7 10.2a1 1 0 0 0-.35.76V19a1.6 1.6 0 0 0 1.6 1.6h4.55v-5.1c0-1.1.9-2 2-2h1c1.1 0 2 .9 2 2v5.1h4.55A1.6 1.6 0 0 0 20.65 19v-8.04a1 1 0 0 0-.35-.76L12 3.1Z"/>'
    + '<path fill="#f2b33d" d="M9.2 8h5.6a.8.8 0 0 1 .8.8v1.7a.8.8 0 0 1-.8.8H9.2a.8.8 0 0 1-.8-.8V8.8a.8.8 0 0 1 .8-.8Z"/>',
  compass: '<circle cx="12" cy="12" r="9.3" fill="currentColor"/>'
    + '<path fill="#fff" d="m16.9 7.1-2.7 7-7 2.7 2.7-7 7-2.7Z"/>'
    + '<circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  headset: '<path fill="currentColor" d="M12 3.2a8.1 8.1 0 0 0-8.1 8.1v4.9a3.1 3.1 0 0 0 3.1 3.1h.6a1.6 1.6 0 0 0 1.6-1.6v-3.2a1.6 1.6 0 0 0-1.6-1.6H6.1v-1.6a5.9 5.9 0 0 1 11.8 0v1.6h-1.5a1.6 1.6 0 0 0-1.6 1.6v3.2a1.6 1.6 0 0 0 1.6 1.6h.6a3.1 3.1 0 0 0 3.1-3.1v-4.9A8.1 8.1 0 0 0 12 3.2Z"/>',
  user: '<circle cx="12" cy="8.1" r="3.7" fill="currentColor"/>'
    + '<path fill="currentColor" d="M12 13.6c-4.1 0-7 2.5-7 5.5 0 .8.6 1.4 1.4 1.4h11.2c.8 0 1.4-.6 1.4-1.4 0-3-2.9-5.5-7-5.5Z"/>',
  'user-plus': '<circle cx="10.2" cy="7.9" r="3.5" fill="currentColor"/>'
    + '<path fill="currentColor" d="M10.2 12.9c-3.8 0-6.5 2.3-6.5 5.2 0 .8.6 1.4 1.4 1.4h6.9a5.9 5.9 0 0 1-.8-3.5 5.9 5.9 0 0 1 1.3-3.1Z"/>'
    + '<path d="M18.6 14.4v5.2M16 17h5.2" fill="none" stroke="#2e7d4f" stroke-width="2" stroke-linecap="round"/>',
  'status-maybe': '<circle cx="12" cy="12" r="10" fill="currentColor"/>'
    + '<path d="m7.7 12.2 2.8 2.8 5.8-6.1" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  'status-clock': '<circle cx="12" cy="12" r="10" fill="currentColor"/>'
    + '<path d="M12 6.9V12l3.4 2" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  'status-none': '<circle cx="12" cy="12" r="10" fill="currentColor"/>'
    + '<path d="M7.8 12h8.4" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/>',
  magnifier: '<circle cx="10.9" cy="10.9" r="6.4" fill="currentColor"/>'
    + '<path d="m15.8 15.8 4.4 4.4" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>'
    + '<path d="M8.2 9.2a3.4 3.4 0 0 1 2.5-1.7" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>',
  'shield-check': '<path fill="currentColor" d="M12 2.6 19.8 5.7v5.7c0 4.7-3.2 8.7-7.8 10-4.6-1.3-7.8-5.3-7.8-10V5.7L12 2.6Z"/>'
    + '<path d="m8.5 11.9 2.5 2.5 4.7-5.1" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  gift: '<path fill="currentColor" d="M4.5 13.2h15v6.2a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5v-6.2Z"/>'
    + '<path fill="currentColor" d="M3.5 8.2h17a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1Z"/>'
    + '<path fill="#fff" opacity=".55" d="M11.05 8.2h1.9v12.7h-1.9z"/>'
    + '<path fill="currentColor" d="M12 7.9c-2.9 0-4.8-1.3-4.8-3C7.2 3.5 8.3 2.5 9.7 2.5c1.7 0 2.3 2.6 2.3 5.4Zm0 0c2.9 0 4.8-1.3 4.8-3 0-1.4-1.1-2.4-2.5-2.4-1.7 0-2.3 2.6-2.3 5.4Z"/>',
  pin: '<path fill="currentColor" d="M12 2.5c-4.1 0-7.4 3.3-7.4 7.4 0 5.2 6.4 11.1 7.1 11.7a.45.45 0 0 0 .6 0c.7-.6 7.1-6.5 7.1-11.7 0-4.1-3.3-7.4-7.4-7.4Z"/>'
    + '<circle cx="12" cy="9.9" r="2.7" fill="#fff"/>',
  'users-two': '<circle cx="9.2" cy="8.3" r="2.9" fill="currentColor"/>'
    + '<path fill="currentColor" d="M9.2 12.4c-3.2 0-5.5 2-5.5 4.3 0 .7.5 1.2 1.2 1.2h8.6c.7 0 1.2-.5 1.2-1.2 0-2.3-2.3-4.3-5.5-4.3Z"/>'
    + '<circle cx="16.7" cy="9.2" r="2.3" fill="currentColor" opacity=".55"/>'
    + '<path fill="currentColor" opacity=".55" d="M16.9 12.6c2.1.4 3.6 1.9 3.9 4.1.1.6-.4 1.2-1 1.2h-2.6a6.6 6.6 0 0 0-1.5-4.1c.4-.1.8-.2 1.2-.2Z"/>',
  play: '<path fill="currentColor" d="M8.3 5.6v12.8c0 .95 1.05 1.53 1.85 1.02l10-6.4a1.2 1.2 0 0 0 0-2.04l-10-6.4c-.8-.51-1.85.07-1.85 1.02Z"/>',
  brand: '<circle cx="10.6" cy="11" r="6.5" fill="none" stroke="#1b5e3b" stroke-width="2.3"/>'
    + '<circle cx="10.6" cy="9.2" r="1.9" fill="#2e7d4f"/>'
    + '<path d="M7.4 15c.6-1.7 1.8-2.7 3.2-2.7s2.6 1 3.2 2.7" fill="none" stroke="#2e7d4f" stroke-width="1.9" stroke-linecap="round"/>'
    + '<path d="m15.7 16.2 3.9 3.9" stroke="#1b5e3b" stroke-width="2.6" stroke-linecap="round"/>'
    + '<path fill="#e8833a" d="M17.7 3.5c.7-.8 1.9-.5 2.3.3.4-.8 1.6-1.1 2.3-.3.7.7.4 1.7-.5 2.4l-1.8 1.5-1.8-1.5c-.9-.7-1.2-1.7-.5-2.4Z"/>',
};

function icon(name) {
  const p = ICONS[name];
  if (!p) return '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"'
    + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

function iconF(name) {
  const p = ICONF[name];
  if (!p) return '';
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + p + '</svg>';
}

const CHOICE_AVATARS = {
  '女儿': 'adult-female', '儿子': 'adult-male',
  '配偶': 'couple', '其他家属': 'other', '社区工作人员': 'worker',
  '父亲': 'elder-male', '母亲': 'elder-female',
  '爷爷': 'elder-male', '奶奶': 'elder-female',
  '外公': 'elder-male', '外婆': 'elder-female', '其他': 'neutral',
};

const AVATAR_MALE_WORDS = ['父亲', '爸爸', '爷爷', '外公', '姥爷'];
const AVATAR_FEMALE_WORDS = ['母亲', '妈妈', '奶奶', '外婆', '姥姥'];

const AVATARS = {
  'elder-male': '<circle cx="12" cy="12" r="11" fill="#e3f1e7"/>'
    + '<path fill="#f8dcbf" d="M12 5.6c-2.4 0-4.2 1.9-4.2 4.4 0 2.6 1.8 4.9 4.2 4.9s4.2-2.3 4.2-4.9c0-2.5-1.8-4.4-4.2-4.4Z"/>'
    + '<path fill="#cdd3d6" d="M7.7 10.9c-.2-1.5.1-2.9.9-3.8.6-.7 1.5-1.2 2.5-1.3-.9.8-1.4 2-1.5 3.4-.7.3-1.4.9-1.9 1.7Z"/>'
    + '<path fill="#cdd3d6" d="M16.3 10.9c.2-1.5-.1-2.9-.9-3.8-.6-.7-1.5-1.2-2.5-1.3.9.8 1.4 2 1.5 3.4.7.3 1.4.9 1.9 1.7Z"/>'
    + '<circle cx="10.4" cy="9.9" r=".55" fill="#4a3f35"/><circle cx="13.6" cy="9.9" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.8 12.1c.7.6 1.7.6 2.4 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#2e7d4f" d="M12 15.4c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  'elder-female': '<circle cx="12" cy="12" r="11" fill="#fdf0e7"/>'
    + '<circle cx="12" cy="5.4" r="1.6" fill="#cdd3d6"/>'
    + '<path fill="#cdd3d6" d="M12 5.9c-2.6 0-4.5 2.1-4.5 4.9 0 1.1.2 2.1.7 2.9l.5-2.2c.3-1.7 1.6-2.8 3.3-2.8s3 1.1 3.3 2.8l.5 2.2c.5-.8.7-1.8.7-2.9 0-2.8-1.9-4.9-4.5-4.9Z"/>'
    + '<path fill="#f8dcbf" d="M12 6.9c-2 0-3.6 1.6-3.6 3.9 0 2.5 1.6 4.6 3.6 4.6s3.6-2.1 3.6-4.6c0-2.3-1.6-3.9-3.6-3.9Z"/>'
    + '<circle cx="10.5" cy="10.6" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.6" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.7c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#e2615c" d="M12 15.6c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  neutral: '<circle cx="12" cy="12" r="11" fill="#eff2f5"/>'
    + '<path fill="#c2c9ce" d="M12 5.4c-2.7 0-4.7 2.2-4.7 5 0 1 .2 1.9.6 2.7l.4-1.8c.3-1.8 1.7-3 3.7-3s3.4 1.2 3.7 3l.4 1.8c.4-.8.6-1.7.6-2.7 0-2.8-2-5-4.7-5Z"/>'
    + '<path fill="#f8dcbf" d="M12 7.1c-1.9 0-3.4 1.5-3.4 3.6 0 2.4 1.5 4.4 3.4 4.4s3.4-2 3.4-4.4c0-2.1-1.5-3.6-3.4-3.6Z"/>'
    + '<circle cx="10.5" cy="10.5" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.5" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.6c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#61707c" d="M12 15.5c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  self: '<circle cx="12" cy="12" r="11" fill="#eaf3ec"/>'
    + '<path fill="#4a3f35" d="M12 4.9c-2.8 0-4.9 2.2-4.9 5.2 0 1 .2 1.9.6 2.7l.5-2.3c.3-1.8 1.8-3 3.8-3s3.5 1.2 3.8 3l.5 2.3c.4-.8.6-1.7.6-2.7 0-3-2.1-5.2-4.9-5.2Z"/>'
    + '<path fill="#f8dcbf" d="M12 7.2c-1.9 0-3.4 1.5-3.4 3.6 0 2.4 1.5 4.4 3.4 4.4s3.4-2 3.4-4.4c0-2.1-1.5-3.6-3.4-3.6Z"/>'
    + '<circle cx="10.5" cy="10.6" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.6" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.7c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#3a8b5c" d="M12 15.5c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  /* ---- 成人角色（操作者选项 · 2026-10-27 UI 提升轮）：只映射 family.html
     用户点选的固定关系标签，不做任何姓名/用字推断 ---- */
  'adult-female': '<circle cx="12" cy="12" r="11" fill="#fdeee2"/>'
    + '<path fill="#5f4432" d="M12 4.5c-3.3 0-5.5 2.3-5.5 5.5 0 1.5.2 2.8.7 3.8.2-1.7.7-3.1 1.6-4 .9.5 2 .8 3.2.8s2.3-.3 3.2-.8c.9.9 1.4 2.3 1.6 4 .5-1 .7-2.3.7-3.8 0-3.2-2.2-5.5-5.5-5.5Z"/>'
    + '<path fill="#f8dcbf" d="M12 7.1c-1.9 0-3.5 1.6-3.5 3.8 0 2.4 1.6 4.5 3.5 4.5s3.5-2.1 3.5-4.5c0-2.2-1.6-3.8-3.5-3.8Z"/>'
    + '<circle cx="10.5" cy="10.6" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.6" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.7c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#e07a5f" d="M12 15.5c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  'adult-male': '<circle cx="12" cy="12" r="11" fill="#e9eff4"/>'
    + '<path fill="#3a3f45" d="M12 4.8c-2.9 0-5 2.1-5 5 0 .9.1 1.7.4 2.4l.6-2c.4-1.6 2-2.7 4-2.7s3.6 1.1 4 2.7l.6 2c.3-.7.4-1.5.4-2.4 0-2.9-2.1-5-5-5Z"/>'
    + '<path fill="#f8dcbf" d="M12 7.2c-1.9 0-3.4 1.5-3.4 3.6 0 2.4 1.5 4.4 3.4 4.4s3.4-2 3.4-4.4c0-2.1-1.5-3.6-3.4-3.6Z"/>'
    + '<circle cx="10.5" cy="10.6" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.6" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.7c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#5b7a99" d="M12 15.5c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  /* 配偶：两位长辈并肩，不预设性别 */
  couple: '<circle cx="12" cy="12" r="11" fill="#f3efe4"/>'
    + '<circle cx="8.4" cy="10.2" r="2.5" fill="#f8dcbf"/>'
    + '<path fill="#cdd3d6" d="M8.4 7.6c-1.4 0-2.4 1-2.6 2.3.5-.5 1.5-.8 2.6-.8s2.1.3 2.6.8C10.8 8.6 9.8 7.6 8.4 7.6Z"/>'
    + '<path fill="#2e7d4f" d="M8.4 13.2c-2.5 0-4.4 1.4-5 3.4 1.4 1.6 3.2 2.6 5 2.9.4-.9.6-1.9.6-3 0-1.2-.2-2.3-.6-3.3Z"/>'
    + '<circle cx="15.4" cy="10.6" r="2.7" fill="#f8dcbf"/>'
    + '<path fill="#e8e4da" d="M15.4 7.8c-1.5 0-2.6 1.1-2.8 2.5.5-.6 1.6-.9 2.8-.9s2.3.3 2.8.9c-.2-1.4-1.3-2.5-2.8-2.5Z"/>'
    + '<path fill="#c96f5a" d="M15.4 13.7c-2.3 0-4 1.1-4.7 2.9.9 1.9 2.7 3.1 4.7 3.3 2-.2 3.8-1.4 4.7-3.3-.7-1.8-2.4-2.9-4.7-2.9Z"/>',
  /* 社区工作人员：青色马甲 + 白色工牌 */
  worker: '<circle cx="12" cy="12" r="11" fill="#e6f2ee"/>'
    + '<path fill="#4a3f35" d="M12 4.9c-2.7 0-4.7 2-4.7 4.8 0 .8.1 1.5.3 2.1l.7-1.7c.4-1.5 1.8-2.5 3.7-2.5s3.3 1 3.7 2.5l.7 1.7c.2-.6.3-1.3.3-2.1 0-2.8-2-4.8-4.7-4.8Z"/>'
    + '<path fill="#f8dcbf" d="M12 7.2c-1.9 0-3.4 1.5-3.4 3.6 0 2.4 1.5 4.4 3.4 4.4s3.4-2 3.4-4.4c0-2.1-1.5-3.6-3.4-3.6Z"/>'
    + '<circle cx="10.5" cy="10.6" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.6" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.7c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#2f7f6f" d="M12 15.5c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>'
    + '<path d="m10.2 15.8 1.8 2.1 1.8-2.1" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<rect x="11.1" y="18.3" width="1.8" height="2.3" rx=".4" fill="#fff"/>',
  /* 其他家属：暖米底 + 灰绿衣着，与「中性」区分 */
  other: '<circle cx="12" cy="12" r="11" fill="#f6efe4"/>'
    + '<path fill="#7a6a55" d="M12 4.9c-2.8 0-4.9 2.2-4.9 5.2 0 1 .2 1.9.6 2.7l.5-2.3c.3-1.8 1.8-3 3.8-3s3.5 1.2 3.8 3l.5 2.3c.4-.8.6-1.7.6-2.7 0-3-2.1-5.2-4.9-5.2Z"/>'
    + '<path fill="#f8dcbf" d="M12 7.2c-1.9 0-3.4 1.5-3.4 3.6 0 2.4 1.5 4.4 3.4 4.4s3.4-2 3.4-4.4c0-2.1-1.5-3.6-3.4-3.6Z"/>'
    + '<circle cx="10.5" cy="10.6" r=".55" fill="#4a3f35"/><circle cx="13.5" cy="10.6" r=".55" fill="#4a3f35"/>'
    + '<path d="M10.9 12.7c.7.6 1.5.6 2.2 0" fill="none" stroke="#b97c50" stroke-width=".7" stroke-linecap="round"/>'
    + '<path fill="#8a7a62" d="M12 15.5c-3.7 0-6.5 2-7.3 4.9A10.9 10.9 0 0 0 12 23a10.9 10.9 0 0 0 7.3-2.7c-.8-2.9-3.6-4.9-7.3-4.9Z"/>',
  add: '<circle cx="12" cy="12" r="11" fill="#f4faf6"/>'
    + '<circle cx="10.8" cy="9.8" r="3" fill="none" stroke="#2e7d4f" stroke-width="1.6"/>'
    + '<path d="M5.6 18.3c.9-2.7 2.9-4.2 5.2-4.2 1.1 0 2.1.3 3 1" fill="none" stroke="#2e7d4f" stroke-width="1.6" stroke-linecap="round"/>'
    + '<path d="M17.9 14.4v5.2M15.3 17h5.2" stroke="#2e7d4f" stroke-width="1.8" stroke-linecap="round"/>',
};

/* 2026-10-30：9 个角色全部接回 theme-cb 的原始人像素材（同一批线描画风，
   形象与角色对应保持不变，未重绘未换人）。这里只写路径基名，扩展名由
   avatarSvg 拼：支持 WebP 的浏览器取 .webp（约 PNG 的 1/6），其余浏览器
   取 192px PNG（按 44px 展示、3× 屏上限生成，圆容器 cover 裁切不拉伸）。 */
const AVATAR_IMG = {
  'elder-male': 'assets/avatars/elder-male',
  'elder-female': 'assets/avatars/elder-female',
  'adult-male': 'assets/avatars/adult-male',
  'adult-female': 'assets/avatars/adult-female',
  'couple': 'assets/avatars/couple',
  'self': 'assets/avatars/self',
  'worker': 'assets/avatars/worker',
  'other': 'assets/avatars/other',
  'neutral': 'assets/avatars/neutral',
};

/* 取成员头像：有位图时返回 <picture>（WebP 优先 + PNG 兜底，装饰性
   aria-hidden）；角色没有位图时回退内联 SVG 线描，映射不到则用中性头像，
   保证任何情况都不会渲染成空白。 */
function avatarSvg(role) {
  const base = AVATAR_IMG[role];
  if (base) {
    return '<picture class="ava-pic"><source type="image/webp" srcset="' + base + '.webp">'
      + '<img class="ava-img" src="' + base + '.png" alt="" aria-hidden="true" decoding="async">'
      + '</picture>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + (AVATARS[role] || AVATARS.neutral) + '</svg>';
}

function memberAvatarRole(beneficiary, mode) {
  if (mode === 'self') return 'self';
  const b = String(beneficiary || '').trim();
  if (!b) return 'neutral';
  if (b === '配偶') return 'couple';
  if (AVATAR_MALE_WORDS.indexOf(b) >= 0) return 'elder-male';
  if (AVATAR_FEMALE_WORDS.indexOf(b) >= 0) return 'elder-female';
  return 'neutral';
}

function mountChoiceAvatars(root) {
  (root || document).querySelectorAll('.choice-grid .choice[data-role]').forEach((btn) => {
    const badge = btn.querySelector('.ch-badge');
    if (!badge || badge.dataset.ava === '1') return;
    badge.dataset.ava = '1';
    badge.classList.add('ch-ava');
    badge.textContent = '';
    badge.innerHTML = avatarSvg(CHOICE_AVATARS[btn.dataset.role] || 'neutral');
  });
}

function validLastMatch(session) {
  const m = session && session.pf_last_match;
  if (!m || typeof m !== 'object') return null;
  if (!Number.isInteger(m.count) || m.count < 0) return null;
  if (m.mode !== 'self' && m.mode !== 'family') return null;
  const now = Date.now();
  if (typeof m.ts !== 'number' || !isFinite(m.ts) || m.ts > now) return null;
  if (now - m.ts > 24 * 60 * 60 * 1000) return null;
  return m;
}

function discoverRouteTarget() {
  const s = store.read();
  const lm = validLastMatch(s);
  if (lm) return lm.mode === 'self' ? 'self.html' : 'discover.html';
  const hasSelf = !!(s.selfText || (s.selfProfile && s.selfProfile.mode === 'self'));
  const hasFam = !!(s.text || s.beneficiary);
  if (hasSelf && hasFam) return 'discover.html';
  if (hasSelf) return 'self.html';
  if (hasFam) return 'discover.html';
  return 'family.html';
}

function renderBottomNav(active) {
  const icons = {
    home: iconF('home'),
    discover: iconF('compass'),
    consult: iconF('headset'),
    mine: iconF('user'),
  };
  const tabs = [
    { key: 'home', label: '首页' },
    { key: 'discover', label: '发现' },
    { key: 'consult', label: '咨询' },
    { key: 'mine', label: '我的' },
  ];
  return '<nav class="tabbar" aria-label="底部导航">'
    + tabs.map(function (t) {
      const isActive = t.key === active;
      const disabled = !!t.disabled;
      const attrs = 'type="button" class="tab-item' + (isActive ? ' is-active' : '')
        + (disabled ? ' is-disabled' : '') + '"'
        + ' data-tab="' + t.key + '"'
        + (isActive ? ' aria-current="page"' : '')
        + (disabled ? ' aria-disabled="true"' : '');
      return '<button ' + attrs + '>' + icons[t.key]
        + '<span>' + escapeHtml(t.label) + '</span></button>';
    }).join('')
    + '</nav>';
}

/* --------------------------------------------------------------------------
 * 「发现」高亮意图（一次性，消费即清除）
 * 用户在底部导航点「发现」时写入，落地页挂导航时读取并立即删除。
 * 高亮与路由分离：无会话时「发现」仍按原稳定版路由落在 family.html
 * （首页分区），但导航上「发现」显示为选中。页面 HTML 结构、样式、
 * 其他入口的路由行为完全不变。
 * -------------------------------------------------------------------------- */
const PF_NAV_INTENT_KEY = 'pf_nav_intent';

function readNavIntent() {
  try {
    const v = sessionStorage.getItem(PF_NAV_INTENT_KEY);
    if (v) sessionStorage.removeItem(PF_NAV_INTENT_KEY);
    return v === 'discover' ? 'discover' : null;
  } catch (e) {
    return null;
  }
}

function writeNavIntent(key) {
  try {
    if (key) sessionStorage.setItem(PF_NAV_INTENT_KEY, key);
    else sessionStorage.removeItem(PF_NAV_INTENT_KEY);
  } catch (e) { /* 存储不可用时静默降级，仅影响高亮不影响路由 */ }
}

function setBottomNavActive(root, key) {
  if (!root) return;
  root.querySelectorAll('.tab-item').forEach(function (btn) {
    const on = btn.dataset.tab === key;
    btn.classList.toggle('is-active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
}

function mountBottomNav(active) {
  const app = document.querySelector('.app');
  if (!app || app.querySelector('.tabbar')) return;
  app.classList.add('has-tabbar');
  // 落地页若带有「发现」点击意图，只把「发现」项渲染为选中；
  // 路由 active 仍用页面本来的分区，点击去重判断不受影响。
  const intent = readNavIntent();
  const visualActive = intent || active;
  app.insertAdjacentHTML('beforeend', renderBottomNav(visualActive));
  const root = app.querySelector('.tabbar');
  if (!root) return;
  root.addEventListener('click', function (e) {
    const btn = e.target.closest('.tab-item');
    if (!btn) return;
    const key = btn.dataset.tab;
    // 当前标签组已经代表用户所在的业务上下文，重复点击不再整页重载。
    // 「发现」同时覆盖家庭/本人两种结果页，因此 active 判断必须优先于动态路由。
    if (key === active) {
      // 视觉激活（来自「发现」意图）与真实分区不同时，点击本组 tab
      // 先把高亮归位到真实分区（如 family.html 上点「首页」），页面不重载。
      if (visualActive !== active) setBottomNavActive(root, active);
      return;
    }
    if (key === 'consult') {
      writeNavIntent(null);
      location.href = 'consult.html';
      return;
    }
    if (key === 'discover') {
      writeNavIntent('discover');
      location.href = discoverRouteTarget();
      return;
    }
    if (key === 'home') {
      writeNavIntent(null);
      location.href = 'index.html';
    }
    if (key === 'mine') {
      writeNavIntent(null);
      // 2026-10-29：我的 → 独立服务页（原 mine-sheet 弹层能力已迁入 services.html，
      // 会话信息 / 重新评估家庭情况 / 为自己查找 / 重置本次查询 全部保留）
      location.href = 'services.html';
      return;
    }
  });
}

function consultOfficialUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch (e) {
    return '';
  }
}

function mineSessionLines() {
  const s = store.read();
  const role = memberAvatarRole(s.beneficiary, s.selfProfile && s.selfProfile.mode === 'self' ? 'self' : null);
  if (s.beneficiary) {
    const age = (s.profile && typeof s.profile.age === 'number') ? s.profile.age + ' 岁' : '';
    return { mode: '家庭协助', relation: (s.operator || '未选择') + ' → ' + s.beneficiary, extra: age, role: role };
  }
  if (s.selfProfile && s.selfProfile.mode === 'self') {
    const age = (typeof s.selfProfile.age === 'number') ? s.selfProfile.age + ' 岁' : '';
    return { mode: '本人模式', relation: '本人', extra: age, role: 'self' };
  }
  return { mode: '尚未开始', relation: '尚未建立家庭画像', extra: '', role: 'neutral' };
}

function renderTopbar(title, parentHref, sub) {
  const el = document.querySelector('.topbar');
  if (!el) return;
  const tag = sub ? `<span class="theme-tag">${escapeHtml(sub)}</span>` : '';
  let back = '';
  if (parentHref) {
    // href 保留：既是无 JS / 中键新窗口的兜底，也让父页面关系可被查看
    back = `<a class="back-link" href="${escapeHtml(parentHref)}" data-back="1">${icon('arrow-left')}返回</a>`;
  }
  el.innerHTML = `
    <div class="brand-row">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">政策找人 · AI赋能公共服务权益发现</div>
      </div>
      ${tag}
    </div>
    <div style="margin-top:10px">${back}</div>`;

  // 登记本页父页面（返回时按它跳转，不看浏览器历史）
  registerNavParent(parentHref);

  const backEl = el.querySelector('[data-back]');
  if (backEl) {
    backEl.addEventListener('click', function (e) {
      e.preventDefault();
      goToParent(parentHref);
    });
  }
}
