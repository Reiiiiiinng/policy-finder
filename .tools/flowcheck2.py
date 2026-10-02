import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run
js = """(() => {
  const b = document.querySelector('[data-confirm="hukou"][data-value="true"]');
  const row = document.querySelector('[data-confirm="hukou"]') ? document.querySelectorAll('.role-val') : null;
  return JSON.stringify({
    y: scrollY,
    h: document.documentElement.scrollHeight,
    btnViewportTop: b ? Math.round(b.getBoundingClientRect().top) : null,
    profileHukou: (JSON.parse(sessionStorage.getItem('policy_finder_session')||'{}').profile||{}).hukou
  });
})()"""
print(run(["eval", "--stdin"], js, 40).strip())
shot = os.path.join(W, ".ui-shots", "flow-results.png")
print(run(["screenshot", shot], None, 60).strip())
