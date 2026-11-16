/* Isolated catalogue prototype. Public allowlist projections, no matching writes. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id), esc=escapeHtml;
 const names={guangzhou:'广州',foshan:'佛山'};const initial=new URLSearchParams(location.search);let region=initial.get('region')==='foshan'?'foshan':'guangzhou',category=initial.get('category')||'',search=initial.get('q')||'',cache={},failed={},seq=0,sqlitePreview=false;
 const icons={default:'M5 3h14v18H5ZM9 2h6v4H9m-1 7 3 3 5-6',home:'M3 11 12 3l9 8v10h-6v-7H9v7H3Z',heart:'M12 21S2 15 2 8a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 7-10 13-10 13ZM5 12h4l2-4 3 8 2-4h4'};
 function glyph(cat){return icons[cat==='养老服务'?'home':cat==='健康服务'?'heart':'default'];}
 function topics(){const cats=[...new Set((cache[region]||[]).map(p=>p.category).filter(Boolean))];$('topics').innerHTML=['',...cats].map(c=>`<button type="button" data-category="${esc(c)}" aria-pressed="${c===category}">${esc(c||'全部')}</button>`).join('');}
 function render(){const all=cache[region];if(all&&!all.some(p=>p.category===category))category='';if(all){history.replaceState(history.state,'',PFNavigation.withParams('discovery-c.html',{region,category,q:search}));}$('list').setAttribute('aria-busy','false');
 document.querySelectorAll('[data-region]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.region===region)));topics();
 if(!all){$('count').textContent=names[region]+' · 暂不可读取';$('list').innerHTML='<div class="dc-empty" role="status">政策数据暂时无法读取，请稍后重试。<br><button id="retry">重新加载</button></div>';$('retry').onclick=()=>load(region);return;}
 const q=search.trim().toLocaleLowerCase();const list=all.filter(p=>(!category||p.category===category)&&(!q||[p.policy_name,p.description,p.category,p.region?.scope,p.source?.department,p.source?.document_no].filter(Boolean).join(' ').toLocaleLowerCase().includes(q)));
 $('count').textContent=`${names[region]} · ${search||category?'找到 '+list.length+' / 共 '+all.length:'共 '+all.length} 条`;
 $('list').innerHTML=list.length?list.map(p=>{const status=p.verification?.status;const verified=status==='verified';const label=verified?'来源已核验':status==='to_verify'?'来源待核验':'来源核验状态暂缺';const source=[p.source?.department,p.source?.document_no].filter(v=>v&&v!=='to_verify').join(' · ');const href=PFNavigation.detailURL(p.policy_id,!sqlitePreview&&region==='foshan'?'8021':null);
 return `<a class="dc-policy" href="${href}" title="查看政策详情" data-id="${esc(p.policy_id)}" data-category="${esc(p.category||'')}" data-status="${esc(status||'')}"><span class="dc-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${glyph(p.category)}"/></svg></span><div class="dc-policy-body"><div class="dc-title-row"><h3>${esc(p.policy_name||'政策名称暂缺')}</h3><span class="dc-status ${verified?'':status==='to_verify'?'pending':'unknown'}">${label}</span></div><p class="dc-description">${esc(p.description||'政策介绍暂未提供。')}</p><div class="dc-meta"><span>${esc(p.category||'分类暂缺')} · ${esc(p.region?.scope||'地区暂缺')}</span><b>了解详情 →</b></div>${source?`<p class="dc-source">${esc(source)}</p>`:''}</div></a>`;}).join(''):'<div class="dc-empty" role="status">没有找到相关政策<br>试试其他关键词，或切换政策主题。</div>';
 }
 async function fetchRegion(r){const res=await fetch(`discovery-c/${r}.json`,{cache:'no-store'});if(!res.ok)throw Error('catalogue unavailable');const d=await res.json();if(!Array.isArray(d.policies))throw Error('invalid catalogue');const prefix=r==='guangzhou'?'gz_elderly_':'fs_med_';if(d.policies.some(p=>!p.policy_id?.startsWith(prefix)))throw Error('region mismatch');return d.policies;}
 async function load(r){const token=++seq;document.querySelectorAll('[data-region]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.region===region)));$('topics').innerHTML='';$('count').textContent=names[region]+' · 正在读取';$('list').setAttribute('aria-busy','true');$('list').innerHTML='<p class="dc-empty">正在读取政策…</p>';try{cache[r]=await fetchRegion(r);failed[r]=false;}catch(e){delete cache[r];failed[r]=true;}if(token===seq&&r===region)render();counts();}
 function counts(){$('gzCount').textContent=cache.guangzhou?`(${cache.guangzhou.length})`:'(暂缺)';$('fsCount').textContent=cache.foshan?`(${cache.foshan.length})`:'(暂缺)';}
 document.querySelectorAll('[data-region]').forEach(b=>b.onclick=()=>{region=b.dataset.region;category='';if(cache[region]){++seq;render();}else load(region);});
 $('topics').onclick=e=>{const b=e.target.closest('[data-category]');if(b){category=b.dataset.category;render();}};
 $('search').addEventListener('input',e=>{search=e.target.value;render();});
 function enter(self){try{if(PF_V3_MODE!=='v1')throw Error();if(self)store.write({target:'self',demo:false,demoBanner:false});else{const previous=store.read().target;store.write({target:previous==='family'?'family':'parents',demo:false,demoBanner:false});}location.href=PFNavigation.taskURL(self?'self':'family');}catch(e){$('entryError').textContent='未能进入查询，请检查存储权限或当前数据保护状态后重试。';}}
 $('selfEntry').onclick=()=>enter(true);$('familyEntry').onclick=()=>enter(false);
 $('search').value=search;
 mountBottomNav();
 Promise.allSettled([PFBusiness.enabled().then(value=>{sqlitePreview=value;}),...['guangzhou','foshan'].map(async r=>{try{cache[r]=await fetchRegion(r);}catch(e){failed[r]=true;}})]).then(()=>{counts();render();});
})();
