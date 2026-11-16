/* B v2 pure data contract. Not loaded by any page; no persistence or environment reads.
 * API: validateState/Record/Choice/History, parseState, migrateLegacy, reduce.
 * All successful data are detached JSON copies. Legacy snapshot uses explicit
 * read outcomes: {records:{ok,raw}, marks:{ok,entries:[{key,value}]}}.
 * Standalone record/choice/history validation returns revision:null (no state).
 * Reducer actions require type, benKey, pid, expectedRevision; timestamps are
 * supplied as now for operations changing records. Identity is the field pair.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PFServiceState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STATES = ['pending', 'checking', 'needinfo', 'ready', 'done'];
  const CHOICES = ['verify', 'later', 'notmatch'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = v => JSON.parse(JSON.stringify(v));
  function fault(code, message, path) { throw { contractError: true, code, message, path }; }
  function need(test, path, message) { if (!test) fault('INVALID_ARGUMENT', message, path); }
  function object(v, path) { need(v !== null && typeof v === 'object' && !Array.isArray(v), path, 'Expected object'); }
  function string(v, path, nonempty) { need(typeof v === 'string' && (!nonempty || v.length > 0), path, 'Expected string' + (nonempty ? ' (nonempty)' : '')); }
  function time(v, path) { need(Number.isSafeInteger(v) && v >= 0, path, 'Expected nonnegative safe integer timestamp'); }
  function exact(v, keys, path) { for (const k of Object.keys(v)) need(keys.includes(k), path + '.' + k, 'Unknown field'); }
  function json(v, path, ancestors = new Set()) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { need(Number.isFinite(v), path, 'Nonfinite JSON number'); return; }
    need(typeof v === 'object', path, 'Not a JSON value');
    need(!ancestors.has(v), path, 'Cyclic JSON value');
    const proto = Object.getPrototypeOf(v);
    need(Array.isArray(v) || proto === Object.prototype || proto === null, path, 'Not a plain JSON object');
    need(Object.getOwnPropertySymbols(v).length === 0, path, 'Symbol keys are not JSON');
    ancestors.add(v);
    if (Array.isArray(v)) {
      need(Object.keys(v).length === v.length && Object.getOwnPropertyNames(v).length === v.length + 1, path, 'Sparse or extended array');
      for (let i = 0; i < v.length; i++) { need(own(v, i), path, 'Sparse array'); const d = Object.getOwnPropertyDescriptor(v, String(i)); need(d && d.enumerable && own(d, 'value'), path, 'Accessor/hidden item is not JSON'); json(d.value, path + '[' + i + ']', ancestors); }
    } else for (const k of Object.getOwnPropertyNames(v)) {
      const d = Object.getOwnPropertyDescriptor(v, k);
      need(d.enumerable && own(d, 'value'), path + '.' + k, 'Accessor/hidden field is not JSON');
      json(d.value, path + '.' + k, ancestors);
    }
    ancestors.delete(v);
  }
  function history(v, p) {
    object(v, p); time(v.ts, p + '.ts');
    need(STATES.includes(v.status), p + '.status', 'Unknown status');
    string(v.note, p + '.note'); string(v.next, p + '.next');
  }
  function record(v, p) {
    object(v, p);
    for (const k of ['rid', 'pid', 'benKey']) string(v[k], p + '.' + k, true);
    for (const k of ['ben', 'pname', 'dept', 'url', 'note', 'next']) string(v[k], p + '.' + k);
    need(STATES.includes(v.status), p + '.status', 'Unknown status');
    need(typeof v.listRemoved === 'boolean', p + '.listRemoved', 'Expected boolean');
    time(v.createdAt, p + '.createdAt'); time(v.updatedAt, p + '.updatedAt');
    need(Array.isArray(v.history), p + '.history', 'Expected history array');
    v.history.forEach((h, i) => history(h, p + '.history[' + i + ']'));
  }
  function choice(v, p) {
    object(v, p); exact(v, ['pid', 'benKey', 'value'], p);
    string(v.pid, p + '.pid', true); string(v.benKey, p + '.benKey', true);
    need(CHOICES.includes(v.value), p + '.value', 'Unknown choice');
  }
  function unique(arr, p) {
    const seen = new Set();
    arr.forEach((v, i) => { const id = JSON.stringify([v.benKey, v.pid]); if (seen.has(id)) fault('DUPLICATE_IDENTITY', 'Duplicate beneficiary/policy pair', p + '[' + i + ']'); seen.add(id); });
  }
  function state(v) {
    json(v, '$'); object(v, '$');
    if (v.schemaVersion !== 2) fault('UNSUPPORTED_SCHEMA', 'Expected schemaVersion 2', '$.schemaVersion');
    exact(v, ['schemaVersion', 'revision', 'namespace', 'records', 'choices'], '$');
    need(Number.isSafeInteger(v.revision) && v.revision >= 0, '$.revision', 'Invalid revision');
    need(v.namespace === 'b', '$.namespace', 'Expected B namespace');
    need(Array.isArray(v.records) && Array.isArray(v.choices), '$', 'Expected records and choices arrays');
    v.records.forEach((r, i) => record(r, '$.records[' + i + ']'));
    v.choices.forEach((c, i) => choice(c, '$.choices[' + i + ']'));
    unique(v.records, '$.records'); unique(v.choices, '$.choices');
  }
  function result(data, revision = null, changed = false) { return { ok: true, data: clone(data), revision, changed }; }
  function guarded(fn, revision) {
    try { return fn(); } catch (e) {
      if (!e || !e.contractError) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Unreadable input' } };
      const error = { code: e.code, message: e.message }; if (e.path !== undefined) error.path = e.path;
      const out = { ok: false, error }; if (Number.isSafeInteger(revision) && revision >= 0) out.revision = revision; return out;
    }
  }
  function validateState(v) { return guarded(() => { state(v); return result(v, v.revision); }); }
  function validateRecord(v) { return guarded(() => { json(v, '$'); record(v, '$'); return result(v); }); }
  function validateChoice(v) { return guarded(() => { json(v, '$'); choice(v, '$'); return result(v); }); }
  function validateHistory(v) { return guarded(() => { json(v, '$'); history(v, '$'); return result(v); }); }
  function parse(raw, path) {
    string(raw, path); try { return JSON.parse(raw); } catch (_) { fault('INVALID_JSON', 'Malformed JSON', path); }
  }
  function parseState(raw) { return guarded(() => { const v = parse(raw, '$'); state(v); return result(v, v.revision); }); }
  function migrateLegacy(snapshot) {
    return guarded(() => {
      json(snapshot, '$'); object(snapshot, '$'); exact(snapshot, ['records', 'marks'], '$');
      for (const k of ['records', 'marks']) {
        object(snapshot[k], '$.' + k);
        if (snapshot[k].ok !== true) fault('LEGACY_READ_FAILED', 'Legacy snapshot could not be read', '$.' + k);
      }
      exact(snapshot.records, ['ok', 'raw'], '$.records'); exact(snapshot.marks, ['ok', 'entries'], '$.marks');
      const records = snapshot.records.raw === null ? [] : parse(snapshot.records.raw, '$.records.raw');
      need(Array.isArray(records), '$.records.raw', 'Expected legacy array');
      need(Array.isArray(snapshot.marks.entries), '$.marks.entries', 'Expected entries array');
      const choices = [], keys = new Set(), prefix = 'pf_fs_b_';
      snapshot.marks.entries.forEach((entry, i) => {
        const p = '$.marks.entries[' + i + ']'; object(entry, p); exact(entry, ['key', 'value'], p);
        string(entry.key, p + '.key', true); string(entry.value, p + '.value');
        need(entry.key.startsWith(prefix), p + '.key', 'Unexpected legacy prefix');
        if (keys.has(entry.key)) fault('DUPLICATE_IDENTITY', 'Duplicate legacy key', p + '.key'); keys.add(entry.key);
        const suffix = entry.key.slice(prefix.length), parts = suffix.split('@');
        if (parts.length !== 2 || !parts[0] || !parts[1]) fault('AMBIGUOUS_LEGACY_KEY', 'Cannot unambiguously split policy and beneficiary', p + '.key');
        choices.push({ pid: parts[0], benKey: parts[1], value: entry.value });
      });
      const candidate = { schemaVersion: 2, revision: 1, namespace: 'b', records, choices };
      state(candidate); return result(candidate, 1, true);
    });
  }
  function reduce(input, action) {
    return guarded(() => {
      state(input); json(action, '$action'); object(action, '$action');
      const types = ['SET_CHOICE', 'CLEAR_CHOICE', 'SET_SELECTED', 'TOGGLE_SELECTED', 'ENSURE_RECORD', 'UPDATE_RECORD', 'REMOVE_FROM_LIST', 'DELETE_RECORD', 'REJOIN_LIST'];
      need(types.includes(action.type), '$action.type', 'Unknown action');
      const fields = { SET_CHOICE:['value'], CLEAR_CHOICE:[], SET_SELECTED:['on'], TOGGLE_SELECTED:[], ENSURE_RECORD:['metadata'], UPDATE_RECORD:['metadata','status','note','next'], REMOVE_FROM_LIST:[], DELETE_RECORD:[], REJOIN_LIST:[] };
      exact(action, ['type','pid','benKey','expectedRevision','now',...fields[action.type]], '$action');
      string(action.pid, '$action.pid', true); string(action.benKey, '$action.benKey', true);
      need(Number.isSafeInteger(action.expectedRevision) && action.expectedRevision >= 0, '$action.expectedRevision', 'Invalid expected revision');
      if (action.expectedRevision !== input.revision) fault('CONFLICT', 'Revision changed', '$action.expectedRevision');
      if (own(action, 'now')) time(action.now, '$action.now');
      const next = clone(input), match = x => x.pid === action.pid && x.benKey === action.benKey;
      let rec = next.records.find(match);
      const stamp = () => { time(action.now, '$action.now'); return action.now; };
      function setChoice(value) {
        const i = next.choices.findIndex(match);
        if (value === null) { if (i >= 0) next.choices.splice(i, 1); }
        else if (i >= 0) next.choices[i].value = value;
        else next.choices.push({ pid: action.pid, benKey: action.benKey, value });
        if (value === 'verify' && rec && rec.listRemoved) { rec.listRemoved = false; rec.updatedAt = stamp(); }
      }
      function metadata() {
        const m = action.metadata === undefined ? {} : action.metadata;
        object(m, '$action.metadata'); exact(m, ['ben','pname','dept','url'], '$action.metadata');
        for (const k of Object.keys(m)) string(m[k], '$action.metadata.' + k);
        return m;
      }
      function create(m, initialHistory) {
        const now = stamp();
        rec = { rid: action.pid + '|' + action.benKey, pid: action.pid, benKey: action.benKey, ben: m.ben === undefined ? action.benKey : m.ben,
          pname: m.pname || '', dept: m.dept || '', url: m.url || '', status:'pending', note:'', next:'', listRemoved:false, createdAt:now, updatedAt:now,
          history:initialHistory ? [{ ts:now, status:'pending', note:'', next:'' }] : [] };
        next.records.push(rec);
      }
      switch (action.type) {
        case 'SET_CHOICE': need(CHOICES.includes(action.value), '$action.value', 'Unknown choice'); setChoice(action.value); break;
        case 'CLEAR_CHOICE': setChoice(null); break;
        case 'SET_SELECTED': need(typeof action.on === 'boolean', '$action.on', 'Expected boolean'); setChoice(action.on ? 'verify' : null); break;
        case 'TOGGLE_SELECTED': setChoice(next.choices.some(c => match(c) && c.value === 'verify') ? null : 'verify'); break;
        case 'REJOIN_LIST': setChoice('verify'); break;
        case 'ENSURE_RECORD': {
          const m = metadata();
          if (!rec) create(m, true);
          else { let changed = false; for (const k of ['pname','dept','url']) if (!rec[k] && m[k]) { rec[k] = m[k]; changed = true; } if (changed) rec.updatedAt = stamp(); }
          break;
        }
        case 'UPDATE_RECORD': {
          need(STATES.includes(action.status), '$action.status', 'Unknown status'); string(action.note, '$action.note'); string(action.next, '$action.next');
          need(action.note.length <= 300 && action.next.length <= 120, '$action', 'Input exceeds edit length limit');
          const m = metadata(); if (!rec) create(m, false);
          for (const k of ['pname','dept','url']) if (!rec[k] && m[k]) rec[k] = m[k];
          const original = input.records.find(match);
          if (!original || JSON.stringify(rec) !== JSON.stringify(original) || rec.status !== action.status || rec.note !== action.note || rec.next !== action.next || rec.listRemoved) {
            rec.status = action.status; rec.note = action.note; rec.next = action.next; rec.listRemoved = false; rec.updatedAt = stamp();
            rec.history.push({ ts:rec.updatedAt, status:rec.status, note:rec.note, next:rec.next });
          }
          break;
        }
        case 'REMOVE_FROM_LIST': setChoice(null); if (rec && !rec.listRemoved) { rec.listRemoved = true; rec.updatedAt = stamp(); } break;
        case 'DELETE_RECORD': next.records = next.records.filter(r => !match(r)); setChoice(null); break;
      }
      const changed = JSON.stringify(next) !== JSON.stringify(input);
      if (changed) {
        if (input.revision === Number.MAX_SAFE_INTEGER) fault('REVISION_EXHAUSTED', 'Revision exhausted', '$.revision');
        next.revision++;
      }
      state(next); return result(next, next.revision, changed);
    });
  }
  /* Schema 3 is an opt-in contract. The schema 2 API above remains available
   * for its existing callers and regression tests; business pages load neither. */
  const S3 = ['pending','checking','consulted','needinfo','preparing','paused','closed','legacy_done_review'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ID = /^[a-zA-Z0-9._:-]{1,120}$/;
  function ident(v,p) { string(v,p,true); need(UUID.test(v),p,'Expected random UUID v4'); }
  function token(v,p) { string(v,p,true); need(ID.test(v),p,'Invalid identifier'); }
  function textLimit(v,p,max) { string(v,p); need(v.length<=max,p,'Text too long'); }
  function keys(v,required,optional,p) {
    object(v,p); exact(v,required.concat(optional),p);
    required.forEach(k=>need(own(v,k),p+'.'+k,'Missing field'));
  }
  function pair(v,p) { ident(v.householdId,p+'.householdId'); ident(v.beneficiaryId,p+'.beneficiaryId'); token(v.pid,p+'.pid'); }
  function sourceRef(v,p) {
    keys(v,['url','document','locator','version'],[],p);
    for(const k of ['url','document','locator','version']) string(v[k],p+'.'+k,true);
    need(/^https:\/\//.test(v.url),p+'.url','Expected HTTPS official citation');
  }
  function state3(v) {
    json(v,'$'); object(v,'$');
    if(v.schemaVersion!==3) fault('UNSUPPORTED_SCHEMA','Expected schemaVersion 3','$.schemaVersion');
    keys(v,['schemaVersion','revision','namespace','households','beneficiaries','actors','records','choices','events','prepItems','quarantine'],[],'$');
    need(Number.isSafeInteger(v.revision)&&v.revision>=0,'$.revision','Invalid revision');
    need(v.namespace==='b','$.namespace','Expected B namespace');
    for(const k of ['households','beneficiaries','actors','records','choices','events','prepItems','quarantine']) need(Array.isArray(v[k]),'$.'+k,'Expected array');
    const unique3=(arr,key,p)=>{const seen=new Set();arr.forEach((x,i)=>{const id=key(x);need(!seen.has(id),p+'['+i+']','Duplicate identity');seen.add(id);});};
    v.households.forEach((x,i)=>{const p='$.households['+i+']';keys(x,['householdId','displayLabel'],[],p);ident(x.householdId,p+'.householdId');textLimit(x.displayLabel,p+'.displayLabel',80);});
    unique3(v.households,x=>x.householdId,'$.households');
    const hs=new Set(v.households.map(x=>x.householdId));
    v.beneficiaries.forEach((x,i)=>{const p='$.beneficiaries['+i+']';keys(x,['householdId','beneficiaryId','displayLabel','relationLabel'],['legacyBenKey'],p);ident(x.householdId,p+'.householdId');ident(x.beneficiaryId,p+'.beneficiaryId');need(hs.has(x.householdId),p+'.householdId','Unknown household');textLimit(x.displayLabel,p+'.displayLabel',80);textLimit(x.relationLabel,p+'.relationLabel',40);if(own(x,'legacyBenKey'))string(x.legacyBenKey,p+'.legacyBenKey',true);});
    unique3(v.beneficiaries,x=>JSON.stringify([x.householdId,x.beneficiaryId]),'$.beneficiaries');
    const bs=new Set(v.beneficiaries.map(x=>JSON.stringify([x.householdId,x.beneficiaryId])));
    v.actors.forEach((x,i)=>{const p='$.actors['+i+']';keys(x,['actorId','displayLabel','role'],['householdIds'],p);ident(x.actorId,p+'.actorId');textLimit(x.displayLabel,p+'.displayLabel',80);need(['self','helper'].includes(x.role),p+'.role','Invalid role');if(own(x,'householdIds')){need(Array.isArray(x.householdIds),p+'.householdIds','Expected household IDs');x.householdIds.forEach((id,j)=>{ident(id,p+'.householdIds['+j+']');need(hs.has(id),p+'.householdIds['+j+']','Unknown household');});need(new Set(x.householdIds).size===x.householdIds.length,p+'.householdIds','Duplicate household');}});
    unique3(v.actors,x=>x.actorId,'$.actors');const as=new Set(v.actors.map(x=>x.actorId));
    const checkPair=(x,p)=>{pair(x,p);need(bs.has(JSON.stringify([x.householdId,x.beneficiaryId])),p,'Unknown beneficiary');};
    v.records.forEach((x,i)=>{const p='$.records['+i+']';keys(x,['householdId','beneficiaryId','pid','status','note','next','listRemoved','createdAt','updatedAt','pname','dept','url'],['legacyStatus'],p);checkPair(x,p);need(S3.includes(x.status),p+'.status','Unknown status');if(own(x,'legacyStatus'))need(STATES.includes(x.legacyStatus),p+'.legacyStatus','Invalid legacy status');textLimit(x.note,p+'.note',300);textLimit(x.next,p+'.next',120);for(const k of ['pname','dept','url'])string(x[k],p+'.'+k);need(typeof x.listRemoved==='boolean',p+'.listRemoved','Expected boolean');time(x.createdAt,p+'.createdAt');time(x.updatedAt,p+'.updatedAt');});
    unique3(v.records,x=>JSON.stringify([x.householdId,x.beneficiaryId,x.pid]),'$.records');
    v.choices.forEach((x,i)=>{const p='$.choices['+i+']';keys(x,['householdId','beneficiaryId','pid','value'],[],p);checkPair(x,p);need(CHOICES.includes(x.value),p+'.value','Invalid choice');});
    unique3(v.choices,x=>JSON.stringify([x.householdId,x.beneficiaryId,x.pid]),'$.choices');
    v.events.forEach((x,i)=>{const p='$.events['+i+']';keys(x,['eventId','commandId','householdId','beneficiaryId','pid','kind','savedAt','provenance','statusAfter','note','next'],['actorId','consultedOn','channel','contactLabel','answerSummary','sourceRefs','correctsEventId','legacyOrdinal','legacyPayload'],p);ident(x.eventId,p+'.eventId');token(x.commandId,p+'.commandId');checkPair(x,p);need(['consultation','status_change','correction','legacy_history','legacy_current_snapshot'].includes(x.kind),p+'.kind','Invalid event kind');time(x.savedAt,p+'.savedAt');need(['user_reported','legacy_import'].includes(x.provenance),p+'.provenance','Invalid provenance');need(S3.includes(x.statusAfter),p+'.statusAfter','Invalid status');textLimit(x.note,p+'.note',300);textLimit(x.next,p+'.next',120);if(own(x,'actorId')){ident(x.actorId,p+'.actorId');need(as.has(x.actorId),p+'.actorId','Unknown actor');}if(own(x,'consultedOn')){string(x.consultedOn,p+'.consultedOn');need(/^\d{4}-\d{2}-\d{2}$/.test(x.consultedOn)&&!Number.isNaN(Date.parse(x.consultedOn+'T00:00:00Z'))&&new Date(x.consultedOn+'T00:00:00Z').toISOString().slice(0,10)===x.consultedOn,p+'.consultedOn','Invalid calendar date');}if(own(x,'channel'))need(['phone','in_person','official_web','other'].includes(x.channel),p+'.channel','Invalid channel');if(own(x,'contactLabel'))textLimit(x.contactLabel,p+'.contactLabel',100);if(own(x,'answerSummary'))textLimit(x.answerSummary,p+'.answerSummary',1000);if(own(x,'sourceRefs')){need(Array.isArray(x.sourceRefs),p+'.sourceRefs','Expected array');x.sourceRefs.forEach((r,j)=>sourceRef(r,p+'.sourceRefs['+j+']'));}if(own(x,'correctsEventId'))ident(x.correctsEventId,p+'.correctsEventId');if(own(x,'legacyOrdinal'))need(Number.isSafeInteger(x.legacyOrdinal)&&x.legacyOrdinal>=0,p+'.legacyOrdinal','Invalid ordinal');});
    unique3(v.events,x=>x.eventId,'$.events');unique3(v.events,x=>x.commandId,'$.events');
    const eventMap=new Map(v.events.map(x=>[x.eventId,x]));v.events.forEach((x,i)=>{
      const p='$.events['+i+']';
      if(x.kind==='consultation')need(x.provenance==='user_reported'&&own(x,'actorId')&&own(x,'answerSummary')&&own(x,'channel')&&own(x,'contactLabel'),p,'Consultation must be a user report with channel');
      if(x.kind==='status_change')need(x.provenance==='user_reported'&&own(x,'actorId'),p,'Status change needs an actor');
      if(x.kind==='correction'){need(x.provenance==='user_reported'&&own(x,'actorId')&&own(x,'answerSummary')&&own(x,'correctsEventId'),p,'Correction needs an actor and target');const old=eventMap.get(x.correctsEventId);need(old&&old.kind==='consultation'&&old.householdId===x.householdId&&old.beneficiaryId===x.beneficiaryId&&old.pid===x.pid,p+'.correctsEventId','Invalid correction target');}
      if(x.kind.startsWith('legacy_'))need(x.provenance==='legacy_import'&&own(x,'legacyPayload'),p+'.provenance','Legacy source and payload required');
    });
    const latest=new Map();v.events.forEach(e=>latest.set(JSON.stringify([e.householdId,e.beneficiaryId,e.pid]),e));
    for(const [key,e] of latest){const r=v.records.find(x=>JSON.stringify([x.householdId,x.beneficiaryId,x.pid])===key);need(r,'$.events','Event without current record');need(r.status===e.statusAfter&&r.note===e.note&&r.next===e.next,'$.records','Current state disagrees with authoritative event');}
    v.records.forEach((r,i)=>{if(r.status==='consulted')need(v.events.some(e=>e.kind==='consultation'&&e.householdId===r.householdId&&e.beneficiaryId===r.beneficiaryId&&e.pid===r.pid),'$.records['+i+'].status','Consulted requires a saved consultation');if(r.status==='legacy_done_review')need(r.legacyStatus==='done','$.records['+i+'].legacyStatus','Legacy done marker required');});
    v.prepItems.forEach((x,i)=>{const p='$.prepItems['+i+']';keys(x,['itemId','householdId','beneficiaryId','pid','kind','text','sourceRef','checked','archived','archivedByUser','sourceNeedsReview','createdAt','updatedAt'],[],p);token(x.itemId,p+'.itemId');checkPair(x,p);need(['official_requirement','confirm_with_office','personal_reminder'].includes(x.kind),p+'.kind','Invalid kind');textLimit(x.text,p+'.text',300);need(x.text.length>0,p+'.text','Empty item');for(const k of ['checked','archived','archivedByUser','sourceNeedsReview'])need(typeof x[k]==='boolean',p+'.'+k,'Expected boolean');need(!x.archivedByUser||x.archived,p+'.archived','User-archived item must remain archived');time(x.createdAt,p+'.createdAt');time(x.updatedAt,p+'.updatedAt');if(x.kind==='official_requirement')sourceRef(x.sourceRef,p+'.sourceRef');else need(x.sourceRef===null,p+'.sourceRef','Only official requirements have citations');});
    unique3(v.prepItems,x=>x.itemId,'$.prepItems');
    v.quarantine.forEach((x,i)=>{const p='$.quarantine['+i+']';keys(x,['legacyBenKey','records','choices','legacyPrep'],[],p);string(x.legacyBenKey,p+'.legacyBenKey',true);need(Array.isArray(x.records)&&Array.isArray(x.choices)&&Array.isArray(x.legacyPrep),p,'Invalid quarantine');});
    unique3(v.quarantine,x=>x.legacyBenKey,'$.quarantine');
  }
  function validateState3(v){return guarded(()=>{state3(v);return result(v,v.revision);});}
  function parseState3(raw){return guarded(()=>{const v=parse(raw,'$');state3(v);return result(v,v.revision);});}
  function generateId(cryptoSource){return guarded(()=>{need(cryptoSource&&typeof cryptoSource.randomUUID==='function','$crypto','Secure randomUUID required');const id=cryptoSource.randomUUID();ident(id,'$id');return result(id);});}
  const oldStatus=s=>({pending:'pending',checking:'checking',needinfo:'needinfo',ready:'preparing',done:'legacy_done_review'})[s];
  function migrateV2ToV3(input,options){return guarded(()=>{
    state(input);keys(options,['households','beneficiaries','actors','legacyMap','idForLegacy'],['legacyPrep'],'$options');
    const out={schemaVersion:3,revision:input.revision+1,namespace:'b',households:clone(options.households),beneficiaries:clone(options.beneficiaries),actors:clone(options.actors),records:[],choices:[],events:[],prepItems:[],quarantine:[]};
    need(Number.isSafeInteger(out.revision),'$.revision','Revision exhausted');
    const map=options.legacyMap, buckets=new Map();object(map,'$options.legacyMap');
    const bucket=key=>{if(!buckets.has(key))buckets.set(key,{legacyBenKey:key,records:[],choices:[],legacyPrep:[]});return buckets.get(key);};
    function target(key){if(!own(map,key))return null;const t=map[key];keys(t,['householdId','beneficiaryId'],[],'$options.legacyMap.'+key);ident(t.householdId,'$target.householdId');ident(t.beneficiaryId,'$target.beneficiaryId');need(out.beneficiaries.some(b=>b.householdId===t.householdId&&b.beneficiaryId===t.beneficiaryId),'$target','Unknown beneficiary');return t;}
    const mapped=new Set();for(const key of Object.keys(map)){const t=target(key),id=JSON.stringify(t);need(!mapped.has(id),'$options.legacyMap','Two legacy identities mapped to one member');mapped.add(id);}
    input.records.forEach((r,ri)=>{const t=target(r.benKey);if(!t){bucket(r.benKey).records.push(clone(r));return;}const pair={householdId:t.householdId,beneficiaryId:t.beneficiaryId,pid:r.pid};out.records.push({...pair,status:oldStatus(r.status),note:r.note,next:r.next,listRemoved:r.listRemoved,createdAt:r.createdAt,updatedAt:r.updatedAt,pname:r.pname,dept:r.dept,url:r.url,legacyStatus:r.status});
      r.history.forEach((h,i)=>{const eventId=optionsId(options,'legacy:'+ri+':'+i);out.events.push({...pair,eventId,commandId:'legacy:'+eventId,kind:'legacy_history',savedAt:h.ts,provenance:'legacy_import',statusAfter:oldStatus(h.status),note:h.note,next:h.next,legacyOrdinal:i,legacyPayload:clone(h)});});
      const last=r.history[r.history.length-1];if(!last||last.status!==r.status||last.note!==r.note||last.next!==r.next){const eventId=optionsId(options,'snapshot:'+ri);out.events.push({...pair,eventId,commandId:'legacy:'+eventId,kind:'legacy_current_snapshot',savedAt:r.updatedAt,provenance:'legacy_import',statusAfter:oldStatus(r.status),note:r.note,next:r.next,legacyPayload:clone(r)});}
    });
    input.choices.forEach(c=>{const t=target(c.benKey);if(!t){bucket(c.benKey).choices.push(clone(c));return;}out.choices.push({householdId:t.householdId,beneficiaryId:t.beneficiaryId,pid:c.pid,value:c.value});});
    if(own(options,'legacyPrep')){need(Array.isArray(options.legacyPrep),'$options.legacyPrep','Expected array');options.legacyPrep.forEach(x=>{keys(x,['legacyBenKey','raw'],[],'$legacyPrep');string(x.legacyBenKey,'$legacyPrep.legacyBenKey',true);string(x.raw,'$legacyPrep.raw');bucket(x.legacyBenKey).legacyPrep.push(clone(x));});}
    out.quarantine=[...buckets.values()];state3(out);return result(out,out.revision,true);
  });}
  function optionsId(options,label){need(options&&typeof options.idForLegacy==='function','$options.idForLegacy','Stable migration ID function required');const id=options.idForLegacy(label);ident(id,'$options.idForLegacy');return id;}
  function migrateLegacyToV3(snapshot,options){const old=migrateLegacy(snapshot);return old.ok?migrateV2ToV3(old.data,options):old;}
  function reduce3(input,action){return guarded(()=>{
    state3(input);json(action,'$action');object(action,'$action');
    const type=action.type;need(['ADD_HOUSEHOLD','ADD_BENEFICIARY','ADD_ACTOR','LINK_ACTOR_HOUSEHOLD','SET_CHOICE','REMOVE_POLICY','REJOIN_POLICY','DELETE_POLICY','SAVE_CONSULTATION','SET_STATUS','CORRECT_CONSULTATION','ADD_PREP_ITEM','UPDATE_PREP_ITEM','SET_PREP_CHECKED','SET_PREP_ARCHIVED','MARK_PREP_SOURCE_STALE','CONFIRM_LEGACY'].includes(type),'$action.type','Unknown command');
    const commandFields={ADD_HOUSEHOLD:['displayLabel','relationLabel'],ADD_BENEFICIARY:['displayLabel','relationLabel'],ADD_ACTOR:['actorId','displayLabel','role'],LINK_ACTOR_HOUSEHOLD:['actorId','explicitConfirmation'],SET_CHOICE:['value'],REMOVE_POLICY:[],REJOIN_POLICY:[],DELETE_POLICY:[],SAVE_CONSULTATION:['eventId','commandId','actorId','consultedOn','channel','contactLabel','answerSummary','statusAfter','note','next','sourceRefs'],SET_STATUS:['eventId','commandId','actorId','statusAfter','note','next'],CORRECT_CONSULTATION:['eventId','commandId','actorId','correctsEventId','answerSummary'],ADD_PREP_ITEM:['item'],UPDATE_PREP_ITEM:['itemId','kind','text','sourceRef'],SET_PREP_CHECKED:['itemId','checked'],SET_PREP_ARCHIVED:['itemId','archived'],MARK_PREP_SOURCE_STALE:['itemId'],CONFIRM_LEGACY:['legacyBenKey','eventIds']};
    exact(action,['type','expectedRevision','now','householdId','beneficiaryId','pid','actingActorId',...commandFields[type]],'$action');
    ident(action.actingActorId,'$action.actingActorId');
    if(type!=='ADD_HOUSEHOLD'&&type!=='LINK_ACTOR_HOUSEHOLD')
      need(input.actors.some(x=>x.actorId===action.actingActorId&&Array.isArray(x.householdIds)&&x.householdIds.includes(action.householdId)),'$action.actingActorId','Actor is not linked to this household');
    if(['SAVE_CONSULTATION','SET_STATUS','CORRECT_CONSULTATION'].includes(type))
      need(action.actorId===action.actingActorId,'$action.actorId','Event actor must be the active actor');
    need(Number.isSafeInteger(action.expectedRevision)&&action.expectedRevision>=0,'$action.expectedRevision','Invalid revision');
    if(action.commandId){const prior=input.events.find(e=>e.commandId===action.commandId);if(prior){
      need(prior.eventId===action.eventId&&prior.householdId===action.householdId&&prior.beneficiaryId===action.beneficiaryId&&prior.pid===action.pid,'$action.commandId','Idempotency key reused for another event');
      const sameContent=prior.kind==='consultation'&&type==='SAVE_CONSULTATION'
        ? prior.actorId===action.actorId&&prior.answerSummary===action.answerSummary&&prior.statusAfter===(action.statusAfter||'consulted')&&prior.note===action.note&&prior.next===action.next&&prior.channel===action.channel&&prior.contactLabel===action.contactLabel&&prior.consultedOn===(action.consultedOn||undefined)&&JSON.stringify(prior.sourceRefs||[])===JSON.stringify(action.sourceRefs||[])
        : prior.kind==='status_change'&&type==='SET_STATUS'
          ? prior.actorId===action.actorId&&prior.statusAfter===action.statusAfter&&prior.note===action.note&&prior.next===action.next
          : prior.kind==='correction'&&type==='CORRECT_CONSULTATION'
            ? prior.actorId===action.actorId&&prior.answerSummary===action.answerSummary&&prior.correctsEventId===action.correctsEventId
            : false;
      need(sameContent,'$action.commandId','Idempotency key reused with different content');
      return result(input,input.revision,false);
    }}
    if(action.expectedRevision!==input.revision)fault('CONFLICT','Revision changed','$action.expectedRevision');
    const next=clone(input),now=action.now;time(now,'$action.now');
    const pairObj={householdId:action.householdId,beneficiaryId:action.beneficiaryId,pid:action.pid};
    const pairKey=x=>JSON.stringify([x.householdId,x.beneficiaryId,x.pid]);
    const same=x=>pairKey(x)===pairKey(pairObj);
    const authorized=()=>{ident(action.actingActorId,'$action.actingActorId');need(next.actors.some(x=>x.actorId===action.actingActorId&&Array.isArray(x.householdIds)&&x.householdIds.includes(action.householdId)),'$action.actingActorId','Actor is not linked to this household');};
    const actor=()=>{ident(action.actorId,'$action.actorId');need(action.actorId===action.actingActorId,'$action.actorId','Event actor must be the active actor');authorized();};
    const member=()=>{pair(pairObj,'$action');need(next.beneficiaries.some(x=>x.householdId===action.householdId&&x.beneficiaryId===action.beneficiaryId),'$action','Unknown beneficiary');};
    const rec=()=>next.records.find(same);
    const ensure=()=>{let r=rec();if(!r){r={...pairObj,status:'pending',note:'',next:'',listRemoved:false,createdAt:now,updatedAt:now,pname:'',dept:'',url:''};next.records.push(r);}return r;};
    const event=(kind,status,note,nextAction,extra={})=>{ident(action.eventId,'$action.eventId');token(action.commandId,'$action.commandId');actor();need(!next.events.some(e=>e.eventId===action.eventId),'$action.eventId','Duplicate event');next.events.push({...pairObj,eventId:action.eventId,commandId:action.commandId,kind,savedAt:now,provenance:'user_reported',statusAfter:status,note,next:nextAction,actorId:action.actorId,...extra});};
    const transition=(old,target,isConsult)=>{need(S3.includes(target)&&target!=='legacy_done_review','$action.statusAfter','Invalid target');if(target==='consulted')need(isConsult,'$action.statusAfter','Consulted requires a consultation event');if(['paused','closed'].includes(old))need(['pending','checking','preparing'].includes(target)||isConsult,'$action.statusAfter','Reopen explicitly');if(old==='preparing')need(target!=='pending','$action.statusAfter','Invalid transition');};
    if(type==='ADD_HOUSEHOLD'){ident(action.householdId,'$action.householdId');ident(action.beneficiaryId,'$action.beneficiaryId');textLimit(action.displayLabel,'$action.displayLabel',80);textLimit(action.relationLabel,'$action.relationLabel',40);need(action.displayLabel.length>0&&action.relationLabel.length>0,'$action','Household and member labels required');need(!next.households.some(x=>x.householdId===action.householdId),'$action.householdId','Duplicate household');const owner=next.actors.find(x=>x.actorId===action.actingActorId&&Array.isArray(x.householdIds)&&x.householdIds.length);need(owner,'$action.actingActorId','Existing linked actor required');next.households.push({householdId:action.householdId,displayLabel:action.displayLabel});next.beneficiaries.push({householdId:action.householdId,beneficiaryId:action.beneficiaryId,displayLabel:'',relationLabel:action.relationLabel});owner.householdIds.push(action.householdId);}
    else if(type==='ADD_BENEFICIARY'){authorized();ident(action.beneficiaryId,'$action.beneficiaryId');need(next.households.some(x=>x.householdId===action.householdId),'$action.householdId','Unknown household');textLimit(action.displayLabel,'$action.displayLabel',80);textLimit(action.relationLabel,'$action.relationLabel',40);need(!next.beneficiaries.some(x=>x.householdId===action.householdId&&x.beneficiaryId===action.beneficiaryId),'$action.beneficiaryId','Duplicate beneficiary');next.beneficiaries.push({householdId:action.householdId,beneficiaryId:action.beneficiaryId,displayLabel:action.displayLabel,relationLabel:action.relationLabel});}
    else if(type==='ADD_ACTOR'){authorized();ident(action.actorId,'$action.actorId');textLimit(action.displayLabel,'$action.displayLabel',80);need(['self','helper'].includes(action.role),'$action.role','Invalid role');need(!next.actors.some(x=>x.actorId===action.actorId),'$action.actorId','Duplicate actor');next.actors.push({actorId:action.actorId,displayLabel:action.displayLabel,role:action.role,householdIds:[action.householdId]});}
    else if(type==='LINK_ACTOR_HOUSEHOLD'){need(action.explicitConfirmation===true,'$action.explicitConfirmation','Explicit confirmation required');ident(action.actorId,'$action.actorId');need(next.households.some(x=>x.householdId===action.householdId),'$action.householdId','Unknown household');const target=next.actors.find(x=>x.actorId===action.actorId);need(target,'$action.actorId','Unknown actor');const firstLegacyClaim=action.actingActorId===action.actorId&&(!Array.isArray(target.householdIds)||target.householdIds.length===0);const invited=next.actors.some(x=>x.actorId===action.actingActorId&&Array.isArray(x.householdIds)&&x.householdIds.includes(action.householdId));need(firstLegacyClaim||invited,'$action.actingActorId','Existing household member must confirm an additional link');if(!Array.isArray(target.householdIds))target.householdIds=[];if(target.householdIds.includes(action.householdId))return result(input,input.revision,false);target.householdIds.push(action.householdId);}
    else if(type==='CONFIRM_LEGACY'){authorized();
      ident(action.householdId,'$action.householdId');ident(action.beneficiaryId,'$action.beneficiaryId');string(action.legacyBenKey,'$action.legacyBenKey',true);need(Array.isArray(action.eventIds),'$action.eventIds','Expected event IDs');action.eventIds.forEach((x,i)=>ident(x,'$action.eventIds['+i+']'));
      const ben=next.beneficiaries.find(x=>x.householdId===action.householdId&&x.beneficiaryId===action.beneficiaryId);need(ben,'$action','Unknown beneficiary');
      need(!next.beneficiaries.some(x=>x.legacyBenKey===action.legacyBenKey&&x!==ben),'$action.legacyBenKey','Legacy source already assigned');
      need(!ben.legacyBenKey||ben.legacyBenKey===action.legacyBenKey,'$action.beneficiaryId','Beneficiary already has another legacy source');
      const q=next.quarantine.find(x=>x.legacyBenKey===action.legacyBenKey);need(q,'$action.legacyBenKey','No quarantined source');
      if(q.records.length||q.choices.length){
        let n=0;const old={schemaVersion:2,revision:0,namespace:'b',records:q.records,choices:q.choices};
        const migrated=migrateV2ToV3(old,{households:next.households,beneficiaries:next.beneficiaries,actors:next.actors,legacyMap:{[action.legacyBenKey]:{householdId:action.householdId,beneficiaryId:action.beneficiaryId}},idForLegacy:()=>action.eventIds[n++]});
        if(!migrated.ok)fault(migrated.error.code,migrated.error.message,migrated.error.path);
        need(n===action.eventIds.length,'$action.eventIds','Incorrect number of event IDs');
        next.records.push(...migrated.data.records);next.choices.push(...migrated.data.choices);next.events.push(...migrated.data.events);
        q.records=[];q.choices=[];ben.legacyBenKey=action.legacyBenKey;
      }else need(ben.legacyBenKey===action.legacyBenKey,'$action.legacyBenKey','Source already empty');
    }
    else {member();
      if(type==='SET_CHOICE'||type==='REJOIN_POLICY'||type==='REMOVE_POLICY'){const value=type==='REMOVE_POLICY'?null:type==='REJOIN_POLICY'?'verify':action.value;need(value===null||CHOICES.includes(value),'$action.value','Invalid choice');const i=next.choices.findIndex(same);if(value===null){if(i>=0)next.choices.splice(i,1);}else if(i>=0)next.choices[i].value=value;else next.choices.push({...pairObj,value});const r=rec();if(r&&r.listRemoved!==(value!=='verify')){r.listRemoved=value!=='verify';r.updatedAt=now;}if(type==='REJOIN_POLICY'||type==='SET_CHOICE'&&value==='verify')next.prepItems.filter(same).forEach(x=>x.archived=x.archivedByUser);if(type==='REMOVE_POLICY'||type==='SET_CHOICE'&&value!== 'verify')next.prepItems.filter(same).forEach(x=>x.archived=true);}
      else if(type==='DELETE_POLICY'){next.records=next.records.filter(x=>!same(x));next.choices=next.choices.filter(x=>!same(x));next.events=next.events.filter(x=>!same(x));next.prepItems=next.prepItems.filter(x=>!same(x));}
      else if(type==='SAVE_CONSULTATION'){const r=ensure(),target=action.statusAfter||'consulted';transition(r.status,target,true);textLimit(action.answerSummary,'$action.answerSummary',1000);textLimit(action.note,'$action.note',300);textLimit(action.next,'$action.next',120);need(['phone','in_person','official_web','other'].includes(action.channel),'$action.channel','Invalid channel');textLimit(action.contactLabel,'$action.contactLabel',100);const extra={channel:action.channel,contactLabel:action.contactLabel,answerSummary:action.answerSummary,sourceRefs:action.sourceRefs||[]};if(action.consultedOn)extra.consultedOn=action.consultedOn;event('consultation',target,action.note,action.next,extra);r.status=target;r.note=action.note;r.next=action.next;r.updatedAt=now;r.listRemoved=false;}
      else if(type==='SET_STATUS'){const r=ensure();transition(r.status,action.statusAfter,false);textLimit(action.note,'$action.note',300);textLimit(action.next,'$action.next',120);if(r.status!==action.statusAfter||r.note!==action.note||r.next!==action.next){event('status_change',action.statusAfter,action.note,action.next);r.status=action.statusAfter;r.note=action.note;r.next=action.next;r.updatedAt=now;}}
      else if(type==='CORRECT_CONSULTATION'){ident(action.correctsEventId,'$action.correctsEventId');const old=next.events.find(x=>x.eventId===action.correctsEventId&&same(x)&&x.kind==='consultation');need(old,'$action.correctsEventId','Unknown consultation');textLimit(action.answerSummary,'$action.answerSummary',1000);event('correction',rec()?rec().status:'pending',rec()?rec().note:'',rec()?rec().next:'',{correctsEventId:action.correctsEventId,answerSummary:action.answerSummary});}
      else if(type==='ADD_PREP_ITEM'){const item=clone(action.item);keys(item,['itemId','kind','text','sourceRef'],[],'$action.item');token(item.itemId,'$action.item.itemId');need(!next.prepItems.some(x=>x.itemId===item.itemId),'$action.item.itemId','Duplicate item');next.prepItems.push({...pairObj,...item,checked:false,archived:false,archivedByUser:false,sourceNeedsReview:false,createdAt:now,updatedAt:now});}
      else if(type==='UPDATE_PREP_ITEM'){token(action.itemId,'$action.itemId');const item=next.prepItems.find(x=>x.itemId===action.itemId&&same(x));need(item,'$action.itemId','Unknown item');if(item.kind!==action.kind||item.text!==action.text||JSON.stringify(item.sourceRef)!==JSON.stringify(action.sourceRef)||item.sourceNeedsReview){item.kind=action.kind;item.text=action.text;item.sourceRef=action.sourceRef;item.sourceNeedsReview=false;item.updatedAt=now;}}
      else if(type==='SET_PREP_CHECKED'){token(action.itemId,'$action.itemId');need(typeof action.checked==='boolean','$action.checked','Expected boolean');const item=next.prepItems.find(x=>x.itemId===action.itemId&&same(x));need(item,'$action.itemId','Unknown item');if(item.checked!==action.checked){item.checked=action.checked;item.updatedAt=now;}}
      else if(type==='SET_PREP_ARCHIVED'){token(action.itemId,'$action.itemId');need(typeof action.archived==='boolean','$action.archived','Expected boolean');const item=next.prepItems.find(x=>x.itemId===action.itemId&&same(x));need(item,'$action.itemId','Unknown item');const nextArchived=action.archived||!next.choices.some(x=>same(x)&&x.value==='verify');if(item.archivedByUser!==action.archived||item.archived!==nextArchived){item.archivedByUser=action.archived;item.archived=nextArchived;item.updatedAt=now;}}
      else if(type==='MARK_PREP_SOURCE_STALE'){token(action.itemId,'$action.itemId');const item=next.prepItems.find(x=>x.itemId===action.itemId&&same(x)&&x.kind==='official_requirement');need(item,'$action.itemId','Unknown official item');if(!item.sourceNeedsReview){item.sourceNeedsReview=true;item.updatedAt=now;}}
    }
    const changed=JSON.stringify(next)!==JSON.stringify(input);if(changed){need(next.revision<Number.MAX_SAFE_INTEGER,'$.revision','Revision exhausted');next.revision++;}state3(next);return result(next,next.revision,changed);
  });}
  return Object.freeze({ validateState, validateRecord, validateChoice, validateHistory, parseState, migrateLegacy, reduce,
    validateState3, parseState3, migrateV2ToV3, migrateLegacyToV3, reduce3, generateId });
});
