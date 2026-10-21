/* 由 build/build_pages.py 生成，请勿手改。 */
/* 政策库来自 data/guangzhou_elderly_policy_v1.1.json */
const POLICY_DB = {
"database_name": "广州养老政策数据库",
"version": "V1.1",
"region": "广州市",
"target_group": "老年人",
"purpose": "AI公共服务权益发现",
"schema_note": "本库为《政策找人》产品原型的数据层。字段设计面向未来 RAG：conditions 为结构化可检索条件，life_scenes 为生活场景标签，ai_reason 为政策侧表述（含 {who}/{age}/{region} 占位符），scene_reason_map 仅在对应生活场景被识别时才会生成推荐理由（避免无依据断言），rag_text 由后端 build_rag_text() 生成用于向量化。",
"last_verified_at": "2026-10-11",
"disclaimer": "AI仅进行初步匹配，用于提示可能相关的公共服务权益，不代表符合资格。所有结论须由主管部门核定。",
"scene_tag_library": [
"年龄增长",
"独居",
"行动不便",
"吃饭困难",
"需要照护",
"长期卧床",
"医疗护理压力",
"记忆下降",
"跌倒风险",
"子女无法陪伴",
"经济压力",
"不了解政策"
],
"status_vocabulary": {
"可能相关": "政策条件与画像基本吻合，仍需用户确认关键信息",
"待确认": "存在关键信息缺口，需用户补充后才能判断相关性",
"待核验": "政策来源尚未核到一手文件，不得作为确定结论展示"
},
"policies": [
{
"policy_id": "gz_elderly_001",
"policy_name": "老年人照护需求综合评估",
"category": "养老服务",
"service_type": "照护服务",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"行动不便",
"需要照护",
"身体能力下降",
"不了解政策"
],
"target_people": [
"60周岁及以上老年人",
"具有照护需求的老年人"
],
"description": "按照全市统一的评估标准，对具有照护需求且符合规定条件的老年人，依申请评估其能力程度、健康状况、社会支持情况，确定评估等级。评估结论是享受长期护理保险待遇和养老服务补贴等政策的重要依据。",
"conditions": {
"age_min": 60,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "广州市",
"other": [
"具有照护需求",
"符合规定条件"
]
},
"match": {
"scene_signals": [
"行动不便",
"需要照护",
"长期卧床",
"医疗护理压力",
"身体能力下降"
],
"priority": 1
},
"missing_information": [
"老人具体健康与失能情况",
"是否已做过照护需求评估",
"所属区、街道，以便确定申请入口"
],
"ai_reason": [
"{who}年龄{age}岁，达到60周岁及以上的服务范围",
"该评估面向具有照护需求的老年人，是申请多项养老服务的前提"
],
"service_note": "评估结论是后续申请长期护理保险待遇、养老服务补贴的重要依据，通常建议优先办理。",
"application_process": [
{
"step": "向居住地的街镇居家养老服务平台或社区养老服务组织提出评估申请",
"to_verify": false
},
{
"step": "由评估机构按全市统一标准开展评估",
"to_verify": false
},
{
"step": "获取评估等级结论，据此申请相应服务和待遇",
"to_verify": false
}
],
"source": {
"department": "广州市民政局",
"document": "广州市基本养老服务清单（2024年版）",
"document_no": "穗民〔2024〕76号",
"publish_date": "2024-07-17",
"official_url": "https://mzj.gz.gov.cn/gkmlpt/content/9/9770/post_9770240.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29",
"note": "政策名称、对象、服务内容与依据文件已核对；具体受理入口以街镇办理指引为准。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。",
"keywords": [
"照护需求",
"能力评估",
"失能评估",
"评估等级",
"养老服务补贴"
],
"scene_reason_map": {
"行动不便": "存在行动不便的情况，可能需要通过评估确定照护等级",
"需要照护": "存在照护需求，评估结论可作为申请服务和待遇的依据",
"长期卧床": "长期卧床通常对应较高照护等级，建议尽快评估",
"医疗护理压力": "医疗护理压力较大时，评估结论有助于申请相应待遇"
}
},
{
"policy_id": "gz_elderly_002",
"policy_name": "社区养老服务",
"category": "养老服务",
"service_type": "社区照护",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"独居",
"子女无法陪伴",
"需要社区帮助",
"不了解政策"
],
"target_people": [
"60周岁及以上老年人"
],
"description": "依托颐康中心（街道、镇层面）与颐康服务站（村、居层面）组成的社区养老服务网络，为老年人提供养老服务向导、日间托管、临时托养、康复护理、辅具租赁、平安通服务、文体教育等服务。",
"conditions": {
"age_min": 60,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "广州市",
"other": [
"所在社区服务覆盖情况"
]
},
"match": {
"scene_signals": [
"独居",
"子女无法陪伴",
"需要照护",
"行动不便"
],
"priority": 2
},
"missing_information": [
"老人的具体需求（日间托管、康复护理、助餐等）",
"所在社区（村居）颐康服务站的服务覆盖情况"
],
"ai_reason": [
"{who}年龄{age}岁，符合社区养老服务面向的年龄范围",
"社区养老服务依托颐康中心与颐康服务站，就近提供日常支持"
],
"service_note": "广州已形成颐康中心与颐康服务站“1+N”社区养老服务网络，一般可就近咨询所在社区的服务站点。",
"application_process": [
{
"step": "向所在社区（村居）颐康服务站或街道（镇）颐康中心咨询可提供的服务项目",
"to_verify": false
},
{
"step": "按服务项目要求提出申请并确认资格",
"to_verify": false
}
],
"source": {
"department": "广州市民政局",
"document": "广州市基本养老服务清单（2024年版）",
"document_no": "穗民〔2024〕76号",
"publish_date": "2024-07-17",
"related_document": "广州市居家社区养老服务管理办法（穗府办规〔2022〕13号）",
"official_url": "https://mzj.gz.gov.cn/gkmlpt/content/9/9770/post_9770240.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29",
"note": "清单2024年版已将养老服务向导、日间托管、临时托养、平安通、康复护理、辅具租赁、文体教育等7项服务纳入社区养老。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。",
"keywords": [
"颐康中心",
"颐康服务站",
"日间托管",
"临时托养",
"康复护理",
"辅具租赁",
"平安通"
],
"scene_reason_map": {
"独居": "独居老人可通过社区站点获得日间照料与日常关照",
"子女无法陪伴": "子女无法长期陪伴时，社区服务可作为日常补充",
"行动不便": "行动不便时可就近利用社区康复护理等服务",
"需要照护": "存在照护需求时，社区可提供日间托管、临时托养等支持"
}
},
{
"policy_id": "gz_elderly_003",
"policy_name": "老年人助餐配餐服务",
"category": "养老服务",
"service_type": "生活支持",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"吃饭困难",
"独居",
"行动不便"
],
"target_people": [
"在本市行政区域内居住的60周岁及以上居家老年人"
],
"description": "以长者饭堂为主要依托，为老年人提供制餐、配餐、分餐、就餐、送餐等服务。长者饭堂由区民政部门、镇人民政府（街道办事处）设置，工作日提供午餐，有条件的可提供早晚餐和周末服务。",
"conditions": {
"age_min": 60,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "在本市行政区域内居住",
"other": [
"居家老年人"
]
},
"match": {
"scene_signals": [
"吃饭困难",
"行动不便",
"独居"
],
"priority": 2
},
"missing_information": [
"所在街道、社区的长者饭堂点位与供餐方式",
"是否符合就餐、送餐补贴条件",
"老人是否需要送餐上门"
],
"ai_reason": [
"{who}年龄{age}岁，符合助餐配餐服务的年龄范围",
"该服务以长者饭堂为依托，提供就餐与送餐两种形式"
],
"service_note": "服务依托长者饭堂提供，覆盖集中就餐与送餐上门两种形式。补贴标准由区民政部门或镇街确定，各区可能存在差异。",
"application_process": [
{
"step": "向所在街镇或就近长者饭堂咨询并提出助餐配餐服务申请",
"to_verify": false
},
{
"step": "由区民政部门或镇人民政府（街道办事处）确认就餐、送餐补贴资格",
"to_verify": false
},
{
"step": "选择就餐或送餐方式并接受服务",
"to_verify": false
}
],
"source": {
"department": "广州市民政局",
"document": "广州市老年人助餐配餐服务管理办法",
"publish_date": "2024",
"official_url": "https://mzj.gz.gov.cn/gk/wgkzl/jcgk/content/post_7146126.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29",
"note": "服务对象、内容与补贴资格确认主体已核对；具体补贴金额各区自定，数据层不写入金额。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。",
"keywords": [
"长者饭堂",
"助餐",
"配餐",
"送餐",
"就餐补贴"
],
"scene_reason_map": {
"吃饭困难": "做饭或买菜困难，长者饭堂可提供就餐支持",
"行动不便": "行动不便时可申请送餐上门",
"独居": "独居老人的用餐问题可就近在长者饭堂解决"
}
},
{
"policy_id": "gz_elderly_004",
"policy_name": "居家上门服务",
"category": "养老服务",
"service_type": "居家照护",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"行动不便",
"无人照顾",
"子女无法陪伴"
],
"target_people": [
"60周岁及以上老年人",
"需要生活照料的老年人"
],
"description": "为居家老年人提供上门助洁、助浴、洗涤、生活护理、协助进餐、陪伴就医、代办服务等生活照料服务。",
"conditions": {
"age_min": 60,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "广州市",
"other": [
"需要生活照料"
]
},
"match": {
"scene_signals": [
"行动不便",
"需要照护",
"子女无法陪伴",
"独居"
],
"priority": 2
},
"missing_information": [
"老人身体与生活自理情况",
"是否符合当地居家上门服务的条件与补贴范围"
],
"ai_reason": [
"{who}年龄{age}岁，符合居家上门服务的年龄范围",
"上门服务覆盖助洁、助浴、陪伴就医等生活照料项目"
],
"service_note": "服务内容按基本生活照料设置，具体项目与补贴标准以各区执行口径为准。",
"application_process": [
{
"step": "向居住地街镇居家养老服务平台或社区养老服务组织提出服务需求",
"to_verify": false
},
{
"step": "由服务机构评估需求并确认服务项目与补贴资格",
"to_verify": false
}
],
"source": {
"department": "广州市民政局",
"document": "广州市基本养老服务清单（2024年版）",
"document_no": "穗民〔2024〕76号",
"publish_date": "2024-07-17",
"related_document": "广州市居家社区养老服务管理办法（穗府办规〔2022〕13号）",
"official_url": "https://mzj.gz.gov.cn/gkmlpt/content/9/9770/post_9770240.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。",
"keywords": [
"助洁",
"助浴",
"生活护理",
"陪伴就医",
"代办服务",
"上门服务"
],
"scene_reason_map": {
"行动不便": "行动不便时，助洁、助浴等上门服务可减轻生活困难",
"需要照护": "存在照护需求时，可由服务机构上门提供生活照料",
"子女无法陪伴": "子女无法长期陪护时，上门服务可作为补充",
"独居": "独居老人的日常起居可由上门服务分担"
}
},
{
"policy_id": "gz_elderly_005",
"policy_name": "家庭养老床位服务",
"category": "养老服务",
"service_type": "居家照护",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"长期卧床",
"需要照护",
"不愿入住养老机构"
],
"target_people": [
"失能或部分失能老年人"
],
"description": "依托有资质的养老服务组织，为失能、部分失能老年人居家环境进行智能化、适老化改造，将专业照护服务送到家，使老年人居家即可享受类机构的专业化养老服务。",
"conditions": {
"age_min": null,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": true,
"residence": "广州市",
"other": [
"失能或部分失能",
"家庭环境具备改造条件"
]
},
"match": {
"scene_signals": [
"长期卧床",
"需要照护",
"医疗护理压力",
"行动不便"
],
"priority": 1
},
"missing_information": [
"老人失能程度（建议先做照护需求综合评估）",
"家庭住房是否具备改造条件",
"是否已建立家庭养老床位"
],
"ai_reason": [
"该服务面向失能、部分失能老年人，把专业照护送到家",
"建议先完成照护需求综合评估，以确定失能程度"
],
"service_note": "通常包括居家环境智能化、适老化改造与专业照护上门两部分，建议与照护需求综合评估一并了解。",
"application_process": [
{
"step": "通过街镇居家养老服务平台或养老服务组织提出建床需求",
"to_verify": false
},
{
"step": "对老年人失能程度与家庭环境进行评估",
"to_verify": false
},
{
"step": "确认建床并开展适老化改造与上门照护服务",
"to_verify": false
}
],
"source": {
"department": "广州市民政局",
"document": "广州市基本养老服务清单（2024年版）",
"document_no": "穗民〔2024〕76号",
"publish_date": "2024-07-17",
"related_document": "广州市民政局 广州市财政局关于全面开展家庭养老床位建设和服务工作的通知（穗民规字〔2024〕4号）",
"official_url": "https://mzj.gz.gov.cn/gkmlpt/content/9/9770/post_9770240.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。",
"keywords": [
"家庭养老床位",
"建床",
"失能",
"部分失能",
"适老化改造",
"上门照护"
],
"scene_reason_map": {
"长期卧床": "长期卧床属于家庭养老床位的典型服务场景",
"需要照护": "照护压力较大时，可在家中建立养老床位",
"医疗护理压力": "需要持续护理时，家庭养老床位可提供类机构服务",
"行动不便": "行动不便且需要照护时，居家建床可减少往返奔波"
}
},
{
"policy_id": "gz_elderly_006",
"policy_name": "居家适老化改造",
"category": "养老服务",
"service_type": "居住环境改善",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"跌倒风险",
"行动不便",
"居家环境不安全"
],
"target_people": [
"居住在广州市、有居家适老化改造需求的老年人（可申请改造服务，含自费申请）",
"政府资助对象：本市户籍年满60周岁的居家老年人，其中①分散供养特困人员、低保/低保边缘家庭中的高龄、失能、残疾老年人；②失能的孤寡老人，优抚对象或计划生育特殊家庭中的失能老年人；③前述两类以外的分散供养特困人员、低保/低保边缘家庭、优抚对象、计划生育特殊家庭中的老年人及孤寡老人"
],
"description": "为老年人提供居家适老化改造咨询、方案设计、施工改造、设施配备与老年用品配置等服务，降低居家生活中的跌倒等安全风险。居住在广州市、有需求的老年人均可申请改造服务（含自费申请）；政府资助仅面向本市户籍年满60周岁且符合方案规定三类情形的老年人家庭。",
"conditions": {
"age_min": null,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "广州市",
"other": [
"居住在广州市、有居家安全改造需求",
"政府资助需本市户籍年满60周岁且符合方案规定的三类对象情形，具体以街镇核实为准"
]
},
"match": {
"scene_signals": [
"跌倒风险",
"行动不便",
"长期卧床",
"需要照护"
],
"priority": 2
},
"missing_information": [
"是否属于政府资助对象范围（本市户籍且符合方案规定的情形类别）",
"家庭住房情况（是否具备改造条件、拥有产权或3年以上长期使用权）",
"老人的具体改造需求"
],
"ai_reason": [
"该服务面向有居家安全需求的老年人，用于降低跌倒等居家风险",
"是否属于补贴对象范围需向所在街镇确认"
],
"service_note": "现行依据为穗民规字〔2025〕1号（2025年2月1日起施行，有效期3年）。改造服务可自费申请；政府资助对象范围与标准按方案规定执行，资助与残疾人家庭无障碍改造资助择高享受，具体以街镇核实为准。",
"application_process": [
{
"step": "老年人家庭通过广州市为老服务综合平台或线下向服务机构提出申请，资助对象由户籍地镇人民政府（街道办事处）进行资助资格初核",
"to_verify": false
},
{
"step": "服务机构入户评估并制定改造方案，与服务对象签订服务协议",
"to_verify": false
},
{
"step": "实施居家环境改造并配置适老用品",
"to_verify": false
},
{
"step": "改造完成后经入户核实与验收，符合条件的按方案规定获得资助",
"to_verify": false
}
],
"source": {
"department": "广州市民政局、广州市财政局、广州市残疾人联合会",
"document": "广州市老年人居家适老化改造工作实施方案",
"document_no": "穗民规字〔2025〕1号",
"publish_date": "2025",
"related_document": "广州市基本养老服务清单（2024年版）（穗民〔2024〕76号）；历史文件：穗民规字〔2021〕8号（已被2025年新方案替代，不再作为现行依据）",
"official_url": "https://mzj.gz.gov.cn/gkmlpt/content/10/10081/post_10081812.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-10-11",
"note": "现行依据已核至2025年新方案全文：穗民规字〔2025〕1号（2025-01-17发布，2025-02-01施行，有效期3年，官方页面标注现行有效）。历史文件穗民规字〔2021〕8号已被新方案替代，不再作为现行依据。办理流程与资助对象范围已按方案原文录入；资助金额不写入数据库。基本养老服务清单（穗民〔2024〕76号）仅作服务目录参考。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。",
"keywords": [
"适老化改造",
"防跌倒",
"居家安全",
"老年用品",
"无障碍"
],
"scene_reason_map": {
"跌倒风险": "存在跌倒风险，居家环境改造可提升安全性",
"行动不便": "行动不便时，居家无障碍改造有助于日常起居",
"长期卧床": "长期卧床时，家庭环境通常需要适老化调整",
"需要照护": "居家照护场景下，环境改造可减轻照护负担"
}
},
{
"policy_id": "gz_elderly_007",
"policy_name": "老年人健康管理",
"category": "健康服务",
"service_type": "公共卫生服务",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"长期健康问题",
"需要健康检查",
"慢性病管理"
],
"target_people": [
"65周岁及以上老年人"
],
"description": "为老年人提供健康评估、体检与健康指导等服务，通常由基层医疗卫生机构结合老年人健康管理相关工作提供。",
"conditions": {
"age_min": 65,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "广州市",
"other": []
},
"match": {
"scene_signals": [
"医疗护理压力",
"需要照护",
"年龄增长"
],
"priority": 3
},
"missing_information": [
"是否属于所在社区卫生服务机构的服务覆盖范围",
"是否已建立健康档案",
"老人近期是否已做过体检"
],
"ai_reason": [
"{who}年龄{age}岁，达到65周岁及以上的健康管理对象年龄范围",
"该服务由基层医疗卫生机构提供，具体内容需向所在社区核实"
],
"service_note": "老年人健康管理属国家基本公共卫生服务项目：国家规范要求每年为辖区内65岁及以上常住居民提供1次健康管理服务（生活方式和健康状况评估、体格检查、辅助检查和健康指导），由基层医疗卫生机构提供。广州本地具体服务点与预约方式，请向所在社区卫生服务中心或镇卫生院核实。",
"application_process": [
{
"step": "向居住地所在的社区卫生服务中心或镇卫生院咨询老年人健康管理服务",
"to_verify": true
}
],
"source": {
"department": "广州市卫生健康部门",
"document": "国家基本公共卫生服务规范（第三版）",
"document_no": "国卫基层发〔2017〕13号",
"publish_date": "2017",
"official_url": "https://www.nhc.gov.cn/wjw/c100175/201703/59887bd178624e5c89b02b0b690fad53.shtml"
},
"verification": {
"status": "to_verify",
"checked_at": "2026-10-11",
"note": "国家依据已核：《国家基本公共卫生服务规范（第三版）》（国卫基层发〔2017〕13号，2017-02-28印发）含《老年人健康管理服务规范》。广州本地具体服务点、办理或预约方式及执行细节尚未核到一手文件，展示时必须标注待核验；不判定用户个人是否符合条件。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。国家政策依据已核验，本地具体服务及预约方式仍待确认。",
"keywords": [
"健康管理",
"体检",
"健康评估",
"慢性病",
"健康档案"
],
"scene_reason_map": {
"医疗护理压力": "存在长期健康问题或就医需求，可关注老年人健康管理服务",
"需要照护": "需要照护的老人通常也需要持续的健康管理",
"年龄增长": "随着年龄增长，定期健康评估与体检尤为重要"
}
},
{
"policy_id": "gz_elderly_008",
"policy_name": "认知功能筛查",
"category": "健康服务",
"service_type": "健康管理",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"记忆下降",
"疑似认知问题",
"家属担心老人状态"
],
"target_people": [
"65周岁及以上老年人"
],
"description": "针对记忆下降、疑似认知障碍的老年人，可关注认知功能筛查与早期干预相关服务。国家层面已提出结合基本公共卫生老年人健康管理服务，推进65岁及以上老年人认知功能初筛。",
"conditions": {
"age_min": 65,
"age_max": null,
"hukou_required": null,
"insurance_required": false,
"disability_required": false,
"residence": "广州市",
"other": []
},
"match": {
"scene_signals": [
"记忆下降",
"需要照护"
],
"priority": 3
},
"missing_information": [
"是否存在记忆下降等相关症状",
"所在区是否开展面向老年人的认知功能筛查",
"是否已就医诊断"
],
"ai_reason": [
"该服务面向65周岁及以上老年人，是否开展需向所在区核实",
"本条政策来源尚未核验，请先向官方渠道确认"
],
"service_note": "国家层面已提出推进老年人认知功能初筛。广州本地具体服务点及预约方式，请向所在地基层医疗卫生机构核实。",
"application_process": [
{
"step": "向所在区的社区卫生服务中心或镇卫生院咨询老年人认知功能筛查服务",
"to_verify": true
}
],
"source": {
"department": "广州市卫生健康部门",
"document": "应对老年期痴呆国家行动计划（2024-2030年）",
"document_no": "国卫老龄发〔2024〕42号",
"publish_date": "2024",
"official_url": "https://www.nhc.gov.cn/wjw/c100375/202501/521ab3ce974c48a989e0b976ecf8f767.shtml",
"related_document": "关于做好2025年基本公共卫生服务工作的通知（国卫基层发〔2025〕7号）：继续开展老年人认知功能初筛"
},
"verification": {
"status": "to_verify",
"checked_at": "2026-10-11",
"note": "国家依据已核：《应对老年期痴呆国家行动计划（2024-2030年）》（国卫老龄发〔2024〕42号，2024-12-31印发）及《关于做好2025年基本公共卫生服务工作的通知》（国卫基层发〔2025〕7号）均提出推进老年人认知功能初筛。广州本地是否开展、具体服务点与预约方式尚未核到一手文件，展示时必须标注待核验；不得编造筛查频次与免费范围；筛查不构成医疗诊断。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。国家政策依据已核验，本地具体服务及预约方式仍待确认，请先向官方渠道核实。",
"keywords": [
"认知功能",
"记忆下降",
"认知障碍",
"筛查",
"阿尔茨海默"
],
"scene_reason_map": {
"记忆下降": "出现记忆下降等情况，可关注认知功能筛查服务",
"需要照护": "照护过程中如出现认知方面异常，可咨询筛查渠道"
}
},
{
"policy_id": "gz_elderly_009",
"policy_name": "长期护理保险服务",
"category": "医疗保障",
"service_type": "长期照护",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"长期卧床",
"护理费用压力",
"家庭照护困难",
"需要照护"
],
"target_people": [
"广州市职工社会医疗保险参保人",
"年满18周岁的城乡居民社会医疗保险参保人",
"长期失能人员"
],
"description": "长期护理保险为经评估符合条件的失能人员提供机构护理、居家护理、医疗护理与设备使用等待遇，由长护险基金按规定比例支付，用于减轻长期照护带来的费用压力。",
"conditions": {
"age_min": null,
"age_max": null,
"hukou_required": false,
"insurance_required": true,
"disability_required": true,
"residence": "广州市",
"other": [
"参加广州市社会医疗保险并建立长护险参保关系",
"经医疗机构或康复机构规范诊疗，失能状态持续6个月以上",
"经失能评估或老年人照护需求综合评估符合条件"
]
},
"match": {
"scene_signals": [
"长期卧床",
"医疗护理压力",
"需要照护",
"经济压力",
"行动不便"
],
"priority": 1
},
"missing_information": [
"是否参加广州市社会医疗保险（职工医保或城乡居民医保）",
"失能状态是否持续6个月以上",
"是否已完成失能评估及评估等级",
"是否已选择长护险定点护理机构"
],
"ai_reason": [
"长期护理保险面向失能人员提供护理待遇，用于减轻照护费用压力",
"需参加广州市医保并通过失能评估，请先确认参保与评估情况"
],
"service_note": "待遇按失能等级1-3级分类，与险种身份、服务类型挂钩。参保人可通过“粤医保”小程序、“穗好办”APP或经办机构提交评估申请，评估机构在13个工作日内完成受理审核及评估实施。",
"application_process": [
{
"step": "确认已参加广州市社会医疗保险（参保时由医保经办机构建立长护险参保关系，无需另外办理参保手续）",
"to_verify": false
},
{
"step": "通过“粤医保”小程序、“穗好办”APP或医保经办机构提交失能评估申请",
"to_verify": false
},
{
"step": "评估机构在13个工作日内完成受理审核及评估实施，评估结论公示并告知申请人",
"to_verify": false
},
{
"step": "选择长护险定点护理机构，按评估结论享受机构护理或居家护理待遇",
"to_verify": false
}
],
"source": {
"department": "广州市医疗保障部门",
"document": "广州市长期护理保险服务管理规定",
"document_no": "穗医保规字〔2023〕1号",
"publish_date": "2023",
"related_document": "广州市基本养老服务清单（2024年版）（穗民〔2024〕76号）",
"official_url": "https://www.gz.gov.cn/gzybj/gkmlpt/content/9/9425/post_9425447.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29",
"note": "参保对象、失能持续时间、评估要求与线上申请渠道已核对；具体待遇支付比例与限额以医保部门现行文件为准，数据层不写入金额。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。长期护理保险待遇须经评估后由医保部门核定。",
"keywords": [
"长护险",
"长期护理保险",
"失能评估",
"居家护理",
"机构护理",
"护理费用"
],
"scene_reason_map": {
"长期卧床": "长期卧床属于长护险关注的重度失能场景",
"医疗护理压力": "护理费用压力较大时，长护险可按规定比例支付相关费用",
"需要照护": "需要长期照护时，可评估是否达到长护险待遇条件",
"经济压力": "照护费用带来经济压力时，建议了解长护险待遇",
"行动不便": "行动不便且持续6个月以上时，可了解失能评估"
}
},
{
"policy_id": "gz_elderly_010",
"policy_name": "长者长寿保健金",
"category": "养老保障",
"service_type": "经济支持",
"region": {
"scope": "广州市",
"level": "市级"
},
"life_scenes": [
"年龄增长",
"不了解政策",
"经济压力"
],
"target_people": [
"具有广州市户籍且年满70周岁及以上的老年人"
],
"description": "对本市户籍年满70周岁及以上的老年人按月发放长寿保健金，发放标准按年龄段分档，并根据经济社会发展情况适时调整。",
"conditions": {
"age_min": 70,
"age_max": null,
"hukou_required": true,
"insurance_required": false,
"disability_required": false,
"residence": "广州市户籍",
"other": [
"需完成个人信息确认"
]
},
"match": {
"scene_signals": [
"年龄增长",
"经济压力",
"不了解政策"
],
"priority": 1
},
"missing_information": [
"老人是否具有广州市户籍（本项为硬条件）",
"老人是否已通过“穗好办”App或村（居）委完成个人信息确认",
"本人适用的发放档次（各区标准可能与市级标准不一致）"
],
"ai_reason": [
"{who}年龄{age}岁，达到70周岁及以上的发放年龄范围",
"该权益要求广州市户籍，需先确认户籍情况"
],
"service_note": "原则上由政府部门通过数据交互获取信息，经老年人确认后发放，无需申请和提供证件材料。年满70周岁起按月享受，每月25日前完成当月审批发放。各区现执行标准与市级标准不一致的可按原标准发放，黄埔区标准高于市级标准。",
"application_process": [
{
"step": "在年满70周岁前（可提前3个月）通过“穗好办”App核对并确认个人信息及银行账户，或到户籍所在地村（居）委确认",
"to_verify": false
},
{
"step": "无法线上确认的，可通过“粤省事”小程序、广州市为老服务综合平台或户籍所在村（居）委会办理申领",
"to_verify": false
},
{
"step": "确认后从年满70周岁当月起按月发放，每月25日前到账",
"to_verify": false
}
],
"source": {
"department": "广州市民政局、广州市财政局",
"document": "广州市长者长寿保健金发放管理办法",
"document_no": "穗民规字〔2026〕6号",
"publish_date": "2026-09",
"official_url": "https://mzj.gz.gov.cn/gkmlpt/content/10/10985/post_10985774.html"
},
"verification": {
"status": "verified",
"checked_at": "2026-09-29",
"note": "新版办法自2026年9月起实施，原穗民规字〔2021〕6号有效期已于2026年8月底届满。对象为本市户籍且年满70周岁及以上。发放标准按年龄段分档，各区可能与市级标准不一致，数据层不写入具体金额，展示时引导用户向户籍地街镇核实本人档次。"
},
"risk_notice": "AI仅进行初步匹配，不代表符合资格。具体金额以户籍所在区执行标准为准。",
"keywords": [
"长寿保健金",
"高龄津贴",
"70周岁",
"老年人补贴",
"穗好办"
],
"scene_reason_map": {
"年龄增长": "年满70周岁属于该权益的发放年龄范围",
"不了解政策": "高龄津贴类权益容易被遗漏，建议核实是否已在发放",
"经济压力": "该权益为按月发放的现金补贴，可核实是否已享受"
}
}
]
};

