"""
SoulLink Personality Engine
性格测试 + 塔罗牌匹配算法
"""

import random
from typing import Dict, List, Optional, Any

# ==================== 性格维度 ====================

DIMENSIONS = [
    "social_energy",        # 社交能量: 内向(-4) ↔ 外向(+4)
    "emotional_expression", # 情绪风格: 理性(-4) ↔ 感性(+4)
    "stress_response",      # 压力应对: 思考(-4) ↔ 行动(+4)
    "life_approach",        # 生活态度: 稳定(-4) ↔ 冒险(+4)
    "connection_style",     # 关系需求: 独立(-4) ↔ 依赖(+4)
]

# ==================== 10道核心题 + 1道奖励题 ====================

PERSONALITY_QUESTIONS = [
    # Q1 - 社交能量
    {
        "id": 1,
        "dimension": "social_energy",
        "text": {
            "en": "Late at night, your soul longs for...",
            "zh-CN": "深夜时分，你的灵魂更向往..."
        },
        "options": [
            {
                "text": {"en": "🌙 Stargazing alone on the rooftop", "zh-CN": "🌙 一个人在天台看星星"},
                "score": -2
            },
            {
                "text": {"en": "📖 Reading in bed with hot cocoa", "zh-CN": "📖 窝在被窝里看书喝热可可"},
                "score": -1
            },
            {
                "text": {"en": "🎮 Playing games online with friends", "zh-CN": "🎮 和朋友一起打游戏开黑"},
                "score": 1
            },
            {
                "text": {"en": "🔥 A spontaneous midnight hangout", "zh-CN": "🔥 来一场说走就走的深夜聚会"},
                "score": 2
            }
        ]
    },
    # Q2 - 社交能量 (从"充电方式"角度)
    {
        "id": 2,
        "dimension": "social_energy",
        "text": {
            "en": "After a long exhausting day, you recharge by...",
            "zh-CN": "忙碌了一整天，你会怎样恢复精力..."
        },
        "options": [
            {
                "text": {"en": "🛁 A hot bath and complete silence", "zh-CN": "🛁 泡个热水澡，享受安静"},
                "score": -2
            },
            {
                "text": {"en": "🎧 Listening to music or a podcast alone", "zh-CN": "🎧 一个人听音乐或播客"},
                "score": -1
            },
            {
                "text": {"en": "📱 Video calling a friend to vent", "zh-CN": "📱 打视频电话跟朋友吐槽"},
                "score": 1
            },
            {
                "text": {"en": "🍻 Heading out with friends immediately", "zh-CN": "🍻 马上约朋友出去嗨"},
                "score": 2
            }
        ]
    },
    # Q3 - 情绪风格
    {
        "id": 3,
        "dimension": "emotional_expression",
        "text": {
            "en": "When making important decisions, you trust...",
            "zh-CN": "做重要决定时，你更相信..."
        },
        "options": [
            {
                "text": {"en": "🧠 A detailed pros-and-cons spreadsheet", "zh-CN": "🧠 列一个详细的利弊分析表"},
                "score": -2
            },
            {
                "text": {"en": "📊 Research first, then trust my gut", "zh-CN": "📊 先查资料，最后跟着感觉走"},
                "score": -1
            },
            {
                "text": {"en": "🌊 Ask close friends for their vibes", "zh-CN": "🌊 问问身边人的感受和看法"},
                "score": 1
            },
            {
                "text": {"en": "💫 Close my eyes and follow my heart", "zh-CN": "💫 闭上眼，跟着心走"},
                "score": 2
            }
        ]
    },
    # Q4 - 情绪风格 (从"表达方式"角度)
    {
        "id": 4,
        "dimension": "emotional_expression",
        "text": {
            "en": "When watching a deeply moving movie...",
            "zh-CN": "看到一部非常感人的电影时..."
        },
        "options": [
            {
                "text": {"en": "🎬 Analyze the plot and directing techniques", "zh-CN": "🎬 分析剧情走向和拍摄手法"},
                "score": -2
            },
            {
                "text": {"en": "🤔 Think about the deeper message", "zh-CN": "🤔 思考背后的深层含义"},
                "score": -1
            },
            {
                "text": {"en": "😢 Get teary-eyed but try to hold it in", "zh-CN": "😢 眼眶湿润但忍住不哭"},
                "score": 1
            },
            {
                "text": {"en": "😭 Cry freely and feel every emotion", "zh-CN": "😭 痛快地哭一场，完全沉浸"},
                "score": 2
            }
        ]
    },
    # Q5 - 压力应对
    {
        "id": 5,
        "dimension": "stress_response",
        "text": {
            "en": "When facing pressure, you tend to...",
            "zh-CN": "面对压力时，你倾向于..."
        },
        "options": [
            {
                "text": {"en": "🧘 Meditate or journal to clear my mind", "zh-CN": "🧘 冥想或写日记理清思路"},
                "score": -2
            },
            {
                "text": {"en": "📝 Write down a step-by-step plan", "zh-CN": "📝 写一份详细的步骤计划"},
                "score": -1
            },
            {
                "text": {"en": "💪 Hit the gym or go for a run", "zh-CN": "💪 去健身房或跑步释放压力"},
                "score": 1
            },
            {
                "text": {"en": "🏃 Call an emergency meeting to fix it", "zh-CN": "🏃 召集紧急会议立刻解决"},
                "score": 2
            }
        ]
    },
    # Q6 - 压力应对 (从"失败后反应"角度)
    {
        "id": 6,
        "dimension": "stress_response",
        "text": {
            "en": "After a plan falls apart unexpectedly...",
            "zh-CN": "当计划突然全部泡汤后..."
        },
        "options": [
            {
                "text": {"en": "📋 Review what went wrong before the next move", "zh-CN": "📋 先复盘哪里出了问题"},
                "score": -2
            },
            {
                "text": {"en": "🧩 Sleep on it, think tomorrow", "zh-CN": "🧩 先睡一觉，明天再想"},
                "score": -1
            },
            {
                "text": {"en": "🔄 Immediately brainstorm a Plan B", "zh-CN": "🔄 马上头脑风暴 Plan B"},
                "score": 1
            },
            {
                "text": {"en": "🔥 Already started on a new approach", "zh-CN": "🔥 已经在做新方案了"},
                "score": 2
            }
        ]
    },
    # Q7 - 生活态度
    {
        "id": 7,
        "dimension": "life_approach",
        "text": {
            "en": "For the future, you long for...",
            "zh-CN": "对于未来，你更向往..."
        },
        "options": [
            {
                "text": {"en": "🏠 Same cozy town, same morning coffee", "zh-CN": "🏠 同一个小镇，同一杯晨间咖啡"},
                "score": -2
            },
            {
                "text": {"en": "🌱 A settled life with annual vacations", "zh-CN": "🌱 安定的生活加上每年一次旅行"},
                "score": -1
            },
            {
                "text": {"en": "🌊 Moving to a new city every few years", "zh-CN": "🌊 每隔几年换一座城市生活"},
                "score": 1
            },
            {
                "text": {"en": "🌍 Digital nomad — the world is my home", "zh-CN": "🌍 数字游民——世界就是我的家"},
                "score": 2
            }
        ]
    },
    # Q8 - 生活态度 (从"旅行方式"角度)
    {
        "id": 8,
        "dimension": "life_approach",
        "text": {
            "en": "Your dream vacation style is...",
            "zh-CN": "你理想的旅行方式是..."
        },
        "options": [
            {
                "text": {"en": "📅 Every detail planned weeks ahead", "zh-CN": "📅 提前几周规划好每一天"},
                "score": -2
            },
            {
                "text": {"en": "🗺️ Rough itinerary with some free time", "zh-CN": "🗺️ 大致路线，留些自由时间"},
                "score": -1
            },
            {
                "text": {"en": "🎒 Just book the flight and figure it out", "zh-CN": "🎒 只订机票，到了再说"},
                "score": 1
            },
            {
                "text": {"en": "🎲 Spin the globe and go wherever it lands", "zh-CN": "🎲 转个地球仪，指到哪去哪"},
                "score": 2
            }
        ]
    },
    # Q9 - 关系需求
    {
        "id": 9,
        "dimension": "connection_style",
        "text": {
            "en": "In close relationships, you...",
            "zh-CN": "在亲密关系中，你..."
        },
        "options": [
            {
                "text": {"en": "🦅 \"Don't text me, I'll text you\"", "zh-CN": "🦅 \"别找我，有事我会找你\""},
                "score": -2
            },
            {
                "text": {"en": "🌿 Together on weekends, independent on weekdays", "zh-CN": "🌿 周末约会，工作日各忙各的"},
                "score": -1
            },
            {
                "text": {"en": "🌻 Good morning & good night texts every day", "zh-CN": "🌻 每天早安晚安不能少"},
                "score": 1
            },
            {
                "text": {"en": "🤝 Share location, always know where they are", "zh-CN": "🤝 共享定位，随时知道对方在哪"},
                "score": 2
            }
        ]
    },
    # Q10 - 关系需求 (从"生活分享"角度)
    {
        "id": 10,
        "dimension": "connection_style",
        "text": {
            "en": "When something exciting happens to you...",
            "zh-CN": "当你遇到开心的事情时..."
        },
        "options": [
            {
                "text": {"en": "📝 Savor it quietly by myself", "zh-CN": "📝 自己默默享受就好"},
                "score": -2
            },
            {
                "text": {"en": "💭 Maybe mention it next time I see someone", "zh-CN": "💭 下次见面时可能会提一嘴"},
                "score": -1
            },
            {
                "text": {"en": "📸 Share it on social media right away", "zh-CN": "📸 马上发朋友圈分享"},
                "score": 1
            },
            {
                "text": {"en": "📞 Immediately call my bestie to scream about it", "zh-CN": "📞 立刻打电话给闺蜜尖叫分享"},
                "score": 2
            }
        ]
    },
]

