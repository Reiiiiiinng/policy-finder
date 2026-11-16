window.PFMine = (() => {
  const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  const drawings = {
    star:'<path d="m12 2 3 6 7 .9-5 5 1.2 7-6.2-3.4L5.8 21 7 13.9l-5-5L9 8Z"/>',
    records:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8m-8 4h8m-8 4h4"/>',
    family:'<circle cx="10" cy="8" r="3.5"/><path d="M3 20a7 7 0 0 1 14 0m1-15a3.5 3.5 0 0 1 0 7m2 3a5 5 0 0 1 2 5"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.1.9-1.9 1.3-1.9 2.6M12 17h.01"/>',
    settings:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="#fffdf6"/><circle cx="16" cy="12" r="2" fill="#fffdf6"/><circle cx="10" cy="17" r="2" fill="#fffdf6"/>',
  };
  const draw = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + drawings[name] + '</svg>';
  const service = (id, label, description, art) => `<a id="${id}" class="mine-service"><span class="mine-service-icon">${art}</span>
    <span><strong>${label}</strong><small>${description}</small></span>${chevron}</a>`;
  let page;

  function mount() {
    const app = document.querySelector('.app');
    const overview = document.getElementById('vfOvLine');
    const favorites = document.createElement('div');
    favorites.append(document.getElementById('favList'), document.getElementById('favEmpty'));
    app.querySelector(':scope > .vf-actions').classList.remove('vf-actions');
    document.getElementById('entPlan').removeAttribute('id');
    page = document.createElement('main');
    page.id = 'businessMine';
    page.innerHTML = `
      <header class="mine-title"><a href="index.html"><img src="assets/brand-mark.svg" alt="" width="26" height="26"><span>政策找人</span></a><h1>我的</h1></header>
      <a class="mine-greeting" data-mine-route="members"><span class="mine-avatar">${avatarSvg('self')}</span>
        <span><strong>你好，欢迎回来</strong><small>管理你的家庭权益记录</small></span>${chevron}</a>
      <section aria-labelledby="mineFamilyTitle">
        <div class="mine-section-heading"><h2 id="mineFamilyTitle">我的家庭</h2>
          <a data-mine-route="members" id="mineFamilyCount"></a></div>
        <div id="minePeople" class="mine-people"></div>
      </section>
      <section class="mine-plan" aria-labelledby="minePlanTitle">
        <h2 id="minePlanTitle">家庭少跑腿计划</h2>
        <div class="mine-plan-inset">
          <div id="mineOverview"></div>
          <p id="mineProgressLabel" hidden></p>
          <progress id="mineProgress" aria-label="已结束办理事项" hidden></progress>
          <p id="mineNext" hidden></p>
          <div class="mine-plan-actions vf-actions">
            <a id="minePlanLink" class="mine-primary" data-mine-route="plans">查看计划 ${chevron}</a>
            <a id="entPlan" data-mine-route="plans" hidden>计划历史</a>
          </div>
        </div>
      </section>
      <section aria-labelledby="mineServicesTitle">
        <div class="mine-section-heading"><h2 id="mineServicesTitle">我的服务</h2></div>
        <div class="mine-services vf-actions">
          ${service('mineFavoritesLink', '权益清单', '我关注的政策', draw('star'))}
          ${service('mineLogs', '咨询与办理记录', '咨询和办理进度', draw('records'))}
          ${service('mineHistory', '查询历史', '找回之前的查询', icon('clock'))}
          ${service('mineMembers', '家庭成员管理', '添加或编辑成员', draw('family'))}
          ${service('minePending', '待核实清单', '需要继续确认的事项', icon('check-circle'))}
        </div>
        <details class="mine-disclosure" id="mineFavorites"><summary>权益清单 ${chevron}</summary></details>
        <div class="mine-quick"><a data-mine-route="saved">先记下来的政策</a></div>
      </section>
      <section aria-labelledby="mineHelpTitle">
        <div class="mine-section-heading"><h2 id="mineHelpTitle">帮助与说明</h2></div>
        <div class="mine-help">
          <details class="mine-disclosure"><summary>${draw('help')}使用帮助 ${chevron}</summary>
            <p>先选择要办理的家庭成员，再查看该成员的计划。政策适用和办理结果由受理机构认定。</p></details>
          <details class="mine-disclosure"><summary>${draw('settings')}设置 ${chevron}</summary>
            <p><a data-mine-route="members">管理家庭成员资料</a></p>
            <p><a href="services.html">清除当前成员选择</a></p></details>
        </div>
      </section>`;
    page.querySelector('#mineOverview').append(overview);
    page.querySelector('#mineFavorites').append(favorites);
    if (location.hash === '#mineFavorites') page.querySelector('#mineFavorites').open = true;
    const favoritesLink = page.querySelector('#mineFavoritesLink');
    favoritesLink.href = '#mineFavorites';
    favoritesLink.addEventListener('click', () => { page.querySelector('#mineFavorites').open = true; });
    app.prepend(page);
    document.body.classList.add('business-mine');
  }

  function render(scope, member, data) {
    if (!page) mount();
    const find = selector => page.querySelector(selector);
    const from = PFNavigation.current();
    const scoped = (url, params = {}) => PFNavigation.withParams(url, {...params, member, from});
    const follow = view => scoped('follow-up.html', {view});
    const selected = scope.members.find(row => row.id === member);
    const people = find('#minePeople');
    const relations = scope.members.map(row => row.relation);
    people.replaceChildren(...scope.members.map(row => {
      const card = document.createElement('a');
      card.href = PFNavigation.withParams('services.html', {member:row.id});
      card.className = 'mine-person';
      card.setAttribute('aria-label', [row.relation, row.name, row.archivedAt && '已归档'].filter(Boolean).join(' · '));
      card.innerHTML = `<span class="mine-avatar">${avatarSvg(memberAvatarRole(row.relation, row.relation === '本人' ? 'self' : 'family'))}</span>
        <strong>${escapeHtml(row.relation || row.name)}</strong>
        ${relations.indexOf(row.relation) !== relations.lastIndexOf(row.relation) ? '<small>'+escapeHtml(row.name)+'</small>' : ''}`;
      if (row.id === member) {
        card.setAttribute('aria-current', 'true');
        card.insertAdjacentHTML('beforeend', '<span class="mine-selected">' + icon('check') + '</span>');
      }
      return card;
    }));
    find('#mineFamilyCount').textContent = '家庭成员 ' + scope.members.length + ' 人 ›';
    for (const entry of page.querySelectorAll('[data-mine-route]')) entry.href = follow(entry.dataset.mineRoute);
    find('#mineLogs').href = follow('logs');
    find('#mineMembers').href = follow('members');
    find('#minePending').href = follow('list');
    const history = find('#mineHistory');
    const aiHistory = history.cloneNode(true);
    aiHistory.id = 'mineAiHistory';
    aiHistory.href = PFNavigation.withParams(scoped('analysis.html'), {view:'history'});
    aiHistory.querySelector('strong').textContent = 'AI 发现记录';
    aiHistory.querySelector('small').textContent = '查看家庭分析与追问';
    aiHistory.querySelector('.mine-service-icon').innerHTML = icon('compass');
    if (!find('#mineAiHistory')) history.after(aiHistory);
    else find('#mineAiHistory').href = aiHistory.href;
    history.href = scoped('query-history.html');

    const plans = Object.values(data?.plans ?? {});
    const overviewPlan = plans.find(row => row.status === 'active') || plans[0];
    const plan = data?.selectedPlan || overviewPlan;
    const line = find('#vfOvLine');
    line.hidden = false;
    line.textContent = data ? `${selected.relation} · ${plans.length} 份计划`
      : selected ? '正在读取所选成员的计划…'
        : scope.invalid ? '无法恢复指定成员，请重新选择。' : '请选择成员后查看计划和历史。';
    const meter = find('#mineProgress');
    const progressLabel = find('#mineProgressLabel');
    const next = find('#mineNext');
    meter.hidden = !plan?.progress.active;
    progressLabel.hidden = meter.hidden;
    next.hidden = !data;
    if (plan) {
      const task = plan.tasks.find(row => plan.progress.ids.includes(row.policyId) &&
        !['completed','rejected','paused'].includes(row.stage) && !['completed','deferred'].includes(row.status));
      meter.max = plan.progress.active || 1;
      meter.value = plan.progress.closed ?? plan.progress.done;
      progressLabel.textContent = `已结束 ${meter.value} / ${meter.max} 项`;
      next.textContent = task ? '下一步 · ' + (task.nextAction?.reason || '查看当前办理事项') :
        plan.status === 'completed' ? '查看已办事项和结果' : '查看计划中的办理事项';
    } else if (data) {
      next.textContent = '可以从待核实清单选择政策并创建计划。';
    }
    find('#entPlan').hidden = !selected;
  }

  return {render};
})();