/**
 * 《政策找人》浏览器端政策引擎
 *
 * 这是 backend/policy_engine.py 的逐行移植，用在没有后端的环境（GitHub Pages）。
 * 移植原则：**不做任何"优化"**。函数边界、判断顺序、默认值、字符串拼接方式
 * 全部照抄 Python 版，因为任何一处偏差都会让浏览器算出的结果和服务器对不上，
 * 而 .tools/baseline.py 的 12 条基线用例正是盯着这些输出的。
 *
 * Python 与 JS 的语义差异已逐处处理，下面每个 `[py]` 注释都在说明对应关系。
 *
 * 数据来源：由 build/build_pages.py 把 data/*.json 内联成 DB 常量。
 */

// ---------------------------------------------------------------- 词典
// 与 policy_engine.py:38-83 逐字一致
const SCENE_KEYWORDS = {
  独居: ['独居', '一个人住', '一个人生活', '自己住', '独自居住', '单独居住', '一个人'],
  行动不便: ['行动不便', '行动不方', '走路困难', '腿脚不便', '腿脚不好', '腿脚不方便',
    '腿脚不灵活', '不能走', '走不动',
    '坐轮椅', '轮椅', '行动困难', '不方便行动', '出门困难'],
  吃饭困难: ['做饭困难', '吃饭困难', '吃饭难', '买菜', '没饭吃', '做不了饭', '吃饭问题'],
  需要照护: ['需要照护', '需要照顾', '要人照顾', '需要人照顾', '要人陪', '照护',
    '照顾', '护理', '陪护'],
  长期卧床: ['长期卧床', '卧床', '瘫痪', '下不了床', '起不来床', '躺床上'],
  医疗护理压力: ['医疗', '看病', '住院', '药费', '医药费', '护理费', '治疗',
    '生病', '慢性病', '身体不好', '健康'],
  记忆下降: ['记忆', '忘事', '健忘', '痴呆', '认知', '阿尔茨海默', '迷路', '糊涂'],
  跌倒风险: ['摔倒', '跌倒', '摔了', '摔跤', '滑倒'],
  子女无法陪伴: ['不在身边', '在外地', '没法陪', '无法陪', '没时间陪', '不能陪',
    '工作忙', '没人陪'],
  经济压力: ['费用高', '压力大', '经济困难', '没钱', '负担重', '费用压力'],
  不了解政策: ['不知道有', '不了解', '没听说过', '有哪些政策', '有什么补贴'],
  住院自付高: ['住院自付', '自付高', '自付费用高', '自付了', '自费高', '自付很多',
    '住院花', '住院费用高', '报销后还要', '自己掏'],
  大病医疗支出: ['大病', '重病', '重大疾病', '肿瘤', '癌症', '化疗', '透析', '手术费'],
  长期服药: ['长期吃药', '长期服药', '每天吃药', '常年吃药', '长期用药', '长期开药'],
  门诊特定病种: ['门诊特定病种', '门特', '门慢', '特定病种'],
  家庭经济困难: ['低保', '特困', '经济困难', '家庭困难', '困难家庭', '低收入'],
  收入偏低: ['收入低', '没有收入', '没收入', '收入不高', '没有固定收入'],
  需要长期照护: ['长期照护', '长期护理', '长期照顾'],
};

