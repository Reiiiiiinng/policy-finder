(() => {
  const root = document.getElementById('followupView'), notice = document.getElementById('followupStatus');
  const params = new URLSearchParams(location.search);
  const view = params.get('view') || 'list', planId = params.get('plan'), policyId = params.get('pid');
  const queryId = view === 'list' ? params.get('query') : null;
  const batchId = view === 'list' ? params.get('batchReceipt') : null;
  const scopedList = !!(queryId || batchId);
  const esc = value => escapeHtml(value ?? '');
  const taskStatuses = {pending:'待办理',preparing:'准备中',consulted:'待核实',applicable:'办理中',
    completed:'已完成',deferred:'已暂停',inapplicable:'不再办理'};
  const stageLabels = {pending:'未开始',preparing:'准备材料中',ready_to_submit:'待提交',
    in_progress:'已实际提交，等待反馈',needs_supplement:'需要补件',completed:'已办结',rejected:'未通过',paused:'已暂停'};
  const materialStatuses = {ready:'已准备',missing:'待准备',unknown:'待核实'};
  const conditionAnswers = {met:'是',not_met:'否',unknown:'不清楚'};
  const conditionSources = {confirmed_profile:'已确认的查询资料',user_record:'用户核对记录',policy_rule:'政策规则'};
  const resultLabels = {completed:'已办结',rejected:'未通过',feedback_received:'已收到官方反馈',
    needs_supplement:'需要补件',waiting:'等待官方反馈',other:'其他情况'};
  const actionLabels = {start_preparation:'开始准备',review_submission:'保存提交前核对',confirm_submission:'确认已实际提交',
    record_result:'保存办理结果',correct_result:'更正办理结果',pause:'暂停办理',resume:'继续办理'};
  const hasPreparedMaterials = task => task.materials?.some(row=>row.state==='ready');
  const stageOf = task => {
    if (task.stage==='in_progress' && !task.submission) return '历史办理记录';
    if (task.stage==='in_progress' && task.outcome?.result==='feedback_received') return '已收到官方反馈';
    if (['pending','preparing'].includes(task.stage) && task.awaitingConsultation) return '待官方核实';
    if (task.stage==='pending' && hasPreparedMaterials(task)) return '准备材料中';
    if (task.stage==='pending' && task.status==='consulted') return '待官方核实';
    return stageLabels[task.stage] || taskStatuses[task.status];
  };
  const adviceLabels = {coordinate:'可以一起做', separate:'必须分开做', pending:'还需核实'};
  const link = (label,url,primary=false) => `<a class="fu-button${primary?' fu-primary':''}" href="${esc(url)}">${label}</a>`;
  const route = (next, extra={}) => PFNavigation.withParams('follow-up.html',{view:next,
    ...(businessMode ? {member:current?.memberId || memberId} : {}),...extra});
  const detail = id => PFNavigation.withParams(PFNavigation.detailURL(id),{semantic:1,
    ...(businessMode ? {member:current?.memberId,plan:planId,query:planId ? (currentPlan()?.tasks.find(task=>task.policyId===id)?.queryId || current?.queryId) :
      current?.items[id]?.activeQueryIds?.[0]} : {})});
  const panel = (title, body) => `<section class="fu-panel"><h2>${title}</h2>${body}</section>`;
  const disclosure = (title, body) => `<details class="fu-panel fu-disclosure"><summary>${title}</summary>${body}</details>`;
  const badge = (label, state) => `<span class="fu-badge" data-state="${esc(state)}">${esc(label)}</span>`;
  const dateLabel = value => value ? new Date(value).toLocaleDateString('zh-CN') : '';
  const list = (items, empty='暂未记录。') => items.length ?
    `<ul>${items.map(item=>`<li>${item}</li>`).join('')}</ul>` : `<p class="fu-muted">${empty}</p>`;
  let current, businessMode, memberRows=[], memberId=params.get('member'), loadVersion=0, saving=false;
  const checked = new Set(scopedList ? history.state?.pfPlanSelection ?? [] : []);
  let initializedSelection = !scopedList || Array.isArray(history.state?.pfPlanSelection);

  function header(title, back, backLabel='‹ 返回') {
    if (businessMode && current?.memberId && back === 'services.html')
      back = PFNavigation.withParams(back, {member:current.memberId});
    return `<header class="fu-header">${link(backLabel, planId && view!=='logs' ? back : PFNavigation.returnTarget(back))}<h1>${title}</h1>
      ${current && view!=='plan' ? `<p class="fu-muted">${esc(current.label)}${current.region?' · '+esc(current.region):''}</p>` : ''}</header>`;
  }

  function currentPlan() { return current?.plans[planId]; }
  function verifiedIds(plan) {
    return progress(plan).ids;
  }
  const progress = plan => businessMode ? plan.progress : PFFollowup.progress(current,plan);
  const planLink = id => businessMode ? PFNavigation.withParams('plan.html',{plan_id:id,member:current?.memberId}) : route('plan',{plan:id});
  const taskLink = (plan, task, next='task') => route(next,{plan:plan.id,pid:task.policyId,member:plan.memberId,query:task.queryId});
  const consultLink = (plan, task, condition) => PFNavigation.withParams(taskLink(plan,task,'consult'),{
    task:task.id, region:plan.region, condition, originStep:view,
  });
  function consultReturn(plan, task) {
    const step=params.get('originStep');
    if(!['conditions','review','task'].includes(step)) return planReturn(plan);
    const target=taskLink(plan,task,step);
    const condition=params.get('condition');
    if(step==='conditions' && task.conditionChecks?.some(row=>row.id===condition))
      return target+'#check-'+encodeURIComponent(condition);
    return step==='review' ? target+'#official-channels' : target;
  }
  const canEdit = plan => !current.memberArchived && !plan.pausedAt;
  const needsConsultation = row => !row.advisory && row.answer!=='not_met' &&
    (row.state==='stale' || (row.state!=='confirmed' && row.answer==='unknown'));
  const planReturn = (plan, pid=policyId) => route('plan',{plan:plan.id,member:plan.memberId,focus:pid});
  function taskHeader(plan, task, title, active) {
    const steps=[['conditions','补充条件'],['prepare','准备材料'],['review','办理渠道'],['task','办理记录']];
    return header(title,planReturn(plan),'‹ 计划总览') +
      `<nav class="fu-steps" aria-label="办理事项导航">${steps.map(([key,label]) =>
        `<a href="${esc(taskLink(plan,task,key))}" ${key===active?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
      <section class="fu-panel fu-subject"><h2>${esc(task.name)}</h2>${badge(stageOf(task),task.stage)}</section>`;
  }
  const queue = () => businessMode ? Object.values(current.items).filter(item=>item.intent==='verify') : PFFollowup.eligible(current);
  const canSelect = item => businessMode && !current.memberArchived && item.activeQueryIds.length > 0;
  const recheckLink = () => link('重新查询并核对', PFNavigation.withParams(PFNavigation.taskURL(current.mode),{
    member:current.memberId,
  }));
  function memberPicker() {
    if(!businessMode || planId || scopedList || !memberRows.length)return '';
    return `<label>查询对象<select id="fuMember"><option value="">请选择成员</option>${memberRows.map(row=>`<option value="${esc(row.id)}" ${row.id===(current?.memberId ?? memberId)?'selected':''}>${esc(row.name)} · ${esc(row.relation)}${row.archivedAt?'（已归档）':''}</option>`).join('')}</select></label>`;
  }

  function renderList() {
    const rows = queue();
    const blocked = current.queryArchived ? '本次查询已从历史删除。待核实事项仍保留，请到该成员的清单查看可继续的事项。' :
      current.memberArchived ? '该成员已归档，当前事项仅供查看。' :
      '本批次没有可加入计划的待核实政策。';
    const items = rows.map(item => panel(esc(item.name), `<p>${esc(item.region||current.region)} · ${esc(item.origin)} · 打算去核实</p>
      ${list(item.conditions.slice(0,3).map(esc),'政策条件请以官方答复为准。')}
      ${canSelect(item) ? `<label><input type="checkbox" data-select value="${esc(item.id)}" ${checked.has(item.id)?'checked':''}>纳入本次计划</label>` :
        businessMode && !current.memberArchived ? '<p>原查询已删除或缺少可用来源。请重新查询并核对这项政策。</p>'+recheckLink() : ''}
      <div class="fu-row">${link('政策详情',detail(item.id))}${canSelect(item) ? `
      <button class="fu-button" data-intent="later" data-id="${esc(item.id)}">先记下来</button>
      <button class="fu-button" data-intent="notmatch" data-id="${esc(item.id)}">情况不符，不适用</button>
      <button class="fu-button" data-remove="${esc(item.id)}">移出待核实清单</button>` : ''}</div>`));
    return header(scopedList ? '创建家庭少跑腿计划' : '待核实清单', 'services.html') +
      (scopedList ? `<p>${rows.some(canSelect) ? '确认本次要纳入计划的政策。' : blocked}</p>` : '') +
      (items.length ? items.join('') + (rows.some(canSelect) ? '<button id="createPlan" class="fu-button fu-primary" disabled>创建少跑腿计划</button>' : '') :
        scopedList ? link('查看该成员全部待核实事项',route('list')) :
        panel('暂无待核实事项','<p>请从发现结果中选择政策并保存「打算去核实」。</p>'+link('返回发现','discovery-c.html'))) +
      `<div class="fu-row">${link('查看已保存政策',route('saved'))}${link('查看已有计划',route('plans'))}</div>`;
  }

  function renderPlans() {
    const plans = Object.values(current.plans);
    return header('我的少跑腿计划','services.html') + (plans.length ? plans.map(plan => {
      const state=progress(plan);
      const tasks=businessMode?plan.tasks.filter(task=>state.ids.includes(task.policyId)):[];
      return panel('少跑腿计划',`<p>${esc(plan.region)}${plan.pausedAt?' · 已暂停':''} · 已完成 ${state.done}/${state.active} 项${plan.createdAt?' · '+esc(dateLabel(plan.createdAt)):''}</p>`
        +link('打开计划',planLink(plan.id),true)
        +(tasks.length ? `<details class="fu-plan-shortcuts"><summary>办理事项</summary>${list(tasks.map(task=>
          link(esc(task.name)+' · '+esc(stageOf(task)),taskLink(plan,task))))}</details>` : ''));
    }).join('') : panel('暂无计划',link('从待核实清单创建',route('list'))));
  }

  function renderMembers() {
    const avatar = row => {
      const role=({'本人':'self','父亲':'elder-male','爷爷':'elder-male','外公':'elder-male',
        '母亲':'elder-female','奶奶':'elder-female','外婆':'elder-female','配偶':'couple'})[row.relation] || 'neutral';
      return `<img src="assets/avatars/${role}.webp" alt="" width="52" height="52" decoding="async">`;
    };
    return header('家庭成员','services.html') + '<p class="fu-page-intro">每位家人的权益和办理记录，分别整理。</p>' +
      `<div class="fu-member-list">${memberRows.map(row=>`<details class="fu-panel fu-member-card">
      <summary><span class="fu-member-avatar">${avatar(row)}</span><span class="fu-member-caption"><strong>${esc(row.name)}</strong>
        ${row.name!==row.relation?`<small>${esc(row.relation)}</small>`:''}${row.archivedAt?'<small>已归档</small>':''}</span>
        <span class="fu-member-edit"><span class="when-closed">编辑资料</span><span class="when-open">收起</span></span></summary>
      <form class="fu-member" data-member-id="${esc(row.id)}">
        <label>称呼或名字<input name="name" value="${esc(row.name)}" required maxlength="80"></label>
        <label>关系<select name="relation">${(row.relation==='本人'?['本人']:['父亲','母亲','爷爷','奶奶','外公','外婆','配偶','子女','其他']).map(relation=>
          `<option ${relation===row.relation?'selected':''}>${relation}</option>`).join('')}</select></label>
        <div class="fu-member-actions"><button class="fu-button fu-primary" type="submit">保存成员资料</button>
        ${row.relation==='本人'?'':`<button class="fu-button" type="button" data-archive-member="${esc(row.id)}">${row.archivedAt?'恢复成员':'归档成员'}</button>`}
        </div></form></details>`).join('')}</div>
      <details class="fu-panel fu-add-member"><summary><strong>添加家庭成员</strong><small>为家人建立一份权益记录</small></summary><form id="fuAddMember">
      <label>称呼或名字<input name="name" required maxlength="80" autocomplete="off"></label>
      <label>关系<select name="relation" required><option value="">请选择</option>${['父亲','母亲','爷爷','奶奶','外公','外婆','配偶','子女','其他'].map(relation=>
        `<option>${relation}</option>`).join('')}</select></label>
      <button class="fu-button fu-primary" type="submit">添加成员</button>
    </form></details>`;
  }

  function renderAdvice(plan) {
    if (plan.advice?.format!=='coordination.v2') return `<p>${plan.adviceStale || plan.advice ?
      '原协同依据需要重新核对。办理任务和记录仍可查看。' : '还未核对这组政策的办理关系。'}</p>`;
    const active = new Set(verifiedIds(plan));
    const rows=plan.advice.assessments.filter(row=>row.ids.every(id=>active.has(id)));
    const name=id=>esc(current.items[id]?.name||id);
    return Object.entries(adviceLabels).map(([kind,label])=>{
      const group=rows.filter(row=>row.kind===kind);
      if(!group.length)return '';
      return `<section data-relation="${kind}"><h3>${label} · ${group.length} 组</h3>${group.map(row=>`
        <details class="fu-relation"><summary>${row.ids.map(name).join(' / ')}</summary>
        ${row.evidence ? `<p>${esc(row.evidence.stage)}</p>`+list(row.ids.map((id,index)=>{
          const proof=index ? row.evidence.right : row.evidence.left;
          const policy=plan.advice.policies.find(item=>item.id===id);
          return `${name(id)}：${esc(proof.text)}（${esc(policy.source.document_no || policy.source.document)}，办理流程第 ${Number(proof.ref.split(':')[1])+1} 项）`;
        })) : '<p>现有资料不足。请分别向官方核对地点、流程和时限。</p>'}
        ${row.dependencies.map(dep=>`<p>先核对是否已有相关认定。${esc(dep.condition.text)}。认定依据见 ${name(dep.prerequisitePolicyId)}。</p>`).join('')}
        ${row.common_prerequisites.length ? `<p>两项政策均列有 ${esc([...new Set(row.common_prerequisites.map(item=>item.left.label))].join('、'))}。请分别核对适用要求。</p>` : ''}
        ${row.common_materials.length ? `<p>两项政策都列出 ${esc([...new Set(row.common_materials.map(item=>item.left.text))].join('、'))}。能否用同一份材料需向官方核实。</p>` : ''}
        </details>`).join('')}</section>`;
    }).join('') || '<p>当前没有需要比较的政策组合。</p>';
  }

  function renderTask(plan, id, expanded=false) {
    const item=current.items[id];
    const task=businessMode ? plan.tasks.find(row=>row.policyId===id) : null;
    const policy=current.policyEvidence?.find(row=>row.id===id);
    const trace = policy ? `<p>${esc(policy.source.document_no || policy.source.document || '办理依据待核实')}</p>
      <p>发布部门 ${esc(policy.source.department || '待核实')}</p>
      <h3>先核对</h3>${list(policy.prerequisites.filter(row=>row.verified).map(row=>esc(row.text)), '请先确认适用条件和受理渠道。')}
      <h3>适用对象与条件</h3>${list([...policy.audiences.map(row=>esc(row.text)),
        ...policy.eligibility.map(row=>esc(row.text)+(row.clause?'（'+esc(row.clause)+'）':'')+(row.verified?'':' · 待核实'))])}
      <h3>去哪办理</h3>${list(policy.locations.filter(row=>row.verified).map(row=>esc(row.text)),
        '受理地点或机构待核实，请从官方来源确认。')}
      <h3>办理步骤</h3>${list(policy.steps.map(row=>esc(row.text)+(row.verified?'':' · 待核实')))}
      <h3>准备材料</h3>${list((task?.materials||[]).map(row=>esc(row.text)+' · '+esc(materialStatuses[row.state])),
        '具体材料待向官方核实。')}
      <h3>办理时限</h3>${list(policy.deadlines.map(row=>esc(row.text)+(row.verified?'':' · 待核实')),'具体时限待核实。')}
      <h3>待核实事项</h3>${list(policy.missing.map(esc))}
      ${official(policy)}` : '<p>办理依据暂不可读取，可从政策详情或官方咨询核对。</p>';
    const active=verifiedIds(plan).includes(id);
    const related=plan.consultations?.filter(row=>row.taskId===task?.id) || [];
    return `<details class="fu-panel fu-task" data-plan-policy="${esc(id)}"><summary>${expanded ? '政策依据与办理说明' :
      `${esc(item.name)} · ${esc(task ? stageOf(task) : taskStatuses[item.status])}`}</summary>
      ${expanded || !businessMode ? trace : disclosure('查看政策依据',trace)}
      ${expanded && related.length ? `<h3>相关咨询</h3>${list(related.map(consultationLink))}` : ''}
      <div class="fu-row">${link('政策详情',detail(id))}
      ${task&&active&&canEdit(plan)?`<button class="fu-button" data-task="remove" data-id="${esc(id)}">移出本计划</button>`:''}</div></details>`;
  }

  function consultationLink(row) {
    return link(esc(current.items[row.pid]?.name||row.pid)+' · '+esc(row.form.date)+' · '+esc(PFBusiness.consultationSourceLabel(row.sourceType)),
      route('record',{consultation:row.id,member:row.memberId,from:PFNavigation.current()}));
  }

  function consultationSourceOptions(selected) {
    return '<option value="">请选择来源</option>'+Object.entries(PFBusiness.consultationSources)
      .map(([type,label])=>`<option value="${type}" ${type===selected?'selected':''}>${esc(label)}</option>`).join('');
  }

  const conditionSummary = row => `${esc(row.text)} · ${badge(...conditionStatus(row))}${row.reportedIssuer ? ' · '+esc(row.reportedIssuer) : ''}`;

  function renderExecution(task) {
    const actions = (task.workflowActions || []).filter(action=>!['start_preparation','review_submission'].includes(action));
    if (!actions.length) return '';
    const main = actions.includes('record_result') ? 'record_result' : actions[0];
    const label = action => action==='confirm_submission' && task.stage==='needs_supplement' ?
      '确认已实际补交' : actionLabels[action];
    const renderFields = (action, content) => `<fieldset data-workflow="${action}" ${action===main?'':'hidden disabled'}>${content}</fieldset>`;
    return `<form id="executionForm" class="fu-panel">
      <h2>${esc(label(main))}</h2>
      ${actions.length===1 ? `<input type="hidden" name="status" value="${main}">` :
        `<label>办理操作<select name="status">${actions.map(action=>`<option value="${action}" ${action===main?'selected':''}>${esc(label(action))}</option>`).join('')}</select></label>`}
      ${actions.includes('confirm_submission') ? renderFields('confirm_submission',`<legend>记录已提交的申请</legend>
        <p>请先通过受理机构的渠道提交，再在这里记录。</p>
        <label><input type="checkbox" name="submitted" required> ${task.stage==='needs_supplement'?'我已实际补交材料':'我已通过受理渠道实际提交申请'}</label>
        <label>提交日期（选填）<input type="date" name="submittedDate"></label>
        <label>提交渠道（选填）<input name="channel" maxlength="120"></label>
        <label>受理编号（选填）<input name="receiptNumber" maxlength="120"></label>`) : ''}
      ${actions.includes('record_result') ? renderFields('record_result',`<legend>记录受理机构的办理结果</legend>
        <label>实际结果<select name="result" required><option value="">请选择结果</option>${Object.entries(resultLabels)
          .map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
        <label>情况说明<textarea name="note" maxlength="800"></textarea></label>
        <label>官方答复或未通过原因（选填）<textarea name="officialReply" maxlength="800"></textarea></label>
        <label>办理日期（选填）<input type="date" name="resultDate"></label>`) : ''}
      ${actions.includes('correct_result') ? renderFields('correct_result',`
        <legend>当前记录：${esc(stageOf(task))}</legend>
        <p>确认后重新打开办理事项，原记录会保留在办理过程。</p>
        <label>更正原因<textarea name="correctionReason" required maxlength="800"></textarea></label>
        <label><input name="correctionConfirmed" type="checkbox" required> 我确认更正此结果</label>`) : ''}
      <p id="executionStatus" role="status" aria-live="polite"></p>
      <button class="fu-button fu-primary" type="submit">${esc(label(main))}</button>
    </form>`;
  }

  function taskAction(task) {
    const target = {conditions:['补充必要条件','conditions'],materials:['准备材料','prepare'],
      submission:['查看办理方式','review'],result:['更新办理结果','task'],resume:['继续办理','task'],review:['查看办理记录','task']};
    const [label,next] = task.awaitingConsultation && ['pending','preparing'].includes(task.stage) ? ['查看待核实事项','review'] :
      task.stage==='pending' && hasPreparedMaterials(task) ? ['继续准备材料','prepare'] :
      task.stage==='pending' ? ['开始办理','conditions'] :
      target[task.nextAction?.type] || ['查看办理记录','task'];
    return {label,next};
  }

  function actionLink(plan, task) {
    const {label,next}=taskAction(task);
    return link(label,taskLink(plan,task,next),true);
  }

  function submissionDates(task) {
    const summary=(label,row)=>row ? `<p>${label} ${esc(row.submittedDate||dateLabel(row.at))}
      ${row.channel?' · '+esc(row.channel):''}</p>` : '';
    return summary('首次提交',task.firstSubmission)+summary('最近补交',task.latestSupplement);
  }

  function renderTaskPage(plan) {
    const task=plan.tasks.find(row=>row.policyId===policyId);
    if(!task)return header('任务暂不可用',planReturn(plan));
    const active=verifiedIds(plan).includes(task.policyId);
    const related=task.relatedPolicies||[];
    return taskHeader(plan,task,'办理进度与结果记录','task')+
      (!task.submission && ['pending','preparing','ready_to_submit'].includes(task.stage)?
        panel('提交情况','<p>尚未提交。实际提交申请后，可以在这里记录时间和渠道。</p>'):'')+
      (task.submission?panel('申请提交记录',`${submissionDates(task)}
        ${task.submission.receiptNumber?`<p>受理编号 ${esc(task.submission.receiptNumber)}</p>`:''}`):'')+
      (task.outcome || task.lastResult ? panel('最近办理结果',`<p>${esc(resultLabels[task.outcome?.result] || '用户记录')}</p>
        <p>${esc(task.outcome?.note || task.lastResult?.note)}</p>
        <p>用户自行记录 · 尚未独立核实</p>
        ${task.outcome?.officialReply?`<p>用户转记的官方答复（未经独立核验）</p><p>${esc(task.outcome.officialReply)}</p>`:''}
        ${task.outcome?.resultDate || task.outcome?.at?`<p>${task.outcome.resultDate?'办理日期':'记录日期'} ${esc(task.outcome.resultDate || dateLabel(task.outcome.at))}</p>`:''}
        ${task.outcome?.result==='rejected' ? `<p>可向受理机构核实未通过涉及的条件、材料及后续处理方式。</p>
        ${related.length ? '<h3>可能相关的政策</h3>'+list(related.map(row=>link(esc(row.name),
          PFNavigation.withParams('policy.html',{id:row.id,member:plan.memberId,from:PFNavigation.current()}))
          + '<p>'+esc(row.reason)+' · 资格仍需核对。</p>'+list((row.unknowns||[]).map(esc),'请核对政策条件。'))) :
          '<p>现有目录暂未找到与本次情况匹配的其他权益。</p>'}
        ${link('查看其他政策',PFNavigation.withParams('discovery-c.html',{member:plan.memberId}))}` : ''}`) : '')+
      (active && canEdit(plan) ? renderExecution(task) : '<p>该办理事项可查看历史记录。</p>')+
      (task.workflowHistory?.some(row=>row.kind==='workflow') ? disclosure('办理过程',list(task.workflowHistory
        .filter(row=>row.kind==='workflow').slice(-5).reverse().map(row=>`${esc(dateLabel(row.at))} · ${
          esc(resultLabels[row.details?.result] || actionLabels[row.reason] || stageLabels[row.newStage])}${
          row.details?.correctionReason ? ' · '+esc(row.details.correctionReason) : row.details?.submittedDate ? ' · '+esc(row.details.submittedDate) : ''}`))) : '')+
      renderTask(plan,task.policyId,true)+
      link('查看办理历史',route('logs',{plan:plan.id,pid:task.policyId,from:PFNavigation.current()}));
  }

  function renderReview(plan) {
    const task=plan.tasks.find(row=>row.policyId===policyId);
    if(!task)return header('任务暂不可用',planReturn(plan),'‹ 计划总览');
    const policy=current.policyEvidence?.find(row=>row.id===policyId);
    const conditions=task.conditionChecks || [];
    const materials=task.materials || [];
    const channel=policy?.steps.filter(row=>row.verified).map(row=>esc(row.text)) || [];
    const active=verifiedIds(plan).includes(policyId) && canEdit(plan);
    const review = active && ['pending','preparing'].includes(task.stage) && task.workflowActions.includes('review_submission') ? `<form id="executionForm" class="fu-panel">
      <input type="hidden" name="status" value="review_submission">
      <label><input type="checkbox" name="requirementsConfirmed" required> 我已查看条件、材料和办理渠道，准备提交</label>
      <p id="executionStatus" role="status"></p>
      <button type="submit" class="fu-button fu-primary">保存为待提交</button></form>` : '';
    return taskHeader(plan,task,'提交前核对与办理渠道','review') + review +
      `<div class="fu-row">${link('查看办理方式','#official-channels',true)}
        ${link('继续补材料',taskLink(plan,task,'prepare'))}${link('稍后继续',planReturn(plan))}</div>` +
      panel('核对清单',`<h3>条件记录</h3>${list(conditions.filter(row=>!row.advisory).map(conditionSummary),'暂无已收录的条件记录。')}
        <h3>材料准备</h3><p>${materialCounts(materials)}</p>${list(materials.filter(row=>row.ref).map(row=>
          esc(materialName(row))+' · '+esc(materialLabel(row))),'请向受理机构确认材料清单。')}`) +
      `<section class="fu-panel" id="official-channels" aria-labelledby="channel-heading"><h2 id="channel-heading">官方办理渠道</h2>
        ${policy?.source.department?`<p>政策发布机关 ${esc(policy.source.department)}</p>`:''}
        ${list(channel,'受理部门和办理方式待官方确认。')}
        ${PFActionability.channels(policy?.channels,esc)}${official(policy)}
        ${active ? `<div class="fu-row">${link('咨询官方',consultLink(plan,task))}
          ${link('记录实际提交或办理结果',taskLink(plan,task))}</div>` : ''}</section>` +
      disclosure('待向官方核实',list([
        ...(policy?.missing || []).map(esc),
        ...conditions.filter(row=>row.state==='stale' ||
          (row.state!=='confirmed' && ['official','observation'].includes(row.inputKind)))
          .map(row=>esc(row.text))
      ],'请核对实际受理机构提供的办事信息。'));
  }


  function renderPlan(plan) {
    const {ids}=progress(plan);
    if (!businessMode) return header('家庭少跑腿计划',route('plans'))+ids.map(id=>renderTask(plan,id)).join('');
    const tasks=plan.tasks.filter(task=>ids.includes(task.policyId));
    const open=tasks.filter(task=>!['completed','rejected','paused'].includes(task.stage));
    const priority={conditions:0,materials:1,submission:2,result:3};
    const rank=task=>(priority[task.nextAction?.type]??4)*2+
      Number((current.policyDependencies||[]).some(row=>row.policyId===task.policyId &&
        open.some(other=>other.policyId===row.prerequisitePolicyId)));
    const suggested=open.slice().sort((a,b)=>rank(a)-rank(b))[0];
    const task=tasks.find(row=>row.policyId===new URLSearchParams(location.search).get('focus')) || suggested || tasks[0];
    const completed=tasks.filter(row=>row.stage==='completed').length;
    const planState=current.memberArchived?'成员已归档':plan.pausedAt?'计划已暂停':
      !tasks.length?'尚未选择权益':completed===tasks.length?'已全部办结':'逐项准备中';
    const pauseForm=current.memberArchived?'':`<form id="planPauseForm">${plan.pausedAt?
      `<p>${plan.pauseReason?esc(plan.pauseReason):'原有进度已保留，方便时可以继续。'}</p>`:
      '<label>暂停原因（选填）<input name="reason" maxlength="500" placeholder="需要时再暂停，进度会保留"></label>'}
      <button type="submit" class="fu-button${plan.pausedAt?' fu-primary':''}">${plan.pausedAt?'恢复计划':'暂停计划'}</button></form>`;
    const steps=[['conditions','核实条件','先问清'],['prepare','准备材料','再整理'],
      ['review','确认渠道','去哪里'],['task','记录进度','留记录']];
    // Use the same destination as the primary action; never infer completed steps.
    const routeStep=task ? steps.findIndex(([next])=>next===taskAction(task).next) : -1;
    return `<div class="plan-overview">
      <div class="plan-topline">${link('‹ 我的计划',route('plans'))}</div>
      <header class="plan-hero" aria-labelledby="plan-title">
        <p class="plan-eyebrow">为家人，把准备做在前面</p>
        <h1 id="plan-title">家庭少跑腿计划</h1>
        <p class="plan-hero-copy">问清条件，备好材料。<br>每一步，都更有准备。</p>
        <img class="plan-family-art" src="assets/plan-family-v2.webp" alt="" aria-hidden="true" width="720" height="540">
        <div class="plan-family-line"><span>正在为 <strong>${esc(current.label)}</strong> 跟进</span>
          ${plan.region?`<span class="plan-region">${esc(plan.region)}</span>`:''}</div>
      </header>
      <div class="plan-body">
        <section class="plan-progress" aria-label="计划办理进度">
          <div><span>共 <strong>${tasks.length}</strong> 项权益</span><span>已办结 <strong>${completed}</strong> 项</span></div>
          <progress value="${completed}" max="${Math.max(tasks.length,1)}" aria-label="已办结 ${completed} 项，共 ${tasks.length} 项权益"></progress>
          <p>${esc(planState)}<span>办理结果以实际记录为准</span></p>
        </section>
        ${current.memberArchived?'<p class="plan-state-note">该家庭成员已归档，计划仅供查阅。</p>':
          plan.pausedAt?`<section class="plan-state-note"><h2>计划已暂停</h2>${pauseForm}</section>`:''}
        ${task?`<section class="fu-panel fu-lead plan-next" aria-labelledby="plan-next-title">
          <div class="plan-section-heading"><h2>${task===suggested?'建议先处理':'当前事项'}</h2>${badge(stageOf(task),task.stage)}</div>
          <h3 id="plan-next-title">${esc(task.name)}</h3>
          <p class="plan-next-reason">${esc(task.awaitingConsultation && ['pending','preparing'].includes(task.stage) ? '已记录咨询，等待答复。' :
            task.stage==='pending' && hasPreparedMaterials(task) ? '已记录材料准备情况，可继续整理。' : task.nextAction?.reason)}</p>
          ${submissionDates(task)}
          <div class="plan-next-actions">${!canEdit(plan)?link('查看办理记录',taskLink(plan,task),true):actionLink(plan,task)}
            <a class="plan-channel-link" href="${esc(taskLink(plan,task,'review'))}">查看办理渠道</a></div>
        </section>`:`<section class="fu-panel plan-next"><h2>从一项权益开始</h2>
          <p>从 AI 发现或待核实清单选择想跟进的权益。</p>${link('查找可能相关的权益',PFNavigation.withParams('find.html',{member:current.memberId}),true)}</section>`}
        ${task?`<section class="plan-route" aria-labelledby="plan-route-title">
          <div class="plan-section-heading"><h2 id="plan-route-title">这件事，分步准备</h2><span>当前事项</span></div>
          <nav class="plan-route-steps" aria-label="当前事项办理路线">${steps.map(([next,label,hint],index)=>
            `<a href="${esc(taskLink(plan,task,next))}" ${index===routeStep?'aria-current="step"':''}>
              <span class="plan-step-number" aria-hidden="true">0${index+1}</span><strong>${label}</strong>
              <small>${index===routeStep?'当前建议':hint}</small></a>`).join('')}</nav>
          <p class="plan-green-note">先在线核对，问清再出门，减少重复奔波。</p>
        </section>`:''}
        <section class="plan-rights" aria-labelledby="plan-rights-title">
          <div class="plan-section-heading"><h2 id="plan-rights-title">已选权益</h2><span>${tasks.length} 项</span></div>
          <div class="plan-rights-list">${tasks.map((row,index)=>`<a class="fu-entry" data-plan-policy="${esc(row.policyId)}"
            href="${esc(planReturn(plan,row.policyId))}" ${row===task?'aria-current="true"':''}>
            <span class="plan-right-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span>
            <span class="plan-right-name">${esc(row.name)}<small>${row===suggested?'建议先处理':'点击查看当前事项'}</small></span>
            ${badge(stageOf(row),row.stage)}</a>`).join('') || '<p class="fu-muted">暂未选择权益。</p>'}</div>
        </section>
        ${ids.length>1?disclosure('怎么办更省跑腿',renderAdvice(plan)+
          (!canEdit(plan)?'':'<button type="button" class="fu-button" data-analyze>核对协同安排</button>')):''}
        ${disclosure('管理计划与历史',`<div class="fu-row">
        ${link('查看全部材料',route('prepare',{plan:plan.id}))}
        ${link('办理历史',route('logs',{plan:plan.id,from:PFNavigation.current()}))}
        ${task?link('政策详情',detail(task.policyId)):''}
        ${task&&canEdit(plan)?`<button type="button" class="fu-button" data-task="remove" data-id="${esc(task.policyId)}">移出本计划</button>`:''}</div>`+
        (canEdit(plan)?list([
          ...(current.availableTasks||[]).map(row=>`${esc(row.name)} <button type="button" class="fu-button" data-task="add" data-id="${esc(row.id)}">加入计划</button>`),
          ...plan.tasks.filter(row=>row.removedAt!==null&&row.intent==='verify').map(row=>`${esc(row.name)} <button type="button" class="fu-button" data-task="restore" data-id="${esc(row.policyId)}">恢复到计划</button>`)
        ],'没有其他可加入或恢复的事项。'):'')+
        (!plan.pausedAt&&pauseForm?`<section class="plan-pause-controls"><h3>需要晚点再办？</h3><p>暂停后，已核对的信息和办理记录都会保留。</p>${pauseForm}</section>`:''))}
        <p class="plan-footnote">线上先理清，线下更从容。具体受理要求以主管部门答复为准。</p>
      </div>
    </div>`;
  }

  function official(policy) {
    return policy?.source.url ?
      `<a class="fu-button" href="${esc(policy.source.url)}" target="_blank" rel="noopener">查看政府网站政策原文</a>` :
      '<p>官方来源链接待核实。可向受理机构核对要求。</p>';
  }


  function materialCounts(rows) {
    const materials=rows.filter(row=>row.ref);
    const ready=materials.filter(row=>row.verified && row.state==='ready').length;
    const missing=materials.filter(row=>row.verified && row.state==='missing').length;
    const unknown=materials.length-ready-missing;
    return materials.length ? `共 ${materials.length} 项 · 已准备 ${ready} · 待准备 ${missing} · 待核实 ${unknown}` :
      '暂无明确材料清单，建议向官方核实。';
  }

  const materialName = row => row.text.split(/[，。；]/,1)[0];
  const materialLabel = row => row.verified ? materialStatuses[row.state] : '建议向官方核实';

  function renderPrepare(plan) {
    const tasks=(plan.tasks||[]).filter(task=>verifiedIds(plan).includes(task.policyId)&&(!policyId||task.policyId===policyId));
    return (policyId && tasks[0] ? taskHeader(plan,tasks[0],'材料准备清单','prepare') : header('材料准备清单',planReturn(plan),'‹ 计划总览')) +
      (tasks.length ? tasks.map(task=>panel(policyId?'材料清单':esc(task.name), `<p id="${policyId?'materialTotals':esc('materials-'+task.policyId)}">${materialCounts(task.materials)}</p>
        ${task.materials.map(row=>`<a class="fu-entry" href="${esc(route('material',{plan:plan.id,pid:task.policyId,key:row.key}))}">
          <span>${esc(materialName(row))}</span>${badge(materialLabel(row),row.verified?row.state:'unknown')}</a>`).join('')}
        <div class="fu-row">${link('提交前核对',taskLink(plan,task,'review'),Boolean(policyId))}</div>`)).join('') :
        '<p>当前没有可读取材料的办理事项。</p>');
  }

  function renderMaterial(plan) {
    const task=plan.tasks.find(row=>row.policyId===policyId);
    const row=task?.materials.find(material=>material.key===params.get('key'));
    if (!row || !verifiedIds(plan).includes(policyId))
      return header('材料暂不可用',planReturn(plan),'‹ 计划总览');
    const policy=current.policyEvidence?.find(item=>item.id===policyId);
    return taskHeader(plan,task,'材料详情','prepare') +
      panel(esc(materialName(row)), `<p>${badge(materialLabel(row),row.verified?row.state:'unknown')}</p>
        <h3>来源与依据</h3><p>${esc(row.clause || policy?.source.document || '建议向官方核实')}</p>
        ${official(policy)}<h3>准备说明</h3><p>${esc(row.text)}</p>${row.note?`<p>${esc(row.note)}</p>`:''}
        ${!row.verified ? '<p>请以受理机构确认的收件要求为准。</p>' : ''}
        ${!canEdit(plan) ? (row.reason?`<p>个人备注 ${esc(row.reason)}</p>`:'') :
          `<form class="fu-material" data-policy="${esc(task.policyId)}" data-key="${esc(row.key)}" data-saved-state="${esc(row.state)}">
            <label>材料状态<select name="state">${Object.entries(materialStatuses).filter(([key])=>row.verified||key!=='ready')
              .map(([key,label])=>`<option value="${key}" ${row.state===key?'selected':''}>${label}</option>`).join('')}</select></label>
            <label>我的备注（选填）<textarea name="reason" maxlength="500">${esc(row.reason)}</textarea></label>
            <p class="fu-inline-feedback" role="status"></p><button class="fu-button fu-primary" type="submit">保存</button></form>`}
        <div class="fu-row">${link('返回材料清单',taskLink(plan,task,'prepare'))}</div>`);
  }

  function renderConditions(plan) {
    const task=plan.tasks.find(row=>row.policyId===policyId);
    if (!task) return header('条件暂不可用',planReturn(plan));
    const active=verifiedIds(plan).includes(task.policyId) && canEdit(plan);
    const checks=task.conditionChecks || [];
    const missing=checks.filter(row=>row.canRecord && (row.state==='stale' ||
      row.source!=='user_record' && row.state!=='confirmed' && !row.reported));
    const other=checks.filter(row=>!missing.includes(row));
    const policy=current.policyEvidence?.find(row=>row.id===task.policyId);
    const source = row => `<p class="fu-muted">${esc(conditionSources[row.source] || '政策规则')}${
      row.at?' · '+esc(dateLabel(row.at)):''}${row.reference && !/^(conditions\.|region\.|missing_information\[)/.test(row.reference)
        ?' · '+esc(row.reference):''}</p>`;
    return taskHeader(plan,task,'补充必要条件','conditions')+
      `<section class="fu-panel fu-condition-list"><h2>还需补充的情况</h2>
      <p class="fu-muted">${missing.length ? '按已知情况填写。暂不清楚的条件可稍后核实。' : '当前没有需要补填的情况，可直接准备材料。'}</p>
        ${missing.map(row=>conditionRow(row,active,policy,source(row),plan,task)).join('')}</section>`+
      (other.length ? disclosure('已记录的信息及其他核实事项',other.map(row=>conditionRow(row,active,policy,source(row),plan,task)).join('')) : '')+
      (active && task.workflowActions?.includes('start_preparation') ?
        '<form id="executionForm"><input type="hidden" name="status" value="start_preparation">'+
        '<p id="executionStatus" role="status" aria-live="polite"></p>'+
        '<button class="fu-button fu-primary" type="submit">继续准备材料</button></form>' : '')+
      `<div class="fu-row">${task.stage==='pending' && active ? '' : link('继续准备材料',taskLink(plan,task,'prepare'),true)}
      ${task.stage==='pending' && active ? link('稍后补充',taskLink(plan,task,'prepare')) : ''}</div>`;
  }

  function conditionStatus(row) {
    if (row.state === 'stale') return ['需重新核实','stale'];
    if (row.source === 'reported_official_result') return ['用户转述正式结果 · 待核验','pending'];
    if (row.inputKind === 'official' || row.inputKind === 'observation') return ['需要官方核实','pending'];
    if (row.inputKind === 'reference') return [row.relatedCondition ? '见对应条件' : '暂时无法判断','pending'];
    if (row.source === 'user_record') {
      if (row.answer === 'unknown') return ['已记录不清楚','unknown'];
      return row.answer === 'not_met' ? ['自述：否','unknown'] : ['自述：是','confirmed'];
    }
    if (row.state === 'confirmed') return row.answer === 'not_met'
      ? ['已知条件不满足','rejected'] : ['已沿用查询信息','confirmed'];
    return [row.inputKind === 'fact' || row.inputKind === 'rule' ? '尚未提供信息' : '暂时无法判断','unknown'];
  }

  function conditionRow(row, active, policy, source, plan, task) {
    const [label,tone] = conditionStatus(row);
    const formal = row.inputKind === 'official';
    const observation = row.inputKind === 'observation';
    const record = row.reported;
    const reportOptions = formal ? {received:'已获得',not_received:'尚未获得',unknown:'不清楚'} :
      {six_months:'已持续 6 个月或以上',under_six_months:'不足 6 个月',unknown:'不清楚'};
    const options = (choices,value) => '<option value="">请选择</option>'+Object.entries(choices)
      .map(([key,text])=>`<option value="${key}" ${value===key?'selected':''}>${text}</option>`).join('');
    const legacy = row.source === 'user_record' && !record && row.inputKind !== 'fact'
      ? `<p>已有旧版个人记录（${esc(conditionAnswers[row.answer])}），正式条件仍需按相应依据核实。</p>` : '';
    return `<details class="fu-condition-item" name="fu-conditions" id="check-${esc(row.id)}">
      <summary><strong>${esc(row.text)}</strong>${badge(label,tone)}
        <small>${esc(row.state === 'stale' ? '相关资料已变化，请重新核对。' : row.guidance || '可向主管部门核实。')}</small>
        <span class="fu-disclosure-arrow" aria-hidden="true"></span></summary>
      <div class="fu-condition-body">${source}${legacy}
        ${record ? `<p>已记录：${esc(reportOptions[record.status])}${record.result ? ' · '+esc(record.result)+' · '+esc(record.source) : ''}</p>` : ''}
        ${row.relatedCondition ? `<a class="fu-button" href="#check-${esc(row.relatedCondition)}" data-related-condition>打开对应条件</a>` : ''}
        ${official(policy)}
        ${active && needsConsultation(row) && (row.inputKind==='official' || row.inputKind==='observation' || !row.canRecord)
          ? link('咨询官方',consultLink(plan,task,row.id),true) : ''}
        ${active && row.canRecord ? `<form class="fu-condition" data-condition="${esc(row.id)}">
          ${formal || observation ? `<input type="hidden" name="answer" value="unknown">
            <label>${formal?'是否已获得正式结果？':'家人观察到的持续时间'}<select name="reportStatus" required>${options(reportOptions,record?.status)}</select></label>
            ${formal ? `<div class="fu-report-fields" ${record?.status==='received'?'':'hidden'}>
              <label>已知结果或等级<input name="reportedResult" maxlength="160" value="${esc(record?.result)}"></label>
              <label>结果出具机构或来源<input name="reportedSource" maxlength="160" value="${esc(record?.source)}"></label></div>` : ''}`
            : `<label>按已知情况填写<select name="answer" required>${options({met:'是',not_met:'否',unknown:'不清楚'},row.source==='user_record' && row.state!=='stale' ? row.answer : '')}</select></label>`}
          <p class="fu-inline-feedback" role="status"></p><button class="fu-button" type="submit">保存这项记录</button>
        </form>`:''}</div></details>`;
  }

  function consultTask(plan) {
    return plan?.tasks.find(task=>task.policyId===policyId && (!params.has('task') || params.get('task')===task.id) &&
      (!params.has('region') || params.get('region')===plan.region));
  }

  function consultationText(plan, task) {
    const questions=(task.conditionChecks||[]).filter(needsConsultation);
    const highlighted=params.get('condition');
    const ordered=questions.slice().sort((a,b)=>Number(b.id===highlighted)-Number(a.id===highlighted));
    const lines=ordered.map(row=>row.text);
    const age=current.profile?.age;
    const person=current.mode==='self' ? '本人' : '家人';
    const background='我想为'+(Number.isInteger(age)?age+'岁的':'')+person+'核实这项权益，办理地区是'+plan.region+'。';
    return {ordered, text:[task.name+'（'+plan.region+'）',background,
      ...(lines.length?['请协助核实：',...lines.map((text,i)=>`${i+1}. ${text}`)]:[]),
      '请告知负责受理的机构、适用的办理入口及需要出示的材料。'].join('\n')};
  }

  function renderConsult(plan) {
    const item=current.items[policyId], task=consultTask(plan);
    if (!item||!task||!verifiedIds(plan).includes(policyId)) return header('官方咨询',route('plan',{plan:plan.id}))+'<p>该政策已离开本次待核实清单。</p>';
    const policy=current.policyEvidence?.find(row=>row.id===policyId);
    const {ordered,text}=consultationText(plan,task);
    const status={unrecorded:'未咨询',contacted:'已联系，暂未获得明确答复',reply_recorded:'已咨询并记录答复'};
    return header('官方咨询与核实',consultReturn(plan,task),'‹ 返回原办理页面') +
      panel(esc(item.name),`<p>${status[task.consultationStatus]}</p>
        ${policy?.source.department?`<p>政策发布机关：${esc(policy.source.department)}</p>`:''}
        ${PFActionability.channels(policy?.channels,esc)}
        ${official(policy)}${list((policy?.locations||[]).filter(row=>row.verified).map(row=>esc(row.text)), '受理方式待核实。')}${list(ordered.map(row=>esc(row.text)), '当前没有需要重复核实的条件。')}
        <details><summary>查看可复制的咨询内容</summary><pre style="white-space:pre-wrap">${esc(text)}</pre></details>
        ${canEdit(plan)&&task.consultationStatus==='unrecorded' ?
          '<button type="button" class="fu-button" data-consult-contact>已联系，暂不记录答复</button>' : ''}
        <button type="button" class="fu-button" data-copy>复制咨询问题</button>`) +
      (!canEdit(plan) ? '' : panel('记录本次咨询',`<form id="consultForm">
        <label>记录来源<select name="sourceType" required>${consultationSourceOptions()}
          <option value="waiting">尚未收到答复（来源未分类）</option></select></label>
        <label>咨询机构<input required name="institution" maxlength="120"></label>
        <label>咨询日期<input required type="date" name="date"></label>
        <label>时间（选填）<input type="time" name="time"></label>
        <label>咨询渠道<input required name="channel" maxlength="80" placeholder="例如：官方办事窗口"></label>
        <label>实际提出的问题<textarea required name="content" maxlength="800"></textarea></label>
        <label data-consult-answer hidden>实际收到的答复<textarea name="answer" required maxlength="800" disabled></textarea></label>
        <label data-consult-note hidden>记录内容<textarea name="recordText" required maxlength="800" disabled></textarea></label>
        <label>后续需要准备的材料<textarea name="followUpMaterials" maxlength="500"></textarea></label>
        <label>后续处理要求<textarea name="pending" maxlength="500"></textarea></label>
        <label>后续状态<select name="followUpStatus"><option value="none">无后续事项</option><option value="pending">待处理</option><option value="done">已处理</option></select></label>
        <button class="fu-button fu-primary" type="submit">保存咨询记录</button></form>`))
      +link('管理办理状态',route('task',{plan:plan.id,pid:policyId,member:plan.memberId}))
      +list(plan.consultations.filter(row=>row.pid===policyId).map(consultationLink),'暂无该任务的咨询记录。');
  }

  function renderRecord(row) {
    const form=row.form;
    const officialReply=row.sourceType==='official_reply_recorded';
    const originalAnswer=form.answer||form.result;
    const recordedAnswer=form.recordedOfficialAnswer;
    const retainedText=[...new Set((officialReply
      ? [form.recordText,form.answer,form.result].filter(text=>text!==(recordedAnswer||originalAnswer))
      : [form.recordText,form.answer,form.result,recordedAnswer]).filter(Boolean))];
    return header('咨询记录',PFNavigation.withParams('services.html',{member:row.memberId}))+panel(esc(row.policyName),`
      <p>${esc(row.memberName)} · <span data-consult-source>${esc(PFBusiness.consultationSourceLabel(row.sourceType))}</span></p>
      <p>${esc(form.date)} ${esc(form.time)} · ${esc(form.institution||'机构未记录')} · ${esc(form.channel)}</p>
      <h3>实际提出的问题</h3><p>${esc(form.content||'未记录')}</p>
      ${officialReply?`<h3>答复转记（未经独立核验）</h3><p>${esc(recordedAnswer||originalAnswer)}</p>`:''}
      ${retainedText.length?`<h3>${officialReply?'其他记录内容':'记录内容'}</h3>${retainedText.map(text=>`<p>${esc(text)}</p>`).join('')}`:''}
      <h3>后续处理</h3><p>${esc(({none:'无后续事项',pending:'待处理',done:'已处理'})[form.followUpStatus]||'状态未记录')}</p>
      <p>${esc(form.followUpMaterials)} ${esc(form.pending)}</p>
      ${row.taskId?link('查看对应办理任务',route('task',{plan:row.planId,pid:row.pid,member:row.memberId})):''}`)
      +panel('修改记录来源',`<form id="consultSourceForm" data-member="${esc(row.memberId)}"
        data-consultation="${esc(row.id)}" data-revision="${row.revision}" data-source="${esc(row.sourceType)}"
        data-recorded-answer="${recordedAnswer?'yes':'no'}">
        <label>记录来源<select name="sourceType" required>${consultationSourceOptions(row.sourceType)}</select></label>
        <label data-consult-answer hidden>请单独填写实际收到的答复<textarea name="officialAnswer" required maxlength="800" disabled></textarea></label>
        <button class="fu-button fu-primary" type="submit">保存来源</button></form>`);
  }

  function renderLogs(plan) {
    const plans=plan?[plan]:Object.values(current.plans);
    const consultations=(businessMode&&!plan?[...current.consultations,...plans.flatMap(p=>p.consultations)]:plans.flatMap(p=>p.consultations))
      .filter(row=>!policyId||row.pid===policyId).sort((a,b)=>b.createdAt-a.createdAt);
    const changes=Object.values(current.items).flatMap(item=>item.changes.map(row=>({...row,name:item.name,policyId:item.id})))
      .filter(row=>(!plan||row.planId===plan.id)&&(!policyId||row.policyId===policyId)).sort((a,b)=>b.at-a.at);
    const events=plans.flatMap(entry=>(entry.tasks||[]).filter(task=>!policyId||task.policyId===policyId)
      .flatMap(task=>(task.workflowHistory||[]).map(row=>({...row,task,plan:entry}))))
      .sort((left,right)=>right.at-left.at);
    const workflow=events.filter(row=>row.kind==='workflow');
    const checks=events.filter(row=>row.kind==='condition'||row.kind==='material');
    return header('核实与咨询记录',plan?route('plan',{plan:plan.id}):'services.html') +
      panel('咨询记录',list(consultations.map(consultationLink),'暂无咨询记录。')) +
      (workflow.length?panel('办理过程',list(workflow.map(row=>link(
        `${esc(row.task.name)} · ${esc(actionLabels[row.reason] || stageLabels[row.newStage])} · ${esc(dateLabel(row.at))}`,
        taskLink(row.plan,row.task))))):'')+
      (checks.length?disclosure('条件与材料更新',list(checks.map(row=>{
        const condition=row.kind==='condition';
        const label=condition ? conditionAnswers[row.newAnswer] : materialStatuses[row.newState];
        return link(`${esc(row.task.name)} · ${condition?'条件核对':'材料准备'} · ${esc(label)} · ${esc(dateLabel(row.at))}`,
          taskLink(row.plan,row.task,condition?'conditions':'prepare'));
      }))):'')+
      panel('状态记录',list(changes.map(row=>{
        const label=esc(row.name)+' · '+esc(taskStatuses[row.status])+' · '+esc(new Date(row.at).toLocaleString());
        return (row.planId?link(label,route('task',{plan:row.planId,pid:row.policyId,member:current.memberId,from:PFNavigation.current()})):label)
          +(row.note?`<p>${esc(row.note)}</p>`:'');
      }),'暂无状态变更。'));
  }

  async function render(replacement) {
    const version=++loadVersion;
    try {
      businessMode=await PFBusiness.enabled();
      if(view==='record' && businessMode){
        const {consultation}=await PFBusiness.consultation(params.get('consultation'),memberId);
        if(version===loadVersion){
          rememberMember(consultation.memberId);
          root.innerHTML=renderRecord(consultation);
        }
        return;
      }
      let data;
      if(replacement)data=replacement;
      else if(businessMode){
        if(planId)data=await PFBusiness.plan(planId,memberId,params.get('query'));
        else if(batchId){
          const result=await PFBusiness.batch(batchId);
          const batch=result.batch;
          if ((queryId && queryId!==batch.queryId) || (memberId!==null && memberId!==batch.memberId))
            throw Error('此处理批次与指定的查询或成员不一致。');
          data={...result,queryId:batch.queryId,memberId:batch.memberId,region:batch.region,plans:{}};
        } else if(queryId) {
          data=await PFBusiness.query(queryId,memberId);
          data.items=Object.fromEntries(Object.entries(data.items).filter(([,item])=>item.activeQueryIds.includes(queryId)));
          data.memberArchived=(await PFBusiness.members()).find(row=>row.id===data.memberId)?.archivedAt != null;
        }
        else {
          const rows=await PFBusiness.members();
          if(version!==loadVersion)return;
          memberRows=rows;
          if(view==='members'){
            current=null;
            root.innerHTML=renderMembers();
            return;
          }
          const selected=rows.find(row=>row.id===memberId);
          if(!selected){
            current=null;
            root.innerHTML=header('请选择成员','services.html')+memberPicker();
            notice.textContent=memberId?'无法恢复指定成员，请重新选择。':'请选择要查看记录的家庭成员。';
            return;
          }
          data=await PFBusiness.overview(selected.id);
          data.memberArchived=selected.archivedAt != null;
        }
      }else data=PFFollowup.read();
      if(version!==loadVersion)return;
      current=data;
      notice.textContent='';
      if(businessMode && current?.memberId) rememberMember(current.memberId);
      if (!current) {
        root.innerHTML=header('权益后续服务','services.html')+panel('请先完成当前查询','<p>查询完成后，从政策结果选择要核实的事项。</p>'+link('返回发现','discovery-c.html'));
        return;
      }
      const plan=currentPlan();
      if(view==='list' && businessMode) {
        const selectable=queue().filter(canSelect).map(item=>item.id);
        for(const id of checked)if(!selectable.includes(id))checked.delete(id);
        if(!initializedSelection) {
          selectable.forEach(id=>checked.add(id));
          initializedSelection=true;
        }
      }
      if (view==='members'&&businessMode) root.innerHTML=renderMembers();
      else if (view==='list') root.innerHTML=renderList();
      else if (view==='plans') root.innerHTML=renderPlans();
      else if (view==='saved') root.innerHTML=header('先记下来的政策','services.html') +
        list(Object.values(current.items).filter(item=>item.intent==='later').map(item=>esc(item.name)+' '+link('政策详情',detail(item.id)) +
          (canSelect(item)?` <button class="fu-button" data-intent="verify" data-id="${esc(item.id)}">打算去核实</button>`:'')),'暂无已保存政策。');
      else if (view==='logs'&&(!planId||plan)) root.innerHTML=renderLogs(plan);
      else if (!plan) root.innerHTML=header('计划暂不可用',route('plans'))+'<p>当前查询下未找到这个计划。</p>';
      else if (view==='prepare') root.innerHTML=renderPrepare(plan);
      else if (view==='material') root.innerHTML=renderMaterial(plan);
      else if (view==='review') root.innerHTML=renderReview(plan);
      else if (view==='conditions') root.innerHTML=renderConditions(plan);
      else if (view==='consult') root.innerHTML=renderConsult(plan);
      else if (view==='task') root.innerHTML=renderTaskPage(plan);
      else root.innerHTML=renderPlan(plan);
      if(!planId && businessMode && view!=='members')root.querySelector('header')?.insertAdjacentHTML('afterend',memberPicker());
      const create=document.getElementById('createPlan');
      if(create)create.disabled=!businessMode||!checked.size;
      if(!businessMode){
        root.querySelectorAll('input,select,textarea,button:not([data-copy])').forEach(control=>control.disabled=true);
        notice.textContent='历史记录仅供查看。请在已启用 SQLite 的预览中保存新操作。';
      }
    } catch(error) {
      if(version!==loadVersion)return;
      if(replacement)throw error;
      current=null;
      root.innerHTML=header('记录暂不可用','services.html')+
        '<div class="fu-row"><button type="button" class="fu-button" data-retry-load>重新读取</button>'+
        (businessMode ? link('重新选择成员','services.html') : '')+'</div>';
      notice.textContent=error.message;
    }
  }

  function rememberMember(id) {
    memberId=id;
    const url=new URL(location.href);
    url.searchParams.set('member',id);
    history.replaceState(history.state,'',url);
  }

  function revealField(form, selector, show) {
    const field=form.querySelector(selector);
    field.hidden=!show;
    field.querySelectorAll('input,textarea').forEach(input=>{input.disabled=!show;});
    if(field.matches('fieldset'))field.disabled=!show;
  }

  root.addEventListener('change',async event=>{
    if(!businessMode)return;
    const input=event.target;
    if(input.id==='fuMember'){
      memberId=input.value;
      checked.clear();
      current=null;
      root.innerHTML=header('正在切换成员','services.html')+memberPicker();
      notice.textContent='正在读取所选成员的记录。';
      const url=new URL(location.href);
      url.searchParams.set('member',memberId);
      history.replaceState(history.state,'',url);
      await render();
      return;
    }
    if(input.matches('[data-select]')){
      if(input.checked)checked.add(input.value);else checked.delete(input.value);
      document.getElementById('createPlan').disabled=!checked.size;
      if(scopedList)history.replaceState({...history.state,pfPlanSelection:[...checked]},'');
    }
    if(input.form?.id==='executionForm'&&input.name==='status'){
      for(const fields of input.form.querySelectorAll('[data-workflow]')){
        fields.hidden=fields.disabled=fields.dataset.workflow!==input.value;
      }
      input.form.querySelector('h2').textContent=input.selectedOptions[0].text;
      input.form.querySelector('[type="submit"]').textContent=input.selectedOptions[0].text;
    }
    if(input.name==='sourceType'&&['consultForm','consultSourceForm'].includes(input.form?.id))
      showConsultationSourceFields(input.form);
  });

  function showConsultationSourceFields(form){
    const source=form.elements.sourceType.value;
    revealField(form,'[data-consult-answer]',source==='official_reply_recorded'&&
      source!==form.dataset.source&&form.dataset.recordedAnswer!=='yes');
    if(form.id==='consultForm')revealField(form,'[data-consult-note]',source==='personal_note'||source==='ai_organized');
  }

  function showExecutionStatus(message){
    const feedback=document.getElementById('executionStatus');
    if(!feedback){notice.textContent=message;return;}
    feedback.textContent=message;
    feedback.scrollIntoView({block:'nearest'});
  }

  root.addEventListener('invalid',event=>{
    if(event.target.form?.id==='executionForm')
      showExecutionStatus('尚未保存。'+event.target.validationMessage);
  },true);

  root.addEventListener('submit',async event=>{
    if(!businessMode){event.preventDefault();return;}
    if(event.target.matches('.fu-member,#fuAddMember')){
      event.preventDefault();
      const row=memberRows.find(member=>member.id===event.target.dataset.memberId);
      const fields=Object.fromEntries(new FormData(event.target));
      const button=event.target.querySelector('[type="submit"]');
      if(button.disabled)return;
      button.disabled=true;
      try{
        if(row) await PFBusiness.command('memberUpdate',{memberId:row.id,expectedRevision:row.revision,...fields});
        else await PFBusiness.addMember(fields.name,fields.relation);
        await render();
        notice.textContent=row?'成员资料已保存。':'已添加家庭成员。';
      }catch(error){notice.textContent=error.message;}
      finally{button.disabled=false;}
      return;
    }
    const element=event.target;
    const material=element.matches('.fu-material');
    const condition=element.matches('.fu-condition');
    const execution=element.id==='executionForm';
    const editSource=element.id==='consultSourceForm';
    const planPause=element.id==='planPauseForm';
    if(!material&&!condition&&!execution&&!editSource&&!planPause&&element.id!=='consultForm')return;
    event.preventDefault();
    if(saving)return;
    saving=true;
    const button=event.target.querySelector('[type="submit"]');
    let returning=false;
    button.disabled=true;
    const feedback=element.querySelector('.fu-inline-feedback');
    if(feedback)feedback.textContent='正在保存…';
    if(execution)showExecutionStatus('正在保存办理状态…');
    try{
      const form=Object.fromEntries(new FormData(element));
      if(planPause){
        const plan=currentPlan();
        const saved=await PFBusiness.command('planPause',{planId,memberId:plan.memberId,expectedRevision:plan.revision,
          paused:!plan.pausedAt,reason:form.reason||''});
        await render(saved.data);
        notice.textContent=plan.pausedAt?'计划已恢复。':'计划已暂停。';
        return;
      }
      if(editSource){
        await PFBusiness.command('consultationSource',{...form,consultationId:element.dataset.consultation,
          memberId:element.dataset.member,expectedRevision:Number(element.dataset.revision)});
        await render();
        notice.textContent='咨询记录来源已保存。';
        return;
      }
      const id=material?element.dataset.policy:policyId;
      const task=currentPlan().tasks.find(row=>row.policyId===id);
      const context={planId,policyId:id,memberId:current.memberId,taskId:task.id};
      if(material){
        const saved=await PFBusiness.command('material',{...context,materialKey:element.dataset.key,
          ...form,expectedRevision:task.revision});

        const plan=saved.data.plans[planId];
        const savedTask=plan.tasks.find(row=>row.id===task.id);
        const savedRow=savedTask.materials.find(row=>row.key===element.dataset.key);
        element.dataset.savedState=savedRow.state;
        element.elements.state.value=savedRow.state;
        element.elements.reason.value=element.elements.reason.defaultValue=savedRow.reason||'';
        returning=true;
        location.replace(taskLink(plan,savedTask,'prepare'));
      }else if(condition){
        const saved=await PFBusiness.command('condition',{...context,conditionId:element.dataset.condition,...form,
          expectedRevision:task.revision});
        const drafts=new Map([...root.querySelectorAll('.fu-condition')].filter(row=>row!==element)
          .map(row=>[row.dataset.condition,new FormData(row)]));
        const openId=root.querySelector('.fu-condition-item[open]')?.id;
        await render(saved.data);
        for(const row of root.querySelectorAll('.fu-condition')){
          for(const [key,value] of drafts.get(row.dataset.condition) || []) {
            if(row.elements[key]) row.elements[key].value=value;
          }
          updateReportFields(row);
        }
        const open=document.getElementById(openId);
        if(open){
          const group=open.parentElement.closest('details');
          if(group)group.open=true;
          open.open=true;
          open.querySelector('summary').focus({preventScroll:true});
        }
        notice.textContent='这项核对已保存。';
      }else if(execution){
        const {status:action,...fields}=form;
        const saved=await PFBusiness.command('workflow',{...context,...fields,action,
          ...(action==='correct_result'?{correctionConfirmed:form.correctionConfirmed==='on'}:{}),
          ...(action==='review_submission'?{requirementsConfirmed:form.requirementsConfirmed==='on'}:{}),
          ...(action==='confirm_submission'?{submitted:form.submitted==='on'}:{}),expectedRevision:task.revision});
        const savedPlan=saved.data.plans[planId];
        const savedTask=savedPlan.tasks.find(row=>row.id===task.id);
        returning=true;
        location.replace(action==='start_preparation' ? taskLink(savedPlan,savedTask,'prepare') :
          planReturn(savedPlan,action==='record_result' && ['completed','rejected'].includes(savedTask.stage) ? null : savedTask.policyId));
        return;
      }else{
        if(form.sourceType==='official_reply_recorded')form.responseStatus='received';
        if(form.sourceType==='waiting'){
          delete form.sourceType;
          form.responseStatus='waiting';
        }
        const saved=await PFBusiness.command('consult',{...context,form});
        await render(saved.data);
        notice.textContent='咨询记录已保存。';
      }
    }catch(error){
      if(error.code==='revision_conflict'&&!editSource){
        try{current=await PFBusiness.plan(planId,memberId);}
        catch{/* Keep the form and allow a later retry. */}
      }
      const message='保存未完成。'+error.message+' 当前输入已保留。';
      if(execution)showExecutionStatus(message);
      else {
        if(feedback)feedback.textContent=message;
        notice.textContent=message;
      }
    }
    finally{if(!returning){saving=false;button.disabled=false;}}
  });

  async function reviseIntent(id,intent){
    const item=current.items[id];
    await PFBusiness.command('intent',{queryId:current.queryId||item.activeQueryIds[0],policyId:id,intent,expectedRevision:item.revision});
  }
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');
    if(!button||button.disabled||(button.form&&button.type==='submit')||
      (!businessMode&&!button.matches('[data-copy],[data-retry-load]')))return;
    button.disabled=true;
    try{
      if(button.matches('[data-retry-load]')){
        await render();
      }else if(button.dataset.archiveMember){
        const row=memberRows.find(member=>member.id===button.dataset.archiveMember);
        if(!row.archivedAt && !confirm('归档后仍可查看其历史记录。确定归档？'))return;
        await PFBusiness.command('memberArchive',{memberId:row.id,expectedRevision:row.revision,archived:!row.archivedAt});
        await render();
      }else if(button.id==='createPlan'){
        const from=PFNavigation.current();
        const selected=[...checked].map(id=>current.items[id]);
        if(new Set(selected.map(item=>item.region)).size!==1)throw Error('请选择同一地区的政策创建计划。');
        const result=await PFBusiness.command('createPlan',{
          memberId:current.memberId, ids:[...checked].sort(), from,
          ...(scopedList ? {queryId:current.queryId,...(batchId?{batchId}:{})} : {region:selected[0].region}),
        });
        location.assign(PFNavigation.withParams(planLink(result.planId),{from}));
      }else if(button.matches('[data-remove]')){
        if(!confirm('移出后仍可在已保存政策中查看。继续吗？'))return;
        await reviseIntent(button.dataset.remove,'later');
        checked.delete(button.dataset.remove);await render();notice.textContent='已移出清单并保留到已保存政策。';
      }else if(button.matches('[data-intent]')){
        await reviseIntent(button.dataset.id,button.dataset.intent);
        checked.delete(button.dataset.id);await render();notice.textContent='处理意向已保存。';
      }else if(button.matches('[data-analyze]')){
        notice.textContent='正在核对官方政策依据…';
        const expectedRevision=currentPlan().revision;
        const advice=await API.post('/api/ai/action-plan',{planId,expectedRevision});
        const saved=await PFBusiness.command('advice',{planId,advice,expectedRevision});
        await render(saved.data);notice.textContent='已保存本次核对结果。待核实的环节仍需向官方确认。';
      }else if(button.matches('[data-consult-contact]')){
        const plan=currentPlan(), task=consultTask(plan);
        const saved=await PFBusiness.command('consultContact',{planId,policyId,memberId:plan.memberId,taskId:task.id,expectedRevision:task.revision});
        await render(saved.data);
        notice.textContent='已标记联系，仍可返回办理。';
      }else if(button.matches('[data-copy]')){
        const plan=currentPlan();
        await navigator.clipboard.writeText(consultationText(plan,consultTask(plan)).text);
        notice.textContent='咨询问题已复制。';
      }else if(button.matches('[data-task]')){
        const plan=currentPlan(), policyId=button.dataset.id, action=button.dataset.task;
        const expectedRevision=action==='add'?plan.revision:plan.tasks.find(row=>row.policyId===policyId).revision;
        const saved=await PFBusiness.command('task',{planId,policyId,action,expectedRevision});
        await render(saved.data);
        notice.textContent='计划任务已更新。若仍有多项政策，可重新核对协同安排。';
      }
    }catch(error){
      if(button.id==='createPlan' && ['plan_source_required','not_in_queue','member_archived'].includes(error.code))await render();
      const code=error.code || error.payload?.error;
      if(businessMode && ['revision_conflict','advice_conflict'].includes(code)) {
        if(view==='consult')current=await PFBusiness.plan(planId).catch(()=>current);
        else await render();
      }
      notice.textContent='操作未完成。'+(error.message||'请重试。');
    }
    finally{button.disabled=false;}
  });
  function updateReportFields(form) {
    const fields=form.querySelector('.fu-report-fields');
    if(!fields)return;
    fields.hidden=form.elements.reportStatus.value!=='received';
    for(const input of fields.querySelectorAll('input')) input.required=!fields.hidden;
  }
  if(view==='conditions'){
    root.addEventListener('change',event=>{
      if(event.target.name==='reportStatus')updateReportFields(event.target.form);
    });
    root.addEventListener('click',event=>{
      const link=event.target.closest('[data-related-condition]');
      if(!link)return;
      const target=document.getElementById(link.hash.slice(1));
      if(!target)return;
      event.preventDefault();
      const group=target.parentElement.closest('details');
      if(group)group.open=true;
      target.open=true;
      target.querySelector('summary').focus();
    });
  }
  if(view==='material')window.addEventListener('beforeunload',event=>{
    const dirty=[...root.querySelectorAll('.fu-material')].some(form=>form.dataset.savedState!==form.elements.state.value ||
      form.elements.reason.defaultValue!==form.elements.reason.value);
    if(dirty)event.preventDefault();
  });
  render().then(()=>{
    if(!location.hash.startsWith('#check-') && location.hash!=='#official-channels')return;
    const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if(!target)return;
    if(target.tagName==='DETAILS'){
      const parent=target.parentElement.closest('details');
      if(parent)parent.open=true;
      target.open=true;
    }
    target.scrollIntoView({block:'nearest'});
  });
  window.addEventListener('pageshow', async event=>{
    if(!event.persisted)return;
    const draft=document.getElementById('consultForm');
    const inputs=draft ? Object.fromEntries(new FormData(draft)) : null;
    await render();
    const restored=document.getElementById('consultForm');
    if(restored&&inputs){
      for(const [name,value] of Object.entries(inputs))restored.elements.namedItem(name).value=value;
      showConsultationSourceFields(restored);
    }
  });
})();
