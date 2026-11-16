"""Run the isolated browser fixture with clearly marked synthetic AI."""

import json
import os

from preview_regression import BrowserModel, main
from policy_engine import detect_scenes


class ManualModel(BrowserModel):
    def chat_json(self, messages, **options):
        data = json.loads(messages[-1]["content"])
        if "catalogue" in data:
            scenes = set(detect_scenes("。".join(data["facts"])))
            ids = set()
            if scenes & {"需要照护", "需要长期照护", "长期卧床", "行动不便"}:
                ids.add("fs_care_001")
            if scenes & {"住院自付高", "大病医疗支出", "长期服药"}:
                ids.update(("fs_med_001", "fs_med_002"))
            if scenes & {"突发生活困难", "家庭经济困难", "收入偏低"}:
                ids.add("fs_med_005")
            self.ids = sorted(ids)
        return super().chat_json(messages, **options)


if __name__ == "__main__":
    factory = ManualModel if os.environ.get("PF_V34_CARE_FIXTURE") == "1" else BrowserModel
    main(lambda: factory(["fs_med_001", "fs_med_002", "fs_med_005"]))
