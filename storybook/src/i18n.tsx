import { createContext, Fragment, useContext, type ReactNode } from "react";

/**
 * UI strings for the two supported languages. English is the source of truth:
 * a key missing from `zh` falls back to English, so an untranslated string
 * never shows as a raw key. Interpolation uses `{name}` placeholders.
 */
export type Locale = "en" | "zh";

const en = {
  "nav.search": "Search",
  "nav.people": "People",
  "nav.primary": "Primary",
  "brand.name": "Unified Search",
  "viewer.signedIn": "Signed in as {name} · groups: {groups}",
  "viewer.groupSep": ", ",
  "list.sep": " or ",
  "kind.video": "video",
  "kind.image": "image",
  "kind.audio": "audio",
  "kind.document": "document",
  "time.today": "today",
  "time.yesterday": "yesterday",

  "freshness.stale": "not updated since {date}",
  "freshness.staleLong": "Not updated since {date}. Newer files are missing.",
  "freshness.items": "{count} items · updated {updated}",
  "freshness.updated": "Updated {updated}",

  "search.region": "Search the index",
  "search.fieldLabel": "Search",
  "search.placeholder": "Q3 budget",
  "search.submit": "search",
  "search.submitHome": "Search",
  "search.limit": "limit",
  "search.type": "type",
  "search.type.all": "All",
  "search.type.nas": "NAS",
  "search.type.archive": "Archive",
  "search.type.bi": "BI metrics",
  "search.reason.busy": "A search is already running.",
  "search.reason.empty": "Type something to search for.",
  "search.reason.unresolved": "Nobody is named {names}. Check the spelling or leave the name out.",


  "page.search.title": "Search",
  "page.openClip": "Open clip",

  "results.label": "Search results",
  "results.searching": "searching…",
  "results.count": "{count} results",
  "results.none": "No results.",
  "results.serverError": "The search failed.",
  "results.retry": "Try again",
  "results.down": "{name} did not respond.",
  "results.filter": "Filter by source",
  "results.filterAll": "all",
  "results.sourceNas": "NAS",
  "results.sourceArchive": "Archive",
  "results.nasIndex": "The NAS index",
  "results.archiveSystem": "The Archive System",
  "results.sourceBi": "BI metrics",
  "results.biPlatform": "The BI platform",

  "card.result": "Result {rank}",
  "card.faces": "{count} faces",
  "card.face": "{count} face",
  "card.copy": "copy",
  "card.archiveSource": "Archive",
  "card.biSource": "BI",
  "card.metric": "Metric",
  "card.moreReports": "+{count} more",
  "metric.owner": "owner",
  "metric.reports": "Reports",
  "metric.filter": "Filter reports",
  "metric.noMatch": "No reports match.",
  "metric.reportsFailed": "Could not load the reports.",
  "metric.dashboard": "dashboard",
  "metric.chart": "1 chart",
  "metric.charts": "{count} charts",
  "metric.openInBi": "Open in BI ↗",
  "card.appearances": "{count} appearances",
  "preview.label": "Preview {name}",
  "preview.matched": "Matched scene of {name}",
  "preview.previous": "Previous",
  "preview.next": "Next",
  "preview.copyPath": "Copy path",
  "preview.copied": "Path copied",
  "preview.copyFailed": "Could not copy. The path is selected below: press Ctrl+C (⌘C on a Mac).",
  "preview.pathField": "File path",
  "preview.close": "Close",
  "preview.forbidden": "You no longer have access to this file.",
  "preview.gone": "This file is no longer on the NAS.",
  "people.label": "People",
  "people.filter": "Filter people",
  "people.title": "People",
  "people.nameHint": "Select a person to name them.",
  "people.selected": "Selected person",
  "people.sampleFace": "Sample face from {id}",
  "people.nameField": "name",
  "people.confirmGroup": "Confirm merge",
  "people.confirm": "Confirm merge",
  "people.cancel": "Cancel",
  "people.undo": "Undo merge",
  "people.allNamed": "Everyone has a name.",
  "people.none": "No people yet.",
  "people.pending": "{count} new faces wait for the next regroup.",
  "people.undoneText": "{id} is its own person again.",
  "people.mergeInto": "Merge into {name}",
  "people.rename": "Rename",
  "people.applyName": "Apply name",
  "people.reason.empty": "Type a name first.",
  "people.reason.same": "That is already this person’s name.",
  "merge.confirm": "Merge {from} ({fromFaces} faces) into {to}, {name} ({toFaces} faces)? {total} appearances in total.",
  "people.appears": "Appears in",
  "people.noHits": "No appearances.",
  "people.saved": "Saved.",
  "people.mergedText": "Merged {id}.",
  "timeline.label": "Timeline",
  "timeline.inMatch": "{time}, in the matched scene",
  "timeline.key": "Timeline key",
  "timeline.key.matched": "Matched scene {start}–{end}",
  "notes.none": "No notes yet.",
  "notes.label": "Notes",
  "note.form": "Add note",
  "note.field": "note",
  "note.placeholder": "Ana is presenting the Q3 budget",
  "note.from": "from",
  "note.to": "to",
  "note.peopleInFrame": "people in frame",
  "note.save": "Save note",
  "note.reason.empty": "Type the note first.",
  "note.added": "Note added.",
  "note.reason.format": "Use mm:ss or seconds.",
  "note.reason.order": "End must be after start.",
  "face.tagForm": "Tag face",
  "face.hint": "Select a face to name it.",
  "face.name": "name",
  "face.applyTo": "apply to",
  "face.all": "All appearances",
  "face.needsCluster": "needs a cluster",
  "face.thisOnly": "This face only",
  "face.apply": "Apply name",
  "face.reason.empty": "Type a name first.",
  "face.thisFace": "this face",
  "face.mergedText": "Merged {from}.",
  "face.undoneText": "{from} is no longer merged.",
  "clip.details": "Details",
  "clip.back": "Search results",
  "clip.frameAlt": "{name} at {time}",
  "clip.speech": "Speech",
  "clip.ocr": "On-screen text",
  "clip.faces": "faces in frame",
  "people.more": "+{count} more",
  "people.chip.all": "all",
  "people.chip.named": "named",
  "people.chip.unnamed": "unnamed ({count})",
  "face.frameAlt": "Keyframe with detected faces",
  "face.button": "Face {n}: {label}",
  "face.untagged": "untagged",
} as const;

