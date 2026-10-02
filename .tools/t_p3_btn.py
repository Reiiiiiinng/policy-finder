import sys, os, time
W = r"C:/Users/admin/WorkBuddy/2026-09-29-10-57-50"
sys.path.insert(0, os.path.join(W, ".tools"))
from abx import run

def ev(js, t=45):
    return run(["eval", "--stdin"], js, t).strip()

run(["open", "http://127.0.0.1:8000/policy.html?id=gz_elderly_010&t=btn1"], None, 45)
time.sleep(2.0)
print(ev("""(() => {
  return JSON.stringify([...document.querySelectorAll('button')].map(b => {
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return {
      cls: b.className,
      text: b.textContent.trim().slice(0, 12),
      h: Math.round(r.height * 10) / 10,
      minH: cs.minHeight,
      pad: cs.padding,
      fs: cs.fontSize,
      lh: cs.lineHeight,
      disp: cs.display,
      box: cs.boxSizing
    };
  }));
})()"""))
