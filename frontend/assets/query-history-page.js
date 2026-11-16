(() => {
  const status = document.querySelector('#historyStatus');
  const unlock = document.querySelector('#historyUnlock');
  const content = document.querySelector('#historyContent');
  const picker = document.querySelector('#historyMember');
  const list = document.querySelector('#historyList');
  const count = document.querySelector('#historyCount');
  const back = document.querySelector('.history-top .q-back');
  let request = 0;

  function syncHistoryReturn(member = picker.value) {
    const fallback = PFNavigation.withParams('services.html', member ? {member} : {});
    back.href = PFNavigation.returnTarget(fallback);
    const mine = document.querySelector('.pf-global-nav [data-tab="mine"]');
    if (mine) mine.href = fallback;
  }

  function report(error) {
    status.textContent = error.message;
    status.dataset.state = 'error';
    if (error.status === 401) {
      content.hidden = true;
      unlock.hidden = error.code === 'LOGIN_REQUIRED';
    }
  }

  async function load() {
    const seq = ++request;
    const member = picker.value;
    syncHistoryReturn(member);
    list.replaceChildren();
    count.textContent = '';
    status.dataset.state = 'info';
    if (!member) {
      status.textContent = '请选择成员后查看查询历史。';
      return;
    }
    status.textContent = '正在读取查询历史…';
    try {
      const data = await PFBusiness.historyList(member);
      if (seq !== request) return;
      status.textContent = data.queries.length ? '' : '这位成员还没有查询记录。';
      count.textContent = data.queries.length + ' 次查询';
      for (const [index, row] of data.queries.entries()) {
        const card = document.createElement('article');
        card.className = 'q-section history-card';
        const head = document.createElement('div');
        head.className = 'history-card-head';
        const title = document.createElement('h3');
        title.textContent = row.region;
        const version = document.createElement('span');
        version.className = 'history-version';
        version.textContent = row.version === 1 ? '原始查询' : '编辑版本 ' + row.version;
        head.append(title, version);
        const created = document.createElement('p');
        created.className = 'history-time';
        const time = document.createElement('time');
        time.dateTime = new Date(row.createdAt).toISOString();
        time.textContent = new Date(row.createdAt).toLocaleString('zh-CN');
        created.append(time);
        const info = document.createElement('p');
        info.className = 'history-snapshot-note';
        info.textContent = row.hasSnapshot ? '' : '本次仅保存了提交资料';
        info.hidden = !!row.hasSnapshot;
        const actions = document.createElement('div');
        actions.className = 'history-card-actions';
        const open = document.createElement('a');
        open.className = 'history-open';
        open.href = PFNavigation.withParams(PFNavigation.resultURL(row.mode === 'self', row.queryId),
          {member, entry: PFNavigation.withParams('query-history.html',
            {member, from: PFNavigation.returnTarget('') || undefined})});
        open.textContent = row.hasSnapshot ? '查看本次结果' : '查看提交资料';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'q-clear history-delete';
        remove.textContent = '删除';
        remove.setAttribute('aria-label', '删除' + row.region + '本次查询历史');
        remove.setAttribute('aria-expanded', 'false');
        const confirmation = document.createElement('div');
        confirmation.className = 'history-delete-confirm';
        confirmation.id = 'historyRemoveConfirm-' + index;
        confirmation.hidden = true;
        confirmation.setAttribute('role', 'group');
        const confirmationText = document.createElement('p');
        confirmationText.className = 'history-confirm-message';
        confirmationText.id = 'historyRemovePrompt-' + index;
        confirmationText.textContent = '从查询历史中移除本次查询及其版本？已保存的咨询、计划和处理记录仍会保留。';
        confirmation.setAttribute('aria-labelledby', confirmationText.id);
        remove.setAttribute('aria-controls', confirmation.id);
        const confirmationActions = document.createElement('div');
        confirmationActions.className = 'history-confirm-actions';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'history-confirm-cancel';
        cancel.textContent = '取消';
        const confirmRemove = document.createElement('button');
        confirmRemove.type = 'button';
        confirmRemove.className = 'history-confirm-remove';
        confirmRemove.textContent = '确认移除';
        const confirmationStatus = document.createElement('p');
        confirmationStatus.className = 'history-confirm-status';
        confirmationStatus.setAttribute('role', 'status');
        confirmationActions.append(cancel, confirmRemove);
        confirmation.append(confirmationText, confirmationActions, confirmationStatus);
        remove.onclick = () => {
          confirmation.hidden = false;
          confirmationStatus.textContent = '';
          remove.setAttribute('aria-expanded', 'true');
          cancel.focus();
        };
        cancel.onclick = () => {
          confirmation.hidden = true;
          remove.setAttribute('aria-expanded', 'false');
          remove.focus();
        };
        confirmRemove.onclick = async () => {
          if (confirmation.hidden || confirmRemove.disabled) return;
          confirmRemove.disabled = true;
          cancel.disabled = true;
          remove.disabled = true;
          confirmationStatus.textContent = '正在从查询历史中移除…';
          try {
            await PFBusiness.archiveQuery(row.queryId, row.version);
            if (picker.value === member) await load();
          } catch (error) {
            report(error);
            confirmationStatus.textContent = '未能移除：' + error.message;
            confirmRemove.disabled = false;
            cancel.disabled = false;
            remove.disabled = false;
          }
        };
        actions.append(open, remove);
        card.append(head, created, info, actions, confirmation);
        list.append(card);
      }
    } catch (error) {
      if (seq === request) report(error);
    }
  }

  async function start() {
    syncHistoryReturn(new URLSearchParams(location.search).get('member'));
    try {
      if (!await PFBusiness.enabled()) {
        status.textContent = '当前预览未启用 SQLite 查询历史。';
        return;
      }
      const members = await PFBusiness.members();
      picker.replaceChildren(new Option('请选择成员', ''), ...members.map(row => new Option(
        row.name + (row.archivedAt ? '（已归档）' : ''), row.id)));
      const preferred = new URLSearchParams(location.search).get('member');
      if (members.some(row => row.id === preferred)) picker.value = preferred;
      unlock.hidden = true;
      content.hidden = false;
      syncHistoryReturn();
      if (preferred !== null && !picker.value) status.textContent = '无法恢复指定成员，请重新选择。';
      else await load();
    } catch (error) { report(error); }
  }

  unlock.onsubmit = async event => {
    event.preventDefault();
    const button = unlock.querySelector('button');
    const token = unlock.querySelector('input');
    button.disabled = true;
    try {
      await PFBusiness.unlock(token.value);
      unlock.reset();
      await start();
    } catch (error) {
      unlock.reset();
      report(error);
    } finally {
      button.disabled = false;
    }
  };
  picker.onchange = () => {
    const url = new URL(location.href);
    if (picker.value) url.searchParams.set('member', picker.value);
    else url.searchParams.delete('member');
    history.replaceState(history.state, '', url);
    load();
  };
  addEventListener('pageshow', event => { if (event.persisted) start(); });
  start();
})();
