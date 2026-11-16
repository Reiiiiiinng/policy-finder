'use strict';

const byId = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role=tab]')];
const local = byId('local-query');
const web = byId('web-query');
const webButton = byId('web-form').querySelector('button');
const sourceLabels = {
  government_policy: '政府政策文件',
  government_explainer: '政策解读',
  government_information: '政府部门资讯',
  third_party_information: '第三方资讯',
  unknown: '来源待确认',
};
let catalogue;
let localLoading = false;
let webLoading = false;
let lastWebQuery = '';

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', '#icon-' + name);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function feedback(mode, message, error = false, ready = false) {
  const status = byId(mode + '-status');
  status.textContent = message;
  status.toggleAttribute('data-error', error);
  status.toggleAttribute('data-ready', ready);
}

function activate(tab) {
  for (const item of tabs) {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    const mode = item.id === 'local-tab' ? 'local' : 'web';
    byId(mode).hidden = !active;
    byId(mode + '-form').hidden = !active;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => activate(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs.find(item => item !== tab);
    activate(next);
    next.focus();
  });
}

function labeledBadge(text, glyph, tone) {
  const badge = node('span', text, 'badge ' + tone);
  if (glyph) badge.prepend(icon(glyph));
  return badge;
}

const categoryGlyphs = new Map([
  ['前置认定', 'family'],
  ['医疗救助', 'medical'],
  ['医疗保障', 'care-cover'],
  ['大病保险', 'critical-cover'],
  ['门诊保障', 'outpatient'],
  ['临时救助', 'relief'],
  ['商业补充', 'supplement'],
  ['养老保障', 'allowance'],
]);

function policyGlyph(policy) {
  const {category, service_type: service, policy_name: title = ''} = policy;
  if (category === '养老服务') {
    if (/评估/.test(title) || service === '照护服务') return 'assessment';
    if (/床位/.test(title)) return 'bed';
    if (/上门/.test(title)) return 'home-visit';
    if (/助餐|配餐|送餐/.test(title)) return 'meals';
    if (service === '社区照护') return 'community';
    if (service === '居住环境改善' || /适老化改造/.test(title)) return 'access';
  }
  if (category === '健康服务') return /认知/.test(title) ? 'cognition' : 'wellness';
  return categoryGlyphs.get(category) ?? 'file';
}

function localCard(policy) {
  const card = node('article', '', 'result local-result');
  card.id = 'policy-' + policy.policy_id;
  const picture = node('div', '', 'result-icon');
  picture.append(icon(policyGlyph(policy)));
  const content = node('div', '', 'local-copy');
  content.append(node('h2', policy.policy_name));
  const summary = policy.description?.trim();
  if (summary) content.append(node('p', summary, 'snippet'));

  const badges = node('div', '', 'badges');
  if (policy.region) badges.append(labeledBadge(policy.region, 'pin', 'region'));
  if (policy.category) badges.append(labeledBadge(policy.category, 'file', 'category'));
  if (policy.verification_status === 'verified') {
    badges.append(labeledBadge('来源已核验', 'shield', 'official'));
  } else if (policy.verification_status === 'to_verify') {
    badges.append(labeledBadge('来源待核验', '', 'pending'));
  }
  card.append(picture, content, badges);
  const detail = node('a', '查看详情');
  detail.append(icon('next'));
  const from = new URLSearchParams({back: policy.policy_id});
  if (local.value.trim()) from.set('q', local.value.trim());
  detail.href = 'policy.html?' + new URLSearchParams({
    id: policy.policy_id,
    from: 'search.html' + (from.size ? '?' + from : ''),
  });
  detail.setAttribute('aria-label', '查看详情：' + policy.policy_name);
  card.append(detail);
  return card;
}

function renderLocal() {
  if (!catalogue) return;
  history.replaceState({...history.state, policySearchLocal: local.value}, '');
  const tokens = local.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = catalogue.filter(policy => {
    const text = [policy.policy_name, policy.category, policy.service_type, policy.region,
      policy.description, ...(policy.life_scenes || [])].join(' ').toLowerCase();
    return tokens.every(token => text.includes(token));
  });
  byId('local-results').replaceChildren(...matches.map(localCard));
  feedback('local', matches.length ? matches.length + ' 条已收录政策' : '未找到已收录政策，试试其他关键词。', false, matches.length > 0);
}

async function loadLocal() {
  if (localLoading) return;
  localLoading = true;
  byId('local-retry').hidden = true;
  feedback('local', '正在加载已收录政策…');
  try {
    const response = await fetch('/api/policies');
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Array.isArray(data.policies)) throw new Error();
    catalogue = data.policies;
    renderLocal();
    const anchor = new URLSearchParams(location.search).get('back');
    const card = anchor && byId('policy-' + anchor);
    if (card) requestAnimationFrame(() => {
      card.scrollIntoView({block: 'center'});
      card.querySelector('a').focus({preventScroll: true});
    });
  } catch {
    feedback('local', '已收录政策暂时无法加载。', true);
    byId('local-retry').hidden = false;
  } finally {
    localLoading = false;
  }
}

