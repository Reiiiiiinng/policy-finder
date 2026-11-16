/* UI draft is history-entry state only; authoritative query uses existing store/API.
 * No localStorage, new session key, migration or schema 3 mutation. */
(() => {
 'use strict';
 const self=location.pathname.endsWith('/self.html');
 if(self&&new URLSearchParams(location.search).get('results')==='1'){
   document.getElementById('legacySelf').classList.add('results-visible');return;
 }
 let aiRun=0,aiController=null;
 const root=document.createElement('main');root.className='app q-app';document.body.prepend(root);
 const esc=escapeHtml, mode=self?'self':'family';let busy=false, cities=[],sceneLibrary=[],sceneError='',regionError='', readError='';
 const blank=()=>({age:'',city:'',answers:{},scenes:[],scenesTouched:false,ai:{status:'idle',description:'',suggestions:[],confirmed:[],directions:[],pending:[]}});
 let saved={};
 try{const raw=sessionStorage.getItem(store.key);if(raw){saved=JSON.parse(raw);if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error();}}
 catch(e){readError='查询资料读取失败。为避免覆盖原资料，本页暂不能提交；请恢复浏览器存储权限后刷新。';}
 let state={mode,step:1,operator:self?'本人':saved.operator||'',beneficiary:self?'本人':saved.beneficiary||'',drafts:{},open:''};
 const initial=self?saved.selfProfile:saved.profile;
 let businessMode, memberRows=[], memberError='';
 const key=()=>self?'self':businessMode?state.memberId||'_new':state.beneficiary||'_new';
 if(initial&&state.beneficiary) state.drafts[key()]={age:initial.age??'',city:initial.region||'',answers:{...(initial.uiForm?.answers||initial.uiAnswers||{})},scenes:[...(initial.uiForm?.scenes||initial.confirmed_scenes||[])],scenesTouched:!!initial.uiForm?.scenesTouched,ai:initial.uiForm?.ai||{status:'idle',description:'',suggestions:[],confirmed:[],directions:[],pending:[]}};
 const restoredDraft=history.state?.pfQuery?.mode===mode;
 if(restoredDraft)state=history.state.pfQuery;
 if(!state.memberId && initial?.uiForm?.memberId) state.memberId=initial.uiForm.memberId;
 if(initial?.uiForm?.memberId && state.memberId===initial.uiForm.memberId && state.drafts[initial.uiForm.beneficiary] && !state.drafts[state.memberId]) {
   state.drafts[state.memberId]=state.drafts[initial.uiForm.beneficiary];
 }
 if(new URLSearchParams(location.search).get('edit')==='1')state.step=2;
 const editId=new URLSearchParams(location.search).get('query');
 let editVersion, editLoading=!!editId;
 const draft=()=>{const d=state.drafts[key()]||(state.drafts[key()]=blank());d.ai ||= {status:'idle',description:'',suggestions:[],confirmed:[],directions:[],pending:[]};return d;};
 if(draft().ai.status==='loading'){draft().ai.status='interrupted';draft().ai.message='上次分析已中断，可重试或继续查询。';}
 const groups=PFQueryFields.groups.filter(g=>!g.selfOnly||self);
 const remember=()=>{try{history.replaceState({...history.state,pfQuery:state},'');}catch(e){/* Memory draft still usable. */}};
 function error(text){root.querySelector('#qError').textContent=text;}
 function option(v,t,current){return `<option value="${esc(v)}" ${v===current?'selected':''}>${esc(t)}</option>`;}
 const glyph={heart:'M12 21S2 15 2 8a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 7-10 13-10 13ZM5 12h4l2-4 3 8 2-4h4',home:'M3 11 12 3l9 8v10h-6v-7H9v7H3Z',meal:'M5 2v8m4-8v8M3 2v5a4 4 0 0 0 8 0V2M7 11v11M19 2v20m0-20c-5 4-5 11 0 11',pin:'M12 22S3 13 3 9a9 9 0 0 1 18 0c0 4-9 13-9 13ZM15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0',note:'M4 5h16M4 12h16M4 19h16'};
 function field(f){const v=draft().answers[f.id]||'';if(f.text)return `<label class="q-label" for="q-${f.id}">${esc(f.label)}</label><textarea id="q-${f.id}" data-field="${f.id}" maxlength="500">${esc(v)}</textarea>`;
 return `<fieldset><legend>${esc(f.label)}</legend><div class="q-options">${f.options.map(([value,label])=>`<label><input type="radio" name="${f.id}" data-field="${f.id}" value="${value}" ${value===v?'checked':''}>${label}</label>`).join('')}</div><button type="button" class="q-clear" data-clear="${f.id}">清除选择，暂不提供</button></fieldset>`;}
 function review(){const d=draft();const rows=[...(self?[['查询对象','本人']]:[['操作人',state.operator],['受益人',state.beneficiary]]),['年龄',d.age+' 岁'],['所在城市',d.city]];
 for(const g of groups){if(g.scenes){rows.push(['生活变化',(d.scenes||[]).join('、')||'暂未提供']);continue;}if(g.region){rows.push(['所在区 / 街道','暂未提供（当前政策库未提供选项表）']);continue;}for(const f of g.fields){const v=d.answers[f.id];rows.push([f.label,!v?'暂未提供':f.text?v:f.options.find(x=>x[0]===v)?.[1]||'暂未提供']);}}
 const ai=d.ai, confirmed=ai.confirmed||[];
 if(ai.description?.trim())rows.push(['生活描述原文（仅作匹配线索）',ai.description]);
 rows.push(['AI 辅助分析',ai.status==='success'?'已整理，请核对以下信息':ai.status==='skipped'?'已跳过':ai.message||'未分析']);
 if(ai.status==='success'){
  rows.push(['AI 引用的原话（仅供核对）',(ai.facts||[]).join('；')||'暂无']);
  rows.push(['您已确认的场景（参与匹配）',confirmed.join('、')||'暂无']);
  rows.push(['AI 推断（尚未确认）',(ai.suggestions||[]).filter(item=>!confirmed.includes(item.scene)).map(item=>item.scene).join('、')||'暂无']);
 }
 return `<dl class="q-review">${rows.map(([k,v])=>`<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;}
 function render(){const d=draft(), restoreDescriptionFocus=document.activeElement?.id==='qAIDescription';root.innerHTML=`<header class="q-head"><button class="q-back" aria-label="返回" id="qBack">←</button>${self?'为自己看看':'家庭协助'}<button type="button" class="q-exit" id="qExit">退出查询</button></header><ol class="q-progress" aria-label="查询进度">${[self?'确认身份':'确认人物','填写基本情况','核对信息'].map((t,i)=>`<li class="${i+1===state.step?'current':i+1<state.step?'done':''}" ${i+1===state.step?'aria-current="step"':''}><span>${i+1<state.step?'✓':i+1}</span>${t}</li>`).join('')}</ol><div id="qError" class="q-error" role="alert">${esc(readError|| (PF_V3_MODE!=='v1'?'当前数据处于保护模式，本页不提交查询。':''))}</div>`;
 if(state.step===1)root.insertAdjacentHTML('beforeend',`<img class="q-art" src="assets/home-family-art.jpg" alt="家人一起查看手机"><h1>${self?'查询适合我的政策':'这次，我们帮谁看看？'}</h1><p class="q-sub">${self?'根据我的情况，发现可能相关的福利与服务。':'先确定操作人和需要帮助的家人。'}</p><section class="q-section">${self?'<p class="q-label">查询对象：本人（我）</p>':`<label class="q-label" for="qOperator">谁在帮忙？（操作人）</label><select id="qOperator">${option('','请选择操作人',state.operator)}${['女儿','儿子','配偶','其他家属','社区工作人员'].map(v=>option(v,v,state.operator)).join('')}</select><label class="q-label" for="qBeneficiary">你要帮助谁？（受益人）</label><select id="qBeneficiary">${option('','请选择受益人',state.beneficiary)}${['父亲','母亲','爷爷','奶奶','外公','外婆','配偶','其他'].map(v=>option(v,v,state.beneficiary)).join('')}</select><button type="button" class="q-clear" id="qResetPerson">更换同称谓的家人，清空本次资料</button><p class="q-sub">本预览按称谓保留一份草稿；换为另一位同称谓家人时，请先清空，避免沿用资料。</p>`}</section><p class="q-note">${self?'查询对象固定为本人，不会使用家人的资料。':'操作人是帮忙查询的人，受益人是可能适用政策的家人。切换受益人会切换对应草稿。'}</p>`);
 if(state.step===2)root.insertAdjacentHTML('beforeend',`<h1>补充一些基本情况</h1><p class="q-sub">完善少量信息，帮助发现可能相关的政策。</p><h2>基本信息</h2><section class="q-section"><label class="q-label" for="qAge">${self?'我的年龄':'老人具体年龄'}</label><input id="qAge" type="number" inputmode="numeric" min="0" max="120" step="1" value="${esc(d.age)}" placeholder="请填写周岁"><label class="q-label" for="qCity">${self?'我所在的城市':'所在城市'}</label><select id="qCity" ${!cities.length?'disabled':''}>${option('','请选择城市',d.city)}${cities.map(v=>option(v,v,d.city)).join('')}</select>${regionError?`<p class="q-error">${esc(regionError)}</p><button class="q-clear" id="qRetry">重试地区数据</button>`:''}</section><h2>进一步了解（选填）</h2>${groups.map(g=>`<details class="q-accordion" data-group="${g.id}" ${state.open===g.id?'open':''}><summary><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${glyph[g.icon]}"/></svg>${esc(self?g.selfTitle||g.title:g.title)}</summary><div class="q-body">${g.scenes?sceneFields():g.region?'<label class="q-label">所在区</label><select disabled><option>暂无可用地区选项</option></select><label class="q-label">所在街道</label><select disabled><option>暂无可用街道选项</option></select><p class="q-sub">当前政策库未提供区、街道选项表，可跳过；不会推测您的地区。</p>':g.fields.map(field).join('')}</div></details>`).join('')}${aiHTML()}<p class="q-note">选填信息可以全部跳过。“不清楚”与“暂未提供”均不会当作否定。资料在本页刷新或返回时保留为查询草稿，确认后才提交。</p>`);
 if(state.step===3)root.insertAdjacentHTML('beforeend',`<h1>请确认以下信息</h1><section class="q-card">${review()}</section><button class="q-edit" id="qEdit">修改信息</button><p class="q-note">确认后将进入现有政策匹配流程。仅提示可能相关政策，最终资格由主管部门核定。</p>`);
 root.insertAdjacentHTML('beforeend',`<div class="q-actions">${state.step>1?'<button id="qPrev">上一步</button>':''}<button class="q-primary" id="qNext">${state.step===3?'确认并查找政策 →':'下一步 →'}</button></div><p class="q-draft-note">草稿保留在本标签页的当前历史记录中；退出后可用浏览器后退或前进恢复。重新从入口进入不保证恢复未提交资料。</p>`);
 root.querySelector('#qBack').onclick=()=>state.step>1?go(state.step-1):PFNavigation.exitTask();
 root.querySelector('#qExit')?.addEventListener('click',PFNavigation.exitTask);
 root.querySelector('#qPrev')?.addEventListener('click',()=>go(state.step-1));root.querySelector('#qEdit')?.addEventListener('click',()=>go(2));root.querySelector('#qRetry')?.addEventListener('click',loadCities);
 if(state.step===1 && !self && businessMode) renderMemberChoice();
 if(memberError) error(memberError);
 if(editLoading||editId&&!editVersion)root.querySelector('#qNext').disabled=true;
 if(memberError.includes('解锁')||readError.includes('解锁')){
   root.querySelector('#qError').insertAdjacentHTML('afterend','<p><a href="query-history.html">解锁本机预览</a></p>');
 }
 root.querySelector('#qNext').onclick=()=>{if(state.step===1){if(businessMode===undefined)return error('成员服务状态暂不可用，请刷新后重试。');if(!state.operator||!state.beneficiary||(!self&&businessMode&&!state.memberId))return error('请选择操作人与受益人。');go(2);}else if(state.step===2){prefillFromDescription(d);if(!/^\d{1,3}$/.test(String(d.age))||+d.age>120)return error('请输入 0～120 的整数年龄。');if(!cities.includes(d.city))return error('请选择政策库实际支持的城市；地区数据暂缺时请重试。');go(3);}else submit();};
 root.querySelector('#qResetPerson')?.addEventListener('click',()=>{aiController?.abort();aiRun++;state.drafts[key()]=blank();remember();error('已清空当前家人的查询草稿，请继续填写。');});
 root.querySelector('#qOperator')?.addEventListener('change',e=>{invalidateAI();state.operator=e.target.value;remember();});root.querySelector('#qBeneficiary')?.addEventListener('change',e=>{aiController?.abort();aiRun++;state.beneficiary=e.target.value;remember();});
 root.querySelector('#qAge')?.addEventListener('input',e=>{draft().age=e.target.value;invalidateAI();error('');remember();});root.querySelector('#qCity')?.addEventListener('change',e=>{draft().city=e.target.value;invalidateAI();error('');remember();});
 root.querySelectorAll('[data-scene-name]').forEach(el=>el.onchange=()=>{draft().scenes=[...root.querySelectorAll('[data-scene-name]:checked')].map(e=>e.value);draft().scenesTouched=true;invalidateAI();remember();});
 root.querySelector('#qScenesClear')?.addEventListener('click',()=>{draft().scenes=[];draft().scenesTouched=false;invalidateAI();remember();render();});
 root.querySelector('#qSceneRetry')?.addEventListener('click',loadScenes);
 root.querySelectorAll('[data-field]').forEach(el=>el.addEventListener(el.tagName==='TEXTAREA'?'input':'change',()=>{draft().answers[el.dataset.field]=el.value;invalidateAI();remember();}));
 root.querySelectorAll('[data-clear]').forEach(el=>el.onclick=()=>{delete draft().answers[el.dataset.clear];invalidateAI();remember();render();});
 bindAI();
 if(restoreDescriptionFocus)root.querySelector('#qAIDescription')?.focus({preventScroll:true});
 root.querySelectorAll('.q-accordion').forEach(el=>el.addEventListener('toggle',()=>{if(el.open){state.open=el.dataset.group;root.querySelectorAll('.q-accordion').forEach(other=>{if(other!==el)other.open=false;});}else if(state.open===el.dataset.group)state.open='';remember();}));remember();
 }

 function aiList(title, items){
  return `<h3>${title}</h3>${items.length?`<ul>${items.map(item=>`<li>${item}</li>`).join('')}</ul>`:'<p>暂无。</p>'}`;
 }
 function prefillFromDescription(d){
  const description=d.ai.description || '';
  const people=self ? ['本人','我'] : [state.beneficiary,...(state.beneficiary==='父亲'?['爸爸']:state.beneficiary==='母亲'?['妈妈']:[])];
  const ages=[...description.matchAll(/(\d{1,3})\s*(?:周岁|岁)/g)];
  if(d.age==='' && ages.length===1 && Number(ages[0][1])<=120){
   const before=description.slice(0,ages[0].index).replace(/(?:今年|现年|目前|已经|现在|是|\s)+$/g,'');
   if(people.some(person=>person && before.endsWith(person))){
    d.age=ages[0][1];
    root.querySelector('#qAge').value=d.age;
   }
  }
  if(!d.city){
   const found=cities.filter(city=>['目前住在','居住在','住在','现住','居住地是','居住地为']
    .some(prefix=>description.includes(prefix+city.replace(/市$/,''))));
   if(found.length===1){
    d.city=found[0];
    root.querySelector('#qCity').value=d.city;
   }
  }
  remember();
 }
 function aiHTML(){
  const a=draft().ai;
  const loading=a.status==='loading';
  const button=loading?'正在分析…':a.analyzed?'重新分析':'开始 AI 分析';
  const suggestions=(a.suggestions||[]).map((item,index)=>`
   <div class="q-ai-suggestion">
    <p><strong>${esc(item.scene)}</strong>${item.evidence?` · 依据「${esc(item.evidence)}」`:''}</p>
    ${sceneLibrary.some(scene=>scene.name===item.scene)?`
      <label><input type="checkbox" data-ai-confirm="${index}" ${a.confirmed.includes(item.scene)?'checked':''}>
       我确认这项情况属实，纳入匹配</label>`:'<p>当前无法核对场景字段，暂不可纳入匹配。</p>'}
   </div>`).join('');
  return `<section class="q-ai" aria-labelledby="qAITitle">
   <div class="q-ai-heading"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></svg>
    <h2 id="qAITitle">让 AI 帮你整理情况</h2></div>
   <p>结合已填写的信息，整理可能相关的生活支持方向和还需确认的情况。</p>
   <p class="q-ai-badge">发起分析会将描述、年龄、城市和已选生活变化发送给 DeepSeek。请勿填写姓名、证件号、电话或详细地址。</p>
   <label class="q-label" for="qAIDescription">生活情况（选填）</label>
   <textarea id="qAIDescription" maxlength="500" placeholder="例如，母亲今年 68 岁，住在佛山，最近住院自付费用较高">${esc(a.description||'')}</textarea>
   <p class="q-note">即使跳过 AI，描述也会用于规则匹配，仅作政策发现线索。</p>
   <div class="q-ai-actions">
    <button type="button" id="qAIAnalyze" ${loading?'disabled':''}>${button}</button>
    <button type="button" id="qAISkip">跳过 AI 分析</button>
   </div>
   <p id="qAIStatus" role="status" aria-live="polite">${esc(a.message||'可直接继续查询。')}</p>
   <div id="qAIResults">${a.status==='success'?`
    ${aiList('AI 引用的原话（仅供核对）', (a.facts||[]).map(esc))}
    <button type="button" class="q-clear" id="qAICorrect">纠正或补充原文</button>
    <h3>AI 推断的生活场景</h3>
    ${suggestions||'<p>暂无场景建议。</p>'}
    ${aiList('可能相关的政策方向', (a.directions||[]).map(item=>`<strong>${esc(item.label)}</strong> · ${esc(item.reason)}`))}
    ${aiList('缺失信息', (a.pending||[]).map(esc))}
    ${aiList('建议进一步了解', (a.questions||[]).map(esc))}
    ${aiList('不确定性说明', (a.uncertainty||[]).map(esc))}
    <p>仅供核对。勾选确认的生活场景才参与匹配，政策申请资格由主管部门核定。</p>`:''}</div>
  </section>`;
 }
 function updateAI(){
  const node=root.querySelector('.q-ai');
  if(node){node.outerHTML=aiHTML();bindAI();}
 }
 function invalidateAI(paint=true){
  aiController?.abort();
  aiRun++;
  const a=draft().ai;
  Object.assign(a,{status:'idle',message:'信息已更新，可重新分析或直接继续查询。',
   facts:[],suggestions:[],confirmed:[],directions:[],pending:[],questions:[],uncertainty:[]});
  if(paint){updateAI();return;}
  root.querySelector('#qAIStatus').textContent=a.message;
  root.querySelector('#qAIResults').replaceChildren();
  const button=root.querySelector('#qAIAnalyze');
  button.disabled=false;
  button.textContent=a.analyzed?'重新分析':'开始 AI 分析';
 }
 function bindAI(){
  root.querySelector('#qAIDescription')?.addEventListener('input',event=>{
   draft().ai.description=event.target.value;
   invalidateAI(false);
   remember();
  });
  root.querySelector('#qAIAnalyze')?.addEventListener('click',analyzeAI);
  root.querySelector('#qAICorrect')?.addEventListener('click',()=>root.querySelector('#qAIDescription').focus());
  root.querySelector('#qAISkip')?.addEventListener('click',()=>{
   invalidateAI(false);
   Object.assign(draft().ai,{status:'skipped',message:'已跳过 AI 分析，可继续核对信息。'});
   remember();
   updateAI();
  });
  root.querySelectorAll('[data-ai-confirm]').forEach(element=>element.onchange=()=>{
   const a=draft().ai;
   a.confirmed=[...root.querySelectorAll('[data-ai-confirm]:checked')].map(input=>a.suggestions[+input.dataset.aiConfirm].scene);
   remember();
  });
 }
 async function analyzeAI(){
  const d=draft(), a=d.ai;
  if(a.status==='loading')return;
  const description=a.description?.trim();
  if(!description){
   a.message='请先补充一句情况描述，或跳过 AI 分析。';
   updateAI();
   root.querySelector('#qAIDescription').focus();
   return;
  }
  invalidateAI(false);
  const controller=new AbortController();
  aiController=controller;
  const token=++aiRun, person=key();
  const context={description,age:d.age===''?null:+d.age,city:d.city,scenes:d.scenes};
  Object.assign(a,{analyzed:true,status:'loading',message:'正在整理您已填写的情况，您也可以跳过。'});
  remember();
  updateAI();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},PFQueryAI.timeoutMs);
  try{
   const data=await PFQueryAI.analyze(context,{signal:controller.signal});
   if(token!==aiRun||key()!==person)return;
   if(!Object.values(data).some(items=>items.length)){
    Object.assign(a,{status:'empty',message:'AI 未返回可用分析内容，可重试或继续查询。'});
    return;
   }
   Object.assign(a,{status:'success',message:'已整理情况。请核对原文和推断，表单不会自动修改。',
    facts:data.confirmed_facts,suggestions:data.inferred_scenes,directions:data.potential_needs,
    pending:data.missing_information,questions:data.follow_up_questions,uncertainty:data.uncertainty_notes});
  }catch(e){
   if(token!==aiRun||key()!==person)return;
   a.status=timedOut||e.code==='TIMEOUT'?'timeout':'error';
   a.message=timedOut?'分析超时，请重试或跳过后继续查询。':`AI 分析失败。${e.message} 您仍可继续查询。`;
  }finally{
   clearTimeout(timer);
   if(token===aiRun){remember();updateAI();}
  }
 }
 function sceneFields(){return `<p class="q-sub">可选择多项，也可全部跳过。未选不表示否定。</p>${sceneError?'<p class="q-error">生活变化选项暂不可读取。</p><button type="button" class="q-clear" id="qSceneRetry">重试</button>':`<div class="q-options">${sceneLibrary.map(x=>`<label><input type="checkbox" data-scene-name value="${esc(x.name)}" ${(draft().scenes||[]).includes(x.name)?'checked':''}>${esc(x.name)}</label>`).join('')}</div>`}<button type="button" class="q-clear" id="qScenesClear">清除选择，暂不提供</button>`;}
 async function loadScenes(){try{const d=await API.scenes();if(!Array.isArray(d.scenes))throw Error();const catalogue=await API.get('/api/policies');if(!Array.isArray(catalogue.policies))throw Error();const details=await Promise.all(catalogue.policies.map(p=>API.policy(p.policy_id)));const signals=new Set(details.flatMap(p=>p.match?.scene_signals||[]));sceneLibrary=d.scenes.filter(x=>signals.has(x.name));if(!sceneLibrary.length)throw Error();sceneError='';}catch(e){sceneError='unavailable';}render();}
 function renderMemberChoice(){
   const relation=root.querySelector('#qBeneficiary');
   const section=relation.parentElement;
   section.querySelector('[for="qBeneficiary"]').hidden=true;
   relation.hidden=true;
   section.querySelector('#qResetPerson').hidden=true;
   section.querySelector('.q-sub').hidden=true;
   section.insertAdjacentHTML('beforeend',`<label class="q-label" for="qMember">你要帮助谁？（受益人）</label>
     <select id="qMember">${option('','请选择家庭成员',state.memberId)}${memberRows.filter(row=>row.relation!=='本人'&&!row.archivedAt).map(row=>option(row.id,row.name+' · '+row.relation,state.memberId)).join('')}</select>
     <details><summary>添加家庭成员</summary><label class="q-label" for="qMemberName">称呼或名字</label><input id="qMemberName" maxlength="80">
     <label class="q-label" for="qMemberRelation">与本人的关系</label><select id="qMemberRelation">${['父亲','母亲','爷爷','奶奶','外公','外婆','配偶','子女','其他'].map(v=>option(v,v,'')).join('')}</select>
     <button type="button" class="q-clear" id="qAddMember">保存成员</button></details>`);
   function choose(row){
     aiController?.abort();aiRun++;
     state.memberId=row?.id||'';
     state.beneficiary=row?.relation||'';
      if(row){memberError='';error('');}
     remember();
   }
   if(editId){
     section.querySelector('#qMember').disabled=true;
     section.querySelector('details').hidden=true;
     return;
   }
   root.querySelector('#qMember').onchange=event=>choose(memberRows.find(row=>row.id===event.target.value));
   root.querySelector('#qAddMember').onclick=async event=>{
     const button=event.currentTarget;
     const name=root.querySelector('#qMemberName').value.trim();
     if(!name)return error('请输入用来区分这位家人的称呼或名字。');
     button.disabled=true;
     try{
       const row=await PFBusiness.addMember(name,root.querySelector('#qMemberRelation').value);
       memberRows.push(row);choose(row);render();
     }catch(e){error(e.message);button.disabled=false;}
   };
 }
 async function loadMembers(){
   try{
     businessMode=await PFBusiness.enabled();
     if(businessMode) {
       memberRows=await PFBusiness.members();
       const preferred=new URLSearchParams(location.search).get('member');
       const member=memberRows.find(row=>row.id===preferred && row.relation!=='本人' && !row.archivedAt);
        if(!self && !editId && preferred!==null){
          if(!member){
            state.memberId='';
            state.beneficiary='';
            state.step=1;
            memberError='无法恢复指定成员，请重新选择。';
          } else if(!restoredDraft || state.memberId!==member.id){
            state.memberId=member.id;
            state.beneficiary=member.relation;
          }
       }
     }
   }catch(e){memberError='暂不能读取家庭成员：'+e.message;}
   if(state.step===1)render();
 }
 async function loadEdit(){
   if(!editId)return;
   try{
      const source=await PFBusiness.history(editId, null, new URLSearchParams(location.search).get('member'));
     if(source.mode!==mode||source.versions[0]?.queryId!==editId)throw Error('请在最新查询版本中修改。');
     editVersion=source.version;
     if(state.editId!==editId){
       const form=source.form?.uiForm;
       const structured=source.profile;
       state={mode,step:2,operator:form?.operator||structured.operator||'本人',
         beneficiary:form?.beneficiary||structured.beneficiary||'本人',memberId:source.memberId,
         actorMemberId:source.actorMemberId,editId,drafts:{},open:''};
       const {age,city,answers,scenes,scenesTouched,ai}=form||{};
       const confirmedAnswers={...(answers||structured.answers||{})};
       for(const key of ['hukou','insurance']){
         if(!Object.hasOwn(confirmedAnswers,key) && typeof structured[key]==='boolean')
           confirmedAnswers[key]=structured[key]?'yes':'no';
       }
       if(!Object.hasOwn(confirmedAnswers,'family_economic') && typeof structured.family_economic==='string')
         confirmedAnswers.family_economic=structured.family_economic;
       state.drafts[self?'self':source.memberId]={...blank(),age:age??structured.age,city:city||source.region,
         answers:confirmedAnswers,scenes:scenes||structured.scenes||[],scenesTouched:!!scenesTouched,ai:ai||blank().ai};
     }
   }catch(e){readError=e.message;}
    finally{
      editLoading=false;
      render();
      if(!readError && new URLSearchParams(location.search).get('focus')==='description') {
        requestAnimationFrame(()=>root.querySelector('#qAIDescription')?.focus());
      }
    }
 }
 function go(step){if(draft().ai.status==='loading'){aiController?.abort();aiRun++;draft().ai.status='interrupted';draft().ai.message='分析已中断，您可以继续查询。';}state.step=step;remember();render();scrollTo(0,0);}
 async function loadCities(){try{const data=await API.get('/api/policies');cities=[...new Set((data.policies||[]).map(p=>p.region).filter(Boolean))];if(!cities.length)throw Error();regionError='';}catch(e){cities=[];regionError='地区数据暂不可用，未填入默认城市。请重试。';}render();}
 async function submit(){if(busy)return;if(readError||PF_V3_MODE!=='v1')return error(readError||'保护模式下无法提交。');busy=true;const btn=root.querySelector('#qNext');btn.disabled=true;btn.textContent='正在准备查询…';
 try{const d=draft(),a=d.answers;let text=`${self?'我':state.beneficiary}${d.age}岁，住在${d.city}。`;
 const facts={help:{sometimes:'日常生活偶尔需要人帮助',often:'日常生活经常需要人帮助',no:'日常生活不需要人帮助'},mobility:{yes:'行动不便',no:'没有行动不便'},assessment:{yes:'已做照护需求评估',no:'尚未做照护需求评估'},living:{alone:'独居',family:'与家人同住'},meal:{yes:'需要社区助餐',no:'不需要社区助餐'},delivery:{yes:'需要送餐服务',no:'不需要送餐服务'},subsidy:{yes:'希望了解相关补贴',no:'不需要了解相关补贴'}};
 for(const [id,values] of Object.entries(facts))if(values[a[id]])text+=values[a[id]]+'。';if(a.notes)text+=a.notes;
 const data=await API.post('/api/profile',{text,life_description:d.ai.description,mode,age:+d.age,region:d.city,relation:self?'本人':state.beneficiary,operator:state.operator});
 const profile=data.profile||data;if(!profile||typeof profile!=='object'||!('age' in profile))throw Error('画像服务返回异常');
 const ageConflict=profile.conflicts?.find(item=>item.kind==='年龄');
 if(ageConflict){
   go(2);
   error(ageConflict.note+'（'+ageConflict.said.join('、')+'）');
   busy=false;
   return;
 }
 profile.uiAnswers={...a};profile.uiForm={age:d.age,city:d.city,answers:{...a},scenes:[...(d.scenes||[])],scenesTouched:!!d.scenesTouched,operator:state.operator,beneficiary:state.beneficiary,mode,ai:JSON.parse(JSON.stringify(d.ai))};
 for(const key of ['hukou','insurance']){
   if(Object.hasOwn(a,key))profile[key]=['yes','no'].includes(a[key])?a[key]==='yes':null;
 }
 if(Object.hasOwn(a,'family_economic'))
   profile.family_economic=a.family_economic && a.family_economic!=='unknown'?a.family_economic:null;
 const selected=[...new Set([...(d.scenes||[]),...(d.ai.confirmed||[])])];if(selected.some(n=>!sceneLibrary.some(x=>x.name===n)))throw Error('场景选项需重新核对');
 if(selected.includes('行动不便')&&a.mobility==='no'||selected.includes('独居')&&a.living==='family'||selected.includes('需要照护')&&a.help==='no')throw Error('生活变化与基本情况冲突');
 if(selected.length){profile.confirmed_scenes=[...new Set([...(profile.scenes||[]),...selected])];profile.scenes=[...profile.confirmed_scenes];profile.scenes_edited=true;}
 if(await PFBusiness.enabled()){
   const memberId=self?memberRows.find(row=>row.relation==='本人')?.id:state.memberId;
   if(!memberId)throw Error('请返回第一步选择本次查询的成员。');
   const structured={age:+d.age,answers:{...a},scenes:selected,operator:state.operator,beneficiary:state.beneficiary};
   for(const key of ['hukou','insurance','disability','family_economic']) {
     if(profile[key]!=null)structured[key]=profile[key];
   }
   const form={text,uiForm:profile.uiForm};
   const stamp=JSON.stringify([memberId,mode,d.city,structured,form,editId]);
   if(state.pendingQuery?.stamp!==stamp)state.pendingQuery={stamp,id:crypto.randomUUID()};
   remember();
   const queryId=state.pendingQuery.id;
   const registered=await PFBusiness.register({queryId,memberId,mode,region:d.city,profile:structured,form,
     ...(editId?{previousQueryId:editId,expectedVersion:editVersion,actorMemberId:state.actorMemberId}:{})});
   if(registered?.queryId!==queryId || registered.memberId!==memberId)throw Error('查询回执与提交资料不一致。');
    location.assign(PFNavigation.withParams(PFNavigation.resultURL(self,queryId),{member:memberId}));
   return;
 }else profile.uiForm.followupQueryId=crypto.randomUUID();
 store.write(self?{target:'self',selfProfile:profile,selfText:text,demo:false,demoBanner:false}:{target:'parents',operator:state.operator,beneficiary:state.beneficiary,confirmed:true,profile,text,demo:false,demoBanner:false});
 delete state.pendingQuery;
 remember();
 location.assign(PFNavigation.resultURL(self));
 }catch(e){error(e.status?e.message+' 资料仍保留在本页。':e.message==='场景选项需重新核对'?'生活变化包含暂不支持的选项，请清除后重新选择。':e.message==='生活变化与基本情况冲突'?'生活变化与基本情况存在冲突，请返回修改后重试。':'未能提交查询，资料仍保留在本页。请检查服务或存储权限后重试。');busy=false;btn.disabled=false;btn.textContent='确认并查找政策 →';}}
 render();loadCities();loadScenes();loadMembers().then(loadEdit);
})();