const RELATION_KEYWORDS = {
  父亲: ['父亲', '爸爸', '我爸', '老爸', '爹'],
  母亲: ['母亲', '妈妈', '我妈', '老妈', '娘'],
  爷爷: ['爷爷', '祖父'],
  奶奶: ['奶奶', '祖母'],
  外公: ['外公', '姥爷'],
  外婆: ['外婆', '姥姥'],
  配偶: ['老伴', '丈夫', '妻子', '爱人'],
};

const OPERATOR_KEYWORDS = {
  女儿: ['我是他女儿', '我是她女儿', '女儿'],
  儿子: ['我是他儿子', '我是她儿子', '儿子'],
  配偶: ['老伴', '丈夫', '妻子'],
  社区工作人员: ['我是社区', '社区工作人员', '网格员', '社工'],
};

const CN_DIGITS = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

const REGION_ALIASES = {
  广州: '广州市', 佛山: '佛山市', 深圳: '深圳市', 东莞: '东莞市',
  珠海: '珠海市', 中山: '中山市', 惠州: '惠州市',
  北京: '北京市', 上海: '上海市',
};

// policy_engine.py:662-695
const SCENE_PLAIN = {
  年龄增长: '已到相关政策的年龄门槛附近',
  独居: '描述中提到独自居住',
  行动不便: '描述中提到行动、走路方面的困难',
  吃饭困难: '描述中提到做饭、吃饭方面的困难',
  需要照护: '描述中提到需要他人照顾、照护',
  长期卧床: '描述中提到长期卧床、下不了床',
  医疗护理压力: '描述中提到就医、护理费用方面的压力',
  记忆下降: '描述中提到记忆、认知方面的变化',
  跌倒风险: '描述中提到摔倒、跌倒风险',
  子女无法陪伴: '描述中提到子女不在身边、无法陪伴',
  经济压力: '描述中提到费用、经济方面的压力',
  不了解政策: '描述中提到此前不了解相关政策',
  身体能力下降: '描述中提到整体身体能力下降',
  居家环境不安全: '描述中提到居家环境存在安全隐患',
  长期健康问题: '描述中提到长期健康问题',
  需要健康检查: '描述中提到需要健康检查',
  慢性病管理: '描述中提到慢性病管理需求',
  疑似认知问题: '描述中提到疑似认知方面问题',
  家属担心老人状态: '描述中提到家属对老人状态的担心',
  无人照顾: '描述中提到身边无人照顾',
  护理费用压力: '描述中提到护理费用方面的压力',
  家庭照护困难: '描述中提到家庭照护方面的困难',
  需要社区帮助: '描述中提到需要社区层面的帮助',
  不愿入住养老机构: '描述中提到不愿入住养老机构',
  住院自付高: '描述中提到住院后个人负担的费用较高',
  大病医疗支出: '描述中提到重大疾病带来的医疗支出',
  长期服药: '描述中提到长期用药、长期开药',
  门诊特定病种: '描述中提到门诊特定病种（门特 / 门慢）',
  家庭经济困难: '描述中提到家庭经济困难或已取得相关认定',
  收入偏低: '描述中提到家庭收入偏低',
  需要长期照护: '描述中提到需要长期照护',
};

