(() => {
  const labels = {
    met: '按所填信息符合单项条件', failed: '按所填信息不符合单项条件',
    reported_result: '已记录用户转述，仍待受理单位核验',
    context_recorded: '已提供办理信息',
    unknown: '信息尚不明确', official_required: '需要官方认定', policy_unverified: '政策依据待核实'
  };
  const sources = {
    user_input: '用户提供', user_corrected: '用户核对修正', user_description: '依据用户描述提取',
    user_reported_official_result: '用户转述正式结果'
  };
  function status(row, item) {
    if (item?.status === '仅供进一步了解' && !item.next_step) return 'policy_unverified';
    if (row.action_status) return row.action_status;
    if (['disability', 'family_economic'].includes(row.key) || row.is_threshold) return 'official_required';
    return Object.hasOwn(labels, row.state) ? row.state : 'unknown';
  }
  function conditionLabel(row, item) {
    return [labels[status(row, item)], row.requirement || row.label, sources[row.fact_source],
      row.reported_issuer, row.source_ref].filter(Boolean).join(' · ');
  }
  function next(item) {
    if (item.next_step?.text) return item.next_step.text;
    if (item.excluded) return '核对与已知情况冲突的条件。';
    if (item.status === '仅供进一步了解') return '先核实政策时效与适用地区。';
    return '查看待核实条件和适用的办理渠道。';
  }
  function channels(rows, esc) {
    const link = (url, label) => {
      try {
        const verified = new URL(url);
        if (verified.protocol === 'https:' && verified.hostname.endsWith('.gov.cn') &&
            !verified.username && !verified.password) {
          return `<a href="${esc(verified.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        }
      } catch {}
      return '';
    };
    if (!rows?.length) return '<p>具体受理窗口、地址、电话和线上入口待核实。</p>';
    return rows.map(row => `<div class="official-channel">
      <p><strong>${esc(row.name)}</strong> · ${esc(row.level)} · ${esc(row.region)}</p>
      <p>${esc(row.method)}</p>
      <p>${esc(row.address || (row.role === 'directory' ? '具体窗口地址待核实' : '线下地址待核实'))} · ${esc(row.phone || '电话待核实')}</p>
      <p>${link(row.online_url, row.role === 'directory' ? '打开官方联系目录' : '进入官方办理入口') ||
        (row.method.startsWith('线上') ? '按上述平台名称查找，网页直达链接待核实。' : '线上办理入口待核实。')}</p>
      <p>${link(row.source_url, '渠道来源')} · ${esc(row.source_ref)} · 核验于 ${esc(row.checked_at)}</p>
    </div>`).join('');
  }
  window.PFActionability = {status, conditionLabel, next, channels};
})();
