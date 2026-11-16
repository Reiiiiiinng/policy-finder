/* UI-only route policy. No storage keys, identity IDs, matching or schema changes. */
window.PFNavigation=(()=>{
 'use strict';
 const destinations={home:'index.html',search:'search.html',discover:'find.html',consult:'consult.html',mine:'services.html'};
 const allowed=new Set([...Object.values(destinations),'analysis.html','policy.html','discovery-c.html','family.html','self.html','discover.html','records.html','verify-list.html','plan.html','follow-up.html','original-home.html','query-history.html']);
 const params=new Set(['id','region','category','q','results','structured','edit','focus','back','entry','task','from','batch','batchReceipt','view','plan','pid','plan_id','member','query','attempt','consultation','analysis','version','semantic','svc','choose']);
 function route(value=location.href){
  const u=new URL(value,location.href), name=u.pathname==='/'?'index.html':u.pathname.split('/').pop();
  let section=name==='original-home.html'?'home':Object.keys(destinations).find(key=>destinations[key]===name)||null;
  let type=section?'primary':'unknown';
  if(name==='discovery-c.html'){section='search';type='primary';}
  if(name==='analysis.html'){section='discover';type='flow';}
  if(name==='family.html'||name==='self.html')type=name==='self.html'&&u.searchParams.get('results')==='1'?'result':'task';
  if(name==='discover.html')type='result';
  if(type==='task'||type==='result')section='discover';
  if(['records.html','verify-list.html','plan.html','follow-up.html','query-history.html','mine.html'].includes(name)){
   type='secondary';
   section='mine';
   if(['follow-up.html','records.html'].includes(name)&&u.searchParams.get('view')==='logs'){
    const from=safeReturn(u.searchParams.get('from'),'');
    if(from.split('?')[0]==='consult.html')section='consult';
   }
  }
  if(name==='policy.html'){
   type='secondary';
   const from=safeReturn(u.searchParams.get('from'),'').split('?')[0];
   if(u.searchParams.has('analysis')||['find.html','analysis.html','self.html','family.html','discover.html'].includes(from))section='discover';
   else if(['services.html','follow-up.html','plan.html','query-history.html','verify-list.html'].includes(from))section='mine';
   else if(from==='consult.html')section='consult';
   else section='search';
  }
  const focusedTask=type==='task'||type==='result'&&['confirm','intent','done'].includes(u.searchParams.get('batch'));
  return {name,type,section,showBottomNav:!!section&&!focusedTask};
 }
 function safeReturn(value,fallback='index.html'){try{if(!value||String(value).length>4096)return fallback;const u=new URL(value,location.href);const preview=location.protocol==='http:'&&location.hostname==='127.0.0.1'&&u.protocol==='http:'&&u.hostname==='127.0.0.1'&&['8018','8021'].includes(u.port);if(u.origin!==location.origin&&!preview)return fallback;const name=u.pathname==='/'?'index.html':u.pathname.split('/').pop();if((u.pathname!=='/'+name&&u.pathname!=='/')||!allowed.has(name))return fallback;const clean=new URL(u.origin+'/'+name);for(const [k,v]of u.searchParams)if(params.has(k))clean.searchParams.set(k,v);return clean.origin===location.origin?name+clean.search:clean.href;}catch{return fallback;}}
 const current=()=>(location.pathname.split('/').pop()||'index.html')+location.search;
 const query=new URLSearchParams(location.search);
 function context(){const previous=history.state?.pfNavigation||{};const ref=document.referrer&&route().type==='task'&&route(document.referrer).type==='primary'?document.referrer:'';const entry=safeReturn(query.get('entry')||previous.entryFrom||ref,'');const returnTo=safeReturn(query.get('from')||previous.returnTo,route().type==='secondary'?'discovery-c.html':'index.html');return {entryFrom:entry,returnTo,queryMode:route().name==='self.html'?'self':route().name==='family.html'||route().name==='discover.html'?'family':null};}
 function remember(){try{history.replaceState({...history.state,pfNavigation:context()},'');}catch{}}
 function withParams(value,extra){const u=new URL(value,location.href);for(const [k,v]of Object.entries(extra))if(v!==null&&v!==undefined)u.searchParams.set(k,String(v));return u.origin===location.origin?u.pathname.split('/').pop()+u.search:u.href;}
 function taskURL(mode){return withParams(mode==='self'?'self.html':'family.html',{entry:safeReturn(current(),'index.html')});}
 function resultURL(self,id){return withParams(self?'self.html?results=1&structured=1':'discover.html?structured=1',{entry:context().entryFrom||'index.html',...(id?{query:id}:{task:current()})});}
 function currentMember(){return window.PFQuerySnapshot?.current?.memberId ?? new URLSearchParams(location.search).get('member');}
 function queryInfoURL({latest=false, describe=false}={}){const self=route().name==='self.html';const fallback=self?'self.html':'family.html';const task=safeReturn(query.get('task'),fallback);const target=route(task).type==='task'&&route(task).name===fallback?task:fallback;const version=latest&&window.PFQuerySnapshot?.current?.versions[0];return withParams(target,{edit:'1',query:version?.queryId||query.get('query'),member:currentMember(),focus:describe?'description':undefined,entry:context().entryFrom||'index.html'});}
 function detailURL(id,port){const base=port?'http://127.0.0.1:'+port+'/policy.html':'policy.html';return withParams(base,{id,member:currentMember(),query:query.get('query'),from:location.href});}
 function returnTarget(fallback='discovery-c.html'){return safeReturn(query.get('from'),fallback);}
 function exitTask(){const message=(context().entryFrom?'将返回原入口。':'将返回首页。')+'草稿仅保留在本标签页的当前历史记录中。离开后可用浏览器后退/前进恢复；重新从入口进入不保证恢复未提交资料。确认退出吗？';if(window.confirm(message))location.assign(context().entryFrom||'index.html');}
 function endQuery(){location.assign(context().entryFrom||'index.html');}
 const tabs={
  home:['首页','M3 11 12 3l9 8v10h-6v-7H9v7H3Z'],
  search:['查政策','M13 21H4V3h14v8M7 7h8m-8 4h4m10 10-3-3M19 15.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z'],
  discover:['AI发现','M12 2c1.6 5.6 4.4 8.4 10 10-5.6 1.6-8.4 4.4-10 10C10.4 16.4 7.6 13.6 2 12c5.6-1.6 8.4-4.4 10-10Z'],
  consult:['咨询','M20 11a8 8 0 0 1-8 8H9l-6 3 2-6a8 8 0 1 1 15-5ZM8 11h.01m3.5 0h.01m3.5 0h.01'],
  mine:['我的','M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 6 0 0 1 16 0v2Z'],
 };
 function markup(){
  const r=route();
  if(!r.showBottomNav)return '';
  return '<nav class="pf-global-nav" aria-label="主导航">'+Object.entries(tabs).map(([key,[label,path]])=>{
   return `<a href="${destinations[key]}" data-tab="${key}" ${key==='mine'&&r.name==='analysis.html'?'id="flow-mine"':''} ${key===r.section?'aria-current="page"':''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg><span>${label}</span></a>`;
  }).join('')+'</nav>';
 }
 function mount(){
  const r=route();
  document.documentElement.dataset.pageType=r.type;
  document.querySelectorAll('.tabbar,.bottom-nav').forEach(node=>node.remove());
  document.querySelector('.app')?.classList.toggle('has-tabbar',r.showBottomNav);
  document.body.classList.toggle('has-global-nav',r.showBottomNav);
  if(!r.showBottomNav){document.querySelector('.pf-global-nav')?.remove();return;}
  if(document.querySelector('.pf-global-nav'))return;
  document.body.insertAdjacentHTML('afterbegin',markup());
  const mine=document.querySelector('.pf-global-nav [data-tab=mine]');
  const member=currentMember();
  if(member&&r.name!=='services.html')mine.href=withParams(destinations.mine,{member});
  document.querySelector('.pf-global-nav').addEventListener('click',event=>{
   const link=event.target.closest('a[data-tab]');
   if(!link||event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
   if(r.name===destinations[link.dataset.tab])event.preventDefault();
  });
 }
 document.documentElement.dataset.pageType=route().type;remember();
 document.addEventListener('DOMContentLoaded',()=>{mount();const r=route();if(r.type==='result'&&!query.get('query')&&!document.querySelector('#structuredEdit')){const bar=document.createElement('div');bar.className='result-navigation';const edit=document.createElement('button');edit.className='query-end';edit.textContent='返回查询信息';edit.onclick=()=>location.assign(queryInfoURL());const end=document.createElement('button');end.className='query-end';end.textContent='结束并返回入口';end.onclick=endQuery;bar.append(edit,end);document.querySelector('.topbar')?.after(bar);}if(r.type==='secondary'&&r.name!=='policy.html'){const fallback=r.name==='plan.html'?'services.html':'services.html';const target=safeReturn(query.get('from'),fallback);if(typeof updateTopbarParent==='function')updateTopbarParent(target);} });
 window.addEventListener('pageshow',()=>{remember();mount();});
 function backFromSecondary(){
  const isPolicy=route().name==='policy.html';
  const target=returnTarget(isPolicy?'discovery-c.html':'services.html');
  const searchParent=isPolicy&&route(target).name==='search.html';
  if(searchParent&&history.length>1&&document.referrer){
   const ref=new URL(document.referrer), parent=new URL(target,location.href);
   if(ref.origin===parent.origin&&ref.pathname===parent.pathname){
    history.back();
    return;
   }
  }
  const followUpFromBatch=['plan.html','verify-list.html'].includes(route().name)&&new URL(target,location.href).searchParams.get('batch')==='done';
  if((isPolicy&&query.get('semantic')==='1'||followUpFromBatch)&&(route(target).type==='result'||route(target).name==='follow-up.html')
      &&document.referrer===new URL(target,location.href).href&&history.length>1){
   history.back();
   return;
  }
  location.replace(target);
 }
 document.addEventListener('click',e=>{const back=e.target.closest('[data-back]');if(back&&route().type==='secondary'){e.preventDefault();e.stopImmediatePropagation();backFromSecondary();return;}const a=e.target.closest('a[href]');if(!a)return;const u=new URL(a.href,location.href);if(u.pathname.endsWith('/policy.html')&&u.searchParams.has('id')&&route().name!=='policy.html'&&!u.searchParams.has('from'))a.href=withParams(u.href,{from:location.href});},true);
 return {route,context,safeReturn,current,withParams,taskURL,resultURL,queryInfoURL,detailURL,returnTarget,exitTask,endQuery,markup,mount,destinations};
})();