const COND_LABEL = {
  hukou: ['户籍条件', '具有广州市户籍', '不具有广州市户籍'],
  insurance: ['医保条件', '已参加广州市社会医疗保险', '未参加广州市社会医疗保险'],
  disability: ['失能条件', '属于失能或部分失能', '不属于失能或部分失能'],
};

const EXPIRING_DAYS = 180;
const DEDUCTIBLE_KEYS = ['deductible', 'deductible_tilted', 'tilted_deductible'];
const AMOUNT_UNIT = { 万: 10000, 千: 1000, 元: 1, 块: 1 };

// Python 的 truthiness：空数组 / 空对象 / 空串 / 0 / None 都是假。
// JS 里 [] 和 {} 是真值，移植时必须显式判断，否则「没有任何生活事件」
// 会被当成「有生活事件」，分层和理由全错。
function truthy(v) {
  if (v === null || v === undefined) return false;
  if (v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

/** Python 的 `x or default`。JS 的 || 对 [] / {} 行为不同，故单独实现。 */
function pyOr(v, fallback) {
  return truthy(v) ? v : fallback;
}

/** 稳定排序，对应 Python 的 sorted()。见下方 note 说明为何需要。 */
function pySorted(arr, cmp) {
  return arr.slice().sort(cmp);
}

// ---------------------------------------------------------------- 基础解析

function _cnToInt(text) {
  if (!text) return null;
  if (!text.includes('十')) {
    let total = 0;
    for (const ch of text) {
      if (!(ch in CN_DIGITS)) return null;
      total = total * 10 + CN_DIGITS[ch];
    }
    return total || null;
  }
  const idx = text.indexOf('十');
  const head = text.slice(0, idx);
  const tail = text.slice(idx + 1);
  const tens = head === '' ? 1 : CN_DIGITS[head];
  const ones = tail === '' ? 0 : CN_DIGITS[tail];
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones;
}

function parseAge(text) {
  let m = /(\d{1,3})\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const age = parseInt(m[1], 10);
    if (age > 0 && age <= 130) return age;
  }
  m = /([零一二两三四五六七八九十]+)\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const age = _cnToInt(m[1]);
    if (age && age > 0 && age <= 130) return age;
  }
  return null;
}

