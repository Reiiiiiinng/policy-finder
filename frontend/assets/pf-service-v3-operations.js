/* Browser-only, injected Storage coordinator. Journal metadata contains hashes,
 * never a copy of personal records. Browser storage is not cross-area atomic. */
(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.PFServiceV3Operations=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const JOURNAL_KEY='pf_service_v3_operation_b',TOMBSTONE_KEY='pf_service_v3_cleared_b';
  const ok=data=>({ok:true,data}),bad=(code,message)=>({ok:false,error:{code,message}});
  const zones=['session','local'];
  function createCoordinator(session,local,options){
    const stores={session,local},keys=options.keys,preferenceKey=options.preferenceKey;
    const uuid=options.idFactory,hash=options.hash;
    const get=(zone,key)=>stores[zone].getItem(key);
    const put=(zone,key,value)=>{stores[zone].setItem(key,value);if(get(zone,key)!==value)throw Error('READBACK_FAILED');};
    const del=(zone,key)=>{stores[zone].removeItem(key);if(get(zone,key)!==null)throw Error('READBACK_FAILED');};
    async function checksum(value){return hash(value);}
    const projectKey=key=>[keys.state,keys.identity,keys.activation,keys.globalGate,keys.backup,keys.oldRecords,keys.oldPrep,keys.oldFavorites,preferenceKey].includes(key)||options.oldPrefixes.some(p=>key.startsWith(p));
    function journal(){const raw=get('local',JOURNAL_KEY);if(raw===null)return null;let x;try{x=JSON.parse(raw);}catch(_){throw Error('CORRUPT_JOURNAL');}
      if(!x||x.version!==1||!['transfer','clear'].includes(x.type)||!zones.includes(x.source)||!Array.isArray(x.entries)||typeof x.id!=='string'||typeof x.stage!=='string')throw Error('CORRUPT_JOURNAL');
      if(x.type==='transfer'&&!zones.includes(x.target))throw Error('CORRUPT_JOURNAL');
      const seen=new Set();for(const e of x.entries){if(!e||!zones.includes(e.zone)||typeof e.key!=='string'||!projectKey(e.key)||typeof e.digest!=='string'||!/^[0-9a-f]{64}$/.test(e.digest))throw Error('CORRUPT_JOURNAL');if(x.type==='transfer'&&(e.zone!==x.source||![keys.state,keys.identity,keys.activation].includes(e.key)))throw Error('CORRUPT_JOURNAL');const pair=e.zone+'\u0000'+e.key;if(seen.has(pair))throw Error('CORRUPT_JOURNAL');seen.add(pair);}
      return x;
    }
    function save(x){put('local',JOURNAL_KEY,JSON.stringify(x));}
    function finish(){del('local',JOURNAL_KEY);}
    async function matches(zone,entry){const value=get(zone,entry.key);return value!==null&&await checksum(value)===entry.digest;}
    async function transfer(source,target){try{
      if(!zones.includes(source)||!zones.includes(target)||source===target)return bad('INVALID_ARGUMENT','Invalid transfer zones');
      if(journal())return bad('RECOVERY_REQUIRED','Unfinished operation exists');
      if(source==='local'&&target==='session')return bad('LOCAL_TO_SESSION_DISABLED','Persistent records cannot be moved directly into a tab session');
      const raw=get(source,keys.state);if(raw===null||!options.validateState(raw))return bad('INVALID_SOURCE','Source state is missing or invalid');
      const pointer=get(source,keys.identity);if((options.requireIdentity&&pointer===null)||(pointer!==null&&!options.validateIdentity(pointer,raw)))return bad('INVALID_SOURCE','Source identity is missing or invalid');
      const transferKeys=[keys.state];if(pointer!==null)transferKeys.push(keys.identity);if(get(source,keys.activation)!==null)transferKeys.push(keys.activation);
      const entries=[],values=new Map();for(const key of transferKeys){if(get(target,key)!==null)return bad('DESTINATION_NOT_EMPTY','Target has an application state');const value=get(source,key);if(value===null)return bad('INVALID_SOURCE','Source changed before transfer');values.set(key,value);entries.push({zone:source,key,digest:await checksum(value)});}
      const x={version:1,id:uuid(),type:'transfer',source,target,entries,stage:'prepared',status:'pending'};save(x);
      x.stage='copying';save(x);
      for(const e of entries){if(!await matches(source,e))throw Error('SOURCE_CHANGED');put(target,e.key,values.get(e.key));}
      for(const e of entries)if(!await matches(target,e))throw Error('READBACK_FAILED');
      x.stage='target_verified';save(x);
      x.stage='source_removing';save(x);
      for(const e of entries)del(source,e.key);
      x.stage='finalizing';save(x);
      put('local',preferenceKey,target);
      x.status='completed';save(x);finish();return ok({id:x.id,source,target});
    }catch(e){return bad('RECOVERY_REQUIRED',e.message||'Transfer interrupted');}}
    async function inspect(){try{const x=journal();if(!x)return ok(null);const states=[];for(const e of x.entries){const src=get(e.zone,e.key),other=x.type==='transfer'?get(x.target,e.key):null;states.push({zone:e.zone,key:e.key,source:src===null?'missing':await checksum(src)===e.digest?'valid':'changed',target:x.type==='transfer'?(other===null?'missing':await checksum(other)===e.digest?'valid':'changed'):null});}return ok({operation:x,states});}catch(e){return bad('RECOVERY_REQUIRED',e.message||'Journal cannot be read');}}
    function recoveryCopies(){try{const x=journal();if(!x)return bad('INVALID_ARGUMENT','No unfinished operation');return ok({operationId:x.id,type:x.type,stage:x.stage,copies:x.entries.map(e=>({zone:e.zone,key:e.key,source:get(e.zone,e.key),target:x.type==='transfer'?get(x.target,e.key):null}))});}catch(e){return bad('RECOVERY_REQUIRED',e.message||'Cannot read recovery copies');}}
    async function recoverTransfer(choice){try{const x=journal();if(!x||x.type!=='transfer'||!['continue','rollback'].includes(choice))return bad('INVALID_ARGUMENT','No matching transfer recovery');
      if(x.source==='local'&&x.target==='session'&&choice==='continue')return bad('LOCAL_TO_SESSION_DISABLED','Historical downgrade cannot be completed; retain the local source or seek manual recovery');
      const check=await inspect();if(!check.ok)return check;
      if(check.data.states.some(s=>s.source==='changed'||s.target==='changed'))return bad('TRANSFER_UNCERTAIN','Stored values differ from the operation snapshot');
      const sourceComplete=check.data.states.every(s=>s.source==='valid');
      if(choice==='rollback'){
        if(!sourceComplete)return bad('TRANSFER_UNCERTAIN','Original source is incomplete');
        x.stage='rolling_back';save(x);for(const e of x.entries)if(get(x.target,e.key)!==null)del(x.target,e.key);
        put('local',preferenceKey,x.source);
      }else{
        if(!sourceComplete&&!check.data.states.every(s=>s.target==='valid'))return bad('TRANSFER_UNCERTAIN','Neither area has a complete state');
        x.stage='resuming';save(x);
        if(sourceComplete)for(const e of x.entries)if(get(x.target,e.key)===null)put(x.target,e.key,get(x.source,e.key));
        for(const e of x.entries)if(!await matches(x.target,e))return bad('TRANSFER_UNCERTAIN','Target readback failed');
        for(const e of x.entries)if(get(x.source,e.key)!==null)del(x.source,e.key);
        put('local',preferenceKey,x.target);
      }
      x.status=choice==='rollback'?'rolled_back':'completed';save(x);finish();return ok({id:x.id,status:x.status});
    }catch(e){return bad('RECOVERY_REQUIRED',e.message||'Recovery failed');}}
    function known(zone,full){const store=stores[zone],out=[];for(let i=0;i<store.length;i++){const key=store.key(i);if(key===JOURNAL_KEY||key===TOMBSTONE_KEY)continue;
      if([keys.state,keys.identity,keys.activation,keys.backup,preferenceKey].includes(key)||(full&&(key===keys.globalGate||key===keys.oldRecords||key===keys.oldPrep||key===keys.oldFavorites||options.oldPrefixes.some(p=>key.startsWith(p)))))out.push(key);}
      return [...new Set(out)];}
    function previewClear(source,full){try{if(journal())return bad('RECOVERY_REQUIRED','Unfinished operation exists');return ok((full?zones:[source]).map(zone=>({zone,keys:known(zone,full)})));}catch(e){return bad('STORAGE_UNAVAILABLE',e.message||'Cannot inspect clear scope');}}
    async function clear(source,full){try{if(!zones.includes(source))return bad('INVALID_ARGUMENT','Invalid clear zone');if(journal())return bad('RECOVERY_REQUIRED','Unfinished operation exists');
      const affected=full?zones:[source],entries=[];for(const zone of affected)for(const key of known(zone,full)){const value=get(zone,key);if(value!==null)entries.push({zone,key,digest:await checksum(value)});}
      const x={version:1,id:uuid(),type:'clear',source,target:null,scope:full?'all_project_records':'current_schema3',entries,stage:'prepared',status:'pending'};save(x);
      put('local',TOMBSTONE_KEY,JSON.stringify({version:1,id:x.id,preventLegacyImport:true}));
      x.stage='deleting';save(x);return await recoverClear();
    }catch(e){return bad('RECOVERY_REQUIRED',e.message||'Clear interrupted');}}
    async function recoverClear(){try{const x=journal();if(!x||x.type!=='clear')return bad('INVALID_ARGUMENT','No clear operation');
      const tomb=get('local',TOMBSTONE_KEY);if(!tomb||JSON.parse(tomb).id!==x.id)put('local',TOMBSTONE_KEY,JSON.stringify({version:1,id:x.id,preventLegacyImport:true}));
      const check=await inspect();if(!check.ok)return check;if(check.data.states.some(s=>s.source==='changed'))return bad('CLEAR_UNCERTAIN','A remaining value changed since confirmation');
      x.stage='deleting';save(x);for(const e of x.entries)if(get(e.zone,e.key)!==null)del(e.zone,e.key);
      x.stage='verifying';save(x);for(const e of x.entries)if(get(e.zone,e.key)!==null)return bad('RECOVERY_REQUIRED','Clear readback failed');
      if(x.scope==='all_project_records'&&zones.some(zone=>known(zone,true).length>0))return bad('CLEAR_UNCERTAIN','New project keys appeared during clear');
      x.status='completed';save(x);finish();return ok({id:x.id,scope:x.scope,deleted:x.entries.length});
    }catch(e){return bad('RECOVERY_REQUIRED',e.message||'Clear recovery failed');}}
    function cleared(){try{const raw=get('local',TOMBSTONE_KEY);if(raw===null)return ok(false);const x=JSON.parse(raw);return x&&x.version===1&&x.preventLegacyImport===true?ok(true):bad('RECOVERY_REQUIRED','Clear marker is corrupt');}catch(_){return bad('RECOVERY_REQUIRED','Clear marker cannot be read');}}
    return Object.freeze({transfer,inspect,recoveryCopies,recoverTransfer,previewClear,clear,recoverClear,cleared});
  }
  return Object.freeze({JOURNAL_KEY,TOMBSTONE_KEY,createCoordinator});
});
