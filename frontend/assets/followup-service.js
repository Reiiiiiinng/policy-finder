/* Query-scoped business state. Browser history only selects the active query. */
window.PFFollowup = (() => {
  const field = 'phase4Followup';
  const keyOf = queryId => 'pf_phase4_followup_v1_b:' + queryId;
  const statuses = {
    pending:'待核实', preparing:'准备中', consulted:'已咨询', applicable:'已确认适用',
    inapplicable:'已确认不适用', deferred:'暂不办理', completed:'已完成后续处理',
  };
  const copy = value => JSON.parse(JSON.stringify(value));

  function context() {
    if (PF_V3_MODE !== 'v1' || PF_V3_BLOCK_LEGACY_WRITES) return null;
    const session = store.read(), profile = activeProfile(), mode = session.lastQuery;
    const form = profile?.uiForm;
    if (!form?.followupQueryId || !['self','family'].includes(mode) || form.mode !== mode) return null;
    if (mode === 'family' && (!session.beneficiary || form.beneficiary !== session.beneficiary)) return null;
    return {queryId:form.followupQueryId, member:PFServices.benKey(), label:mode === 'self' ? '本人' : session.beneficiary,
      mode, region:profile.region};
  }

  function legacyData(ctx) {
    const all = store.read()[field];
    if (all !== undefined && (!all || typeof all !== 'object' || Array.isArray(all))) throw Error('后续服务记录格式异常。');
    return all?.[ctx.queryId] || {...ctx, items:{}, plans:{}};
  }

  function assertScope(snapshot) {
    const ctx = context();
    if (!ctx || !snapshot || ['queryId','member','mode','region'].some(field=>ctx[field]!==snapshot[field])) {
      throw Error('后续服务记录与当前查询对象不一致。');
    }
  }

  function read() {
    const ctx = context();
    if (!ctx) return null;
    const raw = localStorage.getItem(keyOf(ctx.queryId));
    const envelope = raw===null ? {data:legacyData(ctx)} : JSON.parse(raw);
    const data = copy(envelope.data);
    assertScope(data);
    return data;
  }

  function eligible(data) {
    const ids = new Set(PFServices.selectedIds());
    const records = new Set(PFPolicyActions.records().map(row => row.pid));
    return Object.values(data.items).filter(item => item.intent === 'verify' && ids.has(item.id) && records.has(item.id));
  }

  function progress(data, plan) {
    const allowed = new Set(eligible(data).map(item=>item.id));
    const ids = plan.ids.filter(id=>allowed.has(id));
    const done = ids.filter(id=>data.items[id].status==='completed').length;
    return {ids, total:plan.ids.length, active:ids.length, removed:plan.ids.length-ids.length, done,
      status:!ids.length ? 'empty' : done===ids.length ? 'completed' : 'active'};
  }

  return {context,read,eligible,progress,statuses};
})();
