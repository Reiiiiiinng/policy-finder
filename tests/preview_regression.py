"""Launch the normal preview with a deterministic DeepSeek test double."""

import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("PF_V33_PORT", "8148")
os.environ.setdefault("PF_V33_INSTANCE", "browser-test")
os.environ["PF_V33_SEARCH_MODE"] = "mock"

from preview import main
from test_v32 import Model


class BrowserModel(Model):
    def chat_json(self, messages, **options):
        result = super().chat_json(messages, **options)
        if "answer" in result:
            result["answer"] = "请向主管部门核实参保、户籍和困难认定的要求，以当地公布的材料清单为准。" * 20
            result["new_fact_indices"] = []
        return result


if __name__ == "__main__":
    main(lambda: BrowserModel(["fs_med_002"]))
