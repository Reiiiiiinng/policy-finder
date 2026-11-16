"""Synthetic preview data using the source patterns in the prior test report."""

from time import sleep

from cleversee import SearchError


def mock_transport(query, limit, key, proxy):
    sleep(0.45)
    if query == "模拟网络异常":
        raise SearchError("network")
    if query == "模拟超时":
        raise SearchError("timeout")
    if query == "模拟额度不足":
        raise SearchError("quota")
    if query == "注入":
        return {"pageItems": [
            {"title": "<img src=x onerror=window.injected=1>",
             "link": "https://example.org/injection-check", "snippet": "<script>window.injected=1</script>"},
            {"title": "非法协议", "link": "javascript:window.injected=1"},
        ]}
    return {"pageItems": _meal_samples() if "助餐" in query or "饭堂" in query else []}


def _meal_samples():
    return [
        {"title": "佛山市禅城区长者饭堂送餐服务实施方案",
         "link": "https://www.foshan.gov.cn/gfxwj/qjgfxwj/ccq/ccqbmgfxwj/content/post_5955473.html",
         "hostname": "佛山市人民政府门户网站",
         "snippet": "模拟摘要：长者饭堂送餐服务实施方案及相关政策文件的查阅线索。"},
        {"title": "佛山市禅城区长者饭堂送餐服务实施方案（修订）政策解读",
         "link": "http://www.chancheng.gov.cn/zwgk/zcjdzl/bmjd/content/post_7209317.html",
         "hostname": "禅城区人民政府门户网",
         "snippet": "模拟摘要：从政府政策解读栏目了解长者饭堂送餐服务。"},
        {"title": "禅城区长者助餐服务资讯",
         "link": "http://mz.foshan.gov.cn/gkmlpt/content/6/6039/mpost_6039308.html",
         "hostname": "佛山市民政局", "snippet": "模拟摘要：民政部门发布的助餐服务资讯线索。"},
        {"title": "禅城长者饭堂服务报道", "link": "https://pc.nfnews.com/2669/12066397.html",
         "hostname": "南方网", "snippet": "模拟摘要：媒体报道提供长者饭堂服务线索。"},
        {"title": "来源不明的助餐转载线索", "link": "https://example.org/meal-service",
         "snippet": "模拟摘要：来源和内容均待核实。"},
    ]
