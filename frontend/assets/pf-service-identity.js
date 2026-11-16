/* Stable schema 3 identity pointer. Policy records remain authoritative in schema 3.
 * No names or identity numbers are required; this module never reads v1 labels. */
(function (root,factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports=factory();
  else root.PFServiceIdentity=factory();
})(typeof globalThis !== 'undefined' ? globalThis : this,function(){
  'use strict';
  const KEY='pf_service_identity_v3_b';
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const fail=(code,message)=>({ok:false,error:{code,message}});
  const label=(x,max)=>typeof x==='string'&&x.length<=max&&x.trim().length>0;
  function validate(x){
    if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).sort().join('|')!==
      ['actorId','actorLabel','actorRole','beneficiaryId','householdId','householdLabel','relationLabel','schemaVersion'].sort().join('|')||x.schemaVersion!==1)
      return fail('INVALID_IDENTITY','Identity pointer is damaged or incompatible');
    if(![x.householdId,x.beneficiaryId,x.actorId].every(v=>typeof v==='string'&&UUID.test(v))||
       !label(x.householdLabel,80)||!label(x.relationLabel,40)||!label(x.actorLabel,80)||!['self','helper'].includes(x.actorRole))
      return fail('INVALID_IDENTITY','Identity pointer contains invalid fields');
    return {ok:true,data:{...x}};
  }
  function createManager(storage,idFactory){
    function raw(){try{return {ok:true,data:storage.getItem(KEY)};}catch(_){return fail('IDENTITY_STORAGE_UNAVAILABLE','Cannot read identity pointer');}}
    function read(){const r=raw();if(!r.ok)return r;if(r.data===null)return fail('IDENTITY_REQUIRED','No stable identity exists');
      try{return validate(JSON.parse(r.data));}catch(_){return fail('INVALID_IDENTITY','Identity pointer is damaged');}}
    function write(value,expectedRaw){
      const valid=validate(value);if(!valid.ok)return valid;
      const before=raw();if(!before.ok)return before;
      if(before.data!==expectedRaw)return fail('CONFLICT','Identity pointer changed');
      const serialized=JSON.stringify(valid.data);
      try{storage.setItem(KEY,serialized);}catch(_){return fail('IDENTITY_WRITE_FAILED','Identity pointer was not saved');}
      const after=raw();if(!after.ok)return fail('IDENTITY_READBACK_FAILED','Identity write outcome needs review');
      if(after.data!==serialized)return fail('IDENTITY_READBACK_FAILED','Identity pointer did not read back');
      return {ok:true,data:valid.data};
    }
    function initialize(fields){
      const existing=read();if(existing.ok||existing.error.code!=='IDENTITY_REQUIRED')return existing;
      if(!fields||!label(fields.householdLabel,80)||!label(fields.relationLabel,40)||!label(fields.actorLabel,80)||!['self','helper'].includes(fields.actorRole))
        return fail('INVALID_ARGUMENT','Household, beneficiary and helper labels are required');
      if(typeof idFactory!=='function')return fail('ID_GENERATOR_UNAVAILABLE','Secure ID generator is required');
      let ids;try{ids=[idFactory(),idFactory(),idFactory()];}catch(_){return fail('ID_GENERATOR_UNAVAILABLE','Secure ID generator failed');}
      if(!ids.every(v=>typeof v==='string'&&UUID.test(v))||new Set(ids).size!==3)return fail('INVALID_ID','Identity IDs must be distinct UUIDs');
      return write({schemaVersion:1,householdId:ids[0],beneficiaryId:ids[1],actorId:ids[2],householdLabel:fields.householdLabel,
        relationLabel:fields.relationLabel,actorLabel:fields.actorLabel,actorRole:fields.actorRole},null);
    }
    function switchBeneficiary(id,state){
      const current=read();if(!current.ok)return current;
      if(!state||!Array.isArray(state.actors)||!state.actors.some(a=>a.actorId===current.data.actorId&&Array.isArray(a.householdIds)&&a.householdIds.includes(current.data.householdId)))
        return fail('ACTOR_HOUSEHOLD_DENIED','Current helper is not linked to this household');
      if(!state||!Array.isArray(state.beneficiaries)||!state.beneficiaries.some(b=>b.householdId===current.data.householdId&&b.beneficiaryId===id))
        return fail('UNKNOWN_BENEFICIARY','Target member is not in this household');
      const before=raw();if(!before.ok)return before;
      return write({...current.data,beneficiaryId:id},before.data);
    }
    function switchHousehold(householdId,beneficiaryId,state){
      const current=read();if(!current.ok)return current;
      const household=state&&Array.isArray(state.households)&&state.households.find(h=>h.householdId===householdId);
      const beneficiary=state&&Array.isArray(state.beneficiaries)&&state.beneficiaries.find(b=>b.householdId===householdId&&b.beneficiaryId===beneficiaryId);
      const actor=state&&Array.isArray(state.actors)&&state.actors.find(a=>a.actorId===current.data.actorId&&Array.isArray(a.householdIds)&&a.householdIds.includes(householdId));
      if(!household||!beneficiary||!actor)return fail('ACTOR_HOUSEHOLD_DENIED','Current helper is not linked to the selected household and member');
      const before=raw();if(!before.ok)return before;
      return write({...current.data,householdId,beneficiaryId,householdLabel:household.displayLabel,relationLabel:beneficiary.relationLabel},before.data);
    }
    function switchActor(id,state){
      const current=read();if(!current.ok)return current;
      const actor=state&&Array.isArray(state.actors)&&state.actors.find(a=>a.actorId===id);
       if(!actor)return fail('UNKNOWN_ACTOR','Target helper does not exist');
       if(!Array.isArray(actor.householdIds)||!actor.householdIds.includes(current.data.householdId))
         return fail('ACTOR_HOUSEHOLD_DENIED','Target helper is not linked to this household');
      const before=raw();if(!before.ok)return before;
      return write({...current.data,actorId:id,actorLabel:actor.displayLabel,actorRole:actor.role},before.data);
    }
    return Object.freeze({read,initialize,switchBeneficiary,switchHousehold,switchActor});
  }
  function seed(pointer){const r=validate(pointer);if(!r.ok)return r;const x=r.data;return {ok:true,data:{
    householdId:x.householdId,beneficiaryId:x.beneficiaryId,actorId:x.actorId,
    households:[{householdId:x.householdId,displayLabel:x.householdLabel}],
    beneficiaries:[{householdId:x.householdId,beneficiaryId:x.beneficiaryId,displayLabel:'',relationLabel:x.relationLabel}],
    actors:[{actorId:x.actorId,displayLabel:x.actorLabel,role:x.actorRole,householdIds:[x.householdId]}]}};}
  function resolve(pointer,state){const r=validate(pointer);if(!r.ok)return r;const x=r.data;
    if(!state||!Array.isArray(state.households)||!Array.isArray(state.beneficiaries)||!Array.isArray(state.actors)||
       !state.households.some(h=>h.householdId===x.householdId)||
       !state.beneficiaries.some(b=>b.householdId===x.householdId&&b.beneficiaryId===x.beneficiaryId)||
        !state.actors.some(a=>a.actorId===x.actorId&&Array.isArray(a.householdIds)&&a.householdIds.includes(x.householdId)))
       return fail('IDENTITY_RECOVERY_REQUIRED','Identity pointer does not match an authorized household');
    return {ok:true,data:{householdId:x.householdId,beneficiaryId:x.beneficiaryId,actorId:x.actorId,
      households:state.households,beneficiaries:state.beneficiaries,actors:state.actors}};
  }
  return Object.freeze({KEY,validate,createManager,seed,resolve});
});
