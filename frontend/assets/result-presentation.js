/* Results presentation shared by the rule list and AI-only cards. */
window.PFResultPresentation = (() => {
  const details = new Map();
  const esc = value => escapeHtml(value ?? '');
  const topics = {
    meal: '餐食支持', mobility: '行动与出行支持', care: '日常照料',
    medical: '医疗费用与保障', financial: '经济困难与救助',
    memory: '认知与记忆支持', health: '日常健康支持',
  };

  async function prepare(data) {
    if (data.policyDetails) {
      details.clear();
      for (const [id, policy] of Object.entries(data.policyDetails)) details.set(id, policy);
      return;
    }
    await Promise.allSettled((data.results || []).map(async row => {
      if (!details.has(row.policy_id)) details.set(row.policy_id, await API.policy(row.policy_id));
    }));
  }

  function list(items, fallback) {
    return items.length ? `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>` : `<p>${fallback}</p>`;
  }

  function conditionRows(rule, entry) {
    const analysis = entry?.condition_analysis;
    const items = [entry?.personalized_explanation?.next_check,
      ...(analysis?.official_confirmation || []).map(row => ({...row, kind: '向主管部门核实'})),
      ...(analysis?.cannot_determine || []).map(row => ({...row, kind: '目前无法判断'})),
      ...(analysis?.unconfirmed_conditions || []),
      ...(rule?.missing_information || []).map(text => ({text}))];
    const unique = new Map();
    for (const row of items) {
      if (!row?.text) continue;
      if (!unique.has(row.text)) unique.set(row.text, row);
      else if (row.kind && !unique.get(row.text).kind) unique.set(row.text, {...unique.get(row.text), kind: row.kind});
    }
    return [...unique.values()];
  }

  function evidenceLinks(entry, policy) {
    const refs = new Map();
    const add = proof => {
      if (proof?.reference && proof.text && !refs.has(proof.reference)) {
        refs.set(proof.reference, {...proof, id: `proof-${entry?.policy_id || policy.policy_id}-${refs.size + 1}`});
      }
    };
    for (const link of entry?.personalized_explanation?.links || []) add(link.policy_evidence);
    for (const match of entry?.semantic_matches || []) add(match.explanation?.policy_evidence);
    add({reference: 'description:0', text: entry?.summary || policy?.description});
    return refs;
  }

  function proofLink(ref, refs) {
    const proof = refs.get(ref);
    if (!proof) return '';
    const number = [...refs.keys()].indexOf(ref) + 1;
    return ` <a href="#${esc(proof.id)}" data-policy-proof>依据 ${number}</a>`;
  }

  function linkReason(link, refs, includeUser = false) {
    const pending = link.user_evidence.kind === 'ai_inferred_unconfirmed';
    const quote = includeUser ? `「${link.user_evidence.text}」` : '';
    const context = pending ? `待确认的情况${quote}可能涉及` : `本次生活情况${quote}与政策记录的`;
    const text = link.relationship === 'age_scope' ? '已填写的年龄在政策记录的年龄范围内。' :
      link.relationship === 'region_scope' ? '本次查询地区与政策适用地区一致。' :
      `${context}${topics[link.relationship] || '服务方向'}${pending ? '。' : '相关。'}`;
    return `${esc(text)}${proofLink(link.policy_ref, refs)}`;
  }

  function why(rule, entry, refs) {
    const links = entry?.personalized_explanation?.links || [];
    const specific = links.find(link => topics[link.relationship]) || links[0];
    if (specific) return linkReason(specific, refs);
    if (rule?.ai_reason?.length) return esc(rule.ai_reason[0]);
    const semantic = entry?.semantic_matches?.[0]?.explanation;
    if (semantic) return `可能与${esc(semantic.direction)}有关。${proofLink(semantic.policy_evidence?.reference, refs)}`;
    return '当前缺少更具体的关联依据。';
  }

  function explanation(rule, entry, input, refs, pending) {
    if (!entry) {
      const reasons = rule?.ai_reason || [];
      if (reasons.length < 2 && pending.length < 3) return '';
      return `<details class="rp-explanation"><summary>查看完整匹配理由与条件</summary>
        ${list(reasons.map(esc), '暂未记录匹配理由。')}
        ${list(pending.map(row => esc(row.text)), '暂未记录待核实事项。')}</details>`;
    }
    const analysis = entry.condition_analysis;
    const links = entry.personalized_explanation?.links || [];
    const directions = [...new Set((entry.semantic_matches || []).map(match => match.explanation?.direction).filter(Boolean))];
    const facts = (analysis.user_confirmed || []).map(row => `${esc(row.text)}${typeof row.value === 'boolean' ? row.value ? ' · 是' : ' · 否' : row.value ? ' · ' + esc(row.value) : ''}`);
    const inferred = (analysis.ai_inferred_needs || []).map(row => `${esc(row.text)}${row.evidence ? ' · 来自「' + esc(row.evidence) + '」' : ''}`);
    const reasons = [...new Set(links.map(link => linkReason(link, refs, true)))];
    if (!reasons.length) reasons.push(why(rule, entry, refs));
    return `<details class="rp-explanation" data-assessment-evidence><summary>查看个性化解释</summary>
      <div class="rp-explanation-body">
        <h4>用户原始描述</h4><p class="rp-original">${esc(input.description || '本次分析未使用补充描述。')}</p>
        <h4>AI 识别的生活场景</h4>${list(directions.map(esc), '本项暂无已记录的 AI 关联场景。')}
        <h4>已确认事实</h4>${list(facts, '暂无已确认事实。')}
        <h4>AI 推断但未确认的信息</h4>${list(inferred, '本项暂无待确认的 AI 推断。')}
        <h4>为什么该政策可能相关</h4>${list(reasons, '当前缺少具体关联。')}
        ${entry.personalized_explanation?.status === 'no_specific_evidence' ? '<p>现有信息尚不足以确认更具体的关联。</p>' : ''}
        ${rule?.ai_reason?.length ? `<details><summary>原规则匹配理由</summary>${list(rule.ai_reason.map(esc), '')}</details>` : ''}
        <h4>尚待核实的条件</h4>${list(pending.map(row =>
          `<span title="${esc(row.reference)}">${esc(row.text)}${row.kind ? ' · ' + esc(row.kind) : ''}</span>`), '暂未记录待核实事项。')}
      </div></details>`;
  }

  function policyBasis(rule, entry, policy, refs) {
    const state = entry?.evidence_state;
    const source = state?.source || policy?.source || {};
    const verification = state?.verification_record || policy?.verification || {};
    const url = state?.official_url || source.official_url || rule?.source_official_url;
    const safeUrl = /^https?:\/\//i.test(url || '') ? url : '';
    const validity = state?.validity_status || rule?.validity?.status ||
      (policy?.validity?.effective_from || policy?.validity?.expires_at ? policy.validity.status : 'unknown');
    const validityLabel = {active: '库内有明确时效记录', expiring: '库内记录显示临近到期',
      expired: '库内记录显示已过期', superseded: '库内记录显示已替代',
      repealed: '库内记录显示已废止', historical: '历史政策版本',
      not_yet_effective: '库内记录显示尚未生效'}[validity] || '有效性待核实';
    const metadata = [
      ['文号', source.document_no || rule?.source_document_no],
      ['发布部门', source.department || rule?.source_department],
      ['有效状态', validityLabel],
      ['核验时间', verification.checked_at || rule?.source_checked_at],
    ];
    return `<details class="rp-basis"><summary>查看政策依据</summary>
      ${refs.size ? `<h3>库内证据</h3><ol>${[...refs.values()].map(proof => `<li id="${esc(proof.id)}" tabindex="-1" title="${esc(proof.reference)}">${esc(proof.text)}</li>`).join('')}</ol>` : ''}
      <dl>${metadata.map(([name, value]) => `<div><dt>${name}</dt><dd>${esc(value || '暂未记录')}</dd></div>`).join('')}</dl>
      ${safeUrl ? `<a class="rp-official" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">查看官方原文${source.document ? ' · ' + esc(source.document) : ''}</a>` : '<p>官方原文链接暂未记录。</p>'}
    </details>`;
  }

  function cardContent(rule, entry, input) {
    const id = entry?.policy_id || rule.policy_id;
    const policy = details.get(id);
    const verification = policy?.verification?.status || rule?.source_status;
    const state = entry?.evidence_state;
    const verified = state ? state.official_source_verified : verification === 'verified';
    const label = verified ? '来源已核验' :
      state?.insufficient_evidence ? '来源证据不足' :
      state?.source_recorded || verification === 'to_verify' ? '来源待核验' : '来源状态暂缺';
    const origin = {rule: '规则匹配候选', semantic: 'AI 发现候选', both: '规则与 AI 共同发现'}[entry?.origin || 'rule'];
    const refs = evidenceLinks(entry, policy || {policy_id: id});
    const pending = conditionRows(rule, entry);
    const href = entry ? PFNavigation.withParams(PFNavigation.detailURL(id), {semantic: 1}) : PFNavigation.detailURL(id);
    return `<div class="rp-card-head"><h2>${esc(entry?.policy_name || rule.policy_name)}</h2></div>
      <div class="rp-tags"><span data-rule-channel>${origin}</span><span class="rp-status${verified ? '' : ' pending'}">${label}</span>
      ${state?.validity_pending || (!state && rule?.validity?.status === 'unknown') ? '<span class="rp-status unknown">有效性待核实</span>' : ''}
      ${entry?.display_state === 'candidate' ? '<span class="rp-status pending">资格待核实</span>' : ''}
      ${entry?.condition_analysis?.hard_condition_conflict ? '<span class="rp-status pending">与已确认条件不符</span>' : ''}
      ${state?.validity_status === 'expired' ? '<span class="rp-status pending">政策已失效</span>' : ''}</div>
      <p class="rp-meta">${esc(entry?.region || rule?.region || '')}</p>
      <div class="rp-reasons"><h3>为什么可能相关</h3><p>${why(rule, entry, refs)}</p></div>
      <div class="rp-missing"><h3>优先核实</h3>${list(pending.slice(0, 2).map(row => esc(row.text)), '暂未记录优先核实事项。')}</div>
      ${explanation(rule, entry, input, refs, pending)}
      ${policyBasis(rule, entry, policy, refs)}
      <a class="result-foot" href="${esc(href)}">查看政策详情 →</a>`;
  }

  function render(data) {
    const rows = data.results || [];
    const conflicts = (data.profile?.conflicts || []).filter(item => item.kind === '年龄');
    const notice = conflicts.map(item => `<p role="status" class="rp-count">${esc(item.note)}（${esc(item.said.join('、'))}）</p>`).join('')
      + (!data.profile?.region ? '<p role="status" class="rp-count">请确认受益人所在城市，再核对当地政策。</p>' : '');
    if (!rows.length) return `${notice}<section class="rp-empty" data-empty-state="rule-zero">
      <h2>现有目录的规则匹配暂无结果</h2><p>可以修改查询条件，或补充生活情况后重新查询。</p>
      <div class="rp-empty-actions">
        <a data-edit-query href="${esc(PFNavigation.queryInfoURL({latest:true}))}">修改查询条件</a>
        <a data-describe-query href="${esc(PFNavigation.queryInfoURL({latest:true,describe:true}))}">补充生活情况并重新查询</a>
        <a href="discovery-c.html">浏览现有政策目录</a>
      </div></section>`;
    return `${notice}<section class="rp-list" aria-label="原规则匹配政策">
      <p class="rp-count">${rows.length} 项规则匹配 · 资格以主管部门核实为准</p>
      ${rows.map(rule => `<article class="result-card rp-policy" data-id="${esc(rule.policy_id)}">${cardContent(rule)}</article>`).join('')}</section>`;
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-policy-proof]');
    if (!link) return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    event.preventDefault();
    target.closest('details').open = true;
    target.focus();
    target.scrollIntoView({block: 'center'});
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (PFNavigation.route().type !== 'result') return;
    if (window.PFQuerySnapshot?.id) return;
    const session = store.read();
    const profile = location.pathname.endsWith('/self.html') ? session.selfProfile : session.profile;
    if (profile && Object.keys(profile).length) return;
    const area = document.getElementById('resultArea');
    if (area) area.innerHTML = '<section class="rp-empty"><h2>尚未提交查询信息</h2><p>请先填写本人或家人的情况。</p></section>';
  });

  return {prepare, render, cardContent};
})();