function parseAgeApprox(text) {
  let m = /(\d{1,3})\s*多\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 130) return n;
  }
  m = /([零一二两三四五六七八九十]+)\s*多\s*(?:岁|周岁)/.exec(text);
  if (m) {
    const n = _cnToInt(m[1]);
    if (n && n > 0 && n <= 130) return n;
  }
  return null;
}

function normalizeRegion(name) {
  if (!truthy(name)) return name;
  const s = String(name).trim();
  if (!s || s.endsWith('市')) return s;
  return Object.prototype.hasOwnProperty.call(REGION_ALIASES, s) ? REGION_ALIASES[s] : s;
}

// policy_engine.py:168-170
const SELF_PAID_RE = /(?:自付|自费|自己掏|自己付|个人负担|个人支付)[^\d]{0,8}?(\d+(?:\.\d+)?)\s*(万|千|元|块)?/;

function parseSelfPaid(text) {
  if (!truthy(text)) return null;
  const m = SELF_PAID_RE.exec(text);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (Number.isNaN(num)) return null;
  const unit = m[2] || '元';
  const amount = num * (AMOUNT_UNIT[unit] !== undefined ? AMOUNT_UNIT[unit] : 1);
  if (amount <= 0 || amount > 10000000) return null;
  return Math.trunc(amount);
}

function parseRegion(text) {
  if (text.includes('广州')) return '广州市';
  if (text.includes('佛山')) return '佛山市';
  for (const other of ['深圳', '东莞', '北京', '上海', '珠海', '中山', '惠州']) {
    if (text.includes(other)) return other;
  }
  return null;
}

function detectScenes(text) {
  const hits = [];
  for (const scene of Object.keys(SCENE_KEYWORDS)) {
    for (const w of SCENE_KEYWORDS[scene]) {
      if (text.includes(w)) {
        hits.push(scene);
        break;
      }
    }
  }
  return Array.from(new Set(hits)).sort();
}

function detectRelation(text, fallback) {
  for (const relation of Object.keys(RELATION_KEYWORDS)) {
    for (const w of RELATION_KEYWORDS[relation]) {
      if (text.includes(w)) return relation;
    }
  }
  return fallback === undefined ? null : fallback;
}

function detectOperator(text, fallback) {
  for (const role of Object.keys(OPERATOR_KEYWORDS)) {
    for (const w of OPERATOR_KEYWORDS[role]) {
      if (text.includes(w)) return role;
    }
  }
  return fallback === undefined ? null : fallback;
}

// ---------------------------------------------------------------- 画像

function buildProfile(opts) {
  const o = opts || {};
  let text = o.text || '';
  // [py] age = age if age is not None else parse_age(text)
  let age = o.age !== undefined && o.age !== null ? o.age : parseAge(text);
  const ageApprox = age === null ? parseAgeApprox(text) : null;
  const region = truthy(o.region) ? o.region : parseRegion(text);
  let scenes = detectScenes(text);

  const elderAge = age !== null ? age : ageApprox;
  if (elderAge && elderAge >= 60 && !scenes.includes('年龄增长')) {
    scenes.push('年龄增长');
  }
  scenes = Array.from(new Set(scenes)).sort();

  const relation = detectRelation(text, o.relation);
  const operator = detectOperator(text, o.operator);

  let who = '老人';
  if (relation) {
    who = relation !== '配偶' ? ('您' + relation) : '您的老伴';
  }

  let mode = o.mode !== undefined && o.mode !== null ? o.mode : null;
  let beneficiaryLabel;
  if (mode === 'self') {
    // [py] relation = None；本人模式不套用亲属关系
    const selfRelation = null;
    const selfOperator = operator || '本人';
    who = '您';
    beneficiaryLabel = '本人';
    return {
      age,
      region,
      hukou: null,
      insurance: null,
      disability: null,
      scenes,
      relation: selfRelation,
      operator: selfOperator,
      beneficiary_label: beneficiaryLabel,
      who,
      mode: 'self',
      raw_text: text,
      age_approx: ageApprox,
      self_paid_amount: parseSelfPaid(text),
      family_economic: null,
    };
  }
  beneficiaryLabel = relation || '老人';

  return {
    age,
    region,
    hukou: null,
    insurance: null,
    disability: null,
    scenes,
    relation,
    operator,
    beneficiary_label: beneficiaryLabel,
    who,
    mode: 'family',
    raw_text: text,
    age_approx: ageApprox,
    self_paid_amount: parseSelfPaid(text),
    family_economic: null,
  };
}