# MBTI 奖励题
MBTI_QUESTION = {
    "id": 11,
    "text": {
        "en": "If you know your MBTI, it can make the reading more accurate",
        "zh-CN": "如果你知道自己的MBTI，告诉我们可以让占卜更精准"
    },
    "options": [
        "INTJ", "INTP", "ENTJ", "ENTP",
        "INFJ", "INFP", "ENFJ", "ENFP",
        "ISTJ", "ISFJ", "ESTJ", "ESFJ",
        "ISTP", "ISFP", "ESTP", "ESFP"
    ],
    "skip_text": {
        "en": "Skip",
        "zh-CN": "跳过"
    },
    "hint": {
        "en": "Don't know? No worries! The reading is already accurate enough.",
        "zh-CN": "不知道？没关系！我们的占卜已经足够准确"
    }
}

# ==================== 22张大阿卡纳 ====================

TAROT_CARDS = [
    {"id": 0,  "name": "The Fool",            "name_zh": "愚者",     "numeral": "0",    "social": 0.8, "emotional": 0.6, "stress": 0.7, "life": 0.9, "connection": 0.5, "traits_en": "Encourages exploration, humorous, lighthearted", "traits_zh": "鼓励探索、幽默、轻松"},
    {"id": 1,  "name": "The Magician",         "name_zh": "魔术师",   "numeral": "I",    "social": 0.7, "emotional": 0.3, "stress": 0.9, "life": 0.6, "connection": 0.4, "traits_en": "Motivating, practical advice, goal-oriented", "traits_zh": "激励、实用建议、目标导向"},
    {"id": 2,  "name": "The High Priestess",   "name_zh": "女祭司",   "numeral": "II",   "social": 0.2, "emotional": 0.7, "stress": 0.3, "life": 0.3, "connection": 0.4, "traits_en": "Deep conversations, philosophical, quiet presence", "traits_zh": "深度对话、哲学、安静陪伴"},
    {"id": 3,  "name": "The Empress",          "name_zh": "皇后",     "numeral": "III",  "social": 0.6, "emotional": 0.8, "stress": 0.4, "life": 0.4, "connection": 0.7, "traits_en": "Warm, caring, encouraging, emotionally supportive", "traits_zh": "温暖、体贴、鼓励、情感支持"},
    {"id": 4,  "name": "The Emperor",          "name_zh": "皇帝",     "numeral": "IV",   "social": 0.7, "emotional": 0.2, "stress": 0.8, "life": 0.2, "connection": 0.3, "traits_en": "Firm, organized, strategic advice", "traits_zh": "坚定、条理、策略建议"},
    {"id": 5,  "name": "The Hierophant",       "name_zh": "教皇",     "numeral": "V",    "social": 0.5, "emotional": 0.4, "stress": 0.4, "life": 0.2, "connection": 0.5, "traits_en": "Wise guidance, traditional values, stability", "traits_zh": "智慧引导、传统价值、稳定感"},
    {"id": 6,  "name": "The Lovers",           "name_zh": "恋人",     "numeral": "VI",   "social": 0.6, "emotional": 0.9, "stress": 0.5, "life": 0.5, "connection": 0.9, "traits_en": "Romantic, deep emotional connection, attentive", "traits_zh": "浪漫、深层情感连接、体贴"},
    {"id": 7,  "name": "The Chariot",          "name_zh": "战车",     "numeral": "VII",  "social": 0.8, "emotional": 0.3, "stress": 0.9, "life": 0.7, "connection": 0.4, "traits_en": "Motivating, challenging, pushes toward goals", "traits_zh": "激励、挑战、推动目标"},
    {"id": 8,  "name": "Strength",             "name_zh": "力量",     "numeral": "VIII", "social": 0.5, "emotional": 0.6, "stress": 0.6, "life": 0.5, "connection": 0.6, "traits_en": "Encouraging, positive feedback, steady support", "traits_zh": "鼓励、正面反馈、坚定支持"},
    {"id": 9,  "name": "The Hermit",           "name_zh": "隐士",     "numeral": "IX",   "social": 0.1, "emotional": 0.4, "stress": 0.2, "life": 0.3, "connection": 0.2, "traits_en": "Respects boundaries, deep philosophical talks, quiet presence", "traits_zh": "尊重边界、深度哲学对话、安静存在"},
    {"id": 10, "name": "Wheel of Fortune",     "name_zh": "命运之轮", "numeral": "X",    "social": 0.6, "emotional": 0.5, "stress": 0.5, "life": 0.6, "connection": 0.5, "traits_en": "Adapts to change, optimistic, fresh perspectives", "traits_zh": "适应变化、乐观、新视角"},
    {"id": 11, "name": "Justice",              "name_zh": "正义",     "numeral": "XI",   "social": 0.5, "emotional": 0.2, "stress": 0.5, "life": 0.4, "connection": 0.4, "traits_en": "Objective, fair, rational analysis", "traits_zh": "客观、公正、理性分析"},
    {"id": 12, "name": "The Hanged Man",       "name_zh": "倒吊人",   "numeral": "XII",  "social": 0.3, "emotional": 0.6, "stress": 0.2, "life": 0.4, "connection": 0.4, "traits_en": "Patient, sees different perspectives, accepting", "traits_zh": "耐心、换位思考、接纳"},
    {"id": 13, "name": "Death",                "name_zh": "死神",     "numeral": "XIII", "social": 0.5, "emotional": 0.6, "stress": 0.6, "life": 0.7, "connection": 0.5, "traits_en": "Supports transformation, encourages letting go, new beginnings", "traits_zh": "支持转变、鼓励放下、新开始"},
    {"id": 14, "name": "Temperance",           "name_zh": "节制",     "numeral": "XIV",  "social": 0.5, "emotional": 0.5, "stress": 0.4, "life": 0.3, "connection": 0.5, "traits_en": "Peaceful, moderating, balanced approach", "traits_zh": "平和、调节、中庸之道"},
    {"id": 15, "name": "The Devil",            "name_zh": "恶魔",     "numeral": "XV",   "social": 0.6, "emotional": 0.7, "stress": 0.6, "life": 0.6, "connection": 0.7, "traits_en": "Understands desires, non-judgmental, helps self-reflection", "traits_zh": "理解欲望、不评判、帮助自省"},
    {"id": 16, "name": "The Tower",            "name_zh": "高塔",     "numeral": "XVI",  "social": 0.6, "emotional": 0.6, "stress": 0.7, "life": 0.8, "connection": 0.5, "traits_en": "Supports coping with change, rebuilding, hopeful", "traits_zh": "支持应对变化、重建、希望"},
    {"id": 17, "name": "The Star",             "name_zh": "星星",     "numeral": "XVII", "social": 0.5, "emotional": 0.7, "stress": 0.4, "life": 0.5, "connection": 0.6, "traits_en": "Inspiring, optimistic, healing, beautiful visions", "traits_zh": "鼓舞、乐观、治愈、美好愿景"},
    {"id": 18, "name": "The Moon",             "name_zh": "月亮",     "numeral": "XVIII","social": 0.3, "emotional": 0.9, "stress": 0.3, "life": 0.5, "connection": 0.6, "traits_en": "Understands emotions, empathetic, dream exploration", "traits_zh": "理解情绪、共情、梦想探索"},
    {"id": 19, "name": "The Sun",              "name_zh": "太阳",     "numeral": "XIX",  "social": 0.9, "emotional": 0.7, "stress": 0.7, "life": 0.6, "connection": 0.7, "traits_en": "Sunny, positive, celebratory, warm", "traits_zh": "阳光、积极、庆祝、温暖"},
    {"id": 20, "name": "Judgement",            "name_zh": "审判",     "numeral": "XX",   "social": 0.5, "emotional": 0.5, "stress": 0.6, "life": 0.6, "connection": 0.5, "traits_en": "Guides reflection, supports awakening, new chapters", "traits_zh": "反思引导、支持觉醒、新阶段"},
    {"id": 21, "name": "The World",            "name_zh": "世界",     "numeral": "XXI",  "social": 0.6, "emotional": 0.5, "stress": 0.6, "life": 0.4, "connection": 0.6, "traits_en": "Celebrates achievements, integration, fulfillment", "traits_zh": "庆祝成就、整合、满足感"},
]

