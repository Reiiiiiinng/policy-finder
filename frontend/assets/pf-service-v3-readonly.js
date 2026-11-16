/* Read-only service projection for auxiliary pages. Never falls back to v1 in
 * schema 3 or recovery mode; matching form input remains a separate flow. */
(function(global){'use strict';
  function active(){return global.PF_V3_MODE&&global.PF_V3_MODE!=='v1';}
  function failure(code){return {ok:false,error:{code:code}};}
  function snapshot(){
    if(!active())return null;
    if(global.PF_V3_MODE==='v3-blocked'||global.PF_V3_MODE==='v3-recovery')return failure(global.PF_V3_GATE_ERROR||'RECOVERY_REQUIRED');
    if(!global.PFServiceState||!global.PFServiceStorage||!global.PFServiceIdentity||!global.PFServices)return failure('SERVICE_UNAVAILABLE');
    try{
      if(localStorage.getItem('pf_service_v3_operation_b')!==null)return failure('RECOVERY_REQUIRED');
      const isolated=global.PF_V3_MODE==='v3-isolated',config=global.__PF_V3_ISOLATED_TEST__||{};
      const preference=isolated?'pf_v3_isolated_choice':'pf_v3_storage_choice_b';
      const chosen=localStorage.getItem(preference);
      const mode=chosen==='local'||chosen==='session'?chosen:config.storageKind==='local'?'local':'session';
      const adapter=global.PFServiceStorage.createAdapter(mode==='local'?localStorage:sessionStorage);
      const state=adapter.readState3();if(!state.ok)return state;
      let identity;
      if(isolated&&config.householdId&&config.beneficiaryId&&config.actorId)
        identity={householdId:config.householdId,beneficiaryId:config.beneficiaryId,actingActorId:config.actorId};
      else{
        const manager=global.PFServiceIdentity.createManager(mode==='local'?localStorage:sessionStorage);
        const pointer=manager.read();if(!pointer.ok)return pointer;
        const resolved=global.PFServiceIdentity.resolve(pointer.data,state.data);if(!resolved.ok)return resolved;
        identity={householdId:pointer.data.householdId,beneficiaryId:pointer.data.beneficiaryId,actingActorId:pointer.data.actorId};
      }
      const service=global.PFServices.createV3Service({adapter,currentIdentity:function(){return identity;},writePermit:function(){return false;}});
      const list=service.listPolicies(identity);if(!list.ok)return list;
      const progress=service.progress(identity);if(!progress.ok)return progress;
      const beneficiary=state.data.beneficiaries.find(x=>x.householdId===identity.householdId&&x.beneficiaryId===identity.beneficiaryId);
      const actor=state.data.actors.find(x=>x.actorId===identity.actingActorId);
      const household=state.data.households.find(x=>x.householdId===identity.householdId);
      const historyCount=state.data.events.filter(x=>x.householdId===identity.householdId&&x.beneficiaryId===identity.beneficiaryId).length;
      return {ok:true,data:{identity,household,beneficiary,actor,members:state.data.beneficiaries.filter(x=>x.householdId===identity.householdId),policies:list.data,progress:progress.data,historyCount},revision:state.revision};
    }catch(_){return failure('STORAGE_UNAVAILABLE');}
  }
  global.PFV3ReadOnly=Object.freeze({active,snapshot});
})(window);
