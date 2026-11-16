/* Shared UI field catalogue. Policy sources remain /api/policies and /api/scenes.
 * Empty string = not provided, unknown = explicitly unsure, no = explicit denial.
 * These are query conditions, never eligibility decisions. */
window.PFQueryFields = {
  groups: [
    {id:'scenes',title:'生活变化（可多选）',icon:'note',scenes:true},
    {id:'care', title:'照护与身体情况', selfTitle:'身体与生活能力', icon:'heart', fields:[
      {id:'help',label:'日常生活是否需要他人帮助？',options:[['no','不需要'],['sometimes','偶尔需要'],['often','经常需要'],['unknown','不清楚']]},
      {id:'mobility',label:'是否存在行动不便？',options:[['yes','行动不便'],['no','没有行动不便'],['unknown','不清楚']]},
      {id:'assessment',label:'是否做过照护需求评估？',options:[['yes','已评估'],['no','尚未评估'],['unknown','不清楚']]}
    ]},
    {id:'living',title:'居住情况',icon:'home',selfOnly:true,fields:[
      {id:'living',label:'目前的居住情况',options:[['alone','独居'],['family','与家人同住'],['other','其他'],['unknown','不清楚']]}
    ]},
    {id:'policy-facts',title:'户籍、参保与家庭认定',icon:'pin',fields:[
      {id:'hukou',label:'本人或共同生活家人是否有当地户籍？',options:[['yes','是'],['no','否'],['unknown','不清楚']]},
      {id:'insurance',label:'受益人是否参加当地基本医疗保险？',options:[['yes','是'],['no','否'],['unknown','不清楚']]},
      {id:'family_economic',label:'已获得哪类家庭经济状况认定？',options:[
        ['tekun','特困人员'],['guer','孤儿或事实无人抚养儿童'],['dibao','最低生活保障对象'],
        ['dibao_bianyuan','低保边缘家庭成员'],['zhichuxing','支出型困难家庭成员'],['none','以上都不是'],['unknown','不清楚']
      ]}
    ]},
    {id:'meal',title:'助餐与生活服务',icon:'meal',fields:[
      ...[['meal','是否需要社区助餐？'],['delivery','是否需要送餐服务？'],['subsidy','是否希望了解相关补贴？']].map(([id,label])=>({id,label,options:[['yes','需要'],['no','不需要'],['unknown','不清楚']]}))
    ]},
    {id:'area',title:'所在区及街道',icon:'pin',region:true},
    {id:'other',title:'其他需要说明的情况',icon:'note',selfOnly:true,fields:[{id:'notes',label:'其他情况（选填，最多 500 字）',text:true}]}
  ]
};