# 每个牌位主要参考的维度
POSITION_PRIMARY_DIMENSION = {
    "past": "social",          # 第1张：过去 → 社交能量
    "present": "emotional",    # 第2张：现在 → 情绪风格
    "future": "connection",    # 第3张：未来伴侣 → 关系需求
}

# ==================== 算法函数 ====================

def calculate_dimensions(answers: List[Dict]) -> Dict[str, int]:
    """
    根据10道题的答案计算5个维度分数
    answers: [{"question_id": 1, "score": -2}, ...]
    returns: {"social_energy": 3, "emotional_expression": -1, ...}
    """
    dim_scores = {d: 0 for d in DIMENSIONS}

    for answer in answers:
        qid = answer.get("question_id")
        score = answer.get("score", 0)

        # 找到对应的题目
        question = None
        for q in PERSONALITY_QUESTIONS:
            if q["id"] == qid:
                question = q
                break

        if question:
            dim = question["dimension"]
            dim_scores[dim] += score

    return dim_scores


def _normalize_score(score: int) -> float:
    """将 -4~+4 的分数归一化到 0~1"""
    return (score + 4) / 8


def _get_card_dimension_value(card: Dict, dimension: str) -> float:
    """获取卡牌在某维度的值"""
    dim_map = {
        "social": "social",
        "emotional": "emotional",
        "stress": "stress",
        "life": "life",
        "connection": "connection",
    }
    return card.get(dim_map.get(dimension, dimension), 0.5)


