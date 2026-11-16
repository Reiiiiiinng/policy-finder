import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../frontend/assets/navigation-policy.js', import.meta.url), 'utf8');
const origin = 'http://127.0.0.1:28762/';

function navigationAt(path) {
  const context = {
    location: new URL(path, origin), URL, URLSearchParams,
    window: { addEventListener() {} },
    document: { documentElement: { dataset: {} }, referrer: '', addEventListener() {} },
    history: { state: null, replaceState() {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.PFNavigation;
}

test('member selection can return to the original policy with its search context', () => {
  const parent = 'search.html?back=gz_elderly_007&q=医疗';
  const policy = 'policy.html?id=gz_elderly_007&from=' + encodeURIComponent(parent);
  const nav = navigationAt('find.html?choose=1&from=' + encodeURIComponent(policy));
  const target = nav.returnTarget('');
  assert.equal(target, policy);
  assert.equal(nav.route(target).section, 'search');
  const returned = new URL(nav.withParams(target, { member: 'selected-member' }), origin);
  assert.equal(returned.searchParams.get('id'), 'gz_elderly_007');
  assert.equal(returned.searchParams.get('member'), 'selected-member');
  assert.equal(returned.searchParams.get('from'), parent);
});

test('ordinary discovery without a return destination keeps its existing route', () => {
  const nav = navigationAt('find.html?choose=1');
  assert.equal(nav.returnTarget(''), '');
  assert.equal(nav.route().section, 'discover');
});

test('allowing policy returns does not allow an external destination', () => {
  const nav = navigationAt('find.html?choose=1&from=' +
    encodeURIComponent('https://example.com/policy.html?id=example'));
  assert.equal(nav.returnTarget(''), '');
});