export type MessageKey = keyof typeof en;

const zh: Partial<Record<MessageKey, string>> = {
  "nav.search": "搜索",
  "nav.people": "人物",
  "nav.primary": "主导航",
  "brand.name": "统一搜索",
  "viewer.signedIn": "以 {name} 身份登录 · 用户组：{groups}",
  "viewer.groupSep": "、",
  "list.sep": "或",
  "kind.video": "视频",
  "kind.image": "图片",
  "kind.audio": "音频",
  "kind.document": "文档",
  "time.today": "今天",
  "time.yesterday": "昨天",

  "freshness.stale": "自 {date} 起未更新",
  "freshness.staleLong": "自 {date} 起未更新，之后的新文件缺失。",
  "freshness.items": "{count} 项 · 更新于 {updated}",
  "freshness.updated": "更新于 {updated}",

  "search.region": "搜索索引",
  "search.fieldLabel": "搜索",
  "search.placeholder": "第三季度预算",
  "search.submit": "搜索",
  "search.submitHome": "搜索",
  "search.limit": "数量上限",
  "search.type": "类型",
  "search.type.all": "全部",
  "search.type.nas": "NAS",
  "search.type.archive": "档案",
  "search.type.bi": "BI 指标",
  "search.reason.busy": "已有一个搜索正在进行。",
  "search.reason.empty": "请输入要搜索的内容。",
  "search.reason.unresolved": "没有名为 {names} 的人。请检查拼写，或去掉这个名字。",


  "page.search.title": "搜索",
  "page.openClip": "打开片段",

  "results.label": "搜索结果",
  "results.searching": "搜索中…",
  "results.count": "共 {count} 条结果",
  "results.none": "没有结果。",
  "results.serverError": "搜索失败。",
  "results.retry": "重试",
  "results.down": "{name} 没有响应。",
  "results.filter": "按来源筛选",
  "results.filterAll": "全部",
  "results.sourceNas": "NAS",
  "results.sourceArchive": "档案系统",
  "results.nasIndex": "NAS 索引",
  "results.archiveSystem": "档案系统",
  "results.sourceBi": "BI 指标",
  "results.biPlatform": "BI 平台",

  "card.result": "结果 {rank}",
  "card.faces": "{count} 张人脸",
  "card.face": "{count} 张人脸",
  "card.copy": "副本",
  "card.archiveSource": "档案系统",
  "card.biSource": "BI",
  "card.metric": "指标",
  "card.moreReports": "还有 {count} 个",
  "metric.owner": "负责人",
  "metric.reports": "报表",
  "metric.filter": "筛选报表",
  "metric.noMatch": "没有匹配的报表。",
  "metric.reportsFailed": "无法加载报表。",
  "metric.dashboard": "看板",
  "metric.chart": "1 个图表",
  "metric.charts": "{count} 个图表",
  "metric.openInBi": "在 BI 中打开 ↗",
  "card.appearances": "出现 {count} 次",
  "preview.label": "预览 {name}",
  "preview.matched": "{name} 的匹配场景",
  "preview.previous": "上一个",
  "preview.next": "下一个",
  "preview.copyPath": "复制路径",
  "preview.copied": "已复制路径",
  "preview.copyFailed": "无法复制。路径已在下方选中：按 Ctrl+C（Mac 上按 ⌘C）。",
  "preview.pathField": "文件路径",
  "preview.close": "关闭",
  "preview.forbidden": "你已无权访问此文件。",
  "preview.gone": "此文件已不在 NAS 上。",
  "people.label": "人物",
  "people.filter": "筛选人物",
  "people.title": "人物",
  "people.nameHint": "选择一个人进行命名。",
  "people.selected": "已选人物",
  "people.sampleFace": "{id} 的样本人脸",
  "people.nameField": "姓名",
  "people.confirmGroup": "确认合并",
  "people.confirm": "确认合并",
  "people.cancel": "取消",
  "people.undo": "撤销合并",
  "people.allNamed": "所有人都已命名。",
  "people.none": "还没有人物。",
  "people.pending": "{count} 张新人脸等待下次重新分组。",
  "people.undoneText": "{id} 重新成为独立的人。",
  "people.mergeInto": "合并到 {name}",
  "people.rename": "重命名",
  "people.applyName": "应用姓名",
  "people.reason.empty": "请先输入姓名。",
  "people.reason.same": "这已经是此人的姓名。",
  "merge.confirm": "将 {from}（{fromFaces} 张人脸）合并到 {to}，{name}（{toFaces} 张人脸）？合并后共 {total} 次出现。",
  "people.appears": "出现位置",
  "people.noHits": "没有出现记录。",
  "people.saved": "已保存。",
  "people.mergedText": "已合并 {id}。",
  "timeline.label": "时间轴",
  "timeline.inMatch": "{time}，位于匹配的场景内",
  "timeline.key": "时间轴图例",
  "timeline.key.matched": "匹配场景 {start}–{end}",
  "notes.none": "还没有备注。",
  "notes.label": "备注",
  "note.form": "添加备注",
  "note.field": "备注",
  "note.placeholder": "Ana 正在汇报第三季度预算",
  "note.from": "开始",
  "note.to": "结束",
  "note.peopleInFrame": "画面中的人物",
  "note.save": "保存备注",
  "note.reason.empty": "请先输入备注。",
  "note.added": "已添加备注。",
  "note.reason.format": "请使用 mm:ss 或秒数。",
  "note.reason.order": "结束时间必须晚于开始时间。",
  "face.tagForm": "标注人脸",
  "face.hint": "选择一张人脸进行命名。",
  "face.name": "姓名",
  "face.applyTo": "应用到",
  "face.all": "全部出现",
  "face.needsCluster": "尚未归入聚类",
  "face.thisOnly": "仅此人脸",
  "face.apply": "应用姓名",
  "face.reason.empty": "请先输入姓名。",
  "face.thisFace": "此人脸",
  "face.mergedText": "已合并 {from}。",
  "face.undoneText": "{from} 已取消合并。",
  "clip.details": "详情",
  "clip.back": "搜索结果",
  "clip.frameAlt": "{name}，{time}",
  "clip.speech": "语音",
  "clip.ocr": "画面文字",
  "clip.faces": "画面中的人脸",
  "people.more": "还有 {count} 个",
  "people.chip.all": "全部",
  "people.chip.named": "已命名",
  "people.chip.unnamed": "未命名（{count}）",
  "face.frameAlt": "带有检测到的人脸的关键帧",
  "face.button": "人脸 {n}：{label}",
  "face.untagged": "未标注",
};