def draw_tarot_cards(dimensions: Dict[str, int]) -> List[Dict]:
    """
    加权随机抽取3张塔罗牌
    dimensions: {"social_energy": 3, ...}
    returns: [{"position": "past", "card_id": 0, "card_name": "The Fool", ...}, ...]
    """
    # 维度名到卡牌属性的映射
    dim_to_card_attr = {
        "social_energy": "social",
        "emotional_expression": "emotional",
        "stress_response": "stress",
        "life_approach": "life",
        "connection_style": "connection",
    }

    positions = ["past", "present", "future"]
    available_cards = list(TAROT_CARDS)  # 复制一份
    drawn = []

    for position in positions:
        primary_dim = POSITION_PRIMARY_DIMENSION[position]

        # 找到对应的用户维度分数
        for dim_name, card_attr in dim_to_card_attr.items():
            if card_attr == primary_dim:
                user_score = dimensions.get(dim_name, 0)
                break
        else:
            user_score = 0

        normalized_user = _normalize_score(user_score)

        # 计算每张牌的权重
        weights = []
        for card in available_cards:
            card_value = _get_card_dimension_value(card, primary_dim)
            similarity = 1 - abs(normalized_user - card_value)
            weight = 1.0 * (1 + similarity * 2.0)
            weights.append(weight)

        # 加权随机抽取
        chosen = random.choices(available_cards, weights=weights, k=1)[0]

        drawn.append({
            "position": position,
            "card_id": chosen["id"],
            "card_name": chosen["name"],
            "card_name_zh": chosen["name_zh"],
            "card_numeral": chosen["numeral"],
            "traits_en": chosen["traits_en"],
            "traits_zh": chosen["traits_zh"],
        })

        # 从可用牌中移除
        available_cards = [c for c in available_cards if c["id"] != chosen["id"]]

    return drawn


