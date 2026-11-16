/* Read-only semantic candidates. Keep the existing rule result and storage untouched. */
window.PFSemanticResult = (() => {
  const esc = value => escapeHtml(value ?? '');
  const structuredSignals = {
    help: {sometimes:'日常生活偶尔需要他人照料', often:'日常生活经常需要他人照料'},
    mobility: {yes:'行动不便'},
    meal: {yes:'需要社区助餐'},
    delivery: {yes:'需要送餐服务'},
    living: {alone:'独居'},
  };
  // Memory/history for the current result entry only. No extra storage keys.
  let latest = history.state?.pfSemanticResult;
  const detailURL = id => PFNavigation.withParams(PFNavigation.detailURL(id), {semantic: 1});

  function context(profile) {
    const form = profile?.uiForm;
    if (!form?.city) return null;
    const scenes = new Set([...(form.scenes || []), ...(form.ai?.confirmed || [])]);
    for (const [field, options] of Object.entries(structuredSignals)) {
      const value = options[form.answers?.[field]];
      if (value) scenes.add(value);
    }
    const description = form.ai?.status === 'skipped' ? '' : (form.ai?.description || '').trim();
    const base = Object.fromEntries(['confirmed_scenes', 'scenes_edited', 'hukou', 'insurance', 'disability',
      'family_economic', 'relation', 'operator', 'mode'].filter(key => profile[key] !== undefined).map(key => [key, profile[key]]));
    return {
      query: {text: profile.raw_text || '', mode: profile.mode, profile: base},
      description, scenes: [...scenes],
      inferences: form.ai?.status === 'success' ? form.ai.suggestions || [] : [],
    };
  }

  function present(area, list, result, input) {
    const entries = new Map(result.entries.map(entry => [entry.policy_id, entry]));
    for (const card of area.querySelectorAll('.rp-list .rp-policy[data-id]')) {
      const entry = entries.get(card.dataset.id);
      if (!entry) continue;
      card.innerHTML = PFResultPresentation.cardContent(entry.rule_matches[0], entry, input);
      entries.delete(card.dataset.id);
    }

    const extras = [...entries.values()];
    const group = (title, pending) => {
      const rows = extras.filter(entry => (entry.display_state !== 'candidate') === pending);
      if (!rows.length) return '';
      return `<section><h3>${title}</h3>${rows.map(entry =>
        `<article class="rp-policy rp-ai-card" data-ai-policy="${esc(entry.policy_id)}">${PFResultPresentation.cardContent(null, entry, input)}</article>`
      ).join('')}</section>`;
    };
    list.innerHTML = group('AI 补充发现', false) + group('待进一步核实的线索', true);
    const empty = area.querySelector('.rp-empty');
    if (empty) {
      empty.hidden = area.querySelector('.rp-list .rp-policy') !== null || result.entries.length > 0;
      if (!empty.hidden) {
        const state = result.aiState;
        empty.dataset.emptyState = state;
        empty.querySelector('h2').textContent = state === 'no-match' ? '现有目录中本次暂无匹配' :
          state === 'ai-failed' ? '规则暂无匹配，AI 补充未完成' : '现有目录的规则匹配暂无结果';
        empty.querySelector('p').textContent = '可以修改查询条件，或补充生活情况后重新查询。';
      }
    }
    PFPolicyBatch.mount(area, result);
  }

  const unavailableCodes = new Set(['AI_UNAVAILABLE', 'CONFIG_MISSING_KEY']);

  function mount(area, profile, saved) {
    const input = context(profile);
    if (!input || !document.documentElement.classList.contains('structured-results')) return;
    const panel = document.createElement('section');
    panel.className = 'rp-ai-panel';
    panel.setAttribute('aria-labelledby', 'rp-ai-title');
    panel.innerHTML = `<h2 id="rp-ai-title">AI 综合研判</h2>
      <p class="rp-ai-intro">结合生活情况解释相关政策。点击后，补充描述、生活变化和相关条件会发送给 DeepSeek。</p>
      <p data-ai-status role="status"></p>
      <button type="button" data-ai-discover>综合分析本次政策</button>`;
    area.prepend(panel);
    const list = document.createElement('div');
    list.className = 'rp-ai-list';
    area.append(list);
    const status = panel.querySelector('[data-ai-status]');
    const intro = panel.querySelector('.rp-ai-intro');
    const button = panel.querySelector('button');
    const queryId = saved?.queryId;
    const key = JSON.stringify([input, queryId]);
    let ruleEntries = [];
    let assessment;
    let aiFailed = false;
    let checkingRules = !!saved;
    let ruleReadFailed = false;
    const ruleStatus = document.createElement('p');
    ruleStatus.setAttribute('role', 'status');
    ruleStatus.dataset.ruleAdmissionStatus = '';
    const retryRules = document.createElement('button');
    retryRules.type = 'button';
    retryRules.textContent = '重试规则候选核对';
    retryRules.hidden = true;
    panel.before(ruleStatus, retryRules);

    function paint() {
      if (!saved) {
        if (assessment || aiFailed) present(area, list, {...assessment, entries:assessment?.entries || [],
          aiState:aiFailed ? 'ai-failed' : 'no-match'}, input);
        return;
      }
      const ruleIds = new Set(saved.result.results.map(row => row.policy_id));
      const enhanced = new Map((assessment?.entries || []).map(entry => [entry.policy_id, entry]));
      const entries = ruleEntries.map(rule => {
        const ai = enhanced.get(rule.policy_id);
        return ai ? {...rule, origin:ai.origin, semantic_matches:ai.semantic_matches,
          personalized_explanation:ai.personalized_explanation} : rule;
      });
      entries.push(...[...enhanced.values()].filter(entry => !ruleIds.has(entry.policy_id)));
      PFPolicyBatch.afterSave(area, () => {
        if (panel.isConnected) present(area, list, {entries, unassessed:checkingRules || ruleReadFailed,
          aiState:aiFailed || assessment?.errors.length ? 'ai-failed' : assessment ? 'no-match' : 'rule-zero'}, input);
      });
    }

    async function loadRules() {
      checkingRules = true;
      retryRules.hidden = true;
      ruleStatus.textContent = '正在核对规则候选的政策依据。';
      try {
        const data = await PFBusiness.ruleAdmission(queryId, saved.memberId);
        if (!panel.isConnected) return;
        if (data.queryId !== queryId || data.memberId !== saved.memberId || !Array.isArray(data.entries)) {
          throw Error('规则候选与本次查询范围不一致。');
        }
        ruleEntries = data.entries;
        ruleReadFailed = false;
        ruleStatus.textContent = ruleEntries.some(entry => entry.followupProof) ?
          '已通过政策依据核对的规则候选可以选择。申请资格仍需核实。' :
          ruleEntries.length ? '已有规则结果可查看。当前没有通过来源、时效与条件核对的可选政策。' : '';
      } catch (error) {
        if (!panel.isConnected) return;
        ruleReadFailed = true;
        ruleStatus.textContent = '规则候选核对未完成。' + error.message;
        retryRules.hidden = false;
      } finally {
        checkingRules = false;
        if (panel.isConnected) paint();
      }
    }
    retryRules.onclick = loadRules;

    function showState(state) {
      panel.dataset.aiState = state;
      intro.hidden = state !== 'ready';
      button.hidden = state === 'complete' ||
        !!(saved && new URLSearchParams(location.search).has('attempt'));
      button.disabled = state === 'loading';
      button.textContent = {ready: '综合分析本次政策', loading: '正在核对政策…', retry: '重试 AI 分析',
        unavailable:'重试 AI 分析', complete:'重新综合分析'}[state] || '';
    }

    function showResult(result) {
      assessment = result;
      aiFailed = false;
      paint();
      const unavailable = result.errors.length && result.errors.every(error => unavailableCodes.has(error.code));
      showState(unavailable ? 'unavailable' : result.errors.length ? 'retry' : 'complete');
      status.textContent = unavailable ? '当前 AI 分析不可用。' : result.errors.length ?
        '部分 AI 补充分析未完成。' : result.entries.length ? 'AI 补充核对已完成。' : '';
    }

    showState('ready');
    if (saved?.assessment) showResult(saved.assessment);
    else if (!saved && latest?.key === key && latest.result?.version === 'assessment.v1') showResult(latest.result);
    else if (saved) paint();
    else PFPolicyBatch.mount(area, {entries: [], unassessed: true});
    if (saved) loadRules();

    button.onclick = async () => {
      showState('loading');
      status.textContent = '';
      try {
        const result = await API.post('/api/ai/assess', queryId ? {queryId} : input);
        if (!panel.isConnected) return;
        if (!Array.isArray(result?.entries) || !Array.isArray(result.errors))
          throw Error('研判响应格式异常。');
        if (!saved) {
          latest = {key, result};
          try { history.replaceState({...history.state, pfSemanticResult: latest}, ''); } catch {}
        } else saved.assessment = result;
        showResult(result);
        if (saved) {
          try {
            const updated = await PFBusiness.history(queryId);
            if (!panel.isConnected) return;
            saved.assessmentAttempts = updated.assessmentAttempts;
            document.dispatchEvent(new Event('pf-query-loaded'));
          } catch {
            if (panel.isConnected) status.textContent += ' 分析记录暂未刷新，可重新打开本次查询。';
          }
        }
      } catch (error) {
        if (!panel.isConnected) return;
        const unavailable = unavailableCodes.has(error.payload?.error);
        aiFailed = true;
        paint();
        showState(unavailable ? 'unavailable' : 'retry');
        status.textContent = (unavailable ? '当前 AI 分析不可用。' : '这次 AI 补充分析未完成。') +
          (saved?.result.results.length ? ' 已有规则候选仍可查看，通过核对的政策仍可选择和保存。' : '');
      }
    };
  }

  return {mount};
})();
