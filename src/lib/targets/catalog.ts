/**
 * 视觉目标配方。纯数据，可在 client / server 共用。
 * 规则刻意短：换「在画什么」，不造法律。
 */

export const HOME_TARGET_IDS = [
  "ui-visual",
  "game-art",
  "promo-kv",
  "social-cover",
  "product-shot",
  "style-board",
] as const;

export type TargetId = (typeof HOME_TARGET_IDS)[number];

export type RecipeQuestion = {
  id: string;
  label: string;
  type: "radio" | "checkbox" | "text";
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  maxSelections?: number;
};

export type DirectionCard = {
  id: string;
  label: string;
  tokens: string[];
  forbids: string[];
};

export type TargetRecipe = {
  id: TargetId;
  label: string;
  goalSentence: string;
  placeholder: string;
  examples: string[];
  discovery: RecipeQuestion[];
  directionAdjust: RecipeQuestion[];
  directionCards: DirectionCard[];
  canvas: {
    width: number;
    height: number;
    emptyTitle: string;
    emptyHint: string;
  };
  promptContract: string;
  toolsDeny: string[];
  handoff: "code-kickoff" | "art-bible" | "media-pack" | "none";
  keepRuleScope: string[];
  requireReference?: boolean;
};

const MOOD: RecipeQuestion = {
  id: "mood",
  label: "整体调性",
  type: "radio",
  required: true,
  options: [
    { value: "brighter", label: "更明亮" },
    { value: "darker", label: "更暗 / 神秘" },
    { value: "keep_mood", label: "调性先保持" },
  ],
};

const PALETTE: RecipeQuestion = {
  id: "palette",
  label: "配色",
  type: "radio",
  required: true,
  options: [
    { value: "warmer", label: "更暖（金 / 夕阳）" },
    { value: "cooler", label: "更冷（青 / 雾蓝）" },
    { value: "keep_palette", label: "配色先保持" },
  ],
};

const NOTE: RecipeQuestion = {
  id: "note",
  label: "还有什么要改？",
  type: "text",
  placeholder: "一句就行，可空",
};

