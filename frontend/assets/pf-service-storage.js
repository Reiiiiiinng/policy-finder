/* B v2 storage adapter, deliberately NOT loaded by business pages.
 * createAdapter(storage) requires an explicitly injected synchronous Storage interface.
 * No default sessionStorage, automatic initialization, cached state, or v1 writes.
 * commit(action, {benKey, expectedRevision}): action contains no identity/revision.
 * Revision checks detect stale snapshots; they are NOT a cross-frame atomic CAS.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pf-service-state.js'));
  else root.PFServiceStorage = factory(root.PFServiceState);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (contract) {
  'use strict';
  const KEY = 'pf_service_state_v2_b';
  const MIGRATION_BACKUP_KEY = 'pf_service_state_v2_b_migration_backup';
  const OLD_RECORDS = 'pf_verify_records_v1_b';
  const OLD_PREFIX = 'pf_fs_b_';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  function failure(code, message, path) {
    const error = { code, message }; if (path !== undefined) error.path = path;
    return { ok: false, error };
  }
  function guard(fn) {
    try { return fn(); } catch (e) {
      // Only our own errors are surfaced; an injected storage exception cannot
      // spoof an adapter result or cause a candidate to be reported as committed.
      if (e instanceof AdapterError) return e.result;
      return failure('INVALID_ARGUMENT', 'Unreadable adapter input');
    }
  }
  class AdapterError { constructor(result) { this.result = result; } }
  function abort(code, message, path) { throw new AdapterError(failure(code, message, path)); }
  function requireInput(test, path, message) { if (!test) abort('INVALID_ARGUMENT', message, path); }
  function inputObject(value, path) {
    requireInput(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'Expected plain object');
    const proto = Object.getPrototypeOf(value);
    requireInput(proto === Object.prototype || proto === null, path, 'Expected plain object');
    requireInput(Object.getOwnPropertySymbols(value).length === 0, path, 'Symbol fields are not supported');
    const result = Object.create(null);
    for (const k of Object.getOwnPropertyNames(value)) {
      const d = Object.getOwnPropertyDescriptor(value, k);
      requireInput(d.enumerable && own(d, 'value'), path + '.' + k, 'Expected enumerable data field');
      Object.defineProperty(result, k, {value:d.value, enumerable:true});
    }
    return result;
  }
  function createAdapter(storage) {
    // Creation is inert; validate storage access inside each guarded operation.
    function read(key) {
      try {
        if (!storage || typeof storage.getItem !== 'function') throw Error('Missing getItem');
        const raw = storage.getItem(key);
        if (raw !== null && typeof raw !== 'string') throw Error('Invalid getItem result');
        return raw;
      } catch (_) { abort('STORAGE_UNAVAILABLE', 'Storage could not be read', key); }
    }
    function readState() {
      return guard(() => {
        const raw = read(KEY);
        if (raw === null) return failure('MIGRATION_REQUIRED', 'Authoritative state is absent; explicit initialization required', KEY);
        return contract.parseState(raw);
      });
    }
    function keys() {
      try {
        const length = storage.length;
        if (!Number.isSafeInteger(length) || length < 0 || typeof storage.key !== 'function') throw Error('Invalid enumeration');
        const seen = new Set(), list = [];
        for (let i = 0; i < length; i++) {
          const key = storage.key(i);
          if (typeof key !== 'string' || seen.has(key)) throw Error('Incomplete enumeration');
          seen.add(key); list.push(key);
        }
        if (storage.length !== length) throw Error('Enumeration changed');
        return list;
      } catch (_) { abort('LEGACY_READ_FAILED', 'Could not enumerate complete legacy storage', '$legacy.keys'); }
    }
    function legacySnapshot() {
      const before = keys(), raw = read(OLD_RECORDS), entries = [];
      for (const key of before) if (key.startsWith(OLD_PREFIX)) {
        const value = read(key);
        if (value === null) abort('LEGACY_READ_FAILED', 'Legacy key disappeared during snapshot', key);
        entries.push({key, value});
      }
      const after = keys();
      if (JSON.stringify(before.slice().sort()) !== JSON.stringify(after.slice().sort()) || read(OLD_RECORDS) !== raw)
        abort('LEGACY_READ_FAILED', 'Legacy snapshot changed while being read', '$legacy');
      for (const entry of entries) if (read(entry.key) !== entry.value)
        abort('LEGACY_READ_FAILED', 'Legacy value changed while being read', entry.key);
      return {records:{ok:true,raw},marks:{ok:true,entries}};
    }
    function writeCandidate(candidate) {
      const checked = contract.validateState(candidate.data);
      if (!checked.ok) return checked;
      let serialized;
      try { serialized = JSON.stringify(checked.data); }
      catch (_) { return failure('SERIALIZATION_FAILED', 'Could not serialize complete state', KEY); }
      // Prepare a detached success result before writing. No validation, cloning,
      // readback, or other fallible post-write work is needed to confirm success.
      const success = {ok:true,data:checked.data,revision:checked.revision,changed:true};
      try {
        if (!storage || typeof storage.setItem !== 'function') throw Error('Missing setItem');
        storage.setItem(KEY, serialized);
      } catch (_) { return failure('STORAGE_WRITE_FAILED', 'Authoritative state was not saved', KEY); }
      return success;
    }
    function initializeState() {
      return guard(() => {
        const existing = readState();
        if (existing.ok || existing.error.code !== 'MIGRATION_REQUIRED') return existing;
        const snapshot = legacySnapshot();
        const candidate = contract.migrateLegacy(snapshot);
        if (!candidate.ok) return candidate;
        // A valid state that appeared during snapshot collection wins. This is
        // defensive detection, not a lock or guarantee against concurrent frames.
        const latest = readState();
        if (latest.ok || latest.error.code !== 'MIGRATION_REQUIRED') return latest;
        return writeCandidate(candidate);
      });
    }
    function commit(action, ctx) {
      return guard(() => {
        const context = inputObject(ctx, '$ctx');
        requireInput(Object.keys(context).every(k => ['benKey','expectedRevision'].includes(k)), '$ctx', 'Unknown context field');
        requireInput(typeof context.benKey === 'string' && context.benKey.length > 0, '$ctx.benKey', 'Expected fixed beneficiary');
        requireInput(Number.isSafeInteger(context.expectedRevision) && context.expectedRevision >= 0, '$ctx.expectedRevision', 'Invalid revision');
        const payload = inputObject(action, '$action');
        requireInput(!own(payload,'benKey') && !own(payload,'expectedRevision'), '$action', 'Identity and revision belong exclusively to context');
        const current = readState();
        if (!current.ok) return current;
        const reduced = contract.reduce(current.data, {...payload,benKey:context.benKey,expectedRevision:context.expectedRevision});
        if (!reduced.ok) return reduced;
        if (!reduced.changed) return reduced;
        return writeCandidate(reduced);
      });
    }
    /* Opt-in schema 3 path. It uses the SAME authoritative key. The schema 2
     * methods above remain intact for unactivated callers and regression tests. */
    function readState3() {
      return guard(() => {
        const raw = read(KEY);
        if (raw === null) return failure('MIGRATION_REQUIRED', 'Authoritative state is absent; explicit initialization required', KEY);
        return contract.parseState3(raw);
      });
    }
    function inspectRecovery3() {
      return guard(() => {
        const raw=read(MIGRATION_BACKUP_KEY);
        if (raw === null) return {ok:true,data:{required:false}};
        const source=contract.parseState(raw);
        return {ok:true,data:{required:true,validSource:source.ok,bytes:raw.length}};
      });
    }
    function readRecoveryBackup3() {
      return guard(() => {
        const raw=read(MIGRATION_BACKUP_KEY);
        if (raw === null) return failure('BACKUP_NOT_FOUND','No migration backup exists',MIGRATION_BACKUP_KEY);
        return {ok:true,data:raw};
      });
    }
    function legacyPrepSnapshot() {
      const names = keys().filter(k => k === 'pf_prep_v1_b' || k.startsWith('pf_prep_v1_b_'));
      const items = names.map(key => ({key, raw:read(key)}));
      if (items.some(x => x.raw === null) || JSON.stringify(names) !== JSON.stringify(keys().filter(k => k === 'pf_prep_v1_b' || k.startsWith('pf_prep_v1_b_'))))
        abort('LEGACY_READ_FAILED', 'Legacy preparation keys changed', '$legacy.prep');
      for (const x of items) if (read(x.key) !== x.raw) abort('LEGACY_READ_FAILED', 'Legacy preparation changed', x.key);
      return items.map(x => ({legacyBenKey:x.key === 'pf_prep_v1_b' ? 'unowned' : x.key.slice('pf_prep_v1_b_'.length),raw:x.raw}));
    }
    function migrationSource3(raw) {
      const legacy = raw === null ? legacySnapshot() : null;
      const prep = legacyPrepSnapshot();
      return {legacy,prep,token:JSON.stringify({raw,legacy,prep})};
    }
    // Read-only preview; the token binds confirmation to the exact source snapshot.
    function previewState3(options) {
      return guard(() => {
        if (read(MIGRATION_BACKUP_KEY) !== null)
          return failure('RECOVERY_REQUIRED','Migration backup must be reviewed before preview',MIGRATION_BACKUP_KEY);
        const raw = read(KEY);
        if (raw !== null) {
          const parsed = contract.parseState3(raw);
          if (parsed.ok || parsed.error.code !== 'UNSUPPORTED_SCHEMA') return parsed;
        }
        const input = inputObject(options,'$options'),source = migrationSource3(raw);
        const candidate = raw === null
          ? contract.migrateLegacyToV3(source.legacy,{...input,legacyPrep:source.prep})
          : (() => { const old=contract.parseState(raw);return old.ok?contract.migrateV2ToV3(old.data,{...input,legacyPrep:source.prep}):old; })();
        if (!candidate.ok) return candidate;
        if (read(KEY) !== raw || migrationSource3(raw).token !== source.token)
          return failure('CONFLICT','Migration source changed during preview',KEY);
        return {...candidate,requiresMigration:true,sourceToken:source.token};
      });
    }
    function writeCandidate3(candidate) {
      const checked = contract.validateState3(candidate.data);
      if (!checked.ok) return checked;
      let serialized;
      try { serialized = JSON.stringify(checked.data); }
      catch (_) { return failure('SERIALIZATION_FAILED', 'Could not serialize complete state', KEY); }
      const success = {ok:true,data:checked.data,revision:checked.revision,changed:true};
      try {
        if (!storage || typeof storage.setItem !== 'function') throw Error('Missing setItem');
        storage.setItem(KEY,serialized);
      } catch (_) { return failure('STORAGE_WRITE_FAILED', 'Authoritative state was not saved', KEY); }
      return success;
    }
    function initializeState3(options,expectedSourceToken) {
      return guard(() => {
        if (read(MIGRATION_BACKUP_KEY) !== null)
          return failure('RECOVERY_REQUIRED','Migration backup must be reviewed before initialization',MIGRATION_BACKUP_KEY);
        const raw = read(KEY);
        if (raw !== null) {
          const parsed3 = contract.parseState3(raw);
          if (parsed3.ok || parsed3.error.code !== 'UNSUPPORTED_SCHEMA') return parsed3;
        }
        const input = inputObject(options,'$options');
        if (expectedSourceToken !== undefined) {
          requireInput(typeof expectedSourceToken === 'string','$expectedSourceToken','Expected preview source token');
          if (migrationSource3(raw).token !== expectedSourceToken)
            return failure('CONFLICT','Migration source changed since preview',KEY);
        }
        let candidate;
        if (raw !== null) {
          const old = contract.parseState(raw);
          if (!old.ok) return old;
          const prep = legacyPrepSnapshot();
          candidate = contract.migrateV2ToV3(old.data,{...input,legacyPrep:prep});
        } else {
          const snapshot = legacySnapshot();
          const prep = legacyPrepSnapshot();
          candidate = contract.migrateLegacyToV3(snapshot,{...input,legacyPrep:prep});
        }
        if (!candidate.ok) return candidate;
        if (read(KEY) !== raw) return failure('CONFLICT','Authoritative state changed during migration',KEY);
        if (expectedSourceToken !== undefined && migrationSource3(raw).token !== expectedSourceToken)
          return failure('CONFLICT','Migration source changed before commit',KEY);
        if (expectedSourceToken === undefined) return writeCandidate3(candidate);
        // A confirmed migration keeps a temporary, non-authoritative source copy
        // until the schema 3 write has been read back. Legacy v1 keys stay intact.
        if (raw !== null) {
          if (read(MIGRATION_BACKUP_KEY) !== null)
            return failure('RECOVERY_REQUIRED','An earlier migration backup needs review',MIGRATION_BACKUP_KEY);
          try { storage.setItem(MIGRATION_BACKUP_KEY,raw); }
          catch (_) { return failure('BACKUP_WRITE_FAILED','Original schema 2 state was not backed up',MIGRATION_BACKUP_KEY); }
          if (read(MIGRATION_BACKUP_KEY) !== raw)
            return failure('BACKUP_WRITE_FAILED','Migration backup could not be verified',MIGRATION_BACKUP_KEY);
        }
        const saved=writeCandidate3(candidate);
        if (!saved.ok) {
          try { if (raw !== null) storage.removeItem(MIGRATION_BACKUP_KEY); } catch (_) {}
          return saved;
        }
        const checked=readState3();
        if (!checked.ok || JSON.stringify(checked.data)!==JSON.stringify(saved.data)) {
          try {
            if (raw === null) storage.removeItem(KEY);
            else storage.setItem(KEY,raw);
            if (read(KEY) !== raw) throw Error('Restore mismatch');
          } catch (_) { return failure('RECOVERY_REQUIRED','Readback failed; backup or legacy source must be reviewed',MIGRATION_BACKUP_KEY); }
          try { if (raw !== null) storage.removeItem(MIGRATION_BACKUP_KEY); } catch (_) {}
          return failure('READBACK_FAILED','Migration was rolled back after readback failed',KEY);
        }
        try { if (raw !== null) storage.removeItem(MIGRATION_BACKUP_KEY); }
        catch (_) { return {...saved,recoveryBackupRetained:true}; }
        return saved;
      });
    }
    function commit3(action,ctx) {
      return guard(() => {
        if (read(MIGRATION_BACKUP_KEY) !== null)
          return failure('RECOVERY_REQUIRED','Migration backup must be reviewed before any write',MIGRATION_BACKUP_KEY);
        const context=inputObject(ctx,'$ctx'),payload=inputObject(action,'$action');
         requireInput(Object.keys(context).every(k=>['householdId','beneficiaryId','actingActorId','expectedRevision'].includes(k)),'$ctx','Unknown context field');
        requireInput(Number.isSafeInteger(context.expectedRevision)&&context.expectedRevision>=0,'$ctx.expectedRevision','Invalid revision');
         requireInput(!own(payload,'householdId')&&!own(payload,'beneficiaryId')&&!own(payload,'actingActorId')&&!own(payload,'expectedRevision'),'$action','Identity and revision belong to context');
        const current=readState3();if(!current.ok)return current;
        const reduced=contract.reduce3(current.data,{...payload,...context});
        if(!reduced.ok||!reduced.changed)return reduced;
        return writeCandidate3(reduced);
      });
    }
    return Object.freeze({readState, initializeState, commit, readState3, inspectRecovery3, readRecoveryBackup3, previewState3, initializeState3, commit3});
  }
  return Object.freeze({KEY, MIGRATION_BACKUP_KEY, createAdapter});
});
