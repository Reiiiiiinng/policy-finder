/* A committed result is loaded from SQLite. Browser history only keeps navigation and drafts. */
window.PFQuerySnapshot = (() => {
  let current, loadVersion = 0;
  const params = new URLSearchParams(location.search);
  const id = params.get('query');
  const historyPage = 'query-history.html';

  async function open(area, mode) {
    const version = ++loadVersion;
    area.setAttribute('aria-busy', 'true');
    try {
      const saved = await PFBusiness.history(id, params.get('attempt'), params.get('member'));
      if (version !== loadVersion) return;
      if (saved?.queryId !== id || !saved.memberId || !Array.isArray(saved.versions) ||
          !Array.isArray(saved.assessmentAttempts) || !Array.isArray(saved.planIds))
        throw Error('查询记录响应格式异常。');
      if (saved.mode !== mode) throw Error('该查询不属于当前模式，请从历史列表打开。');
      if (saved.result) {
        if (!Array.isArray(saved.result.results) || !saved.result.profile || !saved.form?.uiForm)
          throw Error('规则结果响应格式异常。');
        saved.result.profile = {...saved.result.profile, uiForm: {...saved.form.uiForm,
          memberId: saved.memberId, followupQueryId: saved.queryId}, uiAnswers: saved.form.uiForm.answers};
        await PFResultPresentation.prepare(saved.result);
        if (version !== loadVersion) return;
        current = saved;
        area.innerHTML = PFResultPresentation.render(saved.result);
        PFSemanticResult.mount(area, saved.result.profile, saved);
      } else {
        if (saved.result !== null) throw Error('规则结果响应格式异常。');
        current = saved;
        showMessage(area, 'snapshot-missing', '原始结果未保存',
          '这条旧查询仍可修改资料并重新查询。', mode);
      }
      if (typeof updateTopbarParent === 'function') updateTopbarParent(PFNavigation.withParams(historyPage, {member:saved.memberId}));
      document.dispatchEvent(new Event('pf-query-loaded'));
    } catch (error) {
      if (version !== loadVersion) return;
      current = undefined;
      document.querySelector('#structuredSummary')?.remove();
      document.querySelector('.rp-footer')?.remove();
      showMessage(area, 'query-failed', error.status === 401 ? '需要重新登录或解锁' : '查询结果暂不可读取',
        error.message, mode);
    } finally {
      if (version === loadVersion) area.removeAttribute('aria-busy');
    }
  }

  function showMessage(area, state, title, text, mode) {
    const box = document.createElement('section');
    box.className = 'rp-empty';
    box.dataset.emptyState = state;
    const heading = document.createElement('h2');
    heading.textContent = title;
    const message = document.createElement('p');
    message.textContent = text;
    message.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'rp-empty-actions';
    const link = document.createElement('a');
    link.href = PFNavigation.withParams(historyPage, {member:current?.memberId ?? params.get('member')});
    link.textContent = '打开查询历史';
    if (state === 'snapshot-missing') {
      const edit = document.createElement('a');
      edit.href = PFNavigation.queryInfoURL({latest:true, describe:true});
      edit.textContent = '补充生活情况并重新查询';
      actions.append(edit);
    } else {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重新读取本次结果';
      retry.onclick = () => {
        retry.disabled = true;
        open(area, mode);
      };
      actions.append(retry);
    }
    actions.append(link);
    box.append(heading, message, actions);
    area.replaceChildren(box);
    area.closest('.app')?.classList.remove('batch-open');
    area.closest('.app')?.querySelector('.batch-view')?.remove();
  }

  async function legacyGate() {
    if (!await PFBusiness.enabled()) return false;
    const oldId = activeProfile()?.uiForm?.followupQueryId;
    location.replace(oldId ? PFNavigation.resultURL(activeQueryMode() === 'self', oldId) : historyPage);
    return true;
  }

  return {id, open, legacyGate, get current() { return current; }};
})();
