/* Same-origin business API. Browser storage here holds only pending request identifiers. */
window.PFBusiness = (() => {
  const consultationSources = Object.freeze({
    official_reply_recorded: '官方答复转记（用户提供，未经独立核验）',
    personal_note: '个人咨询笔记',
    ai_organized: 'AI 辅助整理',
  });
  let capability;
  const root = '/api/followup/';
  async function request(path, body) {
    const response = await fetch(root + path, {
      cache: 'no-store',
      ...(body === undefined ? {} : {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-PF-Local': '1'},
        body: JSON.stringify(body),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.detail || '后续服务请求未完成，请重试。');
      error.code = result.error;
      error.status = response.status;
      throw error;
    }
    return result;
  }
  function enabled() {
    capability ||= request('capabilities').then(result => result.enabled === true).catch(error => {
      capability = undefined;
      throw error;
    });
    return capability;
  }
  const queryId = () => new URLSearchParams(location.search).get('query') || activeProfile()?.uiForm?.followupQueryId;
  const query = (id = queryId(), memberId) => id ? scoped('queries/', id, memberId) : Promise.resolve(null);
  const scoped = (path, id, memberId) => request(path + encodeURIComponent(id) +
    (memberId != null ? '?memberId=' + encodeURIComponent(memberId) : ''));
  function plan(id, memberId, queryId) {
    const params = new URLSearchParams();
    if (memberId != null) params.set('memberId', memberId);
    if (queryId != null) params.set('queryId', queryId);
    return request('plans/' + encodeURIComponent(id) + (params.size ? '?' + params : ''));
  }
  const overview = memberId => request('overview' + (memberId ? '?memberId=' + encodeURIComponent(memberId) : ''));
  const members = () => request('members').then(result => result.members);
  function favorites(memberId, policyId, region) {
    const params = new URLSearchParams();
    if (memberId) params.set('memberId', memberId);
    if (policyId) {
      params.set('policyId', policyId);
      params.set('region', region);
    }
    return request('favorites' + (params.size ? '?' + params : ''));
  }
  const pending = new Map();
  const storagePrefix = 'pf_pending_operation:';
  async function write(path, body) {
    if (body.operationId) return request(path, body);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([path, body])));
    const fingerprint = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const key = storagePrefix + fingerprint;
    let operationId = pending.get(key);
    try { operationId ||= sessionStorage.getItem(key); } catch { /* Retry remains possible in memory. */ }
    operationId ||= crypto.randomUUID();
    pending.set(key, operationId);
    try { sessionStorage.setItem(key, operationId); } catch { /* Retry remains possible in memory. */ }
    function forget() {
      pending.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* The receipt remains idempotent. */ }
    }
    try {
      const result = await request(path, {...body, operationId});
      forget();
      return result;
    } catch (error) {
      if (error.status >= 400 && error.status < 500) forget();
      throw error;
    }
  }
  return {
    consultationSources,
    consultationSourceLabel: type => Object.hasOwn(consultationSources, type) ? consultationSources[type] : '来源未分类',
    enabled, query, queryId, plan, overview, members, favorites,
    consultation: (id, memberId) => scoped('consultations/', id, memberId),
    batch: id => request('batches/' + encodeURIComponent(id)),
    history(id, attempt, memberId) {
      const params = new URLSearchParams();
      if (attempt) params.set('attempt', attempt);
      if (memberId != null) params.set('memberId', memberId);
      return request('query-history/' + encodeURIComponent(id) + (params.size ? '?' + params : ''));
    },
    ruleAdmission: (id, memberId) => request('queries/' + encodeURIComponent(id) +
      '/rule-admission?memberId=' + encodeURIComponent(memberId)),
    historyList: memberId => request('queries?memberId=' + encodeURIComponent(memberId)),
    archiveQuery: (queryId, expectedVersion) => write('query-history/archive', {queryId, expectedVersion}),
    unlock: accessToken => request('session', {accessToken}),
    addMember: (name, relation) => write('members', {name, relation}).then(result => result.member),
    register: details => write('queries', details),
    command: (type, data) => write('commands', {type, ...data}),
  };
})();