function profileMissingFields(profile) {
  const missing = [];
  if (profile.age === null || profile.age === undefined) missing.push('老人的年龄');
  if (profile.region === null || profile.region === undefined) missing.push('老人所在城市');
  if (!profile.scenes || profile.scenes.length === 0) {
    missing.push('老人最近的生活变化（如行动、就医、照护情况）');
  }
  return missing;
}

// ---------------------------------------------------------------- 文本拼接

function buildRagText(policy) {
  const parts = [
    policy.policy_name || '',
    policy.category || '',
    policy.service_type || '',
    policy.description || '',
    '面向人群：' + (policy.target_people || []).join('、'),
    '生活场景：' + (policy.life_scenes || []).join('、'),
    '关键词：' + (policy.keywords || []).join('、'),
  ];
  const cond = policy.conditions || {};
  const condDesc = [];
  if (truthy(cond.age_min)) condDesc.push('年龄不低于' + cond.age_min + '周岁');
  if (cond.hukou_required === true) condDesc.push('需本市户籍');
  if (cond.insurance_required === true) condDesc.push('需参加本市医保');
  if (cond.disability_required === true) condDesc.push('需失能或部分失能');
  for (const item of cond.other || []) condDesc.push(String(item));
  if (condDesc.length > 0) parts.push('条件：' + condDesc.join('；'));
  return parts.filter((p) => p).join('\n');
}

// ---------------------------------------------------------------- 通用小工具

function _dedup(items) {
  const out = [];
  for (const it of items || []) {
    if (!truthy(it)) continue;
    let replaced = false;
    for (let i = 0; i < out.length; i += 1) {
      const old = out[i];
      if (old.includes(it)) {      // 已有条目更完整
        replaced = true;
        break;
      }
      if (it.includes(old)) {      // 新条目更完整，替换
        out[i] = it;
        replaced = true;
        break;
      }
    }
    if (!replaced) out.push(it);
  }
  return out;
}

function _hasThreeLayer(policy) {
  const cond = policy.conditions || {};
  return Array.isArray(cond.qualify);
}

// ---------------------------------------------------------------- 第 1 层：资格条件

function _qualifyState(item, profile) {
  const key = item.key;
  const itype = item.type;
  const val = profile[key];

  if (itype === 'boolean') {
    if (val === true) return ['met', '您已确认：符合'];
    if (val === false) return ['failed', '您已确认：不符合'];
    return ['unknown', '尚未确认，需要您或受理单位核实'];
  }

  if (itype === 'enum') {
    const options = item.options || [];
    const labels = {};
    for (const o of options) labels[o.value] = o.label;
    if (val === null || val === undefined) return ['unknown', '尚未选择，需要您确认'];
    if (val === 'none') return ['failed', '您已确认：以上都不是'];
    return ['met', '您已确认：' + (labels[val] !== undefined ? labels[val] : val)];
  }

  if (itype === 'ratio_condition') {
    return ['unknown', '需按票据与家庭收入核算，建议向受理单位核实'];
  }

  return ['unknown', '尚未确认'];
}

function _checkQualify(policy, profile) {
  const missing = [];
  const rows = [];
  let blocked = false;

  for (const item of (policy.conditions || {}).qualify || []) {
    const [state, evidence] = _qualifyState(item, profile);
    rows.push({
      key: item.key,
      label: item.label || '',
      requirement: item.requirement || '',
      state,
      evidence,
      source_ref: item.source_ref || '',
    });
    if (state === 'failed') blocked = true;
    else if (state === 'unknown') missing.push(item.ask || item.label || item.key);
  }

  return [blocked, missing, rows];
}

// ---------------------------------------------------------------- 第 2 层：阈值

function thresholdSignal(policy, profile) {
  const ths = (policy.conditions || {}).thresholds || [];
  const values = ths
    .filter((t) => DEDUCTIBLE_KEYS.includes(t.key) && typeof t.value === 'number')
    .map((t) => t.value);
  if (values.length === 0) return null;

  const paid = profile.self_paid_amount;
  if (paid === null || paid === undefined) {
    return {
      touched: null,
      message: '尚未提供个人负担金额，无法判断是否已达到起付标准',
      action: '可在补充信息里填写个人负担的大致金额，或直接向医保部门核实',
    };
  }

  if (paid >= Math.min(...values)) {
    return {
      touched: true,
      message: '按您提供的金额，可能已触及起付标准',
      action: '具体标准请向医保部门核实',
    };
  }
  return {
    touched: false,
    message: '按您提供的金额，可能尚未达到起付标准',
    action: '具体标准请向医保部门核实；如后续费用增加可重新判断',
  };
}

function thresholdRows(policy) {
  const ths = (policy.conditions || {}).thresholds || [];
  const rows = [];
  for (const t of ths) {
    rows.push({
      label: t.label || '',
      unit: t.unit || '',
      source_ref: t.source_ref || '',
      has_value: (t.value !== null && t.value !== undefined) || truthy(t.formula),
      display: '具体标准请向医保部门核实',
    });
  }
  return rows;
}

// ---------------------------------------------------------------- 政策时效

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 解析 YYYY-MM-DD 为 UTC 零点的毫秒数。
 * [py] 用 datetime.date，只关心日期差；这里统一按 UTC 计算，避免本地时区
 * 让「今天」在跨零点时偏移一天，导致 expiring / expired 判定漂移。
 */