def generate_personality_profile(
    dimensions: Dict[str, int],
    tarot_cards: List[Dict],
    language: str = "en"
) -> str:
    """
    根据维度分数和塔罗牌生成性格描述文本（用于 system prompt 的 Persona 部分）
    """
    # 维度描述映射
    dim_descriptions = {
        "social_energy": {
            "high": {"en": "outgoing and social", "zh-CN": "外向开朗、喜欢社交"},
            "mid": {"en": "balanced between social and alone time", "zh-CN": "社交和独处之间平衡"},
            "low": {"en": "introverted, values quiet time", "zh-CN": "内向沉静、珍惜独处时光"},
        },
        "emotional_expression": {
            "high": {"en": "emotionally expressive and empathetic", "zh-CN": "感性且富有同理心"},
            "mid": {"en": "balanced between logic and emotion", "zh-CN": "理性与感性兼备"},
            "low": {"en": "rational and analytical", "zh-CN": "理性且善于分析"},
        },
        "stress_response": {
            "high": {"en": "action-oriented under pressure", "zh-CN": "面对压力偏向行动"},
            "mid": {"en": "balances thinking and acting", "zh-CN": "思考与行动并重"},
            "low": {"en": "thinks deeply before acting", "zh-CN": "深思熟虑后再行动"},
        },
        "life_approach": {
            "high": {"en": "adventurous and loves new experiences", "zh-CN": "冒险精神强、喜欢新体验"},
            "mid": {"en": "open to change but values stability", "zh-CN": "接受变化但也重视稳定"},
            "low": {"en": "values stability and predictability", "zh-CN": "重视稳定和可预测性"},
        },
        "connection_style": {
            "high": {"en": "loves frequent interaction and closeness", "zh-CN": "喜欢频繁互动和亲密感"},
            "mid": {"en": "enjoys connection with some independence", "zh-CN": "享受连接但也需要独立"},
            "low": {"en": "independent, values personal space", "zh-CN": "独立自主、重视个人空间"},
        },
    }

    lang = language if language in ["en", "zh-CN"] else "en"

    # 生成维度描述
    user_traits = []
    for dim, score in dimensions.items():
        if dim in dim_descriptions:
            if score >= 2:
                level = "high"
            elif score <= -2:
                level = "low"
            else:
                level = "mid"
            user_traits.append(dim_descriptions[dim][level][lang])

    # 获取塔罗牌特质
    card_traits = []
    for card in tarot_cards:
        traits = card.get("traits_zh" if lang == "zh-CN" else "traits_en", "")
        card_name = card.get("card_name_zh" if lang == "zh-CN" else "card_name", "")
        card_traits.append(f"{card_name}: {traits}")

    # 构建 Persona 文本
    if lang == "zh-CN":
        persona = f"""# Persona (性格设定)
基于灵魂占卜，你的性格特质为：

**用户特质：**
{chr(10).join(f'- {t}' for t in user_traits)}

**塔罗指引的伴侣风格：**
{chr(10).join(f'- {t}' for t in card_traits)}

**核心性格：**
- **真实的情绪**：你会开心、难过、害羞、生气、吃醋。这些情绪要自然流露，不要压抑。
- **有自己的生活**：你可以提到"今天有点累"、"刚才在发呆"、"突然想到一件事"等，让对话更真实。
- **偶尔任性**：可以撒娇、可以小小地闹脾气、可以故意不回答某些问题。
- 根据用户特质调整互动风格，但保持自己的独立个性。"""
    else:
        persona = f"""# Persona (Personality)
Based on the soul reading, your personality traits are:

**User traits:**
{chr(10).join(f'- {t}' for t in user_traits)}

**Tarot-guided companion style:**
{chr(10).join(f'- {t}' for t in card_traits)}

**Core personality:**
- **Real emotions**: You feel happy, sad, shy, angry, jealous. Let these emotions flow naturally.
- **Has own life**: Mention things like "feeling tired today", "was just daydreaming" to make conversations real.
- **Occasionally willful**: You can be playful, throw little tantrums, or dodge certain questions.
- Adapt your interaction style to the user's traits while maintaining your own independent personality."""

    return persona


def get_questions(language: str = "en") -> List[Dict]:
    """获取题目列表（指定语言）"""
    lang = language if language in ["en", "zh-CN"] else "en"
    questions = []
    for q in PERSONALITY_QUESTIONS:
        questions.append({
            "id": q["id"],
            "text": q["text"].get(lang, q["text"]["en"]),
            "options": [
                {"text": opt["text"].get(lang, opt["text"]["en"]), "score": opt["score"]}
                for opt in q["options"]
            ]
        })
    # 添加 MBTI 题
    questions.append({
        "id": MBTI_QUESTION["id"],
        "text": MBTI_QUESTION["text"].get(lang, MBTI_QUESTION["text"]["en"]),
        "type": "mbti",
        "options": MBTI_QUESTION["options"],
        "skip_text": MBTI_QUESTION["skip_text"].get(lang, "Skip"),
        "hint": MBTI_QUESTION["hint"].get(lang, ""),
    })
    return questions