const RECIPES: Record<TargetId, TargetRecipe> = {
  "ui-visual": {
    id: "ui-visual",
    label: "界面视觉",
    goalSentence: "用户目标 = 生产可给编码看的高保真屏幕图",
    placeholder: "哪一屏、给谁用？例如：健身 App 今日训练首页",
    examples: [
      "健身 App 今日训练首页",
      "SaaS 定价页，深色专业",
      "电商结算页，清晰步骤",
    ],
    discovery: [
      {
        id: "productType",
        label: "要做什么？",
        type: "radio",
        required: true,
        options: [
          { value: "game", label: "游戏 / 概念图" },
          { value: "app_ui", label: "App / 界面" },
          { value: "landing", label: "落地页 / 官网" },
          { value: "poster", label: "海报 / 封面" },
          { value: "other", label: "其他" },
        ],
      },
      {
        id: "tone",
        label: "视觉调性",
        type: "checkbox",
        maxSelections: 2,
        options: [
          { value: "pixel", label: "像素" },
          { value: "xianxia", label: "仙侠 / 国风" },
          { value: "cyberpunk", label: "赛博朋克" },
          { value: "minimal", label: "现代极简" },
          { value: "editorial", label: "杂志编辑" },
          { value: "luxury", label: "奢华精致" },
          { value: "illustration", label: "插画" },
        ],
      },
      {
        id: "audience",
        label: "给谁看？",
        type: "text",
        placeholder: "例如：核心玩家、早期投资人、内部评审",
      },
      {
        id: "brand",
        label: "品牌背景",
        type: "radio",
        options: [
          { value: "pick_direction", label: "帮我选方向" },
          { value: "brand_spec", label: "我有品牌规范" },
          { value: "reference_match", label: "有参考图 / 网站" },
        ],
      },
    ],
    directionAdjust: [
      MOOD,
      PALETTE,
      {
        id: "density",
        label: "界面疏密",
        type: "radio",
        options: [
          { value: "airier", label: "更留白" },
          { value: "denser", label: "信息更满" },
          { value: "keep_density", label: "疏密先保持" },
        ],
      },
      NOTE,
    ],
    directionCards: [
      {
        id: "linear",
        label: "Linear",
        tokens: ["cool gray", "one accent", "tight spacing"],
        forbids: ["promo collage", "giant sale type"],
      },
      {
        id: "editorial",
        label: "编辑杂志",
        tokens: ["serif headline", "asymmetric grid"],
        forbids: ["app-store badge soup"],
      },
      {
        id: "dark-pro",
        label: "深色专业",
        tokens: ["charcoal", "hairline dividers"],
        forbids: ["neon cyber poster"],
      },
      {
        id: "game-hud",
        label: "游戏化 HUD",
        tokens: ["diegetic panels", "readable stats"],
        forbids: ["not a marketing key visual"],
      },
    ],
    canvas: {
      width: 1024,
      height: 1024,
      emptyTitle: "还没有这一屏",
      emptyHint: "说一下主操作和给谁用，结果会落在这里",
    },
    promptContract: [
      "Complete single-screen UI mockup.",
      "Readable UI type. One navigation system.",
      "Not a poster, promo banner, sale graphic, or campaign collage.",
      "No giant marketing typography.",
    ].join("\n"),
    toolsDeny: [],
    handoff: "code-kickoff",
    keepRuleScope: ["avoid-poster"],
  },
  "game-art": {
    id: "game-art",
    label: "游戏原画",
    goalSentence: "用户目标 = 生产可进美术包的概念图 / 立绘 / 场景",
    placeholder: "什么资产？立绘、场景还是道具？例如：像素仙侠门派山门",
    examples: [
      "像素仙侠门派山门立绘",
      "厚涂机甲角色三视图",
      "水墨仙侠夜航渡口",
    ],
    discovery: [
      {
        id: "assetKind",
        label: "资产种类",
        type: "radio",
        required: true,
        options: [
          { value: "portrait", label: "角色立绘" },
          { value: "scene", label: "场景 / 镜头" },
          { value: "prop", label: "道具" },
          { value: "icon", label: "图标 / 界面装饰" },
        ],
      },
      {
        id: "render",
        label: "渲染语言",
        type: "radio",
        options: [
          { value: "pixel", label: "像素" },
          { value: "thick-paint", label: "厚涂" },
          { value: "cel", label: "三渲二" },
          { value: "ink", label: "水墨 / 国风" },
        ],
      },
      {
        id: "world",
        label: "时代 / 门派 / 世界观",
        type: "text",
        placeholder: "例如：仙侠门派、赛博夜市",
      },
    ],
    directionAdjust: [
      MOOD,
      PALETTE,
      {
        id: "pixel",
        label: "像素精度",
        type: "radio",
        options: [
          { value: "fine", label: "更细的像素颗粒" },
          { value: "chunky", label: "更粗的 8-bit" },
          { value: "keep_pixel", label: "精度先保持" },
        ],
      },
      {
        id: "focus",
        label: "概念图主题",
        type: "radio",
        options: [
          { value: "architecture", label: "门派 / 场景建筑" },
          { value: "combat", label: "战斗 / 修炼场面" },
          { value: "ui", label: "游戏 UI 感" },
          { value: "keep_focus", label: "主题先保持" },
        ],
      },
      NOTE,
    ],
    directionCards: [
      {
        id: "pixel-xianxia",
        label: "像素仙侠",
        tokens: ["chunky pixels", "jade and dusk gold"],
        forbids: ["SaaS homepage", "Inter purple"],
      },
      {
        id: "thick-paint",
        label: "厚涂",
        tokens: ["oil-like strokes", "dramatic key light"],
        forbids: ["flat UI kit"],
      },
      {
        id: "cel",
        label: "三渲二",
        tokens: ["clean rims", "anime volume"],
        forbids: ["photoreal product shot"],
      },
      {
        id: "ink-xianxia",
        label: "水墨仙侠",
        tokens: ["ink wash", "empty mist"],
        forbids: ["dashboard chrome"],
      },
    ],
    canvas: {
      width: 1280,
      height: 720,
      emptyTitle: "还没有这张概念图",
      emptyHint: "描述一个镜头或角色，结果会落在这里",
    },
    promptContract: [
      "Concept art: character, environment, or prop keyframe.",
      "Clear silhouette. Same world across shots.",
      "No SaaS landing page. No Inter purple gradient UI chrome.",
    ].join("\n"),
    toolsDeny: ["materialize_mockup"],
    handoff: "art-bible",
    keepRuleScope: [],
  },
  "promo-kv": {
    id: "promo-kv",
    label: "宣传主视觉",
    goalSentence: "用户目标 = 生产可投放的主 KV 与多尺寸变体",
    placeholder: "哪条渠道、一句卖点？例如：新品发布主视觉",
    examples: [
      "新品发布 KV，电影感",
      "品牌年度大片，16:9",
      "国潮海报，必须上品牌名",
    ],
    discovery: [
      {
        id: "channel",
        label: "投放渠道",
        type: "radio",
        required: true,
        options: [
          { value: "wide", label: "16:9 横版" },
          { value: "square", label: "1:1" },
          { value: "story", label: "9:16 竖版" },
          { value: "set", label: "一套多尺寸" },
        ],
      },
      {
        id: "hook",
        label: "一句卖点",
        type: "text",
        placeholder: "必须出现在画面上的那句话",
      },
      {
        id: "mustType",
        label: "必须上的字",
        type: "text",
        placeholder: "品牌名 / 日期 / 可空",
      },
    ],
    directionAdjust: [
      MOOD,
      PALETTE,
      {
        id: "drama",
        label: "戏剧感",
        type: "radio",
        options: [
          { value: "more", label: "光影更戏剧" },
          { value: "quiet", label: "更克制" },
          { value: "keep_drama", label: "先保持" },
        ],
      },
      NOTE,
    ],
    directionCards: [
      {
        id: "cinematic",
        label: "电影感",
        tokens: ["anamorphic light", "deep contrast"],
        forbids: ["fake app frame", "clickable UI"],
      },
      {
        id: "fashion",
        label: "时尚大片",
        tokens: ["editorial crop", "skin highlight"],
        forbids: ["dashboard"],
      },
      {
        id: "guochao",
        label: "国潮海报",
        tokens: ["bold type", "red-gold ink"],
        forbids: ["SaaS cards"],
      },
    ],
    canvas: {
      width: 1920,
      height: 1080,
      emptyTitle: "还没有主视觉",
      emptyHint: "说渠道和那句卖点，主 KV 会落在这里",
    },
    promptContract: [
      "Campaign key visual. Big type and dramatic light are allowed.",
      "No fake app chrome. Not a clickable interface.",
    ].join("\n"),
    toolsDeny: ["materialize_mockup"],
    handoff: "media-pack",
    keepRuleScope: [],
  },
  "social-cover": {
    id: "social-cover",
    label: "社媒封面",
    goalSentence: "用户目标 = 生产可发的竖版封面 / 知识卡",
    placeholder: "哪个平台、钩子是什么？例如：小红书开箱封面",
    examples: [
      "小红书开箱封面",
      "知识卡：三步讲清一个点",
      "生活方式封面，要人脸",
    ],
    discovery: [
      {
        id: "platform",
        label: "平台",
        type: "radio",
        required: true,
        options: [
          { value: "xhs", label: "小红书" },
          { value: "wechat", label: "公众号头图" },
          { value: "other", label: "其他竖版" },
        ],
      },
      {
        id: "hook",
        label: "钩子 / 标题",
        type: "text",
        placeholder: "少字，一句",
      },
      {
        id: "face",
        label: "要不要人脸 / 产品",
        type: "radio",
        options: [
          { value: "face", label: "要人脸" },
          { value: "product", label: "要产品" },
          { value: "neither", label: "都不要" },
        ],
      },
    ],
    directionAdjust: [
      MOOD,
      PALETTE,
      {
        id: "hookTone",
        label: "钩子语气",
        type: "radio",
        options: [
          { value: "louder", label: "更冲" },
          { value: "softer", label: "更生活" },
          { value: "keep_hook", label: "先保持" },
        ],
      },
      NOTE,
    ],
    directionCards: [
      {
        id: "knowledge",
        label: "知识卡",
        tokens: ["big title", "3 short lines"],
        forbids: ["long article in-image", "dashboard"],
      },
      {
        id: "unbox",
        label: "开箱",
        tokens: ["hands + product", "bright key"],
        forbids: ["UI mockup"],
      },
      {
        id: "lifestyle",
        label: "生活方式",
        tokens: ["soft daylight", "one hero"],
        forbids: ["dense infographic"],
      },
    ],
    canvas: {
      width: 1080,
      height: 1440,
      emptyTitle: "还没有封面",
      emptyHint: "说平台和钩子，竖版卡会落在这里",
    },
    promptContract: [
      "Vertical cover. Few words, one focus.",
      "Do not typeset a long article. No dashboard UI.",
    ].join("\n"),
    toolsDeny: ["materialize_mockup"],
    handoff: "media-pack",
    keepRuleScope: [],
  },
  "product-shot": {
    id: "product-shot",
    label: "产品图",
    goalSentence: "用户目标 = 按实物参考出电商主图，不脑补外形",
    placeholder: "先有实拍或三视图。例如：白底主图 + 生活场景",
    examples: [
      "白底主图，保留外形",
      "生活场景里的这只杯子",
      "材质特写，金属拉丝",
    ],
    discovery: [
      {
        id: "shot",
        label: "拍法",
        type: "radio",
        required: true,
        options: [
          { value: "white", label: "白底主图" },
          { value: "lifestyle", label: "生活场景" },
          { value: "macro", label: "材质特写" },
        ],
      },
      {
        id: "refNote",
        label: "参考图说明",
        type: "text",
        placeholder: "外形以哪张为准；没有图先停",
      },
    ],
    directionAdjust: [
      {
        id: "light",
        label: "光线",
        type: "radio",
        options: [
          { value: "softer", label: "更柔" },
          { value: "harder", label: "更硬" },
          { value: "keep_light", label: "先保持" },
        ],
      },
      {
        id: "scene",
        label: "场景",
        type: "radio",
        options: [
          { value: "cleaner", label: "更干净白底" },
          { value: "lived-in", label: "更生活" },
          { value: "keep_scene", label: "先保持" },
        ],
      },
      NOTE,
    ],
    directionCards: [
      {
        id: "white",
        label: "白底主图",
        tokens: ["seamless white", "true silhouette"],
        forbids: ["invented geometry"],
      },
      {
        id: "lifestyle",
        label: "生活场景",
        tokens: ["believable set", "product hero"],
        forbids: ["swap product structure"],
      },
      {
        id: "macro",
        label: "材质特写",
        tokens: ["true material", "tight crop"],
        forbids: ["new hero shape"],
      },
    ],
    canvas: {
      width: 1024,
      height: 1024,
      emptyTitle: "还没有产品图",
      emptyHint: "先放一张实拍或三视图，再出主图",
    },
    promptContract: [
      "Product photography. Shape follows the reference.",
      "Light and set may change. Structure may not.",
    ].join("\n"),
    toolsDeny: ["materialize_mockup"],
    handoff: "media-pack",
    keepRuleScope: [],
    requireReference: true,
  },
  "style-board": {
    id: "style-board",
    label: "风格探索",
    goalSentence: "用户目标 = 并排试方向，再锁定到某一条正式目标",
    placeholder: "品类 + 三个词，或丢参考图。例如：茶饮 纸感 雾绿 手写",
    examples: [
      "茶饮 纸感 雾绿 手写",
      "机甲 冷金属 夜光 四张并排",
      "儿童绘本 奶油色 圆润",
    ],
    discovery: [
      {
        id: "category",
        label: "品类",
        type: "text",
        placeholder: "茶饮 / 游戏角色 / 工具 App…",
      },
      {
        id: "words",
        label: "三个词",
        type: "text",
        placeholder: "材质、颜色、情绪",
      },
    ],
    directionAdjust: [MOOD, PALETTE, NOTE],
    directionCards: [
      {
        id: "draft-grid",
        label: "并排试色",
        tokens: ["same subject", "four treatments"],
        forbids: ["final production polish"],
      },
    ],
    canvas: {
      width: 1024,
      height: 1024,
      emptyTitle: "还没有风格卡",
      emptyHint: "三个词或一张参考，并排试方向",
    },
    promptContract: [
      "Draft style frames. Same subject, different treatment.",
      "Mark as exploration, not final production art.",
    ].join("\n"),
    toolsDeny: ["materialize_mockup"],
    handoff: "none",
    keepRuleScope: [],
  },
};

export function isTargetId(value: unknown): value is TargetId {
  return (
    typeof value === "string" &&
    (HOME_TARGET_IDS as readonly string[]).includes(value)
  );
}

export function getTargetRecipe(id: TargetId): TargetRecipe {
  return RECIPES[id];
}

export function listHomeTargetRecipes(): TargetRecipe[] {
  return HOME_TARGET_IDS.map((id) => RECIPES[id]);
}