/**
 * Chinese for the sample content in `src/mock` (file names and person names stay as they are).
 * Keyed by the English text, so a sample string with no entry shows as written.
 */
const samplesZh: Record<string, string> = {
  "Ana demonstrates the garlic butter": "Ana 演示蒜香黄油",
  "Ana is presenting the Q3 budget": "Ana 正在汇报第三季度预算",
  "Camera shake from here": "此处镜头抖动",
  "now fold the garlic into the butter and let it soften": "现在把蒜末拌入黄油，静置至软化",
  "Q3 BUDGET — headcount and spend": "第三季度预算——人员编制与支出",
  "I started cooking when I was nine, mostly bread": "我九岁开始做饭，主要是面包",
  "Garlic butter: 4 cloves, 80 g butter, rest 10 min": "蒜香黄油：4 瓣大蒜，80 克黄油，静置 10 分钟",
  "Catering services agreement — cooking class series 2025": "餐饮服务协议——2025 烹饪课系列",
  "Counterparty: Lumen Kitchen Studio · term 2025-04 to 2025-12 · status: active": "合作方：Lumen Kitchen Studio · 期限 2025-04 至 2025-12 · 状态：生效中",
  "Q3 budget review — approved minutes": "第三季度预算审议——已批准会议纪要",
  "Approved by the finance committee · 14 pages · retention: 10 years": "经财务委员会批准 · 14 页 · 保存期限 10 年",
  "Purchase order — kitchen equipment for the cooking studio": "采购订单——烹饪工作室厨房设备",
  "Contract": "合同",
  "Board minutes": "董事会会议纪要",
  "Purchase order": "采购订单",
  "Marketing": "市场部",
  "Finance": "财务部",
  "Facilities": "后勤部",
  "Exec": "管理层",
  "Media-Library": "媒体库",
  "Hotels": "酒店",
  "Taxi": "出租车",
  "Monthly hotel P&L": "酒店月度损益表",
  "Finance / Close": "财务 / 结账",
  "Hotel portfolio dashboard": "酒店组合看板",
  "Hotels / Revenue": "酒店 / 收益管理",
  "Board pack — Q3 2026": "董事会材料——2026 年第三季度",
  "Finance / Board": "财务 / 董事会",
  "Weekend rate test readout": "周末房价测试总结",
  "Hotels / Pricing": "酒店 / 定价",
  "RevPAR by property": "各酒店 RevPAR",
  "Hotels / Operations": "酒店 / 运营",
  "Weekly business review": "每周经营回顾",
  "FY26 forecast vs actuals": "2026 财年预测与实际对比",
  "Finance / Planning": "财务 / 预算规划",
  "Fleet daily dashboard": "车队日报看板",
  "Taxi / Operations": "出租车 / 运营",
  "FY26 opex budget tracker": "2026 财年运营费用预算跟踪",
  "RevPAR": "RevPAR（每间可售房收入）",
  "Room revenue ÷ available room nights": "客房收入 ÷ 可售间夜数",
  "Revenue per trip": "每单收入",
  "Fare revenue ÷ completed trips": "车费收入 ÷ 完成订单数",
  "Opex budget variance": "运营费用预算偏差",
  "Group EBITDA margin": "集团 EBITDA 利润率",
  "EBITDA ÷ group revenue": "EBITDA ÷ 集团收入",
};

