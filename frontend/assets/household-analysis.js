(() => {
  const app = document.querySelector('#app');
  const notice = document.querySelector('#notice');
  const params = new URLSearchParams(location.search);
  const cities = ['广州市', '佛山市'];
  const stages = {understand:'理解家庭情况', needs:'识别潜在需求', retrieve:'查找相关政策',
    verify:'核对政策适用条件', judge:'整理综合研判', chatting:'结合当前查询回答'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const query = values => new URLSearchParams(values).toString();
  const route = values => 'analysis.html?' + query(values);
  const list = values => values.length ? '<ul>' + values.map(value => `<li>${escape(value)}</li>`).join('') + '</ul>' : '';
  function shortText(value, limit) {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    const sentence = text.match(/^.{1,95}?[。！？](?=.)/)?.[0];
    return sentence && sentence.length <= limit ? sentence : text.slice(0,limit - 1) + '…';
  }
  const panel = (title, inner) => `<section class="panel"><h2>${title}</h2>${inner}</section>`;
  const button = (label, primary = true) => `<button type="submit" class="${primary ? 'primary' : ''}">${label}</button>`;
  const hero = (title, copy = '', art = false) => `<section class="flow-hero${art ? ' with-art' : ''}"><h1>${title}</h1>${copy ? `<p>${copy}</p>` : ''}</section>`;
  function header(title, back = 'find.html') {
    document.querySelector('#flow-title').textContent = title;
    const backLink = document.querySelector('#flow-back');
    backLink.href = back;
    backLink.onclick = null;
    backLink.setAttribute('aria-label','返回上一页');
    window.PFNavigation?.mount();
    const mine = document.querySelector('#flow-mine');
    if (mine) mine.href = 'services.html?' + query({member:memberId});
  }
  let state, members = [], memberId = params.get('member'), busy = false;
  let savingFavorites = 0;
  const demoCases = {
    medical: {age:68, region:'佛山市', description:'我妈妈今年68岁，住在佛山市，参加了佛山市基本医疗保险。今年住院，报销后个人自费3万元，家庭收入偏低，想了解医疗救助。是否属于民政部门认定的困难家庭还不清楚。'},
    age: {age:68, region:'佛山市', description:'我妈妈今年65岁，住在佛山市。住院报销后自费3万元，家庭收入偏低，想了解医疗救助。'},
    meal: {age:68, region:'佛山市', description:'我妈妈今年68岁，住在佛山市。她只想找社区老年助餐点，平时身体健康，没有医疗支出或照护需求。'}
  };
  const demo = Object.hasOwn(demoCases, params.get('demo')) ? params.get('demo') : null;
  let fixtureAI = false;
  const demoLabel = () => fixtureAI ? '<p class="demo-note">合成验收 · AI 模拟结果</p>' :
    state?.result?.mode === 'ai' ? '<p class="demo-note">真实 DeepSeek 分析 · 资格待受理单位核验</p>' :
    (state ? state.demo : demo) ? '<p class="demo-note">合成家庭演示</p>' : '';

  async function request(path, data) {
    const response = await fetch('/api/followup/' + path, data ? {
      method:'POST', headers:{'Content-Type':'application/json','X-PF-Local':'1'}, body:JSON.stringify(data),
      keepalive:path === 'v32/chat'
    } : {});
    fixtureAI = response.headers.get('X-PF-Preview-AI') === 'fixture';
    const value = await response.json();
    if (!response.ok) throw Error(value.detail || '当前操作暂不可用。');
    return value;
  }

  const stateQuery = () => query({id:state?.id || params.get('id'), memberId});
  const getState = () => request('v32/state?' + stateQuery());
  const analysisRoute = (view = '') => route({id:state.id, member:memberId, ...(view ? {view} : {})});
  const currentView = () => new URLSearchParams(location.search).get('view');
  const currentMember = () => members.find(person => person.id === memberId);
  const isSelf = () => currentMember()?.relation === '本人';
  function memberContext() {
    const member = currentMember();
    const role = isSelf() ? 'self' : ['父亲','爷爷','外公'].includes(member?.relation) ? 'elder-male' :
      ['母亲','奶奶','外婆'].includes(member?.relation) ? 'elder-female' : member?.relation === '配偶' ? 'couple' : 'neutral';
    return `<div class="member-note member-context"><img src="assets/avatars/${role}.webp" alt="" width="40" height="40">
      <span><small>本次查询对象</small><strong>${escape(member?.name)}</strong>${member?.name === member?.relation ? '' : `<span class="member-relation">${escape(member?.relation)}</span>`}</span>
      <a href="find.html?choose=1">更换</a></div>`;
  }
  let draftTimer, draftWrite=Promise.resolve(), draftRevision=0;
  function rememberDraft(form) {
    clearTimeout(draftTimer);
    const status=document.getElementById('draft-status');
    if(!status)return;
    status.textContent='正在保存草稿…';
    const id=form.dataset.id, fields=readInput(form);
    draftTimer=setTimeout(()=>{
      draftWrite=draftWrite.then(async()=>{
        try{
          const saved=await request('v32/draft',{id,memberId,demo,revision:draftRevision,...fields});
          draftRevision=saved.revision;
          status.textContent='草稿已保存，可下次继续。';
        }catch(error){
          status.textContent='草稿保存未完成。当前输入仍在本页。'+error.message;
        }
      });
    },180);
  }
  const readBasic = form => ({age:form.elements.age.value === '' ? null : Number(form.elements.age.value),
    region:form.elements.region.value || null});
  const readInput = form => ({...readBasic(form), description:form.elements.description.value,
    supplement:form.elements.supplement.value, providedFacts:Object.fromEntries(
      ['hukou','insurance'].filter(key => form.elements.region.value && form.elements[key].value)
        .map(key => [key,form.elements[key].value === 'true']))});

  function basics(base) {
    return `<div class="fields"><label>年龄 <small>选填</small>
      <input name="age" type="number" min="0" max="120" step="1" value="${escape(base.age)}"></label>
      <label>所在地区<select name="region"><option value="">暂不提供</option>
      ${cities.map(city => `<option ${city === base.region ? 'selected' : ''}>${city}</option>`).join('')}</select></label></div>`;
  }

  function editor(group, values) {
    const fields = values.map((value, index) => `<input aria-label="${group} ${index+1}" name="${group}" maxlength="300" value="${escape(value)}">`);
    fields.push(`<input aria-label="补充${group}" placeholder="补充${group}（选填）" name="${group}" maxlength="300">`);
    return fields.join('');
  }

  function questions(items) {
    return items.map(item => `<label>${escape(item.text)}
      <select name="answer-${escape(item.key)}"><option value="">不清楚</option>
      ${item.options.length ? item.options.map(option => `<option value="${escape(option.value)}">${escape(option.label)}</option>`).join('')
        : '<option value="true">是</option><option value="false">否</option>'}</select>
      <small>用于核对 ${escape(item.policies.join('、'))}</small></label>`).join('');
  }

  function originals() {
    return `<details class="panel"><summary>查看原始描述</summary>
      <div class="original">${escape(Object.values(state.original_description).filter(Boolean).join('\n\n'))}</div></details>`;
  }

  async function start() {
    const data = await request('members');
    members = data.members.filter(person => !person.archivedAt);
    const first = params.has('self') ? members.find(person => person.relation === '本人') :
      members.find(person => person.name === '验收甲');
    if (!memberId && !params.has('id') && !params.has('self') && !demo && currentView() !== 'history') {
      location.replace('find.html?choose=1');
      return;
    }
    if (memberId && !params.has('id') && !members.some(person => person.id === memberId)) {
      throw Error('无法读取指定家庭成员，请返回发现重新选择。');
    }
    if (params.has('self') && !params.has('id') && (!first || (memberId && memberId !== first.id))) {
      throw Error('无法读取本人资料，请返回首页或在「我的」核对成员。');
    }
    if (!memberId) memberId = (first || members[0])?.id;
    if (!memberId) throw Error('请先在「我的」添加家庭成员。');
    state = params.has('id') ? await getState() : null;
    await render();
    if (state && stages[state.stage]) monitor().catch(showError);
  }

  async function input() {
    const records = await request('v32/history?' + query({memberId}));
    const prior = records.history.find(entry => entry.basic)?.basic || {};
    let priorDraft, draftError=false;
    if (currentView()!=='history' && !params.has('new')) {
      try{ priorDraft=(await request('v32/draft?'+query({memberId,...(demo?{demo}:{})}))).draft; }
      catch{ draftError=true; }
    }
    draftRevision=priorDraft?.revision||0;
    const saved = {age:prior.age ?? records.memberBasic?.age, region:prior.region ?? records.memberBasic?.region,
      ...demoCases[demo], ...priorDraft};
    const choices = members.map(person => `<option value="${escape(person.id)}" ${person.id === memberId ? 'selected' : ''}>${escape(person.name)}</option>`);
    const historyOnly = params.get('view') === 'history';
    header(historyOnly ? '查询历史' : isSelf() ? '我的情况' : '家庭情况', historyOnly ? 'find.html' : isSelf() ? 'index.html' : 'find.html?choose=1');
    app.innerHTML = `${hero(historyOnly ? '查询历史' : isSelf() ? '你最近有什么变化？' : '家里最近有什么变化？',
      historyOnly ? '' : isSelf() ? '说说你的近况，AI 会帮你查找可能相关的政策。' : '说说家里的近况，AI 会帮你查找可能相关的政策。')}${demoLabel()}
      ${historyOnly ? `<label class="member-field">家庭成员<select id="member">${choices.join('')}</select></label>` :
        memberContext()}
      ${historyOnly ? `<a class="button" href="${route({member:memberId,new:1})}">新建查询</a>` :
      `<form id="intake" data-id="${escape(saved.id || crypto.randomUUID())}">
        <label class="description-field">${isSelf() ? '描述你的情况' : '描述家庭情况'}<textarea name="description" required rows="5" maxlength="4000" placeholder="${isSelf() ? '例如，我最近住院，报销后仍有一笔自费支出，想了解有哪些政策可以进一步咨询。' : '例如，妈妈最近走路不方便，做饭和外出都需要人帮忙。'}">${escape(saved.description)}</textarea></label>
        ${basics(saved)}
        <details class="optional"><summary>补充生活情况（选填）</summary>
          <label>生活变化、身体或照护情况<textarea name="supplement" rows="2" maxlength="2000">${escape(saved.supplement)}</textarea></label>
          <p class="meta" id="facts-scope">户籍和参保以所选城市为准。</p>
          <div class="fields">${[['hukou','有本市户籍'],['insurance','参加本市基本医保']].map(([key,label]) =>
            `<label>${label}<select name="${key}"><option value="">不清楚 / 暂不填写</option>
              ${[true,false].map(value=>`<option value="${value}" ${saved.providedFacts?.[key] === value ? 'selected' : ''}>${value ? '是' : '否'}</option>`).join('')}</select></label>`).join('')}</div></details>
        <p class="muted" id="draft-status" role="status">${draftError?'暂时无法读取上次草稿。':priorDraft?'已恢复该成员的草稿。':'填写后会保存草稿。'}</p>
        <p class="muted">请省略身份证号、详细地址和电话号码。</p>
        ${button('开始 AI 分析')}
      </form>`}
      <details class="optional" id="history" ${historyOnly ? 'open' : ''}><summary>该成员的查询</summary></details>`;
    const target = document.querySelector('#history');
    if (!historyOnly && !saved.region) for (const key of ['hukou','insurance']) {
      document.querySelector('#intake').elements[key].disabled = true;
    }
    if (!target) return;
    target.insertAdjacentHTML('beforeend', records.history.length ? `<div class="history">${
      records.history.map(entry => `<a href="${escape(route({id:entry.id,member:memberId}))}">${
        escape(entry.description.slice(0,52))} · ${entry.hasResult ? '查看结果' : '继续查询'}</a>`).join('')}</div>`
      : '<p class="muted">暂无查询记录。</p>');
  }

  function progress() {
    header('发现');
    const steps = [['understand','理解家庭情况'],['retrieve','检索政策目录'],['verify','核对规则条件'],['judge','整理推荐结果']];
    const current = steps.findIndex(([key]) => key === (state.stage === 'needs' ? 'understand' : state.stage));
    if (!app.querySelector('.analysis-progress')) {
      app.innerHTML = `<section class="analysis-progress">
        <div class="analysis-progress-intro">
          <div class="analysis-orbit" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="m9 12 23 0 6 6v17H9zM15 22h17m-17 6h11m12-10h-6v-6"/></svg></div>
          <h1>AI 正在分析</h1><p>正在为 <strong>${escape(state.memberLabel)}</strong> 查找相关权益</p>
        </div>
        <ol class="analysis-steps">${steps.map(([,label])=>`<li><span>${label}</span><small></small></li>`).join('')}</ol>
        <p class="analysis-continue" role="status"></p>${demoLabel()}
      </section>`;
    }
    app.querySelectorAll('.analysis-steps li').forEach((item,index) => {
      const phase = index < current ? 'done' : index === current ? 'current' : 'waiting';
      item.dataset.phase = phase;
      if (phase === 'current') item.setAttribute('aria-current','step');
      else item.removeAttribute('aria-current');
      item.querySelector('small').textContent = {done:'已完成',current:'进行中',waiting:'未开始'}[phase];
    });
    app.querySelector('.analysis-continue').textContent = (stages[state.stage] || '正在分析') + '，完成后自动继续';
  }

  function review(isFallback = false) {
    const initial = state.pending_confirmation;
    const intake = state.intake || {};
    const base = initial?.basic || state.suggested_basic || state.basic;
    const conflict = state.suggested_basic?.conflicting_information?.find(item =>
      (item.key || 'age') === 'age' && !Object.hasOwn(state.conflict_resolution || {}, 'age'));
    const title = isFallback ? 'AI 分析暂不可用' : '核对这次查询用到的信息';
    app.innerHTML = `<h1>${title}</h1><p class="meta">${escape(state.memberLabel)}</p>${demoLabel()}
      ${isFallback ? `<p>原始描述已保存。可以先按基础规则查找，或稍后重试 AI。</p>
        <p class="muted">状态 ${escape(state.error)}</p>`
        : `<p>${escape(intake.analysis_summary)}</p><p class="muted">${escape(intake.confidence_or_uncertainty)}</p>`}
      <form id="${isFallback ? 'fallback' : 'confirm'}">
      ${panel('已明确事实', basics(base) + (conflict ? `<label><input type="checkbox" name="resolveAge" required>
        ${escape(conflict.said.join('、'))}。我已核对实际年龄</label>` : '')
        + (!isFallback ? editor('事实', initial?.facts || intake.extracted_facts || []) : ''))}
      ${isFallback ? '' : panel('AI 推断需求', editor('需求', initial?.needs || intake.inferred_needs || []))}
      ${intake.missing_information?.length ? `<details class="optional" id="review-questions"><summary>补充待核实事实（${intake.missing_information.length} 项，选填）</summary>${questions(intake.missing_information)}</details>` : ''}
      <div class="actions">${button(isFallback ? '运行基础规则查询' : '确认并查找政策')}
      ${isFallback ? '<button type="button" data-action="analyze">重试 AI 分析</button>' : ''}
      ${isFallback && state.result ? '<button type="button" data-action="previous">查看上次结果</button>' : ''}</div></form>${originals()}`;
  }

  function conflictReview() {
    const conflicts = state.suggested_basic.conflicting_information.filter(item =>
      !Object.hasOwn(state.conflict_resolution || {}, item.key || 'age'));
    const ageOnly = conflicts.length === 1 && (conflicts[0].key || 'age') === 'age';
    header('事实冲突核对', route({member:memberId}));
    app.innerHTML = `${hero(conflicts.length === 1 ? '发现' + escape(conflicts[0].kind) + '信息不一致' : '发现关键信息不一致',
      '请选择这次分析应使用的信息。', true)}${demoLabel()}
      <form id="resolve">${conflicts.map(item => {
        const key = item.key || 'age';
        const choices = key === 'region' ? cities : [];
        const formAge = item.formAge ?? state.basic.age;
        const descriptions = item.descriptionAges ?? item.said.filter(text=>!text.startsWith('表单'))
          .flatMap(text=>[...text.matchAll(/(\d+)\s*(?:周岁|岁)/g)].map(match=>Number(match[1])));
        const ageCompare = `<div class="age-compare"><div>表单填写<strong>${formAge == null ? '未填写' : escape(formAge) + ' 岁'}</strong></div>
          <div>描述提到<strong>${escape(descriptions.map(value=>value+' 岁').join(' / '))}</strong></div></div>`;
        return `<section class="panel conflict-panel">${key === 'age' ? ageCompare : `<h2>${escape(item.kind)}</h2>${list(item.said)}`}
          ${key === 'member' ? `<label><input type="checkbox" name="memberConfirmed" required>继续为${escape(state.memberLabel)}查询，仅使用与该成员有关的信息</label>`
          : key === 'age' ? `<fieldset class="age-sources"><legend>请确认实际年龄</legend>
            ${formAge == null ? '' : `<label><input type="radio" name="ageChoice" value="form:${escape(formAge)}" required>使用 ${escape(formAge)} 岁（表单）</label>`}
            ${descriptions.map(value=>`<label><input type="radio" name="ageChoice" value="description:${escape(value)}" required>使用 ${escape(value)} 岁（描述）</label>`).join('')}
            <label><input type="radio" name="ageChoice" value="custom" required>我来修改</label>
            <label id="custom-age" hidden>实际年龄<input name="age" type="text" inputmode="numeric" pattern="[0-9]{1,3}" maxlength="3" disabled></label>
            </fieldset><p class="flow-note">分析与规则核对都使用确认后的年龄，原始描述会保留。</p>`
          : `<label>选择实际${escape(item.kind)}<select name="${key}" required><option value="">请选择</option>
            ${choices.map(value=>`<option value="${escape(value)}">${escape(value)}${key === 'age' ? ' 岁' : ''}</option>`).join('')}</select></label>`}</section>`;
      }).join('')}${button(ageOnly ? '确认年龄并重新分析' : '确认并继续分析')}</form>
      <p><a href="find.html?choose=1">返回选择家庭成员</a></p>`;
  }

  function conditionGroups(item) {
    const rows = list(item.conditions.map(row => PFActionability.conditionLabel(row, item)));
    return `<h3>适用条件</h3>${rows || '<p>具体条件待核实。</p>'}
      ${item.excluded ? list(item.reasons) : ''}`;
  }

  function rightsSummary(review) {
    const eligible = review.guide.filter(item=>item.canPlan);
    const focus = eligible[0] || review.guide.find(item=>!item.excluded) || review.guide[0];
    const others = review.guide.filter(item=>item !== focus);
    const pending = focus.conditions.filter(row => ['unknown', 'official_required', 'reported_result', 'policy_unverified'].includes(PFActionability.status(row, focus)))
      .map(row => row.label || row.requirement);
    const status = focus.excluded ? '条件不满足' : focus.next_step?.kind === 'source' ? '政策依据待核实' :
      pending.length ? '资格待核实' : '可进一步了解';
    const next = PFActionability.next(focus);
    const purpose = focus.id === 'fs_med_002' ? '了解低保边缘家庭或支出型困难家庭的认定与救助。' : shortText(focus.purpose,48);
    return `${hero('为你整理好了', `已找到 ${review.guide.length} 项值得进一步了解的权益`)}${demoLabel()}
      <p class="muted">已保存。稍后可从「我的」恢复。</p>
      <section class="panel rights-focus"><p class="meta">重点关注 · ${escape(state.memberLabel)}</p>
        <h2>${escape(focus.name)}</h2><span class="tag">${status}</span><p>${escape(purpose)}</p>
        <p class="flow-note"><strong>下一步</strong>　${escape(next)}</p>
        ${pending.length && !focus.excluded ? '<h3>还需核实</h3>' + list([...new Set(pending)].slice(0,1)) : ''}
        ${focus.excluded ? list(focus.reasons.slice(0,3)) : ''}
        <details class="optional"><summary>详细条件与办理依据</summary>${guideCard(focus)}</details>
      </section>
      ${others.length ? `<details class="panel"><summary>其他权益（${others.length} 项）</summary>
        ${others.map(item=>`<details class="optional"><summary>${escape(item.name)}${item.excluded ? ' · 条件不满足' : ''}</summary>${guideCard(item)}</details>`).join('')}</details>` : ''}
      ${eligible.length && eligible.length < review.guide.length ? '<p class="muted">本次仅将可办理的权益纳入计划，其余权益保留在清单中。</p>' : ''}
      <div class="completion-actions"><form id="reviewed-plan"><button id="rights-next" class="primary" ${eligible.length ? '' : 'disabled data-unavailable'}>开始少跑腿计划</button></form>
      ${eligible.length ? '' : '<p class="muted">当前没有可纳入计划的权益，可调整选择或补充资料。</p>'}
      <div class="center-action"><a href="services.html?${query({member:memberId})}#mineFavorites">稍后再办</a>
        <a href="${escape(analysisRoute())}">调整权益选择</a></div></div>
      <p class="center-action subtle"><a href="${escape(analysisRoute('selected-edit'))}">修改核对条件</a></p>`;
  }

  function guideCard(item) {
    const detail = 'policy.html?' + query({id:item.id, region:item.region, member:memberId, semantic:1,
      analysis:state.id,version:state.result.version,from:analysisRoute('selected')});
    const evidenceList = rows => list(rows.map(row=>row.text + (row.verified ? (row.clause ? ' · ' + row.clause : '') : ' · 需向主管部门核实')));
    return panel(escape(item.name), `<p>${escape(item.purpose)}</p>${conditionGroups(item)}
      <h3>官方办理渠道</h3>${PFActionability.channels(item.channels, escape)}
      <h3>办理步骤</h3>${evidenceList(item.steps) || '<p>当前目录没有已收录的具体渠道，请向主管部门核实。</p>'}
      <h3>材料准备</h3>${evidenceList(item.materials) || '<p>当前目录未列明材料，请向主管部门核实。</p>'}
      <h3>下一步</h3><p>${escape(PFActionability.next(item))}</p>
      <p>${escape([item.source.department,item.source.document_no].filter(Boolean).join(' · '))}</p>
      <div class="card-links">${item.source.url ? `<a href="${escape(item.source.url)}" target="_blank" rel="noopener noreferrer">查看官方原文</a>` : ''}
      <a href="${escape(detail)}">查看政策详情</a></div>`);
  }

  function understanding(result) {
    const facts = result.confirmed;
    const intake = state.intake || {};
    const corrections = Object.entries(state.conflict_resolution || {}).map(([key,value]) =>
      key === 'member' ? '继续为 ' + state.memberLabel + ' 查询' : (key === 'age' ? '年龄：' + value + ' 岁' : '地区：' + value));
    return `<details class="panel"><summary>查看或修改 AI 理解的信息</summary>${originals()}
      <h3>AI 提取的内容</h3>${list(intake.extracted_facts || []) || '<p class="muted">暂无提取内容。</p>'}
      <h3>AI 推断的需求</h3>${list(intake.inferred_needs || []) || '<p class="muted">暂无推断需求。</p>'}
      ${corrections.length ? '<h3>已确认的冲突修正</h3>' + list(corrections) : ''}
      ${result.missing_information.length ? '<h3>待核实信息</h3>' + list(result.missing_information.map(item=>item.text)) : ''}
      <form id="revise">${basics(facts.basic)}
        <label>本次使用的事实<textarea name="facts" rows="3" maxlength="6500">${escape(facts.facts.join('\n'))}</textarea></label>
        <label>本次使用的需求<textarea name="needs" rows="2" maxlength="6500">${escape(facts.needs.join('\n'))}</textarea></label>
        ${button('保存修改并重新分析',false)}</form></details>`;
  }

  const recommendationIcons = {
    care:'<path d="m2.5 11 9.5-8 9.5 8M5 9v11h14V9"/><path d="M12 16.5 9 13.7a1.8 1.8 0 0 1 3-2 1.8 1.8 0 0 1 3 2z"/>',
    medical:'<rect x="3" y="4" width="18" height="16" rx="5"/><path d="M12 8v8m-4-4h8"/>',
    document:'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h4"/>',
    spark:'<path d="M12 3c.7 5 4 8.3 9 9-5 .7-8.3 4-9 9-.7-5-4-8.3-9-9 5-.7 8.3-4 9-9Z"/>',
    checkList:'<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 10h6m-6 4h6m-6 4h4"/>',
    external:'<path d="M13 4h7v7m0-7-9 9m7 1v5H5V6h5"/>',
    chat:'<path d="M5 18 3 21l5-1.5a9 9 0 1 0-3-1.5ZM8 11h.01m4 0h.01m4 0h.01"/>'
  };
  const recommendationIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${recommendationIcons[name]}</svg>`;
  function recommendationHeading(name, meta, status, icon) {
    return `<header class="recommendation-heading">
      <span class="recommendation-icon">${recommendationIcon(icon)}</span>
      <div><h3>${escape(name)}</h3>${meta ? `<div class="policy-meta">${escape(meta)}</div>` : ''}</div>
      <span class="tag">${escape(status)}</span></header>`;
  }
  const recommendationLine = (label, value, icon) =>
    `<p class="policy-reason"><strong>${recommendationIcon(icon)}${label}</strong><span>${escape(value)}</span></p>`;

  function card(item, selectable, version) {
    let sourceLink = '';
    try {
      const url = new URL(item.source.official_url);
      if (url.protocol === 'https:') sourceLink = `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${recommendationIcon('external')}官方原文</a>`;
    } catch {}
    const unresolved = item.conditions.filter(condition => !['met', 'failed', 'context_recorded'].includes(PFActionability.status(condition, item)));
    const pending = unresolved[0]?.label || item.missing_information[0];
    const detail = 'policy.html?' + query({id:item.id, region:item.region, member:memberId, semantic:1,
      analysis:state.id, version,
      from:location.pathname.split('/').pop()+location.search});
    const icon = /医疗|医药|护理|医保/.test(item.category) ? 'medical' :
      /养老|照护|助餐/.test(item.category) ? 'care' : 'document';
    return `<article class="card policy-card" data-policy="${escape(item.id)}">
      ${recommendationHeading(item.name, item.region + ' · ' + item.category, item.status === '待核实' ? '资格待核实' : item.status, icon)}
      <p class="policy-benefit">${escape(shortText(item.benefit || item.policy?.description || item.category, 98))}</p>
      ${recommendationLine('为什么推荐', shortText(item.reason,84), 'spark')}
      ${recommendationLine('还需核实', shortText(pending || '具体办理资格由受理机构确认。',64), 'checkList')}
      <p class="flow-note"><strong>下一步</strong>　${escape(PFActionability.next(item))}</p>
      <details class="optional"><summary>核对依据与条件</summary>
      <p class="muted">规则根据已提供事实核对条件。官方机构已确认仅适用于有官方确认依据的记录。</p>
      ${list(item.conditions.map(row => PFActionability.conditionLabel(row, item)))}
      ${item.reason.length > 84 ? '<p class="muted">'+escape(item.reason)+'</p>' : ''}
      ${list(item.missing_information.filter(text => !item.conditions.some(row => row.label === text || row.requirement === text)).slice(0,3))}
      </details><div class="card-links"><a href="${escape(detail)}">${recommendationIcon('document')}查看政策详情</a>
      ${sourceLink || '<span class="muted">官方原文链接待核实</span>'}
      ${selectable ? `<button type="button" class="save-policy" data-favorite="${escape(item.id)}"
        data-region="${escape(item.region)}" aria-pressed="false" disabled>正在读取清单…</button>
        <p class="muted favorite-status" aria-live="polite"></p>` : ''}</div>
      ${selectable ? '' : '<p class="muted">历史版本仅供回看，可在当前结果中操作权益清单。</p>'}</article>`;
  }

  function favoriteState(button, saved) {
    button.setAttribute('aria-pressed', String(saved));
    button.closest('.policy-card')?.classList.toggle('is-selected', saved);
    button.textContent = saved ? '✓ 已选 · 取消' : '选择此政策';
    button.disabled = false;
    updateNext();
  }

  function updateNext() {
    const next = document.querySelector('#selected-next');
    if (!next) return;
    const count = app.querySelectorAll('[data-favorite][aria-pressed=true]').length;
    document.querySelector('#selected-count').textContent = '已选 ' + count + ' 项';
    document.querySelector('#selection-hint').hidden = count > 0;
    next.disabled = !count || busy || savingFavorites > 0 || loadingFavorites;
  }

  async function loadFavorites() {
    const buttons = [...app.querySelectorAll('[data-favorite]')];
    if (!buttons.length) return;
    loadingFavorites = true;
    const lookup = button => query({memberId, policyId:button.dataset.favorite, region:button.dataset.region});
    await Promise.all(buttons.map(async button => {
      try {
        const record = await request('favorites?' + lookup(button));
        favoriteState(button, record.favorite.saved);
      } catch (error) {
        button.textContent = '权益清单暂不可操作';
        button.nextElementSibling.textContent = error.message;
      }
    }));
    loadingFavorites = false;
    updateNext();
  }

  async function toggleFavorite(button) {
    if (busy || button.disabled) return;
    const fields = {memberId, policyId:button.dataset.favorite, region:button.dataset.region};
    const desired = button.getAttribute('aria-pressed') !== 'true';
    const status = button.nextElementSibling;
    button.disabled = true;
    savingFavorites++;
    updateNext();
    status.textContent = '';
    try {
      const {favorite} = await request('favorites?' + query(fields));
      const saved = favorite.saved === desired ? favorite : (await request('commands', {type:'favorite', ...fields,
        operationId:crypto.randomUUID(), expectedRevision:favorite.revision, saved:desired})).favorite;
      favoriteState(button, saved.saved);
      status.textContent = saved.saved ? '已加入该成员的权益清单。' : '已从该成员的权益清单移除。';
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    } finally {
      savingFavorites--;
      updateNext();
    }
  }

  function result(result, historical = false) {
    const items = result.policy_candidates;
    const first = items.slice(0,3).map(item => card(item,!historical,result.version)).join('');
    const others = items.length > 3 ? `<details class="recommendation-group"><summary>其他相关政策（${items.length - 3} 项）</summary>
      <div class="recommendation-list">${items.slice(3).map(item => card(item,!historical,result.version)).join('')}</div></details>` : '';
    const region = result.confirmed.basic.region;
    const empty = !items.length ? panel(region ? '当前目录无相关政策' : '需要所在地区才能查找本地政策',
      `<p>${region ? '本次需求在现有政策目录中暂无匹配。' : '可补充所在地区再查询。'}</p>
      <a href="discovery-c.html">浏览现有政策目录</a>`) : '';
    const plans = Object.keys(state.plans || {}).map(id => `<a class="button" href="${escape(planLink(id))}">恢复少跑腿计划</a>`).join('');
    header('政策找人', route({member:memberId,view:'history'}));
    app.innerHTML = `${historical ? '' : '<div class="result-scroll">'}${hero(result.mode === 'rules' ? '基础规则查询结果' : 'AI 政策推荐',
      isSelf() ? '根据你的近况，看看哪些权益值得进一步了解。' : '根据这次家庭情况，看看哪些权益值得进一步了解。', true)}
      <p class="meta">${escape(state.memberLabel)} · 第 ${result.version} 版 · ${items.length} 项相关政策</p>${demoLabel()}
      ${state.planWarning ? `<p role="status">${escape(state.planWarning)}</p>` : ''}
      <div id="recommendations">${first}${others}</div>
      ${empty}${result.excluded.length ? `<details class="recommendation-group"><summary data-excluded-summary>与已知条件不符</summary>
        <div class="recommendation-list">${result.excluded.map(item => `<article class="card policy-card" data-excluded>
          ${recommendationHeading(item.name, region, '条件不满足', 'document')}
          ${recommendationLine('判断依据', item.reasons.join('；'), 'checkList')}
        </article>`).join('')}</div></details>` : ''}
      ${historical ? '<button data-action="current">返回当前分析</button>' : `<div class="actions">
        <a href="${escape(route({member:memberId,view:'history'}))}">查询历史</a>
        <a href="${escape(route({member:memberId,new:1}))}">新建查询</a>
        <a href="services.html?${query({member:memberId})}#mineFavorites">该成员的权益清单</a>
        ${result.public_search_query ? `<a href="search.html?${query({web:result.public_search_query})}">联网查找官方政策与渠道</a>` : ''}
        ${result.mode === 'rules' ? '<button data-action="analyze">重试 AI 分析</button>' : ''}
        ${result.version > 1 ? '<button data-action="versions">查看历史版本</button>' : ''}</div>${
          result.mode === 'ai' ? conversation() : ''}${plans ? `<details class="optional"><summary>已有少跑腿计划</summary>${plans}</details>` : ''}${understanding(result)}`}
      ${historical ? originals() : `</div><div class="selection-bar" role="region" aria-label="政策选择">
        <div class="selection-status"><span id="selected-count" aria-live="polite">已选 0 项</span><small id="selection-hint">请先选择政策</small></div>
        ${result.mode === 'ai' ? `<button type="button" class="ask-ai" data-action="open-chat" aria-controls="conversation" aria-expanded="${chatExpanded()}">${recommendationIcon('chat')}继续问 AI</button>` : ''}
        <button type="button" class="primary" id="selected-next" data-action="selected" aria-describedby="selection-hint" disabled>我已选好，下一步</button></div>`}`;
    loadFavorites();
    syncComposer();
  }

  function selectedConditions(review) {
    const official = key => ['disability','family_economic'].includes(key);
    const receipts = review.receipt?.answers || {};
    const prompts = review.questions.map(item => {
      const formal = official(item.key);
      const recorded = Object.hasOwn(receipts,item.key);
      const status = formal ? '需要官方核实' : !recorded ? '尚未提供信息' : receipts[item.key] == null ? '已记录不清楚' : '已提供事实';
      const detail = formal ? '仅按已经收到的正式结果填写。记录供本次政策比对，仍由主管部门核实。' : '可按实际情况填写，不清楚时可保留。';
      const options = item.options.length ? item.options : formal
        ? [{value:'true',label:'正式结果已认定'},{value:'false',label:'正式结果未认定'}]
        : [{value:'true',label:'是'},{value:'false',label:'否'}];
      const selected = receipts[item.key] == null ? '' : String(receipts[item.key]);
      return `<details class="selected-condition" name="selected-conditions">
        <summary><strong>${escape(item.text)}</strong><span>${status}</span><small>${detail}</small></summary>
        <fieldset class="fact-question"><legend class="condition-sr">记录已知情况</legend><p class="meta">${escape(item.policies.join('、'))}</p>
          <div class="fact-options">${[...options,{value:'',label:'不清楚'}].map(option =>
            `<label><input type="radio" name="answer-${escape(item.key)}" value="${escape(option.value)}" ${String(option.value) === selected ? 'checked' : ''}>${escape(option.label)}</label>`).join('')}</div>
          ${formal ? `<label class="formal-source" ${selected ? '' : 'hidden'}>结果出具机构或来源
            <input name="formal-${escape(item.key)}" maxlength="160" value="${escape(review.receipt?.formalReports?.[item.key])}">
            ${selected && !review.receipt?.formalReports?.[item.key] ? '<small>旧版记录未填写来源。</small>' : ''}</label>` : ''}
        </fieldset></details>`;
    });
    const remaining = review.items.map(item => {
      const asked = new Set(review.questions.filter(row=>row.policies.includes(item.name)).map(row=>row.key));
      const rows = (item.conditions || []).filter(row=>!asked.has(row.key));
      return rows.length ? `<section><h3>${escape(item.name)}</h3>${rows.map(row => {
        const status = official(row.key) ? '需要官方核实' : row.state === 'failed' ? '已知条件不满足' :
          row.state === 'met' ? '规则已核验' : '暂时无法判断';
        return `<details class="selected-condition" name="selected-conditions">
          <summary><strong>${escape(row.label || row.requirement)}</strong><span>${status}</span></summary>
          <p>${escape(row.requirement || row.label)}</p><p class="meta">${row.state === 'met' && !official(row.key)
            ? '已根据本次查询资料比对政策规则。' : '可查看政策依据并向主管部门核实。'}</p>
          <a href="policy.html?${escape(query({id:item.id,region:item.region,semantic:1,analysis:state.id,member:memberId,version:review.version,from:analysisRoute(currentView())}))}">查看政策依据</a></details>`;
      }).join('')}</section>` : '';
    }).join('');
    return `<div class="selected-conditions">${prompts.join('') || '<p class="flow-note">当前没有需要补充的事实。</p>'}
      ${remaining ? `<details class="optional selected-other"><summary>查看其余条件和依据</summary>${remaining}</details>` : ''}</div>`;
  }

  async function renderSelected() {
    const back = `<a href="${escape(analysisRoute())}">‹ 返回调整选择</a>`;
    try {
      const review = await request('v32/selected-review?' + stateQuery());
      const receipt = review.receipt;
      const edit = currentView() === 'selected-edit';
      const summary = receipt && !edit;
      header(summary ? '权益发现' : '核对已选权益', analysisRoute());
      app.innerHTML = summary ? rightsSummary(review) : `${hero('核对已选权益',
        '补充已知情况，其他条件可查看核实方向。', true)}${demoLabel()}
        <div class="member-note">为 <strong>${escape(state.memberLabel)}</strong> · 已选 <strong>${review.items.length}</strong> 项</div>
        <details class="optional"><summary>查看所选政策</summary>${list(review.items.map(item=>item.name))}</details>
        <form id="selected-review">${selectedConditions(review)}
            ${button('保存核对并查看结果')}</form><p class="center-action">${back}</p>`;
      const planForm = document.querySelector('#reviewed-plan');
      if (planForm) planForm.onsubmit = event => {
        event.preventDefault();
        run('plan',{reviewed:true,version:review.version,selection:review.selection});
      };
      const form = document.querySelector('#selected-review');
      if (form) form.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        const submit = form.querySelector('button');
        submit.disabled = true;
        try {
          const fields = new FormData(form);
          const answers = readAnswers(fields,true);
          const formalReports = {};
          for (const [name,value] of fields) {
            if (!name.startsWith('formal-')) continue;
            const key = name.slice(7);
            if (answers[key] == null) continue;
            const source = value.trim();
            if (source) formalReports[key] = source;
            else if (review.receipt?.answers[key] !== answers[key]) {
              const input = form.elements[name];
              input.closest('details').open = true;
              input.focus();
              throw Error('请填写正式结果的出具机构或来源。');
            }
          }
          await request('v32/selected-review', {id:state.id, memberId, selection:review.selection, version:review.version,
            answers, formalReports});
          state = await getState();
          history.replaceState(null,'',analysisRoute('selected'));
          await renderSelected();
          window.scrollTo(0,0);
          document.querySelector('#reviewed-plan button, #app h1')?.focus({preventScroll:true});
        } catch (error) { showError(error); }
        finally { busy = false; submit.disabled = false; }
      };
    } catch (error) {
      app.innerHTML = `<h1>已选权益核对</h1><p>${escape(error.message)}</p>${back}`;
    }
  }

  function readAnswers(data, includeUnknown = false) {
    const answers = {};
    for (const [key,value] of data) if (key.startsWith('answer-') && (value || includeUnknown))
      answers[key.slice(7)] = value === 'true' ? true : value === 'false' ? false : value || null;
    return answers;
  }

  const chatExpanded = () => chatOpen ?? Boolean(state.pending?.length);
  const suggestions = ['为什么推荐这项政策？','哪些条件还需要确认？','不清楚申请条件怎么办？'];
  function chatMessages() {
    return state.messages.map(message => {
      const paragraphs = answer => answer.split(/\n+/).filter(line => line.trim())
        .map(line => `<p>${escape(line)}</p>`).join('');
      const long = message.answer.length > 360;
      const answer = long
        ? `${paragraphs(shortText(message.answer,120))}<details class="chat-answer-full"><summary>展开完整回答</summary>${paragraphs(message.answer)}</details>`
        : paragraphs(message.answer);
      return `<article><div class="chat-user"><strong>你</strong><p>${escape(message.question)}</p></div>
        <div class="chat-answer"><strong>AI</strong>${answer}
          ${message.sources.length ? `<details class="optional"><summary>查看引用依据（${message.sources.length}）</summary>${list(message.sources.map(source => source.document || source.department).filter(Boolean))}</details>` : ''}</div></article>`;
    }).join('');
  }
  function pendingFacts() {
    return state.pending?.length ? `<form id="apply"><h3>确认补充给当前成员的信息</h3>${list(state.pending)}
        ${basics(state.result.confirmed.basic)}${questions(state.result.missing_information)}
        <div class="actions">${button('确认并重新研判')}
        <button type="button" data-action="dismiss">暂不更新</button></div></form>` : '';
  }
  function conversation() {
    return `<details class="panel ai-conversation" id="conversation" ${chatExpanded() ? 'open' : ''}><summary>继续问 AI</summary>
      <p class="meta">可以围绕本次找到的政策继续了解，不需要重新描述家庭情况。</p>
      <div id="chat-log">${chatMessages()}</div>
      <div id="chat-facts">${pendingFacts()}</div>
      <div class="chat-suggestions" ${state.messages.length ? 'hidden' : ''}>${suggestions.map(question =>
        `<button type="button" data-question="${question}">${question}</button>`).join('')}</div>
      <p id="chat-status" class="meta" role="status">${state.stage === 'chatting' ? 'AI 正在回答…' : ''}</p>
      <form id="chat"><label class="chat-label" for="chat-question">向 AI 追问</label>
        <div class="chat-composer"><textarea id="chat-question" name="question" required maxlength="1500" rows="1"
          placeholder="输入你想了解的问题">${escape(chatDraft)}</textarea>
          <button type="submit" aria-label="发送问题" title="发送问题" ${!chatDraft.trim() || state.stage === 'chatting' ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>
          </button></div></form></details>`;
  }

  const planLink = (id, from = '') => 'follow-up.html?' + query({view:'plan', plan:id, member:memberId, ...(from ? {from} : {})});
  let chatOpen, chatDraft = '', chatSending = false, loadingFavorites = false;
  function syncComposer() {
    const form = document.querySelector('#chat');
    if (!form) return;
    const field = form.elements.question;
    field.style.height = '';
    if (field.clientHeight) field.style.height = Math.min(field.scrollHeight + 2, 112) + 'px';
    field.readOnly = chatSending || state.stage === 'chatting';
    form.querySelector('button').disabled = field.readOnly || !field.value.trim();
    app.querySelectorAll('[data-question], #apply button').forEach(control => { control.disabled = field.readOnly; });
  }

  async function sendChat(question) {
    if (busy || chatSending || state.stage === 'chatting' || !question) return;
    chatOpen = true;
    chatSending = true;
    const status = document.querySelector('#chat-status');
    status.textContent = 'AI 正在回答…';
    syncComposer();
    try {
      const updated = await request('v32/chat', {id:state.id, memberId, revision:state.revision, question});
      state = updated;
      if (state.error) throw Error();
      chatDraft = '';
      document.querySelector('#chat').elements.question.value = '';
      document.querySelector('#chat-log').innerHTML = chatMessages();
      document.querySelector('#chat-facts').innerHTML = pendingFacts();
      document.querySelector('.chat-suggestions').hidden = true;
      status.textContent = 'AI 已回复';
      if (document.querySelector('#conversation').open) {
        document.querySelector('#chat-log article:last-child').scrollIntoView({block:'nearest'});
      }
    } catch {
      status.textContent = '发送未成功，问题已保留。可以再次发送。';
      try { state = await getState(); } catch {}
      if (state.stage === 'chatting') {
        await monitor().catch(showError);
      }
    } finally {
      chatSending = false;
      syncComposer();
    }
  }
  async function render() {
    app.setAttribute('aria-busy', String(!!stages[state?.stage]));
    if (!state) await input();
    else if (state.stage === 'chatting' && state.result) {
      if (['selected','selected-edit','guide'].includes(currentView())) {
        header('已选权益核对', analysisRoute());
        app.innerHTML = `${hero('已选权益核对')}<p class="flow-note" role="status">正在完成 AI 回答，随后显示已选权益。</p>`;
      } else result(state.result);
    }
    else if (stages[state.stage]) progress();
    else if (state.stage === 'conflict') conflictReview();
    else if (state.stage === 'review') await run('analyze');
    else if (state.stage === 'result') ['selected','selected-edit','guide'].includes(currentView()) ? await renderSelected() : result(state.result);
    else review(true);
  }

  async function monitor() {
    while (state && stages[state.stage]) {
      await new Promise(resolve => setTimeout(resolve,600));
      const current = await getState();
      if (!busy) {
        const wasChatting = state.stage === 'chatting';
        state = current;
        if (wasChatting && current.stage === 'chatting') continue;
        await render();
      }
    }
  }

  async function run(action, values = {}) {
    if (busy) return;
    busy = true;
    notice.textContent = '';
    const startRevision = state.revision;
    const poll = setInterval(async () => {
      try {
        const current = await getState();
        if (busy && current.revision > state.revision && stages[current.stage]) {
          state = current;
          progress();
        }
      } catch {}
    },450);
    app.querySelectorAll('button:not([data-favorite])').forEach(node => { node.disabled = true; });
    try {
      const next = await request('v32/' + action, {id:state.id, memberId, revision:startRevision, ...values});
      if (action === 'plan') location.assign(planLink(next.planId, values.reviewed ? analysisRoute('selected') : ''));
      else {
        state = next;
        await render();
        if (action === 'dismiss') document.querySelector('#conversation')?.scrollIntoView({block:'nearest'});
      }
    } catch (error) {
      notice.textContent = error.message;
      try { state = await getState(); await render(); if (stages[state.stage]) setTimeout(() => monitor().catch(showError),0); } catch {}
    } finally {
      clearInterval(poll);
      busy = false;
      app.querySelectorAll('button:not([data-favorite]):not(#selected-next):not([data-unavailable])').forEach(node => { node.disabled = false; });
      updateNext();
      syncComposer();
    }
  }

  function showError(error) { notice.textContent = error.message; }
  app.addEventListener('input', event => {
    if (event.target.form?.id === 'intake') rememberDraft(event.target.form);
    if (event.target.form?.id === 'resolve') notice.textContent = '';
    if (event.target.id === 'chat-question') {
      chatDraft = event.target.value;
      syncComposer();
    }
  });
  app.addEventListener('toggle', event => {
    if (event.target.id !== 'conversation') return;
    chatOpen = event.target.open;
    app.querySelector('.ask-ai')?.setAttribute('aria-expanded', String(chatOpen));
    syncComposer();
  }, true);
  app.addEventListener('change', event => {
    const formalSource = event.target.closest('.selected-condition')?.querySelector('.formal-source');
    if (formalSource && event.target.type === 'radio') formalSource.hidden = !event.target.value;
    if (event.target.form?.id === 'intake' && event.target.name === 'region') {
      const form = event.target.form;
      for (const key of ['hukou','insurance']) {
        form.elements[key].value = '';
        form.elements[key].disabled = !event.target.value;
      }
      rememberDraft(form);
    }
    if (event.target.name === 'ageChoice') {
      const custom = document.querySelector('#custom-age');
      const field = custom.querySelector('input');
      const enabled = event.target.value === 'custom';
      custom.hidden = !enabled;
      field.disabled = !enabled;
      field.required = enabled;
      if (enabled) field.focus();
    }
    if (event.target.id === 'member') location.assign(route({member:event.target.value,
      ...(demo ? {demo} : {}), ...(params.get('view') === 'history' ? {view:'history'} : {})}));
  });
  app.addEventListener('click', async event => {
    const suggestion = event.target.closest('[data-question]');
    if (suggestion) {
      const field = document.querySelector('#chat-question');
      field.value = suggestion.dataset.question;
      chatDraft = field.value;
      syncComposer();
      field.focus();
      return;
    }
    const favorite = event.target.closest('[data-favorite]');
    if (favorite) return toggleFavorite(favorite);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'open-chat') {
      const conversation = document.querySelector('#conversation');
      if (conversation) {
        chatOpen = conversation.open = !conversation.open;
        if (chatOpen) {
          conversation.scrollIntoView({block:'start'});
          conversation.querySelector('summary').focus({preventScroll:true});
        }
      }
      return;
    }
    if (action === 'selected') {
      if (!busy && !event.target.closest('button').disabled) location.assign(analysisRoute('selected'));
      return;
    }
    if (chatSending || state?.stage === 'chatting') return;
    if (action === 'current') return render();
    if (action === 'previous') return result(state.result,true);
    if (action === 'versions') {
      try {
        const response = await request('v32/versions?' + stateQuery());
        app.innerHTML = `<h1>查询版本</h1><div class="actions">${
          response.versions.map(version => `<button data-version="${version.version}">第 ${version.version} 版</button>`).join('')}
          <button data-action="current">返回当前分析</button></div>`;
        app.querySelectorAll('[data-version]').forEach(node => node.onclick = () =>
          result(response.versions.find(item => item.version === Number(node.dataset.version)),true));
      } catch (error) { showError(error); }
      return;
    }
    await run(action);
  });
  app.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || chatSending) return;
    const form = event.target, formData = new FormData(form);
    if (form.id === 'intake') {
      busy = true;
      form.querySelector('button').disabled = true;
      try {
        clearTimeout(draftTimer);
        await draftWrite;
        state = await request('v32/create', {id:form.dataset.id, memberId, demo, draftRevision, ...readInput(form)});
        history.replaceState(null,'',route({id:state.id,member:memberId}));
      } catch (error) { showError(error); }
      finally { busy = false; form.querySelector('button').disabled = false; }
      if (state) await run('analyze');
    } else if (form.id === 'resolve') {
      const choice = formData.get('ageChoice');
      const [ageSource,value] = choice?.split(':') || [];
      const age = choice === 'custom' ? Number(formData.get('age')) : choice ? Number(value) : null;
      if (choice && (!Number.isInteger(age) || age < 0 || age > 120)) return showError(Error('请输入 0–120 岁的整数年龄。'));
      await run('resolve',{age, ageSource,
        region:formData.get('region') || null, memberConfirmed:formData.has('memberConfirmed')});
    } else if (form.id === 'revise') {
      const lines = key => formData.get(key).split('\n').map(line=>line.trim()).filter(Boolean);
      await run('revise',{...readBasic(form), facts:lines('facts'), needs:lines('needs')});
    } else if (['confirm','fallback','apply'].includes(form.id)) {
      await run(form.id, {...readBasic(form), resolveAge:formData.has('resolveAge'), answers:readAnswers(formData),
        facts:formData.getAll('事实').map(value=>value.trim()).filter(Boolean),
        needs:formData.getAll('需求').map(value=>value.trim()).filter(Boolean)});
    } else if (form.id === 'chat') {
      await sendChat(formData.get('question').trim());
    }
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && state?.stage === 'result') getState().then(value => {
      if (chatSending) return;
      state = value;
      return render();
    }).catch(showError);
  });
  start().catch(error => { app.textContent = error.message; app.setAttribute('aria-busy','false'); });
})();