function webCard(result) {
  const card = node('article', '', 'result web-result');
  const badges = node('div', '', 'badges');
  const label = Object.hasOwn(sourceLabels, result.source_type) ? sourceLabels[result.source_type] : sourceLabels.unknown;
  const style = String(result.source_type).startsWith('government_') ? 'official'
    : result.source_type === 'third_party_information' ? 'third-party' : '';
  const badge = node('span', label, 'badge ' + style);
  badge.title = result.source_basis || '';
  const glyph = {
    government_policy: 'file', government_explainer: 'book',
    government_information: 'announcement', third_party_information: 'media',
  };
  badge.prepend(icon(Object.hasOwn(glyph, result.source_type) ? glyph[result.source_type] : 'info'));
  const groupLabel = {
    verified_official: '目录已核验', official_lead: '官方线索待核实',
    third_party: '第三方参考', unverified: '来源待判定'
  };
  badges.append(badge, node('span', groupLabel[result.group] || '待核实', 'badge pending'));
  // Provider-indexed dates alone do not establish an original publication date.
  if (result.published_at_verified === true && /^\d{4}-\d{2}-\d{2}$/.test(result.published_at)) {
    const date = node('time', result.published_at);
    date.dateTime = result.published_at;
    badges.append(date);
  }
  if (style === 'official') badges.append(labeledBadge('政府网站', '', 'site-badge official'));
  card.append(badges, node('h3', result.title));
  const source = [...new Set([result.source_name, result.source_host].filter(Boolean))];
  if (source.length) {
    const site = node('p', source.join(' · '), 'meta');
    site.prepend(icon('pin'));
    card.append(site);
  }
  if (result.snippet) card.append(node('p', result.snippet, 'snippet'));
  const date = new Date(result.retrieved_at);
  const time = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai'
  }).format(date);
  if (time) card.append(node('p', '检索于 ' + time, 'meta'));
  try {
    const url = new URL(result.url);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
      const link = node('a', '查看原文');
      link.append(icon('external'));
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', '查看原文（新标签页）：' + result.title);
      card.append(link);
    }
  } catch {
    // Results without a usable address have no external link.
  }
  return card;
}

async function searchWeb(query) {
  if (webLoading) return;
  const results = byId('web-results');
  results.replaceChildren();
  byId('web-results-title').hidden = true;
  byId('web-submitted-query').hidden = true;
  byId('web-notice').hidden = true;
  byId('web-retry').hidden = true;
  if (!query || query.length > 120) {
    feedback('web', '请输入 1 至 120 字的公开政策关键词。', true);
    web.focus();
    return;
  }
  lastWebQuery = query;
  webLoading = true;
  webButton.disabled = true;
  webButton.textContent = '搜索中';
  results.setAttribute('aria-busy', 'true');
  feedback('web', '正在搜索…');
  try {
    const response = await fetch('/api/search/web', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query}),
    });
    const data = await response.json();
    if (!response.ok) {
      feedback('web', data.error?.message || '联网搜索暂时不可用，请稍后重试。', true);
      byId('web-retry').hidden = false;
      return;
    }
    results.replaceChildren(...data.results.map(webCard));
    const count = data.results.length;
    byId('web-results-title').hidden = false;
    const submitted = byId('web-submitted-query');
    submitted.textContent = '关键词：' + query;
    submitted.hidden = false;
    byId('web-notice').hidden = !count;
    const message = count ? '共找到 ' + count + ' 条结果' : '未找到相关结果，试试其他关键词。';
    feedback('web', (data.mode === 'mock' ? '模拟演示 · ' : '') + message);
    if (count) {
      const number = node('strong', String(count));
      byId('web-status').replaceChildren(data.mode === 'mock' ? '模拟搜索 · 共找到 ' : '真实联网搜索 · 共找到 ', number, ' 条结果');
    }
    if (data.status === 'no_reliable_result') {
      byId('web-status').append(' · 暂未找到可靠的官方结果');
    }
  } catch {
    feedback('web', '无法取得联网搜索结果，请检查本地服务后重试。', true);
    byId('web-retry').hidden = false;
  } finally {
    webLoading = false;
    webButton.disabled = false;
    webButton.textContent = '搜索';
    results.removeAttribute('aria-busy');
  }
}

byId('local-form').addEventListener('submit', event => {
  event.preventDefault();
  renderLocal();
});
local.addEventListener('input', renderLocal);
byId('local-retry').addEventListener('click', loadLocal);
byId('web-form').addEventListener('submit', event => {
  event.preventDefault();
  searchWeb(web.value.trim());
});
web.addEventListener('input', () => { byId('web-retry').hidden = true; });
byId('web-retry').addEventListener('click', () => {
  webButton.focus();
  searchWeb(lastWebQuery);
});
const localParams = new URLSearchParams(location.search);
local.value = (history.state?.policySearchLocal ?? localParams.get('q') ?? '').slice(0, 120);
loadLocal();
if (localParams.has('web')) {
  web.value = localParams.get('web').slice(0, 120);
  activate(byId('web-tab'));
}
