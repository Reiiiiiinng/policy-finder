/* A draft belongs to one result history entry. Committed data uses PFPolicyActions. */
window.PFPolicyBatch = (() => {
  const choices = {
    verify: '打算去核实', later: '先记下来', notmatch: '情况不符，不适用',
  };
  const esc = value => escapeHtml(value ?? '');
  let controller;
  let activeArea, deferred, saving = false;

  function afterSave(area, update) {
    if (saving && area === activeArea) deferred = update;
    else update();
  }

  function mount(area, result) {
    controller?.abort();
    controller = new AbortController();
    const {signal} = controller;
    activeArea = area;
    const app = area.closest('.app');
    if (!app) return;
    app.querySelector('.batch-view')?.remove();
    area.querySelector('.batch-selection')?.remove();
    area.querySelectorAll('.batch-pick').forEach(element => element.remove());
    const profile = activeProfile(), session = store.read(), scope = PFPolicyActions.scope();
    const saved = history.state?.pfPolicyBatch;
    const initial = saved?.scope === scope ? saved : {scope, ids: [], intents: {}};
    const eligible = new Map(result.entries.filter(entry => entry.display_state === 'candidate'
      && (!window.PFQuerySnapshot?.current || entry.followupProof)
      && entry.evidence_state?.official_source_verified && entry.evidence_state.validity_status === 'active')
      .map(entry => [entry.policy_id, entry]));
    let draft = {...initial, ids: result.unassessed ? initial.ids : initial.ids.filter(id => eligible.has(id))};
    let receipt;
    let canPlan = false;
    const supported = PF_V3_MODE === 'v1' && !PF_V3_BLOCK_LEGACY_WRITES && !!profile?.uiForm &&
      (window.PFQuerySnapshot?.current || session.lastQuery === 'self' || (session.lastQuery === 'family' && !!session.beneficiary
        && session.beneficiary === profile.uiForm.beneficiary));
    const stage = () => new URLSearchParams(location.search).get('batch') || '';
    const receiptId = () => new URLSearchParams(location.search).get('batchReceipt');
    const safeScope = () => PFPolicyActions.scope() === scope;
    const detail = id => PFNavigation.withParams(PFNavigation.detailURL(id), {semantic: 1});
    const entries = draftIds => draftIds.map(id => eligible.get(id));

    function persist(next, view = stage(), id = view === 'done' ? receiptId() : null) {
      if (!safeScope()) throw Error('查询对象或资料已变化，请返回原查询。');
      const url = new URL(location.href);
      if (view) url.searchParams.set('batch', view);
      else url.searchParams.delete('batch');
      if (id) url.searchParams.set('batchReceipt', id);
      else url.searchParams.delete('batchReceipt');
      history.replaceState({...history.state, pfPolicyBatch: next}, '', url);
      draft = next;
    }

    const bar = document.createElement('section');
    bar.className = 'batch-selection';
    bar.hidden = !eligible.size;
    bar.innerHTML = `<h2>选择要继续处理的政策</h2><p data-batch-count role="status"></p>
      <details><summary>查看已选政策</summary><ul data-batch-selected></ul></details>
      <p data-batch-error role="alert"></p>
      <button class="batch-primary" type="button" data-batch-next>我已选完，进行下一步</button>`;
    area.append(bar);
    const view = document.createElement('section');
    view.className = 'batch-view';
    view.hidden = true;
    app.append(view);
    let busy = false;

    function paintBar() {
      const count = draft.ids.length;
      bar.querySelector('[data-batch-count]').textContent = supported ?
        eligible.size ? `已选择 ${count} 项政策` : result.unassessed ?
          '已选择 0 项政策 · 正在核对规则候选的政策依据。' :
          '已选择 0 项政策 · 当前没有通过证据核对的可选政策。' :
        '当前查询缺少可用的成员关联，暂不能保存处理意向。';
      bar.querySelector('[data-batch-selected]').innerHTML = entries(draft.ids).filter(Boolean).map(entry => `<li>${esc(entry.policy_name)}</li>`).join('');
      bar.querySelector('details').hidden = !count;
      bar.querySelector('[data-batch-next]').disabled = !supported || !count || draft.ids.some(id => !eligible.has(id));
      for (const input of area.querySelectorAll('[data-batch-pick]')) {
        input.checked = draft.ids.includes(input.value);
        input.disabled = !!draft.pending;
      }
    }

    for (const card of area.querySelectorAll('.rp-policy')) {
      const id = card.dataset.id || card.dataset.aiPolicy;
      const entry = eligible.get(id);
      if (!entry || !supported) continue;
      const label = document.createElement('label');
      label.className = 'batch-pick';
      label.innerHTML = `<input type="checkbox" data-batch-pick value="${esc(id)}">选择此政策<span class="batch-sr"> · ${esc(entry.policy_name)}</span>`;
      // Existing rule cards delegate ordinary clicks to their detail route.
      label.addEventListener('click', event => event.stopPropagation());
      card.querySelector('.result-foot')?.before(label);
    }

    function fail(error) {
      const message = view.hidden ? bar.querySelector('[data-batch-error]') : view.querySelector('[data-batch-error]');
      if (message) message.textContent = error.message || '操作未完成，请重试。';
    }

    function policyRow(entry, intentStage) {
      const id = entry.policy_id;
      const core = entry.personalized_explanation?.next_check || entry.condition_analysis?.unconfirmed_conditions?.[0];
      const name = esc(entry.policy_name);
      return `<article class="batch-policy" data-batch-policy="${esc(id)}">
        <h2>${name}</h2><p>${esc(entry.origin_label)} · 来源已核验</p>
        ${core ? `<p>优先核实　${esc(core.text)}</p>` : ''}
        <div class="batch-links"><a href="${esc(detail(id))}">查看政策详情</a>
        ${intentStage ? '' : `<button type="button" data-batch-remove="${esc(id)}" aria-label="移除 ${name}">移除</button>`}</div>
        ${intentStage ? `<fieldset><legend>如何处理这项政策？</legend>
          ${Object.entries(choices).map(([value, label]) => `<label><input type="radio" name="intent-${esc(id)}" ${draft.pending?'disabled':''}
           data-batch-intent="${esc(id)}" value="${value}" ${draft.intents[id] === value ? 'checked' : ''}>${label}</label>`).join('')}
          </fieldset>` : ''}</article>`;
    }

    function summary() {
      if (!receipt) return receiptId()
        ? '<p>读取本次处理结果后可继续。</p><button type="button" data-batch-view="done">重新读取</button>'
        : '<p>当前页面没有可读取的批次回执，请返回结果页核对。</p>';
      const groups = Object.entries(choices).map(([intent, title]) => {
        const rows = receipt.entries.filter(entry => entry.intent === intent);
        return `<section><h2>${esc(title)} · ${rows.length} 项</h2>
          <ul>${rows.map(row=>`<li data-batch-summary-id="${esc(row.policyId)}">${esc(row.name)}</li>`).join('')}</ul></section>`;
      }).join('');
      const from = PFNavigation.current();
      const plan = PFNavigation.withParams('follow-up.html', {
        view:'list', query:receipt.queryId, member:receipt.memberId, batchReceipt:receipt.id, from,
      });
      const checklist = PFNavigation.withParams('follow-up.html', {view:'list', member:receipt.memberId, from});
      return `${groups}<div class="batch-links">
        <a href="${esc(checklist)}">查看该成员全部待核实事项</a>
        ${canPlan ?
          `<a class="batch-primary" href="${esc(plan)}">生成家庭少跑腿计划</a>` : ''}</div>`;
    }

    function render() {
      paintBar();
      const mode = stage();
      const showing = ['confirm', 'intent', 'done'].includes(mode);
      app.classList.toggle('batch-open', showing);
      view.hidden = !showing;
      PFNavigation.mount();
      if (!showing) return;
      const valid = supported && safeScope() && draft.ids.length > 0 && draft.ids.every(id => eligible.has(id));
      const heading = mode === 'done' ? '处理结果' : mode === 'intent' ? '逐项确认处理意向' : '确认已选政策';
      let content = '<p>本次没有可继续处理的政策，请返回结果页核对选择。</p>';
      if (mode === 'done') {
        content = summary();
      } else if (mode === 'intent' && draft.pending && !valid) {
        content = '<p>上次提交结果尚未确认，可重试原提交。</p>';
      } else if (valid) {
        content = `<p>选择表示希望继续了解，申请资格以主管部门核实为准。</p>${entries(draft.ids).map(entry => policyRow(entry, mode === 'intent')).join('')}`;
      }
      view.innerHTML = `<header><h1>${heading}</h1><p>${esc(window.PFQuerySnapshot?.current?.memberLabel || PFServices.benLabel())} · ${esc(profile?.region)} · 已选 ${mode==='done' && receipt ? receipt.entries.length : draft.ids.length} 项</p></header>
        ${content}
        <p data-batch-error role="alert"></p><div class="batch-links">
        <button type="button" data-batch-view="" ${draft.pending?'disabled':''}>返回结果页修改选择</button>
        ${valid && mode === 'confirm' ? '<button class="batch-primary" type="button" data-batch-view="intent">确认选择，下一步</button>' : ''}
        ${(valid || draft.pending) && mode === 'intent' ? `<button class="batch-primary" type="button" data-batch-save>${draft.pending?'重试本次提交':'保存处理意向'}</button>` : ''}
        ${valid && mode === 'done' ? '<button type="button" data-batch-view="intent">修改处理意向</button>' : ''}
        </div>`;
    }

    function changeStage(next) {
      persist(draft, next);
      render();
      window.scrollTo(0, 0);
    }

    async function readReceipt() {
      const result = await PFBusiness.batch(receiptId());
      if (result.batch.queryId !== scope) throw Error('该处理回执不属于本次查询。');
      receipt = result.batch;
      canPlan = !result.queryArchived && !result.memberArchived && Object.keys(result.items).length > 0;
      if (!signal.aborted) render();
    }

    area.addEventListener('change', event => {
      const input = event.target.closest('[data-batch-pick]');
      if (!input || busy || draft.pending || !eligible.has(input.value)) return;
      const ids = input.checked ? [...new Set([...draft.ids, input.value])] : draft.ids.filter(id => id !== input.value);
      try { persist({...draft, ids}); }
      catch (error) { fail(error); }
      paintBar();
    }, {signal});
    bar.querySelector('[data-batch-next]').onclick = () => {
      if (!draft.ids.length) return;
      try { changeStage('confirm'); } catch (error) { fail(error); }
    };
    view.addEventListener('change', event => {
      const input = event.target.closest('[data-batch-intent]');
      if (!input || busy || draft.pending) return;
      try { persist({...draft, intents: {...draft.intents, [input.dataset.batchIntent]: input.value}}); }
      catch (error) { render(); fail(error); }
    }, {signal});
    view.addEventListener('click', async event => {
      const action = event.target.closest('button');
      if (!action || busy) return;
      busy = true;
      saving = true;
      action.disabled = true;
      let saved = false;
      let submitting = false;
      try {
        if (action.hasAttribute('data-batch-view')) {
          if (action.dataset.batchView === 'done') await readReceipt();
          else if (!draft.pending) changeStage(action.dataset.batchView);
          return;
        }
        if (action.hasAttribute('data-batch-remove')) {
          persist({...draft, ids: draft.ids.filter(id => id !== action.dataset.batchRemove)});
          render();
        }
        if (!action.hasAttribute('data-batch-save')) return;
        if (!draft.pending) {
          if (!draft.ids.length || draft.ids.some(id => !Object.hasOwn(choices, draft.intents[id])))
            throw Error('请先为每项政策选择处理意向。');
          if (!window.PFQuerySnapshot?.current || !safeScope()) throw Error('请返回本次查询结果再继续。');
          const data = await PFBusiness.query(scope);
          const selected=entries(draft.ids);
          if (selected.some(entry=>!entry.followupProof)) throw Error('请刷新政策核对结果，再保存选择。');
          const pending = {queryId:scope, memberId:window.PFQuerySnapshot.current.memberId, operationId:crypto.randomUUID(), entries:selected.map(entry=>({
            policyId:entry.policy_id, intent:draft.intents[entry.policy_id],
            expectedRevision:data.items[entry.policy_id]?.revision??0, proof:entry.followupProof,
          }))};
          persist({...draft, pending});
        }
        if (!safeScope() || draft.pending.queryId !== scope) throw Error('请返回本次查询结果再继续。');
        submitting = true;
        const response=await PFBusiness.command('batch', draft.pending);
        saved = true;
        receipt = response.batch;
        canPlan = receipt.entries.some(entry=>entry.intent==='verify');
        persist({...draft, pending:null}, 'done', receipt.id);
        render();
        window.scrollTo(0, 0);
      } catch (error) {
        if (submitting && !saved && error.status>=400 && error.status<500) {
          persist({...draft, pending:null});
        }
        if (submitting) render();
        fail(Error(saved ? '处理意向已保存，但页面未能切换。请重试读取原提交。' :
          `${error.message} ${draft.pending?'提交结果尚未确认，请重试本次提交。':'当前选择已保留，可重试。'}`));
      } finally {
        busy = false;
        saving = false;
        action.disabled = false;
        const update = deferred;
        deferred = undefined;
        if (!signal.aborted) update?.();
      }
    }, {signal});
    app.addEventListener('click', event => {
      if (!draft.ids.length || stage() === 'done') return;
      if (!event.target.closest('#queryEnd,#structuredEdit,.hybrid-tabbar [data-tab]')) return;
      if (event.target.closest('.hybrid-tabbar [aria-current="page"]')) return;
      if (!window.confirm('离开后，本次选择保留在当前标签页的结果历史中。可用浏览器后退恢复。确定离开？')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, {capture: true, signal});
    render();
    if (stage() === 'done' && receiptId()) readReceipt().catch(error=>{if(!signal.aborted)fail(error);});
    window.addEventListener('pageshow', event=>{
      if(event.persisted && stage()==='done' && receiptId()){
        canPlan=false;
        render();
        readReceipt().catch(error=>{if(!signal.aborted)fail(error);});
      }
    }, {signal});
  }

  return {mount, afterSave};
})();
