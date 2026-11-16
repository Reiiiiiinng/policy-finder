(() => {
  const family = document.getElementById('family');
  const self = document.getElementById('self');
  const go = document.getElementById('go');
  if (!family || !self || !go) return;
  let mode = 'family';
  function select(value) {
    mode = value;
    family.setAttribute('aria-pressed', String(value === 'family'));
    self.setAttribute('aria-pressed', String(value === 'self'));
    go.textContent = (value === 'family' ? '开始家庭协助' : '开始查询我的政策') + ' →';
  }
  family.addEventListener('click', () => select('family'));
  self.addEventListener('click', () => select('self'));
  go.addEventListener('click', () => {
    if (mode === 'family') {
      goFamilyEntry();
    } else {
      document.querySelector('.hp-self-link').click();
    }
  });
})();