function _parseDate(s) {
  if (!truthy(s)) return null;
  const parts = String(s).trim().split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  // 拒绝 2024-02-31 这类溢出日期，与 Python datetime.date 抛错后返回 None 一致
  const back = new Date(t);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

function _todayUtc() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * 与 Python 的键缺失对齐：Python 里 v.get("expires_at") 缺字段返回 None，
 * 但这个 None 经 json.dumps 出来仍然是 null；**真正缺键**（数据库里根本没有
 * 这个键）时 json.dumps 会省略该键。前端拿到的是 undefined，不是 null。
 *
 * 两者在 JS 里都是假值，渲染结果相同；但在对照测试里是不同的值，
 * 而且后续若有代码用 `in` 判断，语义也不同。所以这里显式模拟：
 * 键不存在就 delete，让返回对象与 Python 序列化后的形状完全一致。
 */
function _pickValiditySource(v) {
  const out = {};
  for (const key of ['expires_at', 'effective_from', 'verified_at']) {
    if (key in v) out[key] = v[key];
  }
  return out;
}

function deriveValidity(policy, today) {
  const v = policy.validity || {};
  const t = today === undefined || today === null ? _todayUtc() : today;

  const stored = v.status || 'active';
  const expires = _parseDate(v.expires_at);
  const sup = v.superseded_by;
  // [py] v.get("expires_at") —— 缺这个键时得到 None，返回的就是 null；
  // 只有「键存在但值为空」与「键不存在」在这里都落到 null，故统一取 vp，
  // 缺键时 vp 里没有该键，取出来即 undefined。
  const vp = _pickValiditySource(v);

  if (stored === 'superseded' && truthy(sup)) {
    const name = sup.name || '新文件';
    return {
      status: 'superseded',
      level: 'muted',
      expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
      effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
      verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
      superseded_by: sup,
      message: '该政策已由《' + name + '》替代，请查看新规',
    };
  }

  if (stored === 'expired' || (expires !== null && expires < t)) {
    return {
      status: 'expired',
      level: 'muted',
      expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
      effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
      verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
      superseded_by: sup,
      message: '该政策已过有效期，请以最新文件为准',
    };
  }

  if (expires !== null && (expires - t) / DAY_MS <= EXPIRING_DAYS) {
    return {
      status: 'expiring',
      level: 'warn',
      expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
      effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
      verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
      superseded_by: null,
      message: '本办法有效期至 ' + v.expires_at + '，届时请以最新文件为准',
    };
  }

  return {
    status: 'active',
    level: 'normal',
    expires_at: Object.prototype.hasOwnProperty.call(vp, 'expires_at') ? vp.expires_at : null,
    effective_from: Object.prototype.hasOwnProperty.call(vp, 'effective_from') ? vp.effective_from : null,
    verified_at: Object.prototype.hasOwnProperty.call(vp, 'verified_at') ? vp.verified_at : null,
    superseded_by: null,
    message: '',
  };
}

// ---------------------------------------------------------------- 硬条件

function _hardConditionCheck(policy, profile) {
  const regionScope = (policy.region || {}).scope;
  if (regionScope && truthy(profile.region)) {
    if (normalizeRegion(profile.region) !== normalizeRegion(regionScope)) {
      return [true, ['该政策适用于' + regionScope + '，老人当前所在地区为' + profile.region]];
    }
  }

  if (_hasThreeLayer(policy)) {
    const [blocked, missing] = _checkQualify(policy, profile);
    return [blocked, missing];
  }

  const cond = policy.conditions || {};
  const missing = [];

  const ageMin = cond.age_min;
  if (truthy(ageMin)) {
    if (profile.age === null || profile.age === undefined) {
      missing.push('老人是否已年满' + ageMin + '周岁');
    } else if (profile.age < ageMin) {
      return [true, ['老人年龄未达到' + ageMin + '周岁的服务门槛']];
    }
  }

  if (cond.hukou_required === true) {
    if (profile.hukou === null || profile.hukou === undefined) {
      missing.push('老人是否具有广州市户籍');
    } else if (profile.hukou === false) {
      return [true, ['该权益要求广州市户籍，您已确认老人不具有本市户籍']];
    }
  }

  if (cond.insurance_required === true) {
    if (profile.insurance === null || profile.insurance === undefined) {
      missing.push('老人是否参加广州市社会医疗保险');
    } else if (profile.insurance === false) {
      return [true, ['该待遇要求参加广州市社会医疗保险，您已确认老人未参保']];
    }
  }

  if (cond.disability_required === true) {
    if (profile.disability === null || profile.disability === undefined) {
      missing.push('老人是否属于失能或部分失能（建议先做照护需求综合评估）');
    } else if (profile.disability === false) {
      return [true, ['该服务面向失能或部分失能老年人，您已确认老人不属于该范围']];
    }
  }

  return [false, missing];
}

function renderReason(templates, profile) {
  const rendered = [];
  for (const tpl of templates || []) {
    if (tpl.includes('{age}') && (profile.age === null || profile.age === undefined)) continue;
    if (tpl.includes('{region}') && !truthy(profile.region)) continue;
    let text = tpl.split('{who}').join(profile.who);
    text = text.split('{age}').join(String(profile.age));
    text = text.split('{region}').join(truthy(profile.region) ? profile.region : '当地');
    rendered.push(text);
  }
  return rendered;
}

// ---------------------------------------------------------------- 证据链

function _quoteSource(policy) {
  const src = policy.source || {};
  const parts = [];
  if (truthy(src.document) && src.document !== 'to_verify') parts.push(String(src.document));
  if (truthy(src.document_no)) parts.push(String(src.document_no));
  if (parts.length === 0) return '';
  let text = parts.join('、');
  if (truthy(src.publish_date)) text += '（' + src.publish_date + '）';
  return text;
}

function buildEvidenceChain(policy, profile, hitScenes, missing) {
  const basis = [];
  for (const s of hitScenes) {
    basis.push({
      kind: 'scene',
      label: s,
      text: SCENE_PLAIN[s] !== undefined ? SCENE_PLAIN[s] : '描述中提到的相关生活情况',
    });
  }
  if (profile.age !== null && profile.age !== undefined) {
    basis.push({ kind: 'age', label: '年龄 ' + profile.age + ' 岁', text: '由您在描述中提供' });
  }
  if (truthy(profile.region)) {
    basis.push({ kind: 'region', label: profile.region, text: '由您在描述中提供' });
  }

  const cond = policy.conditions || {};
  const conds = [];

  if (_hasThreeLayer(policy)) {
    const rows = _checkQualify(policy, profile)[2];
    for (const r of rows) {
      conds.push({
        label: r.label,
        requirement: r.requirement,
        state: r.state,
        evidence: r.evidence,
        source_ref: r.source_ref,
      });
    }
    for (const t of thresholdRows(policy)) {
      conds.push({
        label: t.label,
        requirement: t.display,
        state: 'unknown',
        evidence: '阈值仅用于内部判断，页面不展示具体数值',
        source_ref: t.source_ref,
        is_threshold: true,
      });
    }
  } else {
    if (truthy(cond.age_min)) {
      const met = profile.age !== null && profile.age !== undefined && profile.age >= cond.age_min;
      conds.push({
        label: '年龄门槛',
        requirement: '年满 ' + cond.age_min + ' 周岁',
        state: met ? 'met' : 'unknown',
        evidence: (profile.age !== null && profile.age !== undefined)
          ? ('您描述为 ' + profile.age + ' 岁') : '尚未提供年龄',
      });
    }
    for (const key of ['hukou', 'insurance', 'disability']) {
      const req = cond[key + '_required'];
      if (req !== true) continue;
      const [label, yesText, noText] = COND_LABEL[key];
      const val = profile[key];
      let state;
      let ev;
      if (val === true) { state = 'met'; ev = '您已确认：' + yesText; }
      else if (val === false) { state = 'failed'; ev = '您已确认：' + noText; }
      else { state = 'unknown'; ev = '尚未确认，需要您或受理单位核实'; }
      conds.push({ label, requirement: '需符合：' + yesText, state, evidence: ev });
    }
    for (const item of cond.other || []) {
      conds.push({
        label: '其他条件',
        requirement: String(item),
        state: 'unknown',
        evidence: '需向受理单位确认适用口径',
      });
    }
  }

  const src = policy.source || {};
  const ver = policy.verification || {};
  const pending = ver.status === 'to_verify';
  const citation = {
    department: src.department || '',
    document: src.document === 'to_verify' ? '' : (src.document || ''),
    document_no: src.document_no || '',
    publish_date: src.publish_date || '',
    quote: _quoteSource(policy),
    verified: !pending,
    checked_at: ver.checked_at || '',
    official_url: src.official_url || '',
  };

  return {
    profile_basis: basis,
    policy_conditions: conds,
    citation,
    pending_count: conds.filter((c) => c.state === 'unknown').length,
  };
}

function assignTier(result) {
  if (truthy(result.matched_scenes)) {
    if (result.status === '待确认') return '可能相关';
    return '强相关';
  }
  return '待确认';
}

// ---------------------------------------------------------------- 打分与匹配

function scorePolicy(policy, profile) {
  const [blocked, missing] = _hardConditionCheck(policy, profile);
  if (blocked) return null;

  const signals = (policy.match || {}).scene_signals || [];
  const hit = signals.filter((s) => profile.scenes.includes(s));

  if (hit.length === 0) {
    const cond = policy.conditions || {};
    const ageMin = cond.age_min;
    const ok = truthy(ageMin) && truthy(profile.age) && profile.age >= ageMin;
    if (!ok) return null;
  }

  const priority = pyOr((policy.match || {}).priority, 3);
  let score = hit.length * 10 + Math.max(0, 4 - priority) * 3;
  if (hit.includes('年龄增长')) score += 2;

  let status = missing.length > 0 ? '待确认' : '可能相关';
  const sourceStatus = (policy.verification || {}).status || 'to_verify';

  const policySource = policy.source || {};
  const policyVerification = policy.verification || {};

  let reasons = renderReason(policy.ai_reason || [], profile);
  const sceneMap = policy.scene_reason_map || {};
  for (const scene of hit) {
    if (sceneMap[scene] !== undefined) reasons.push(sceneMap[scene]);
  }

  const hitEmpty = hit.length === 0;
  if (hitEmpty) {
    reasons = reasons.filter((r) => r.includes('岁') || r.includes('年龄') || r.includes('周岁'));
    reasons.push('目前仅依据年龄作出初步提示，是否有对应需求还需您确认');
    status = '待确认';
    score = Math.min(score, 5);
  }

  return {
    policy_id: policy.policy_id,
    policy_name: policy.policy_name,
    category: policy.category,
    service_type: policy.service_type || '',
    region: (policy.region || {}).scope || '',
    status,
    score,
    ai_reason: reasons,
    matched_scenes: hit,
    missing_information: _dedup(missing.concat(policy.missing_information || [])),
    source_status: sourceStatus,
    source_pending: sourceStatus === 'to_verify',
    source_department: policySource.department || '',
    source_document_no: policySource.document_no || '',
    source_official_url: policySource.official_url || '',
    source_publish_date: policySource.publish_date || '',
    source_checked_at: policyVerification.checked_at || '',
    service_note: policy.service_note || '',
    evidence: buildEvidenceChain(policy, profile, hit, missing),
    tier: assignTier({ status, matched_scenes: hit }),
    policy_level: policy.policy_level || '',
    validity: deriveValidity(policy),
    green_note: policy.green_note || null,
    materials: policy.materials || [],
    threshold_signal: thresholdSignal(policy, profile),
    // [py] (policy.get("conditions") or {}).get("result_params") —— 缺键即 None
    result_params: (policy.conditions || {}).result_params !== undefined
      ? (policy.conditions || {}).result_params
      : null,
  };
}

function matchPolicies(db, profile) {
  const results = [];
  for (const policy of db.policies || []) {
    const r = scorePolicy(policy, profile);
    if (r) results.push(r);
  }
  // [py] results.sort(key=lambda x: (-x["score"], x["policy_id"]))
  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.policy_id < b.policy_id) return -1;
    if (a.policy_id > b.policy_id) return 1;
    return 0;
  });
  return results;
}

