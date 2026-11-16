/* Early mode gate. Production activation is deliberately compiled OFF.
 * Load before app.js and pf-services.js so legacy writes cannot race startup. */
(function (global) {
  'use strict';
  var PRODUCTION_ENABLED = false;
  var test = global.__PF_V3_ISOLATED_TEST__;
  var localhost = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  var isolated = localhost && test && test.token === 'pf-v3-isolated-2b1';
  var rehearsal = localhost && test && test.token === 'pf-v3-switch-rehearsal';
  // Future production enablement needs a separately reviewed identity provider,
  // migration approval and recovery preflight before this constant can change.
  var mode = isolated ? 'v3-isolated' : 'v1';
  var gateError = '';
  var priorActivation=false;
  var unfinished=false;
  var globalActivation=false;
  if(!isolated&&!rehearsal){
    try { unfinished=global.localStorage.getItem('pf_service_v3_operation_b')!==null;
      globalActivation=global.localStorage.getItem('pf_service_v3_global_active_b')!==null;
      priorActivation=global.sessionStorage.getItem('pf_service_v3_active_b')!==null||
       global.localStorage.getItem('pf_service_v3_active_b')!==null||globalActivation; }
    catch (_) { gateError='ACTIVATION_STORAGE_UNAVAILABLE';mode='v3-blocked'; }
    if(unfinished)mode='v3-recovery';
    else if(priorActivation&&!PRODUCTION_ENABLED){gateError='ACTIVE_STATE_REQUIRES_V3_RELEASE';mode='v3-blocked';}
  }
  if (PRODUCTION_ENABLED || rehearsal) {
    mode = 'v3-pending';
    if (!global.isSecureContext) gateError='INSECURE_CONTEXT';
    else if (!global.crypto || typeof global.crypto.randomUUID !== 'function') gateError='ID_GENERATOR_UNAVAILABLE';
    else if (!navigator.locks || typeof navigator.locks.request !== 'function') gateError='LOCK_UNAVAILABLE';
    if(gateError)mode='v3-blocked';
  }
  Object.defineProperty(global,'PF_V3_MODE',{value:mode,configurable:false,writable:false});
  Object.defineProperty(global,'PF_V3_BLOCK_LEGACY_WRITES',{value:mode!=='v1',configurable:false,writable:false});
  Object.defineProperty(global,'PF_V3_GATE_ERROR',{value:gateError,configurable:false,writable:false});
})(window);