/** The sample text in `zh`, or the text itself when there is no translation. */
function sampleText(text: string, locale: Locale): string {
  return locale === "zh" ? samplesZh[text] ?? text : text;
}

const messages: Record<Locale, Partial<Record<MessageKey, string>>> = { en, zh };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Fills `{name}` placeholders. Unknown placeholders are left as written. */
export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function translator(locale: Locale): Translate {
  return (key, vars) => format(messages[locale][key] ?? en[key], vars);
}

/** Like `format`, but each filled placeholder comes back as its own part, so a caller can style it. */
export function formatParts(template: string, vars: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name !== undefined && name in vars ? <Fragment key={i}>{vars[name]}</Fragment> : part;
  });
}

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/**
 * The current locale, a `t` that translates a message key, a `rich` that
 * does the same but lets each placeholder be any React node, and an `s` for
 * sample content. English when no provider is present.
 */
export function useI18n(): {
  locale: Locale;
  t: Translate;
  rich: (key: MessageKey, vars: Record<string, ReactNode>) => ReactNode[];
  /** Translates sample content (mock titles, notes, transcripts). */
  s: (text: string) => string;
} {
  const locale = useContext(LocaleContext);
  return { locale, t: translator(locale), rich: (key, vars) => formatParts(messages[locale][key] ?? en[key], vars), s: (text) => sampleText(text, locale) };
}

export const LOCALES: { value: Locale; title: string }[] = [
  { value: "en", title: "English" },
  { value: "zh", title: "中文" },
];