function findPolicy(db, policyId) {
  for (const policy of db.policies || []) {
    if (policy.policy_id === policyId) return policy;
  }
  return null;
}

// ---------------------------------------------------------------- 生活事件库

function buildSceneLibrary(db, profile) {
  const events = [];
  const seen = new Set();

  for (const name of db.scene_tag_library || []) {
    if (!seen.has(name)) { seen.add(name); events.push(name); }
  }
  for (const p of db.policies || []) {
    const combined = (p.life_scenes || []).concat((p.match || {}).scene_signals || []);
    for (const name of combined) {
      if (name && !seen.has(name)) { seen.add(name); events.push(name); }
    }
  }

  const detected = new Set(pyOr((profile || {}).scenes, []));

  const items = [];
  for (const name of events) {
    const related = [];
    for (const p of db.policies || []) {
      const signals = (p.match || {}).scene_signals || [];
      if (signals.includes(name) || (p.life_scenes || []).includes(name)) {
        related.push(p.policy_id);
      }
    }
    items.push({
      name,
      plain: SCENE_PLAIN[name] !== undefined ? SCENE_PLAIN[name] : '与您描述的情况相关',
      detected: detected.has(name),
      related_count: related.length,
    });
  }

  // [py] items.sort(key=lambda x: (not x["detected"], -x["related_count"], x["name"]))
  items.sort((a, b) => {
    if (a.detected !== b.detected) return a.detected ? -1 : 1;
    if (a.related_count !== b.related_count) return b.related_count - a.related_count;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  return items;
}

function toggleScene(profile, scene, on) {
  let scenes = (profile.scenes || []).slice();
  if (on) {
    if (!scenes.includes(scene)) scenes.push(scene);
  } else {
    scenes = scenes.filter((s) => s !== scene);
  }
  return Array.from(new Set(scenes)).sort();
}

// ---------------------------------------------------------------- 对外入口
// 与 backend/server.py 的接口返回结构一一对应，这样前端 API 层可以原样对接。

const DISCLAIMER = '本页面由AI根据您描述的生活情况进行初步匹配，'
  + '仅用于提示可能相关的公共服务权益，不代表已符合政策资格。'
  + '最终资格由主管部门核定。';

function _brief(policy) {
  return {
    policy_id: policy.policy_id,
    policy_name: policy.policy_name,
    category: policy.category,
    service_type: policy.service_type || '',
    region: (policy.region || {}).scope || '',
    life_scenes: policy.life_scenes || [],
    verification_status: (policy.verification || {}).status,
  };
}

function _tierSummary(results) {
  const order = ['强相关', '可能相关', '待确认'];
  const counts = {};
  for (const k of order) counts[k] = 0;
  for (const r of results) {
    if (r.tier in counts) counts[r.tier] += 1;
  }
  return order.filter((k) => counts[k] > 0).map((k) => ({ tier: k, count: counts[k] }));
}

function _detail(policy, profile) {
  const data = Object.assign({}, policy);
  data.rag_text = buildRagText(policy);
  if (truthy(profile)) {
    data.ai_reason_rendered = renderReason(policy.ai_reason || [], profile);
  }
  data.validity = deriveValidity(policy);
  data.threshold_signal = truthy(profile) ? thresholdSignal(policy, profile) : null;
  return data;
}

/** DB 由页面在引擎脚本之前注入（见 build/build_pages.py）。 */
function localApi(DB) {
  if (!DB) throw new Error('政策库未加载');

  return {
    health() {
      return {
        ok: true,
        database: DB.database_name,
        version: DB.version,
        policy_count: (DB.policies || []).length,
        disclaimer: DISCLAIMER,
      };
    },

    policies() {
      return {
        total: (DB.policies || []).length,
        policies: (DB.policies || []).map(_brief),
      };
    },

    policy(id) {
      const p = findPolicy(DB, id);
      if (!p) throw new Error('policy not found');
      return _detail(p);
    },

    scenes(profile) {
      return {
        scenes: buildSceneLibrary(DB, profile),
        disclaimer: DISCLAIMER,
      };
    },

    tiers() {
      return {
        tiers: [
          { key: '强相关', desc: 'AI 从您的描述中识别到了对应的生活事件，且没有关键条件缺口' },
          { key: '可能相关', desc: '识别到了对应生活事件，但仍有户籍、医保、失能等待确认的条件' },
          { key: '待确认', desc: '目前仅依据年龄等基础信息提示，是否有对应需求还需要您确认' },
        ],
      };
    },

    // 与 server.py:207-217 一致
    profile(payload) {
      const p = payload || {};
      const profile = buildProfile({
        text: p.text || '',
        relation: p.relation,
        operator: p.operator,
        age: p.age,
        region: p.region,
        mode: p.mode,
      });
      profile.missing_fields = profileMissingFields(profile);
      return { profile, disclaimer: DISCLAIMER };
    },

    // 与 server.py:219-272 一致，包括那 4 条「只沿用用户明确作答过的事实」的规则
    match(payload) {
      const p = payload || {};
      const text = p.text || '';
      const base = p.profile || {};
      const mode = truthy(p.mode) ? p.mode : base.mode;
      const profile = buildProfile({
        text,
        relation: truthy(base.relation) ? base.relation : p.relation,
        operator: truthy(base.operator) ? base.operator : p.operator,
        age: p.age,
        region: p.region,
        mode,
      });
      for (const key of ['hukou', 'insurance', 'disability', 'family_economic']) {
        if (key in base && base[key] !== null && base[key] !== undefined) {
          profile[key] = base[key];
        }
      }
      if (Array.isArray(base.confirmed_scenes)) {
        profile.scenes = Array.from(new Set(base.confirmed_scenes)).sort();
        profile.confirmed_scenes = profile.scenes.slice();
        profile.scenes_edited = true;
      } else if (base.scenes_edited) {
        const prev = base.confirmed_scenes;
        if (Array.isArray(prev)) {
          profile.scenes = Array.from(new Set(prev)).sort();
        }
        profile.confirmed_scenes = profile.scenes.slice();
        profile.scenes_edited = true;
      }

      profile.missing_fields = profileMissingFields(profile);
      const results = matchPolicies(DB, profile);
      return {
        profile,
        results,
        total: results.length,
        tier_summary: _tierSummary(results),
        scene_library: buildSceneLibrary(DB, profile),
        disclaimer: DISCLAIMER,
        notice: '以下为初步匹配结果，均需进一步确认，不作为资格认定。',
      };
    },

    explain(payload) {
      const p = payload || {};
      const policy = findPolicy(DB, p.policy_id || '');
      if (!policy) throw new Error('policy not found');
      const saved = p.profile || {};
      const profile = buildProfile({
        text: saved.raw_text || '',
        relation: saved.relation,
        operator: saved.operator,
        age: saved.age,
        region: saved.region,
        mode: saved.mode,
      });
      return { policy: _detail(policy, profile), disclaimer: DISCLAIMER };
    },
  };
}

