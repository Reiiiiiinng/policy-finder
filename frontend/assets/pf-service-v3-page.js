/* Shared schema 3 page adapter. The early activation module keeps production
 * compiled off; localhost rehearsal exercises the dormant production path. */
(function (global) {
  'use strict';
  var gateMode=global.PF_V3_MODE;
  if (gateMode==='v1'||!gateMode)return;
  var isIsolated=gateMode==='v3-isolated';
  var rehearsal=location.hostname==='127.0.0.1' && global.__PF_V3_ISOLATED_TEST__
    && global.__PF_V3_ISOLATED_TEST__.token==='pf-v3-switch-rehearsal';
  var config=global.__PF_V3_ISOLATED_TEST__||{storageKind:'session'};
  var preferenceKey=isIsolated?'pf_v3_isolated_choice':'pf_v3_storage_choice_b';
  var activationKey='pf_service_v3_active_b';
  var globalActivationKey='pf_service_v3_global_active_b';

  var page = location.pathname.split('/').pop();
  if (!['discover.html','self.html','policy.html','verify-list.html','plan.html','records.html'].includes(page)) return;
  var key = 'pf_service_state_v2_b', active = config.beneficiaryId;
  var backend, adapter, service, manager, operations, revision = 0, permit = false, cleared = false;
  var sourceMode = config.storageKind === 'local' ? 'local' : 'session';
  var preferenceError=false;
  try { var chosen=global.localStorage.getItem(preferenceKey);if(chosen==='local'||chosen==='session')sourceMode=chosen; }
  catch (_) { preferenceError=true; }
  var banner, messageBox, bodyBox, editor, discard, editContext, originalDraft;
  var detailCache = new Map(), removedArm = new Set(), deleteArm = new Set();
  var legacyIds = new Map();

  function element(tag, content, className) {
    var node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function button(label, action, className) {
    var node = element('button', label, className || 'vf-btn');
    node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function note(text) { if (messageBox) messageBox.textContent = text; }
  function fail(result, prefix) {
    note((prefix || '操作失败') + '：' + ((result && result.error && result.error.code) || 'UNKNOWN') + '。请保留草稿并核对后重试。');
  }
  function identity() { return {householdId:config.householdId,beneficiaryId:active,actingActorId:config.actorId}; }
  function context() { return {...identity(),expectedRevision:revision}; }
  function same(x) { return x.householdId === config.householdId && x.beneficiaryId === active; }
  function storageFor(mode) { return mode === 'local' ? localStorage : sessionStorage; }
  function seed() {
    return {households:config.households,beneficiaries:config.beneficiaries,actors:config.actors,
      legacyMap:{},idForLegacy:function (label) {
        if (!legacyIds.has(label)) legacyIds.set(label,crypto.randomUUID());
        return legacyIds.get(label);
      }};
  }
  function connect() {
    backend = storageFor(sourceMode);
    adapter = global.PFServiceStorage.createAdapter(backend);
    var initial = adapter.readState3();
    if (!initial.ok) { fail(initial, '读取失败'); return false; }
    if(manager){
      var pointer=manager.read(),matched=pointer.ok?global.PFServiceIdentity.resolve(pointer.data,initial.data):pointer;
      if(!matched.ok){migrationError(matched);return false;}
      config={...config,...matched.data};active=matched.data.beneficiaryId;
    }
    revision = initial.revision;
    service = global.PFServices.createV3Service({adapter:adapter,clock:Date.now,
      idFactory:function () { return crypto.randomUUID(); },currentIdentity:identity,
       writePermit:function () { try{return permit&&localStorage.getItem(global.PFServiceV3Operations.JOURNAL_KEY)===null;}catch(_){return false;} }});
    return true;
  }
  async function ensureActivation() {
    if(isIsolated)return true;
    var state=adapter.readState3(),pointer=manager&&manager.read();
    if(!state.ok||!pointer||!pointer.ok||!global.PFServiceIdentity.resolve(pointer.data,state.data).ok){
      migrationError({error:{code:'ACTIVATION_PREFLIGHT_FAILED'}});return false;
    }
    var result=await exclusive(function(){
      try {
        var latest=adapter.readState3(),currentPointer=manager.read();
        if(!latest.ok||!currentPointer.ok||!global.PFServiceIdentity.resolve(currentPointer.data,latest.data).ok)
          return {ok:false,error:{code:'ACTIVATION_PREFLIGHT_FAILED'}};
         var globalMarker=localStorage.getItem(globalActivationKey);
         if(globalMarker===null){
           globalMarker=JSON.stringify({schemaVersion:3,namespace:'b'});
           localStorage.setItem(globalActivationKey,globalMarker);
           if(localStorage.getItem(globalActivationKey)!==globalMarker)return {ok:false,error:{code:'ACTIVATION_READBACK_FAILED'}};
         }else{var globalParsed=JSON.parse(globalMarker);if(globalParsed.schemaVersion!==3||globalParsed.namespace!=='b')return {ok:false,error:{code:'ACTIVATION_CONFLICT'}};}
        var existing=backend.getItem(activationKey);
        if(existing){
          var parsed=JSON.parse(existing);
           if(parsed.schemaVersion!==3||!latest.data.households.some(function(h){return h.householdId===parsed.householdId;}))
            return {ok:false,error:{code:'ACTIVATION_CONFLICT'}};
          return {ok:true};
        }
        if(backend.getItem(global.PFServiceStorage.MIGRATION_BACKUP_KEY)!==null)
          return {ok:false,error:{code:'RECOVERY_REQUIRED'}};
        var value=JSON.stringify({schemaVersion:3,householdId:pointer.data.householdId});
        backend.setItem(activationKey,value);
        if(backend.getItem(activationKey)!==value)return {ok:false,error:{code:'ACTIVATION_READBACK_FAILED'}};
        return {ok:true};
      }catch(_){return {ok:false,error:{code:'ACTIVATION_STORAGE_FAILED'}};}
    });
    if(!result.ok){migrationError(result);return false;}
    return true;
  }
  async function prepareIdentity() {
    if(config.householdId&&config.beneficiaryId&&config.actorId)return true;
    try {
      var other=storageFor(sourceMode==='session'?'local':'session');
      if(other.getItem(global.PFServiceIdentity.KEY)!==null||other.getItem(key)!==null||other.getItem(activationKey)!==null){
        migrationError({error:{code:'IDENTITY_STORAGE_CONFLICT'}});return false;
      }
    }catch(_){migrationError({error:{code:'IDENTITY_STORAGE_UNAVAILABLE'}});return false;}
    manager=global.PFServiceIdentity.createManager(storageFor(sourceMode),function(){return crypto.randomUUID();});
    var existing=manager.read();
    if(existing.ok){
      var seeded=global.PFServiceIdentity.seed(existing.data);
      if(!seeded.ok){migrationError(seeded);return false;}
      config={...config,...seeded.data};active=seeded.data.beneficiaryId;
      var stored=global.PFServiceStorage.createAdapter(storageFor(sourceMode));
      var oldState=stored.readState3();
      if(oldState.ok){
        var linked=oldState.data.actors.some(function(a){return a.actorId===existing.data.actorId&&Array.isArray(a.householdIds)&&a.householdIds.includes(existing.data.householdId);});
        if(!linked){
          if(!oldState.data.households.some(function(h){return h.householdId===existing.data.householdId;})||
             !oldState.data.beneficiaries.some(function(b){return b.householdId===existing.data.householdId&&b.beneficiaryId===existing.data.beneficiaryId;})||
             !oldState.data.actors.some(function(a){return a.actorId===existing.data.actorId;})){
            migrationError({error:{code:'IDENTITY_RECOVERY_REQUIRED'}});return false;
          }
          var panel=element('aside',undefined,'pf-v3-shell');panel.id='pfV3ActorLink';
          panel.append(element('h2','确认旧操作人归属'));
          panel.append(element('p','旧记录没有操作人与家庭关联。请核对操作人「'+existing.data.actorLabel+'」是否协助家庭「'+existing.data.householdLabel+'」。确认前仅可查看此说明，个人记录不可读取或修改。'));
          var problem=element('p','');problem.setAttribute('role','alert');panel.append(problem);
          panel.append(button('确认关联此家庭',async function(){
            var result=await exclusive(function(){var latest=stored.readState3();if(!latest.ok)return latest;
              return stored.commit3({type:'LINK_ACTOR_HOUSEHOLD',actorId:existing.data.actorId,explicitConfirmation:true,now:Date.now()},
                {householdId:existing.data.householdId,beneficiaryId:existing.data.beneficiaryId,actingActorId:existing.data.actorId,expectedRevision:latest.revision});});
            if(!result.ok){problem.textContent='关联失败：'+result.error.code+'；旧记录未改动。';return;}
            panel.remove();await finishStart();
          },'vf-btn is-primary'));
          var app=document.querySelector('.app')||document.body;app.insertBefore(panel,app.children[1]||null);
          return false;
        }
      }
      return true;
    }
    if(existing.error.code!=='IDENTITY_REQUIRED'){migrationError(existing);return false;}
    // If schema 3 already exists, an absent pointer needs manual recovery, never a new ID.
    var stateAdapter=global.PFServiceStorage.createAdapter(storageFor(sourceMode));
    var stateRead=stateAdapter.readState3();
    if(stateRead.ok){migrationError({error:{code:'IDENTITY_RECOVERY_REQUIRED'}});return false;}
    if(!['MIGRATION_REQUIRED','UNSUPPORTED_SCHEMA'].includes(stateRead.error.code)){migrationError(stateRead);return false;}
    document.body.classList.add('pf-v3-isolated');
    var panel=element('aside',undefined,'pf-v3-shell');panel.id='pfV3Migration';
    panel.append(element('h2','建立稳定家庭身份'));
    panel.append(element('p','只需称谓，不需要真实姓名或身份证号。创建后在本次会话内保留稳定 ID；本机保存需另行主动选择。'));
    function field(text,max){var labelNode=element('label',text),input=document.createElement('input');input.maxLength=max;input.setAttribute('aria-label',text);labelNode.append(input);panel.append(labelNode);return input;}
    var household=field('家庭称呼',80),relation=field('受益人称谓',40),actor=field('协助者称谓',80),status=element('p','');
    status.setAttribute('role','alert');panel.append(status);
    panel.append(button('建立并继续预览',async function(){
      var made=await exclusive(function(){return manager.initialize({householdLabel:household.value.trim(),relationLabel:relation.value.trim(),actorLabel:actor.value.trim(),actorRole:'helper'});});
      if(!made.ok){status.textContent='身份建立失败：'+made.error.code+'；不会另建新身份覆盖旧关系。';return;}
      var seeded=global.PFServiceIdentity.seed(made.data);if(!seeded.ok){status.textContent=seeded.error.code;return;}
      config={...config,...seeded.data};active=seeded.data.beneficiaryId;panel.remove();await finishStart();
    },'vf-btn is-primary'));
    var app=document.querySelector('.app')||document.body;app.insertBefore(panel,app.children[1]||null);
    return false;
  }
  function migrationCounts(state) {
    return {records:state.records.length,choices:state.choices.length,
      quarantine:state.quarantine.reduce(function(n,q){return n+q.records.length+q.choices.length+q.legacyPrep.length;},0)};
  }
  function migrationError(result) {
    document.body.classList.add('pf-v3-isolated');
    var panel=element('aside',undefined,'pf-v3-shell');panel.id='pfV3Migration';
    panel.append(element('h2','记录暂不可读取'));
    panel.append(element('p','这不是空记录；原始数据未被清理。错误：'+((result&&result.error&&result.error.code)||'UNKNOWN')));
    if(result&&result.error&&result.error.code==='ACTIVE_STATE_REQUIRES_V3_RELEASE')
      panel.append(element('p','此浏览器已有 schema 3 启用标记。请使用经过审核的 V2 版本继续或联系维护人员恢复；当前版本不会回退旧版写入。'));
    var app=document.querySelector('.app')||document.body;app.insertBefore(panel,app.children[1]||null);
  }
  function showRecovery(info) {
    document.body.classList.add('pf-v3-isolated');
    var panel=element('aside',undefined,'pf-v3-shell');panel.id='pfV3Recovery';
    panel.append(element('h2','需要人工恢复：当前只读'));
    panel.append(element('p','检测到迁移原文备份（'+info.bytes+' 字符）。当前页面禁止保存、再次迁移和清除。'));
    panel.append(element('p','恢复步骤：①下载原始备份；②保留当前浏览器数据，不清除或重复提交；③在可信设备核对备份内容；④交由维护人员按备份核对并恢复。不要把文件发送到公开渠道。'));
    if(!info.validSource)panel.append(element('p','备份校验未通过，请保留浏览器数据并联系维护人员。','pf-v3-warning'));
    var status=element('p','');status.setAttribute('role','status');panel.append(status);
    panel.append(button('下载原始迁移备份',function(){
      var result=adapter.readRecoveryBackup3();if(!result.ok){status.textContent='备份读取失败：'+result.error.code;return;}
      var blob=new Blob([result.data],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download='policy-finder-b-migration-backup.json';document.body.append(a);a.click();a.remove();
      setTimeout(function(){URL.revokeObjectURL(url);},1000);status.textContent='已生成备份下载；当前仍为只读。';
    }));
    var app=document.querySelector('.app')||document.body;app.insertBefore(panel,app.children[1]||null);
  }
  async function prepareMigration() {
    backend=storageFor(sourceMode);adapter=global.PFServiceStorage.createAdapter(backend);
    var recovery=adapter.inspectRecovery3();
    if(!recovery.ok){migrationError(recovery);return false;}
    if(recovery.data.required){showRecovery(recovery.data);return false;}
    var current=adapter.readState3();if(current.ok)return true;
    if(!['MIGRATION_REQUIRED','UNSUPPORTED_SCHEMA'].includes(current.error.code)){migrationError(current);return false;}
    var preview=adapter.previewState3(seed());
    if(!preview.ok){migrationError(preview);return false;}
    var counts=migrationCounts(preview.data),hasLegacy=counts.records+counts.choices+counts.quarantine>0;
    var clearMarker=operations.cleared();if(!clearMarker.ok){migrationError(clearMarker);return false;}
    if(clearMarker.data&&hasLegacy){migrationError({error:{code:'LEGACY_IMPORT_BLOCKED_AFTER_CLEAR'}});return false;}
    if(!hasLegacy){
      var emptyResult=await exclusive(function(){return adapter.initializeState3(seed(),preview.sourceToken);});
      if(!emptyResult.ok){migrationError(emptyResult);return false;}
      var emptyRead=adapter.readState3();if(!emptyRead.ok){migrationError(emptyRead);return false;}
      return true;
    }
    document.body.classList.add('pf-v3-isolated');
    var panel=element('aside',undefined,'pf-v3-shell');panel.id='pfV3Migration';
    panel.append(element('h2','旧记录迁移前预览'));
    panel.append(element('p','即将纳入 '+counts.records+' 条已确认归属记录、'+counts.choices+' 条个人选择；另有 '+counts.quarantine+' 项归属待确认，继续隔离。'));
    panel.append(element('p','目标家庭：'+config.households.map(function(x){return x.displayLabel;}).join('、')+'；成员：'+config.beneficiaries.map(function(x){return x.relationLabel||x.displayLabel;}).join('、')+'。'));
    panel.append(element('p',isIsolated?'确认后仅在当前独立测试存储中写入；原有 v1 键保持不变。':'确认后写入当前选择的本机存储；旧版记录保留供核对，不会同时写入。','pf-v3-muted'));
    var error=element('p','');error.setAttribute('role','alert');panel.append(error);
    panel.append(button(isIsolated?'确认迁移隔离记录':'确认迁移个人记录',async function(){
      var result=await exclusive(function(){return adapter.initializeState3(seed(),preview.sourceToken);});
      if(!result.ok){error.textContent='迁移未完成：'+result.error.code+'；原始记录仍可检查。';return;}
      var check=adapter.readState3();
      if(!check.ok||JSON.stringify(check.data)!==JSON.stringify(result.data)){
        error.textContent='写后读回校验未通过；请停止操作并检查原始记录。';return;
      }
      panel.remove();await finishConnected();
      if(result.recoveryBackupRetained)note('迁移已保存，但旧版本临时备份未能清除；请检查本机记录并使用清除入口。');
    },'vf-btn is-primary'));
    var app=document.querySelector('.app')||document.body;app.insertBefore(panel,app.children[1]||null);
    return false;
  }
  function read() {
    var result = adapter.readState3();
    if (!result.ok) { fail(result, '读取失败'); bodyBox.replaceChildren(element('p','记录暂不可读取；这不是空清单。')); return null; }
    revision = result.revision; return result.data;
  }
  async function exclusive(operation,allowRecovery) {
    if (!navigator.locks || typeof navigator.locks.request !== 'function')
      return {ok:false,error:{code:'LOCK_UNAVAILABLE'}};
    try {
      return await navigator.locks.request('pf-service-v3-b-write',{ifAvailable:true},async function (lock) {
        if (!lock) return {ok:false,error:{code:'LOCK_BUSY'}};
        try{if(!allowRecovery&&localStorage.getItem(global.PFServiceV3Operations.JOURNAL_KEY)!==null)return {ok:false,error:{code:'RECOVERY_REQUIRED'}};}
        catch(_){return {ok:false,error:{code:'STORAGE_UNAVAILABLE'}};}
        permit = true;
        try { return await operation(); } finally { permit = false; }
      });
    } catch (_) { permit = false; return {ok:false,error:{code:'LOCK_FAILED'}}; }
  }
  async function change(operation, success) {
    var fixed=context();
    var result = await exclusive(function(){
      if(!same(fixed))return {ok:false,error:{code:'IDENTITY_CHANGED'}};
      return operation(fixed);
    });
    if (!result.ok) { fail(result); return false; }
    note(success || '个人记录已保存'); await render(); return true;
  }
  async function script(url) {
    return new Promise(function (resolve, reject) {
      var node = document.createElement('script'); node.src = url;
      node.onload = resolve; node.onerror = reject; document.head.append(node);
    });
  }
  async function modules() {
    if (!global.PFServiceIdentity) await script('assets/pf-service-identity.js');
    if (!global.PFServiceState) await script('assets/pf-service-state.js');
    if (!global.PFServiceStorage) await script('assets/pf-service-storage.js');
    if (!global.PFServiceV3Operations) await script('assets/pf-service-v3-operations.js');
    if (!global.PFServices) { global.PF_NS = 'b'; await script('assets/pf-services.js'); }
    operations=global.PFServiceV3Operations.createCoordinator(sessionStorage,localStorage,{
      keys:{state:key,identity:global.PFServiceIdentity.KEY,activation:activationKey,globalGate:globalActivationKey,backup:global.PFServiceStorage.MIGRATION_BACKUP_KEY,oldRecords:'pf_verify_records_v1_b',oldPrep:'pf_prep_v1_b',oldFavorites:'pf_saved_b'},
      preferenceKey:preferenceKey,oldPrefixes:['pf_fs_b_','pf_prep_v1_b_'],requireIdentity:!isIsolated,idFactory:function(){return crypto.randomUUID();},
      hash:async function(raw){var bytes=new TextEncoder().encode(raw),digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest),function(b){return b.toString(16).padStart(2,'0');}).join('');},
      validateState:function(raw){return global.PFServiceState.parseState3(raw).ok;},
      validateIdentity:function(pointerRaw,stateRaw){try{var p=global.PFServiceIdentity.validate(JSON.parse(pointerRaw)),s=global.PFServiceState.parseState3(stateRaw);return p.ok&&s.ok&&global.PFServiceIdentity.resolve(p.data,s.data).ok;}catch(_){return false;}}
    });
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'assets/pf-service-v3-page.css'; document.head.append(css);
  }
  function title(pid) { var p = detailCache.get(pid); return p ? p.policy_name : pid; }
  async function detail(pid) {
    if (detailCache.has(pid)) return detailCache.get(pid);
    try { var p = await API.policy(pid); if (p && !p.error) { detailCache.set(pid,p); return p; } }
    catch (_) { /* source unavailable: retain local records */ }
    return null;
  }
  function names(state) {
    return state.beneficiaries.filter(function (b) { return b.householdId === config.householdId; });
  }
  function statusLabel(value) {
    return ({pending:'待核实',checking:'核实中',consulted:'已记录咨询',needinfo:'待补充信息',preparing:'准备材料',paused:'暂不办理',closed:'个人标记已处理',legacy_done_review:'旧状态待确认'})[value] || '待核实';
  }
  function nextLabel(code) {
    return ({select_policy:'先选择想了解的政策',review_missing_information:'先补充或确认缺失信息',verify_conditions:'先核实政策条件',follow_up:'等待或跟进答复',review_consultation:'回看个人咨询记录',prepare_items:'继续准备事项',review_or_reopen:'回看记录或重新跟进'})[code] || '请核对当前记录';
  }
  function card(name) { var node = element('article',undefined,'pf-v3-card'); node.append(element('h3',name)); bodyBox.append(node); return node; }
  function link(href,label) { var node = element('a',label,'vf-btn'); node.href = href; return node; }
  function actions(node) { var row = element('div',undefined,'pf-v3-actions'); node.append(row); return row; }
  function injectShell() {
    document.body.classList.add('pf-v3-isolated');
    banner = element('aside',undefined,'pf-v3-shell'); banner.id = 'pfV3Shell';
    banner.append(element('strong',isIsolated?'少跑腿计划 V2 · 隔离验收':'少跑腿计划 V2 · 个人辅助记录'));
    banner.append(element('p',isIsolated?'仅在独立 localhost 测试配置中启用。咨询答复属于个人记录，不代表官方资格认定。':'咨询答复属于个人记录，不代表官方资格认定或正式办结。','pf-v3-muted'));
    var controls = element('div',undefined,'pf-v3-actions');
    if(manager){
      var households=service.listHouseholds(identity());
      if(households.ok){
        var householdSelect=element('select');householdSelect.setAttribute('aria-label','当前家庭');
        households.data.forEach(function(h){var o=element('option',h.displayLabel||'家庭');o.value=h.householdId;householdSelect.append(o);});
        householdSelect.value=config.householdId;
        householdSelect.addEventListener('change',async function(){
          var target=households.data.find(function(h){return h.householdId===householdSelect.value;}),first=target&&target.beneficiaries[0];
          if(!first){householdSelect.value=config.householdId;note('目标家庭尚无受益人，已阻止切换。');return;}
          var state=adapter.readState3(),switched=state.ok?await exclusive(function(){return manager.switchHousehold(target.householdId,first.beneficiaryId,state.data);}):state;
          if(!switched.ok){householdSelect.value=config.householdId;fail(switched,'切换家庭失败');return;}
          location.reload();
        });controls.append(householdSelect);
      }else note('家庭列表暂不可读取：'+households.error.code);
      controls.append(button('新建家庭',async function(){
        var label=prompt('新家庭称呼（无需真实姓名）','');if(label===null)return;
        var relation=prompt('首位受益人的关系称谓','');if(relation===null)return;
        var fixed=context(),made=await exclusive(function(){return service.createHousehold({displayLabel:label,relationLabel:relation},fixed);});
        if(!made.ok){fail(made,'新建家庭失败');return;}
        var state=adapter.readState3(),switched=state.ok?await exclusive(function(){return manager.switchHousehold(made.data.householdId,made.data.beneficiaryId,state.data);}):state;
        if(!switched.ok){fail(switched,'家庭已建立，但身份切换失败；请刷新后从家庭列表选择');return;}
        location.reload();
      }));
      controls.append(button('关联现有协助者',async function(){
        var state=adapter.readState3();if(!state.ok){fail(state,'读取操作人失败');return;}
        var candidates=state.data.actors.filter(function(a){return !Array.isArray(a.householdIds)||!a.householdIds.includes(config.householdId);});
        if(!candidates.length){note('没有待关联的现有协助者。');return;}
        var dlg=document.createElement('dialog');dlg.setAttribute('aria-label','确认协助者家庭关联');
        dlg.append(element('h2','明确关联现有协助者'));
        dlg.append(element('p','此操作只建立本机家庭记录的访问关联，不是实名账户授权。'));
        var select=element('select');select.setAttribute('aria-label','选择协助者');candidates.forEach(function(a){var o=element('option',a.displayLabel||a.actorId);o.value=a.actorId;select.append(o);});dlg.append(select);
        dlg.append(button('确认关联当前家庭',async function(){var fixed=context(),result=await exclusive(function(){return service.linkActorToHousehold(select.value,fixed);});
          if(!result.ok){fail(result,'关联失败');return;}dlg.close();dlg.remove();location.reload();},'vf-btn is-primary'));
        dlg.append(button('取消',function(){dlg.close();dlg.remove();}));document.body.append(dlg);dlg.showModal();
      }));
    }
    var chooser = element('select'); chooser.id = 'pfV3Beneficiary'; chooser.setAttribute('aria-label','当前受益人');
    names(adapter.readState3().data).forEach(function (b) { var o = element('option',b.relationLabel || b.displayLabel || '受益人'); o.value = b.beneficiaryId; chooser.append(o); });
    chooser.value = active; chooser.addEventListener('change',async function () {
      var target=chooser.value,previous=active;
      if(manager){var state=adapter.readState3(),switched=state.ok?await exclusive(function(){return manager.switchBeneficiary(target,state.data);}):state;
        if(!switched.ok){chooser.value=previous;fail(switched,'切换受益人失败');return;}}
      active=target;render();
    }); controls.append(chooser);
    controls.append(button('新增受益人',async function(){
      var relation=prompt('新成员的关系称谓（可以与现有成员相同）','');
      if(relation===null)return;relation=relation.trim();
      if(!relation||relation.length>40){note('请输入 1—40 字的关系称谓。');return;}
      var newId=crypto.randomUUID(),expected=revision;
      var added=await exclusive(function(){return adapter.commit3({type:'ADD_BENEFICIARY',displayLabel:'',relationLabel:relation,now:Date.now()},
         {householdId:config.householdId,beneficiaryId:newId,actingActorId:config.actorId,expectedRevision:expected});});
      if(!added.ok){fail(added,'新增成员失败');return;}
      var state=adapter.readState3();if(!state.ok){fail(state,'新增后读取失败');return;}
      var option=element('option',relation);option.value=newId;chooser.append(option);
      if(manager){var switched=await exclusive(function(){return manager.switchBeneficiary(newId,state.data);});
        if(!switched.ok){fail(switched,'成员已建立，但切换身份失败');await render();return;}}
      active=newId;chooser.value=newId;config.beneficiaries=state.data.beneficiaries;await render();
    }));
    var actorSelect=element('select');actorSelect.id='pfV3Actor';actorSelect.setAttribute('aria-label','当前操作人');
     adapter.readState3().data.actors.filter(function(a){return Array.isArray(a.householdIds)&&a.householdIds.includes(config.householdId);}).forEach(function(a){var o=element('option',a.displayLabel||'操作人');o.value=a.actorId;actorSelect.append(o);});
    actorSelect.value=config.actorId;actorSelect.addEventListener('change',async function(){
      var target=actorSelect.value,previous=config.actorId;
      if(manager){var state=adapter.readState3(),switched=state.ok?await exclusive(function(){return manager.switchActor(target,state.data);}):state;
        if(!switched.ok){actorSelect.value=previous;fail(switched,'切换操作人失败');return;}}
      config.actorId=target;note('当前操作人已切换；未保存的咨询草稿需重新核对。');
    });controls.append(actorSelect);
    controls.append(button('新增协助者',async function(){
      var label=prompt('协助者称谓（无需真实姓名）','');if(label===null)return;label=label.trim();
      if(!label||label.length>80){note('请输入 1—80 字的协助者称谓。');return;}
      var newId=crypto.randomUUID(),expected=revision,fixed=identity();
      var added=await exclusive(function(){if(!same(fixed))return {ok:false,error:{code:'IDENTITY_CHANGED'}};
        return adapter.commit3({type:'ADD_ACTOR',actorId:newId,displayLabel:label,role:'helper',now:Date.now()},
          {...fixed,expectedRevision:expected});});
      if(!added.ok){fail(added,'新增协助者失败');return;}
      var state=adapter.readState3();if(!state.ok){fail(state,'新增后读取失败');return;}
      var option=element('option',label);option.value=newId;actorSelect.append(option);
      if(manager){var switched=await exclusive(function(){return manager.switchActor(newId,state.data);});
        if(!switched.ok){fail(switched,'协助者已建立，但切换失败');await render();return;}}
      config.actorId=newId;actorSelect.value=newId;config.actors=state.data.actors;await render();
    }));
    var mode = element('span',undefined,'pf-v3-mode'); mode.id = 'pfV3Mode'; controls.append(mode);
    if(sourceMode==='session')controls.append(button('选择本机保存',toggleStorage));
    else controls.append(element('p','本机记录不能直接转为本次会话。您可以主动下载备份，或单独确认清除本机记录。','pf-v3-muted'));
    controls.append(button(isIsolated?'清除隔离记录':'清除本机个人记录',showClearChoice));
    controls.append(button('主动下载当前记录备份',function(){
      var state=adapter.readState3();if(!state.ok){fail(state,'备份读取失败');return;}
      var pointer=manager?manager.read():null;if(manager&&!pointer.ok){fail(pointer,'身份读取失败');return;}
      var payload={exportVersion:1,schema3:state.data,identity:pointer&&pointer.data||null,exportedAt:new Date().toISOString()};
      var url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
      var a=document.createElement('a');a.href=url;a.download='policy-finder-personal-backup.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
      note('备份已由您主动下载，请妥善保管。');
    }));
    controls.append(button('待确认归属',function () { renderQuarantine(); }));
    banner.append(controls);
    banner.append(element('p','共享设备提示：选择本机保存后，同一浏览器的其他使用者可能看到这些个人记录。','pf-v3-muted'));
    messageBox = element('p',''); messageBox.id='pfV3Message'; messageBox.setAttribute('role','status'); banner.append(messageBox);
    bodyBox = element('div'); bodyBox.id='pfV3Body'; banner.append(bodyBox);
    var app = document.querySelector('.app') || document.body;
    app.insertBefore(banner,app.children[1] || null);
    editor = document.createElement('dialog'); editor.id='pfV3Editor'; editor.setAttribute('aria-labelledby','pfV3EditorTitle');
    editor.innerHTML = '<form id="pfV3Form"><h2 id="pfV3EditorTitle">记录咨询</h2><p>答复摘要为用户自行记录，不表示政府确认。</p><label>咨询日期<input id="pfV3Date" type="date"></label><label>渠道<select id="pfV3Channel"><option value="phone">电话</option><option value="in_person">现场</option><option value="official_web">官方网站</option><option value="other">其他</option></select></label><label>咨询对象<input id="pfV3Contact" maxlength="100"></label><label>答复摘要<textarea id="pfV3Answer" maxlength="1000" required></textarea></label><label>个人状态<select id="pfV3Status"><option value="consulted">已记录咨询</option><option value="needinfo">待补充信息</option><option value="checking">核实中</option><option value="preparing">准备材料</option></select></label><label>下一步<input id="pfV3Next" maxlength="120"></label><div class="pf-v3-actions"><button type="submit" class="vf-btn is-primary">保存个人记录</button><button type="button" id="pfV3Cancel" class="vf-btn">取消</button></div><p id="pfV3EditError" role="alert"></p></form>';
    document.body.append(editor);
    discard = document.createElement('dialog'); discard.id='pfV3Discard'; discard.setAttribute('aria-labelledby','pfV3DiscardTitle');
    discard.innerHTML='<h2 id="pfV3DiscardTitle">有未保存内容</h2><p>丢弃本次草稿？</p><button type="button" id="pfV3Stay" class="vf-btn">继续编辑</button><button type="button" id="pfV3DiscardNow" class="vf-btn">丢弃</button>';
    document.body.append(discard);
    document.getElementById('pfV3Cancel').addEventListener('click',requestClose);
    editor.addEventListener('cancel',function (e) { e.preventDefault(); requestClose(); });
    document.getElementById('pfV3Stay').addEventListener('click',function () { discard.close(); });
    document.getElementById('pfV3DiscardNow').addEventListener('click',function () { discard.close(); editor.close(); editContext=null; });
    document.getElementById('pfV3Form').addEventListener('submit',saveConsultation);
    updateMode();
  }
  function updateMode() { document.getElementById('pfV3Mode').textContent = sourceMode === 'local' ? (isIsolated?'隔离本机保存（localStorage）':'本机保存（localStorage）') : '仅本次会话（sessionStorage）'; }
  async function toggleStorage() {
    if(sourceMode!=='session'){note('本机记录不能直接转为本次会话；现有本机记录未改动。');return;}
    var next = sourceMode === 'session' ? 'local' : 'session';
    var result = await exclusive(async function () {
      var current=adapter.readState3();if(!current.ok)return current;
      try {if(backend.getItem(global.PFServiceStorage.MIGRATION_BACKUP_KEY)!==null)return {ok:false,error:{code:'RECOVERY_REQUIRED'}};}
      catch(_){return {ok:false,error:{code:'STORAGE_UNAVAILABLE'}};}
      return operations.transfer(sourceMode,next);
    });
    if (!result.ok) { fail(result,'切换保存方式失败');if(result.error.code==='RECOVERY_REQUIRED')await showPendingOperation();return; }
    sourceMode=next;
    if(manager)manager=global.PFServiceIdentity.createManager(storageFor(sourceMode),function(){return crypto.randomUUID();});
    connect(); updateMode();
    var storageAction=Array.from(document.querySelectorAll('#pfV3Shell button')).find(function(x){return x.textContent==='选择本机保存';});
    if(storageAction){storageAction.replaceWith(element('p','本机记录不能直接转为本次会话。您可以主动下载备份，或单独确认清除本机记录。','pf-v3-muted'));}
    note('已按您的选择切换保存方式；旧位置不再保存该状态。'); await render();
  }
  async function clearCurrent(full) {
    var result=await exclusive(function(){return operations.clear(sourceMode,full);});
    if (!result.ok) { fail(result,'清除失败');if(result.error.code==='RECOVERY_REQUIRED')await showPendingOperation();return; }
    cleared=true;bodyBox.replaceChildren(element('p',full?'本项目个人记录已按确认范围清除。':'当前 schema 3 记录已清除；旧版记录保留但不再自动导入。'));
    note('清除已完成：'+result.data.deleted+' 个本项目专用键。请刷新后重新建立个人记录。');
  }
  function showClearChoice(){
    var dlg=document.createElement('dialog');dlg.setAttribute('aria-label','选择个人记录清除范围');
    dlg.append(element('h2','确认清除范围'));
    dlg.append(element('p','清除后无法在页面内撤销。请先按需主动下载备份；仅删除下方列出的 B 版个人记录专用键。共用的查询输入 policy_finder_session 不在此范围。会话存储只属于当前标签页，其他已打开标签页需分别核对并关闭。'));
    for(const option of [{full:false,label:'仅清除当前 schema 3、身份及迁移备份'},{full:true,label:'完整清除当前标签页会话与本浏览器本机记录（含旧 v1）'}]){
      var preview=operations.previewClear(sourceMode,option.full),row=element('p');
      row.textContent=option.label+'：'+(preview.ok?preview.data.map(function(z){return z.zone+' ['+z.keys.join('、')+']';}).join('；'):'无法读取范围，禁止清除');dlg.append(row);
      var btn=button('确认'+option.label,async function(){if(!preview.ok)return;dlg.close();dlg.remove();await clearCurrent(option.full);},'vf-btn');
      btn.disabled=!preview.ok;dlg.append(btn);
    }
    dlg.append(button('取消',function(){dlg.close();dlg.remove();}));document.body.append(dlg);dlg.showModal();
  }
  async function showPendingOperation(){
    var check=await operations.inspect();if(check.ok&&check.data===null){if(gateMode==='v3-recovery'){location.reload();return true;}return false;}
    document.body.classList.add('pf-v3-isolated');var panel=element('aside',undefined,'pf-v3-shell');panel.id='pfV3Recovery';
    panel.append(element('h2','个人记录操作未完成'));
    if(!check.ok){panel.append(element('p','操作记录无法读取：'+check.error.code+'。已阻止写入。请保留当前浏览器数据并人工核对备份。'));}
    else{
      var op=check.data.operation;
      panel.append(element('p','操作 '+op.id+' · '+(op.type==='transfer'?'保存方式转移':'清除')+' · 阶段 '+op.stage+'。恢复前不允许读取或写入个人记录。'));
      panel.append(element('p',check.data.states.map(function(s){return s.zone+'/'+s.key+'：源 '+s.source+(s.target?'，目标 '+s.target:'');}).join('；')));
      panel.append(element('p','如果两处数据不一致，请保留当前浏览器数据；仅在您主动下载现存副本后，由维护人员核对。不要将备份发送到公开渠道。'));
      panel.append(button('主动下载现存副本',function(){
        var copies=operations.recoveryCopies();if(!copies.ok){message.textContent='备份读取失败：'+copies.error.code;return;}
        var url=URL.createObjectURL(new Blob([JSON.stringify(copies.data,null,2)],{type:'application/json'}));
        var a=document.createElement('a');a.href=url;a.download='policy-finder-recovery-copies.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
        message.textContent='现存副本已由您主动下载；恢复状态仍未解除。';
      }));
      var action=async function(choice){var result=await exclusive(function(){return op.type==='clear'?operations.recoverClear():operations.recoverTransfer(choice);},true);
        if(!result.ok){message.textContent='恢复未完成：'+result.error.code+'；数据仍保留，请停止写入并核对备份。';return;}
        location.reload();};
      if(op.type==='transfer'){
        if(!(op.source==='local'&&op.target==='session'))panel.append(button('继续转移并验证目标',function(){action('continue');},'vf-btn is-primary'));
        else panel.append(element('p','此旧操作试图把本机记录转为会话记录，不能继续该方向。原本机数据完整时可回滚；否则请下载现存副本并保持只读，交由维护人员核对。','pf-v3-warning'));
        panel.append(button('保留原位置并回滚目标',function(){action('rollback');},'vf-btn'));
      }else panel.append(button('继续清除已确认范围',function(){action('continue');},'vf-btn is-primary'));
    }
    var message=element('p','');message.setAttribute('role','alert');panel.append(message);
    var app=document.querySelector('.app')||document.body;app.insertBefore(panel,app.children[1]||null);return true;
  }
  function editorDraft() { return JSON.stringify(['pfV3Date','pfV3Channel','pfV3Contact','pfV3Answer','pfV3Status','pfV3Next'].map(function (id) { return document.getElementById(id).value; })); }
  function openEditor(pid) {
    var r=adapter.readState3(); if (!r.ok) { fail(r,'读取失败'); return; }
    var ids=service.makeCommand(); if (!ids.ok) { fail(ids); return; }
     editContext={pid:pid,identity:{householdId:config.householdId,beneficiaryId:active,actingActorId:config.actorId,expectedRevision:r.revision},actorId:config.actorId,ids:ids.data};
    document.getElementById('pfV3Form').reset(); document.getElementById('pfV3EditError').textContent='';
    originalDraft=editorDraft(); editor.showModal();
  }
  function requestClose() { if (editorDraft()!==originalDraft) discard.showModal(); else {editor.close();editContext=null;} }
  async function saveConsultation(e) {
    e.preventDefault(); if (!editContext) return;
    if(config.actorId!==editContext.actorId){document.getElementById('pfV3EditError').textContent='保存失败：ACTOR_CHANGED；草稿已保留。';return;}
    var field=function (id) { return document.getElementById(id).value; };
    var draft={...editContext.ids,actorId:editContext.actorId,channel:field('pfV3Channel'),contactLabel:field('pfV3Contact'),answerSummary:field('pfV3Answer'),statusAfter:field('pfV3Status'),note:'',next:field('pfV3Next')};
    if (field('pfV3Date')) draft.consultedOn=field('pfV3Date');
    var r=await exclusive(function () { return service.saveConsultation(editContext.pid,draft,editContext.identity); });
    if (!r.ok) { document.getElementById('pfV3EditError').textContent='保存失败：'+r.error.code+'；草稿已保留。'; return; }
    editor.close(); editContext=null; note('个人咨询记录已保存'); await render();
  }
  async function renderResult() {
    var area=document.getElementById('resultArea'); if (!area) return;
    function bind() {
      area.querySelectorAll('.result-card[data-id]').forEach(function (node) {
        if (node.querySelector('[data-pf-v3-add]')) return;
        var pid=node.dataset.id, row=element('div',undefined,'pf-v3-actions');
        row.append(button('加入待核实清单',function (e) { e.stopPropagation(); change(function (fixed) { return service.setChoice(pid,'verify',fixed); },'已加入个人清单，不代表符合资格'); },'vf-btn is-primary'));
        row.lastChild.dataset.pfV3Add=pid; node.append(row);
      });
    }
    bind(); var observer=new MutationObserver(bind); observer.observe(area,{childList:true,subtree:true});
    bodyBox.append(element('p','结果页保留原有匹配理由和政策依据；加入计划属于个人选择。'));
  }
  async function renderPolicy(state) {
    var pid=new URLSearchParams(location.search).get('id'); if (!pid) { bodyBox.append(element('p','缺少政策编号。')); return; }
    var p=await detail(pid),events=state.events.filter(function (x) { return same(x)&&x.pid===pid; });
    if (!p) bodyBox.append(element('p','政策详情来源暂不可用；以下本地个人记录仍保留。','pf-v3-warning'));
    var selected=service.readChoice(pid,identity()); if (!selected.ok) { fail(selected,'读取失败');return; }
    var c=card(p?p.policy_name:pid);c.append(element('p','当前个人选择：'+(selected.data==='verify'?'待核实':selected.data||'未加入')));
    if (events.length) c.append(element('p','已有 '+events.length+' 条个人历史事件。'));
    var row=actions(c);
    row.append(button(selected.data==='verify'?'取消加入':'加入待核实清单',function () {
      change(function (fixed) { return service.setChoice(pid,selected.data==='verify'?null:'verify',fixed); });
    },'vf-btn is-primary'));
    row.append(button('记录咨询',function () { openEditor(pid); }));
    if (p) { var questions=service.questions(pid,p,identity());if (questions.ok) questions.data.forEach(function (q) { c.append(element('p','待核实：'+q.text)); }); }
  }
  async function renderList() {
    var r=service.listPolicies(identity()); if (!r.ok) { fail(r,'读取失败');bodyBox.append(element('p','清单读取失败，不能当作空清单。'));return; }
    if (!r.data.length) { bodyBox.append(element('p','待核实清单为空。'));return; }
    for (const item of r.data) {
      var p=await detail(item.pid),c=card(p?p.policy_name:item.pid);
      if (!p) c.append(element('p','政策来源暂不可用；个人记录仍保留。','pf-v3-warning'));
      c.append(element('p','个人状态：'+statusLabel(item.record?item.record.status:'pending')));
      var row=actions(c);const pid=item.pid;
      row.append(link('policy.html?id='+encodeURIComponent(pid)+'&from=verify-list.html','查看政策依据'));
      row.append(button('记录咨询',function (id) { return function () { openEditor(id); }; }(pid)));
      row.append(button('移除',function (id) { return function () {
        if (!removedArm.has(id)) { removedArm.add(id);note('再次点击确认移除；历史和准备事项保留。');return; }
        removedArm.delete(id);change(function (fixed) { return service.removePolicy(id,fixed); });
      }; }(pid)));
    }
  }
  async function renderPlan(state) {
    var progress=service.progress(identity()),items=service.listPolicies(identity());
    if (!progress.ok || !items.ok) { fail(!progress.ok?progress:items,'读取失败');bodyBox.append(element('p','计划读取失败，不能当作空计划。'));return; }
    bodyBox.append(element('p','已选 '+progress.data.total+' 项 · 下一步：'+nextLabel(progress.data.nextAction)));
    if (!items.data.length) {bodyBox.append(element('p','尚未选择政策。'));return;}
    for (const entry of items.data) {
      const pid=entry.pid;var p=await detail(pid),c=card(p?p.policy_name:pid);
      if (!p) c.append(element('p','政策来源暂不可用；个人记录仍保留。','pf-v3-warning'));
      c.append(element('p','个人状态：'+statusLabel(entry.record?entry.record.status:'pending')));
      if (p) {var q=service.questions(pid,p,identity());if(q.ok)q.data.forEach(function(x){c.append(element('p','待核实：'+x.text));});}
      var prep=service.listPrep(pid,identity());
      if (prep.ok) prep.data.forEach(function (item) {
        if (item.archived) return;
        var label=element('label',undefined,'pf-v3-check'),input=document.createElement('input');input.type='checkbox';input.checked=item.checked;
        input.addEventListener('change',function () { var checked=input.checked;change(function (fixed) { return service.checkPrep(pid,item.itemId,checked,fixed); }); });
        var kind=item.sourceNeedsReview?'官方来源待复核':({official_requirement:'官方依据支持',confirm_with_office:'待向官方确认',personal_reminder:'我的提醒'})[item.kind];
        label.append(input,element('span',item.text+' · '+kind));c.append(label);
      });
      if (!p || !Array.isArray(p.materials) || !p.materials.length) c.append(element('p','当前政策数据没有可确认的正式材料清单。','pf-v3-muted'));
      var input=document.createElement('input');input.placeholder='为这项政策添加我的准备提醒';input.setAttribute('aria-label','我的准备提醒');c.append(input);
      var row=actions(c);row.append(button('添加我的提醒',function (id,field) {return function(){var text=field.value.trim();if(text)change(function(fixed){return service.addPrep(id,{itemId:crypto.randomUUID(),kind:'personal_reminder',text:text,sourceRef:null},fixed);});};}(pid,input)));
      row.append(button('记录咨询',function(id){return function(){openEditor(id);};}(pid)));
      row.append(link('policy.html?id='+encodeURIComponent(pid)+'&from=plan.html','政策详情'));
    }
    bodyBox.append(element('p','共同咨询对象、受理渠道和地区证据不足时，请分别向主管部门核实；这里不表示联合办理。','pf-v3-muted'));
  }
  async function renderRecords(state) {
    var list=state.events.filter(same);if(!list.length){bodyBox.append(element('p','还没有个人咨询或状态记录。'));return;}
    list.slice().reverse().forEach(function (ev) {
      var c=card(title(ev.pid));c.append(element('p',(ev.kind==='consultation'?'个人咨询记录':ev.kind==='correction'?'咨询更正':ev.kind.startsWith('legacy_')?'旧记录导入':'个人状态更新')+' · '+(ev.consultedOn||'咨询日期未记录')));
      if(ev.answerSummary)c.append(element('p','用户记录：'+ev.answerSummary));
      if(ev.correctsEventId)c.append(element('p','更正原事件：'+ev.correctsEventId));
      if(ev.next)c.append(element('p','下一步：'+ev.next));
      var row=actions(c);row.append(link('policy.html?id='+encodeURIComponent(ev.pid)+'&from=records.html','对应政策详情'));
      if(ev.kind==='consultation')row.append(button('更正答复',function(){openCorrection(ev); }));
      row.append(button('删除此政策的个人数据',function(){
        if(!deleteArm.has(ev.pid)){deleteArm.add(ev.pid);note('再次点击确认删除当前受益人此政策的个人数据。');return;}
        deleteArm.delete(ev.pid);change(function(fixed){return service.deletePolicy(ev.pid,fixed);});
      }));
    });
  }
  function openCorrection(ev) {
    var value=prompt('更正用户记录的答复（原文会保留）',ev.answerSummary||'');
    if(value===null)return;
    var ids=service.makeCommand();if(!ids.ok){fail(ids);return;}
    change(function(fixed){return service.correctConsultation(ev.pid,{...ids.data,actorId:config.actorId,correctsEventId:ev.eventId,answerSummary:value},fixed);});
  }
  async function renderQuarantine() {
    bodyBox.replaceChildren();var result=service.quarantine();if(!result.ok){fail(result,'读取失败');return;}
    if(!result.data.length){bodyBox.append(element('p','没有待确认归属的旧记录。'));return;}
    result.data.forEach(function(q){var c=card('旧关系标签：'+q.legacyBenKey);c.append(element('p','旧记录 '+q.recordCount+' 条；旧选择 '+q.choiceCount+' 条；未归属通用准备 '+q.genericPrepCount+' 份。'));
      c.append(element('p','同名关系可能对应不同人，无法确定时请保持隔离。','pf-v3-muted'));
      if(!q.recordCount&&!q.choiceCount)return;
      var select=document.createElement('select');select.setAttribute('aria-label','选择旧记录目标受益人');var none=element('option','请选择目标受益人');none.value='';select.append(none);
      names(adapter.readState3().data).forEach(function(b){var o=element('option',b.relationLabel||b.displayLabel||'受益人');o.value=b.beneficiaryId;select.append(o);});c.append(select);
      c.append(button('确认归属',function(){if(!select.value){note('请明确选择目标受益人。');return;}active=select.value;document.getElementById('pfV3Beneficiary').value=active;
        var ids=Array.from({length:q.requiredEventIds},function(){return crypto.randomUUID();});
        change(function(fixed){return service.confirmLegacy(q.legacyBenKey,ids,fixed);},'已确认归属，原关系标签及旧历史保留可追溯。');
      }));
    });
  }
  async function render() {
    if (cleared) return;
    bodyBox.replaceChildren();var state=read();if(!state)return;
    if(page==='discover.html'||page==='self.html')await renderResult();
    else if(page==='policy.html')await renderPolicy(state);
    else if(page==='verify-list.html')await renderList();
    else if(page==='plan.html')await renderPlan(state);
    else if(page==='records.html')await renderRecords(state);
  }
  function activatePage() {
      if(page==='policy.html')document.addEventListener('click',function(e){
        var target=e.target.closest && e.target.closest('#fsOpts [data-fs],#fsClear');if(!target)return;
        e.preventDefault();e.stopImmediatePropagation();
        var pid=new URLSearchParams(location.search).get('id');if(!pid)return;
        var value=target.id==='fsClear'?null:target.dataset.fs;
        change(function(fixed){return service.setChoice(pid,value,fixed);},'个人选择已保存；不代表符合资格');
      },true);
      global.addEventListener('pageshow',function(){if(!cleared)render();});
      global.addEventListener('focus',function(){if(!cleared)render();});
      if(isIsolated||rehearsal)global.PFServiceV3Isolated={service:function(){return service;},adapter:function(){return adapter;},render:render,exclusive:exclusive,
        get mode(){return sourceMode;},get active(){return active;}};
  }
  async function finishConnected(){
      if(!connect())return;
      if(!await ensureActivation())return;
      injectShell(); await render();activatePage();
  }
  async function finishStart(){
      if(!await prepareMigration())return;
      await finishConnected();
  }
  async function start() {
    try {
      if(gateMode==='v3-blocked'){migrationError({error:{code:global.PF_V3_GATE_ERROR||'ACTIVATION_BLOCKED'}});return;}
       await modules();if(await showPendingOperation())return;
       if(preferenceError){migrationError({error:{code:'STORAGE_UNAVAILABLE'}});return;}
       var chosen=localStorage.getItem(preferenceKey);if(chosen==='local'||chosen==='session')sourceMode=chosen;
      if(!await prepareIdentity())return;
      await finishStart();
    } catch (_) { console.error('Isolated schema 3 page wiring failed'); }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
