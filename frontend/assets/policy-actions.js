/* SQLite intent commands and read-only legacy display. */
window.PFPolicyActions=(()=>{
 let busy=false;
 const labels={verify:'打算去核实',later:'先记下来',notmatch:'用户主观判断：情况不符，不适用（未经官方核实）'};
 function records(){const raw=sessionStorage.getItem(PFServices.K.records);if(raw){const data=JSON.parse(raw);if(!Array.isArray(data)||data.some(r=>!r||typeof r.pid!=='string'||typeof r.benKey!=='string'))throw Error('核实记录格式异常，请先检查已有数据。');}return PFServices.recordsOf();}
 function scope(){const id=window.PFQuerySnapshot?.current?.queryId;if(id)return id;const p=activeProfile(),s=store.read();return JSON.stringify([s.lastQuery,PFServices.benKey(),p?.uiForm,p?.raw_text,p?.confirmed_scenes,p?.hukou,p?.insurance,p?.disability,p?.family_economic]);}
 function intentOf(record){return Object.keys(labels).find(value=>record?.note?.startsWith('【'+labels[value]+'】'))||'';}
 async function showFollowup(pid,status,source){
  if(!window.PFFollowup)return;
  try{
   const data=source===undefined?PFFollowup.read():source, item=data?.items[pid];
   if(!item)return;
   const consultations=(data.consultations?.length?data.consultations:Object.values(data.plans).flatMap(plan=>plan.consultations))
    .filter(row=>row.pid===pid).sort((a,b)=>b.createdAt-a.createdAt);
   let line=status.parentElement.querySelector('[data-followup-current]');
   if(!line){line=document.createElement('p');line.setAttribute('data-followup-current','');status.before(line);}
   const latest=consultations[0];
   line.textContent='本次查询处理状态：'+PFFollowup.statuses[item.status]+(latest?'。最近咨询：'+latest.form.date+' · '+PFBusiness.consultationSourceLabel(latest.sourceType):'');
  }catch(error){status.textContent='暂不能读取后续记录：'+error.message;}
 }
 function render(){return `<section class="pa-panel"><h2>看完依据，接下来怎么做？</h2><p>选择只保存在当前设备浏览器中，不代表已经核实或提交申请。</p><div class="pa-buttons"><button data-policy-action="verify"><b>打算去核实</b><span>创建或更新核实事项，之后查看核实记录。</span></button><button data-policy-action="later"><b>先记下来</b><span>保存到当前成员的已保存政策，稍后再决定。</span></button><button data-policy-action="notmatch"><b>情况不符，不适用</b><span>记录我的判断，不等同于官方核实。</span></button></div><p id="policyActionStatus" role="status" aria-live="polite"></p><div class="pa-links"><a href="records.html?from=services.html">核实记录</a><a href="verify-list.html?from=services.html">待核实清单</a><a href="plan.html?from=verify-list.html">少跑腿计划</a><a href="consult.html">咨询与跟进指引</a></div></section>`;}
 async function bind(p){const status=document.getElementById('policyActionStatus');const buttons=[...document.querySelectorAll('[data-policy-action]')];const paint=value=>buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.policyAction===value)));
 buttons.forEach(b=>b.disabled=true);
 try{
  if(await PFBusiness.enabled()){
   const params=new URLSearchParams(location.search);
   const planId=params.get('plan');
   const queryId=params.get('query'), memberId=params.get('member');
   const read=()=>planId?PFBusiness.plan(planId,memberId,queryId):queryId?PFBusiness.query(queryId,memberId):null;
   let data=await read();
   const resolvedMember=data?.memberId ?? memberId;
   for(const link of status.parentElement.querySelectorAll('.pa-links a[href^="records.html"],.pa-links a[href^="verify-list.html"],.pa-links a[href^="plan.html"]')){
    link.href=PFNavigation.withParams(link.getAttribute('href'),{
     member:resolvedMember,from:PFNavigation.withParams('services.html',{member:resolvedMember})});
   }
   const setCurrent=()=>{paint(data?.items[p.policy_id]?.intent);return showFollowup(p.policy_id,status,data);};
   if(!data?.queryId){status.textContent='请先完成本人或家庭查询，再保存处理意向。';return;}
   const info=status.parentElement.querySelector('h2+p');
   if(info)info.textContent='处理意向保存到本机后续服务，仅用于个人记录。申请资格以主管部门核实为准。';
   await setCurrent();
   window.addEventListener('pageshow',async event=>{
    if(!event.persisted||!status.isConnected)return;
    try{data=await read();await setCurrent();}catch(error){status.textContent=error.message;}
   });
   buttons.forEach(button=>{
    button.disabled=false;
    button.onclick=async()=>{
     if(busy)return;
     busy=true;
     buttons.forEach(row=>row.disabled=true);
     try{
      const intent=button.dataset.policyAction;
      await PFBusiness.command('intent',{queryId:data.queryId,memberId:data.memberId,policyId:p.policy_id,intent,expectedRevision:data.items[p.policy_id]?.revision??0});
      data=await read();
      await setCurrent();
      status.textContent=intent==='verify'?'已加入待核实清单。':intent==='later'?'已保存到当前成员的政策记录。':'已记录用户判断。';
     }catch(error){
      if(error.code==='revision_conflict'){data=await read().catch(()=>data);await setCurrent();}
      status.textContent='未完成保存：'+error.message+' 当前页面和查询资料已保留。';
     }finally{busy=false;buttons.forEach(row=>row.disabled=false);}
    };
   });
   return;
  }
 }catch(error){status.textContent='暂不能读取后续记录：'+error.message;return;}
 try {
  const old=records().find(row=>row.pid===p.policy_id);
  paint(intentOf(old));
  status.textContent='历史记录仅供查看。请在已启用 SQLite 的预览中保存处理意向。';
  await showFollowup(p.policy_id,status);
 } catch(error) {status.textContent='暂不能读取核实记录：'+error.message;}
 }
 return {render,bind,scope,intentOf,records};
})();
