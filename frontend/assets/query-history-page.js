(() => {
  const status = document.querySelector('#historyStatus');
  const unlock = document.querySelector('#historyUnlock');
  const content = document.querySelector('#historyContent');
  const picker = document.querySelector('#historyMember');
  const list = document.querySelector('#historyList');
  let request = 0;

  function report(error) {
    status.textContent = error.message;
    if (error.status === 401) {
      content.hidden = true;
      unlock.hidden = error.code === 'LOGIN_REQUIRED';
    }
  }

  async function load() {
    const seq = ++request;
    const member = picker.value;
    list.replaceChildren();
    if (!member) {
      status.textContent = '请选择成员后查看查询历史。';
      return;
    }
    status.textContent = '正在读取查询历史…';
    try {
      const data = await PFBusiness.historyList(member);
      if (seq !== request) return;
      status.textContent = data.queries.length ? '' : '这位成员还没有查询记录。';
      for (const row of data.queries) {
        const card = document.createElement('section');
        card.className = 'q-section';
        const title = document.createElement('h2');
        title.textContent = row.region + ' · ' + new Date(row.createdAt).toLocaleString('zh-CN');
        const info = document.createElement('p');
        info.textContent = (row.version === 1 ? '原始查询' : '编辑版本 ' + row.version) +
          (row.hasSnapshot ? '' : ' · 仅有提交资料');
        const open = document.createElement('a');
        open.href = PFNavigation.withParams(PFNavigation.resultURL(row.mode === 'self', row.queryId),
          {member, entry: PFNavigation.withParams('query-history.html', {member})});
        open.textContent = '查看本次结果';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'q-clear';
        remove.textContent = '删除查询历史';
        remove.onclick = async () => {
          if (!confirm('从查询历史中移除本次查询及其版本？已保存的咨询、计划和处理记录仍会保留。')) return;
          remove.disabled = true;
          try {
            await PFBusiness.archiveQuery(row.queryId, row.version);
            if (picker.value === member) await load();
          } catch (error) {
            report(error);
            remove.disabled = false;
          }
        };
        card.append(title, info, open, remove);
        list.append(card);
      }
    } catch (error) {
      if (seq === request) report(error);
    }
  }

  async function start() {
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
