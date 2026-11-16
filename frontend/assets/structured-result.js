/* Preview-only presentation adapter. Existing result renderer/API/store unchanged. */
window.PFStructuredResult = (() => {
 let insetObserver;
 const active=location.pathname.endsWith('/discover.html')||new URLSearchParams(location.search).get('results')==='1';
 function retain(profile,previous){return active&&previous?.uiForm?{...profile,uiForm:previous.uiForm,uiAnswers:previous.uiAnswers}:profile;}
 if(active){
  document.documentElement.classList.add('structured-results');
  function paint(){
   const saved=window.PFQuerySnapshot?.current;
   if(window.PFQuerySnapshot?.id&&!saved)return;
   document.querySelector('#structuredSummary')?.remove();
   document.querySelector('.rp-footer')?.remove();
   const self=location.pathname.endsWith('/self.html');const s=store.read();
   const profile=saved?saved.result?.profile:self?s.selfProfile:s.profile;
   const form=profile?.uiForm||(saved?{age:saved.profile.age,city:saved.region,mode:saved.mode,...saved.profile}:null);
   // Remove the legacy input subtree after legacy handlers captured their references.
   document.querySelector('#situation')?.closest('.section')?.remove();
   document.querySelectorAll('.case-card').forEach(e=>e.remove());
   const app=document.querySelector('.app');
   const box=document.createElement('section');box.className='structured-summary';box.id='structuredSummary';
   const heading=document.createElement('h1');heading.textContent='本次查询';box.append(heading);
   if(saved){
    const meta=document.createElement('p');
    meta.textContent=new Date(saved.createdAt).toLocaleString('zh-CN')+' · '+(saved.version===1?'原始查询':'编辑版本 '+saved.version);
    box.append(meta);
    const lineage=document.createElement('details');
    const caption=document.createElement('summary');caption.textContent='查看查询版本与已保存分析';lineage.append(caption);
    const link=(href,label)=>{const row=document.createElement('p'),a=document.createElement('a');a.href=href;a.textContent=label;row.append(a);lineage.append(row);};
    for(const v of saved.versions){
     link(PFNavigation.resultURL(self,v.queryId),'版本 '+v.version+' · '+new Date(v.createdAt).toLocaleString('zh-CN')+(v.queryId===saved.queryId?'（当前查看）':''));
    }
    for(const a of saved.assessmentAttempts){
     link(PFNavigation.withParams(PFNavigation.resultURL(self,saved.queryId),{attempt:a.attempt}),'AI 分析 '+a.attempt+' · '+new Date(a.createdAt).toLocaleString('zh-CN'));
    }
    for(const id of saved.planIds)link(PFNavigation.withParams('plan.html',{plan_id:id,member:saved.memberId,query:saved.queryId,from:location.href}),'查看本版本关联的少跑腿计划');
    box.append(lineage);
   }
   const person=saved?.memberLabel||form?.beneficiary||'未提供';
   const lead=document.createElement('p');lead.className='query-compact';lead.textContent=form?`${self?'操作人、受益人：本人':'操作人：'+(form.operator||'未提供')+' · 受益人：'+person} · ${form.age} 岁 · ${form.city}`:'本次查询资料暂不可读取';box.append(lead);
   if(form&&form.mode===(self?'self':'family')){
    const rows=[...(self?[['查询对象','本人']]:[['操作人',form.operator],['受益人',form.beneficiary]]),['年龄',form.age+' 岁'],['所在城市',form.city],['生活变化',(form.scenes||[]).join('、')||'暂未提供']];
    for(const g of (window.PFQueryFields?.groups||[])){if(g.selfOnly&&!self||g.scenes||g.region)continue;for(const f of g.fields||[]){const v=form.answers?.[f.id];if(!v)continue;rows.push([f.label,!v?'暂未提供':f.text?v:f.options?.find(x=>x[0]===v)?.[1]||'暂未提供']);}}
     if(form.ai?.description?.trim())rows.push(['生活描述原文（仅作匹配线索）',form.ai.description]);
     rows.push(['用户确认的 AI 补充信息',(form.ai?.confirmed||[]).join('、')||'暂无']);rows.push(['AI 分析',form.ai?.status==='success'?'辅助建议已核对（非资格结论）':form.ai?.message||'未使用']);
    if(!Object.values(form.answers||{}).some(Boolean))rows.push(['补充情况','暂未提供']);
    const dl=document.createElement('dl');for(const [label,value]of rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value||'暂未提供';row.append(dt,dd);dl.append(row);}const full=document.createElement('details');full.id='queryFull';const summary=document.createElement('summary');summary.textContent='展开查询信息';full.append(summary,dl);box.append(full);
   }else{const p=document.createElement('p');p.textContent='结构化资料暂不可读取，请返回核对后重试。';p.setAttribute('role','alert');box.append(p);}
   const edit=document.createElement('button');
   edit.type='button';
   edit.textContent=form?'修改查询信息':'填写查询信息';
   edit.id='structuredEdit';
   edit.onclick=()=>location.assign(PFNavigation.queryInfoURL());
   if(saved&&saved.versions[0]?.queryId!==saved.queryId)edit.hidden=true;
   const end=document.createElement('button');
   end.type='button';
   end.className='query-end';
   end.id='queryEnd';
   end.textContent=saved?'返回查询历史':'返回入口';
   end.onclick=saved?()=>location.assign('query-history.html?member='+encodeURIComponent(saved.memberId)):PFNavigation.endQuery;
   const footer=document.createElement('section');
   footer.className='rp-footer';
   footer.setAttribute('aria-label','查询操作');
   footer.append(edit,end);
   const result=document.querySelector('#resultArea');
   result?.before(box);
   result?.after(footer);
   requestAnimationFrame(()=>{
    const nav=app?.querySelector('.hybrid-tabbar');
    if(!nav)return;
    const updateInset=()=>app.style.setProperty('--result-tab-height',Math.ceil(nav.getBoundingClientRect().height)+'px');
    updateInset();
    if(typeof ResizeObserver==='function'){
     insetObserver?.disconnect();
     insetObserver=new ResizeObserver(updateInset);
     insetObserver.observe(nav);
    }
   });
  }
  document.addEventListener('DOMContentLoaded',paint);
  document.addEventListener('pf-query-loaded',paint);
 }
 return {active,retain};
})();
