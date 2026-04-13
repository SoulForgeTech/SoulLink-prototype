/**
 * Application-wide constants.
 *
 * Ported from index.html — backgrounds, ambient sounds, model definitions,
 * personality subtypes, avatar colour presets, mini-games, and app version.
 */

import type {
  BackgroundDef,
  AmbientSoundDef,
  ModelDef,
  SubtypeDef,
  MiniGame,
} from '@/types';

// ==================== App Version ====================

export const APP_VERSION = 'v0.2.1-beta';

// ==================== Chat Backgrounds ====================

export const BACKGROUNDS: BackgroundDef[] = [
  { id: 'default', file: 'bg.webp', path: 'images/bg.webp', thumb: 'images/Background/thumbnails/bg.jpg', label: 'Default' },
  { id: 'bg01', file: 'aditya-anjagi-KZSDCocsOEE-unsplash.jpg', thumb: 'images/Background/thumbnails/aditya-anjagi-KZSDCocsOEE-unsplash.jpg' },
  { id: 'bg02', file: 'alex-mesmer-6h6O17NjZ_I-unsplash.jpg', thumb: 'images/Background/thumbnails/alex-mesmer-6h6O17NjZ_I-unsplash.jpg' },
  { id: 'bg03', file: 'ali-kazal-Vn7nOtD9DmQ-unsplash.jpg', thumb: 'images/Background/thumbnails/ali-kazal-Vn7nOtD9DmQ-unsplash.jpg' },
  { id: 'bg04', file: 'filiz-elaerts-J_C3_JpJMms-unsplash.jpg', thumb: 'images/Background/thumbnails/filiz-elaerts-J_C3_JpJMms-unsplash.jpg' },
  { id: 'bg05', file: 'florian-schindler-EYj2rSMGnU0-unsplash.jpg', thumb: 'images/Background/thumbnails/florian-schindler-EYj2rSMGnU0-unsplash.jpg' },
  { id: 'bg06', file: 'liana-s-RBLc00d72yo-unsplash.jpg', thumb: 'images/Background/thumbnails/liana-s-RBLc00d72yo-unsplash.jpg' },
  { id: 'bg07', file: 'marek-piwnicki-pE9RxXqGbd4-unsplash.jpg', thumb: 'images/Background/thumbnails/marek-piwnicki-pE9RxXqGbd4-unsplash.jpg' },
  { id: 'bg08', file: 'matt-liu-FT7J1SONJA8-unsplash.jpg', thumb: 'images/Background/thumbnails/matt-liu-FT7J1SONJA8-unsplash.jpg' },
  { id: 'bg09', file: 'mike-hindle-By65zuM4fAc-unsplash.jpg', thumb: 'images/Background/thumbnails/mike-hindle-By65zuM4fAc-unsplash.jpg' },
  { id: 'bg10', file: 'museum-of-new-zealand-te-papa-tongarewa-hFXKUCTWEMI-unsplash.jpg', thumb: 'images/Background/thumbnails/museum-of-new-zealand-te-papa-tongarewa-hFXKUCTWEMI-unsplash.jpg' },
  { id: 'bg11', file: 'pascal-debrunner-8xkImX3so8U-unsplash.jpg', thumb: 'images/Background/thumbnails/pascal-debrunner-8xkImX3so8U-unsplash.jpg' },
  { id: 'bg12', file: 'pexels-nolan-lee-109304063-10259638.jpg', thumb: 'images/Background/thumbnails/pexels-nolan-lee-109304063-10259638.jpg' },
  { id: 'bg13', file: 'pexels-pauldeetman-2695679.jpg', thumb: 'images/Background/thumbnails/pexels-pauldeetman-2695679.jpg' },
  { id: 'bg14', file: 'pic-kaca-unsplash.jpg', thumb: 'images/Background/thumbnails/pic-kaca-unsplash.jpg' },
  { id: 'bg15', file: 'robert-clark-XKaHnkxBc1w-unsplash.jpg', thumb: 'images/Background/thumbnails/robert-clark-XKaHnkxBc1w-unsplash.jpg' },
  { id: 'bg16', file: 'shubham-dhage-TXTmUUGuvpQ-unsplash.jpg', thumb: 'images/Background/thumbnails/shubham-dhage-TXTmUUGuvpQ-unsplash.jpg' },
  { id: 'bg17', file: 'tobias-reich-CI8UPpze-V4-unsplash.jpg', thumb: 'images/Background/thumbnails/tobias-reich-CI8UPpze-V4-unsplash.jpg' },
];

// ==================== Ambient Sounds ====================

const AMBIENT_CDN =
  'https://cdn.jsdelivr.net/gh/remvze/moodist@main/public/sounds';

export const AMBIENT_SOUNDS: AmbientSoundDef[] = [
  // Rain
  { id: 'light_rain',      category: 'rain',   emoji: '\u{1F327}\uFE0F', src: `${AMBIENT_CDN}/rain/light-rain.mp3` },
  { id: 'heavy_rain',      category: 'rain',   emoji: '\u26C8\uFE0F',    src: `${AMBIENT_CDN}/rain/heavy-rain.mp3` },
  { id: 'thunder',          category: 'rain',   emoji: '\u26A1',          src: `${AMBIENT_CDN}/rain/thunder.mp3` },
  // Nature
  { id: 'birds',            category: 'nature', emoji: '\u{1F426}',       src: `${AMBIENT_CDN}/animals/birds.mp3` },
  { id: 'campfire',         category: 'nature', emoji: '\u{1F525}',       src: `${AMBIENT_CDN}/nature/campfire.mp3` },
  { id: 'ocean',            category: 'nature', emoji: '\u{1F30A}',       src: `${AMBIENT_CDN}/nature/waves.mp3` },
  { id: 'wind',             category: 'nature', emoji: '\u{1F343}',       src: `${AMBIENT_CDN}/nature/wind.mp3` },
  { id: 'river',            category: 'nature', emoji: '\u{1F3DE}\uFE0F', src: `${AMBIENT_CDN}/nature/river.mp3` },
  // Urban
  { id: 'cafe',             category: 'urban',  emoji: '\u2615',          src: `${AMBIENT_CDN}/places/cafe.mp3` },
  { id: 'keyboard_typing',  category: 'urban',  emoji: '\u2328\uFE0F',    src: `${AMBIENT_CDN}/things/keyboard.mp3` },
  { id: 'train',            category: 'urban',  emoji: '\u{1F682}',       src: `${AMBIENT_CDN}/transport/inside-a-train.mp3` },
  // Noise
  { id: 'white_noise',      category: 'noise',  emoji: '\u{1F4FB}',       src: `${AMBIENT_CDN}/noise/white-noise.wav` },
  { id: 'brown_noise',      category: 'noise',  emoji: '\u{1F7E4}',       src: `${AMBIENT_CDN}/noise/brown-noise.wav` },
];

// ==================== AI Model Definitions ====================

export const MODEL_DEFINITIONS: ModelDef[] = [
  {
    id: 'gemini',
    name: 'Gemini 3 Flash',
    iconClass: 'gemini-icon',
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z" fill="url(#gemini-grad)"/><defs><linearGradient id="gemini-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop stop-color="#4285F4"/><stop offset=".5" stop-color="#9B72CB"/><stop offset="1" stop-color="#D96570"/></linearGradient></defs></svg>',
    desc_en: 'Fast \u00B7 Thinking \u00B7 Multimodal',
    desc_zh: '\u5FEB\u901F \u00B7 \u601D\u8003 \u00B7 \u591A\u6A21\u6001',
    badge_en: 'Free',
    badge_zh: '\u514D\u8D39',
    hasThinking: true,
  },
  {
    id: 'gpt4o',
    name: 'GPT-4o',
    iconClass: 'openai-icon',
    svg: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" fill="#fff"/></svg>',
    desc_en: 'Classic \u00B7 Stable \u00B7 Content restricted',
    desc_zh: '\u7ECF\u5178 \u00B7 \u7A33\u5B9A \u00B7 \u5185\u5BB9\u6709\u9650\u5236',
    badge_en: 'Limited Free',
    badge_zh: '\u9650\u65F6\u514D\u8D39',
    hasThinking: false,
  },
  {
    id: 'grok',
    name: 'Grok 4.1 Fast Reasoning',
    iconClass: 'grok-icon',
    svg: '<svg viewBox="0 0 512 510" xmlns="http://www.w3.org/2000/svg"><path d="M213.2 306l179-180v.2l51.7-51.8c-.9 1.3-1.9 2.6-2.8 3.9-39.3 54.2-58.5 80.6-43.1 146.9l-.1-.1c10.6 45.1-.7 95.1-37.4 131.8-46.2 46.3-120.2 56.6-181.1 14.9l42.5-19.7c38.9 15.3 81.4 8.6 111.9-22 30.6-30.6 37.4-75.2 22.1-112.3-2.9-7-11.7-8.8-17.8-4.3L213.2 306zm-25.8 22.4l-.03.03L68.1 435.2c7.6-10.4 17-20.3 26.3-30.1 26.4-27.8 52.7-55.4 36.7-94.3-21.4-52.1-9-113.2 30.7-152.9 41.2-41.3 102-51.7 152.7-30.8 11.2 4.2 21 10.1 28.6 15.6l-42.4 19.6c-39.4-16.6-84.6-5.3-112.2 22.3-37.3 37.3-44.8 102-1.1 143.8z" fill="#fff"/></svg>',
    desc_en: 'Intimate \u00B7 Roleplay \u00B7 No restrictions',
    desc_zh: '\u66F4\u4EB2\u5BC6 \u00B7 \u89D2\u8272\u626E\u6F14 \u00B7 \u65E0\u9650\u5236',
    badge_en: 'Limited Free',
    badge_zh: '\u9650\u65F6\u514D\u8D39',
    hasThinking: false,
    recommended: true,
  },
];

// ==================== Companion Subtypes ====================

export const SUBTYPES: Record<'female' | 'male', SubtypeDef[]> = {
  female: [
    { id: 'female_gentle', icon: '\u{1F338}',       name_zh: '\u6E29\u67D4\u59D0\u59D0',       name_en: 'Gentle Big Sis',  desc_zh: '\u6E29\u67D4\u4F53\u8D34\u3001\u5305\u5BB9\u6210\u719F',       desc_en: 'Warm, caring, mature' },
    { id: 'female_cute',   icon: '\u{1F380}',       name_zh: '\u5143\u6C14\u5C11\u5973',       name_en: 'Energetic Girl',  desc_zh: '\u6D3B\u6CFC\u53EF\u7231\u3001\u7231\u6492\u5A07',       desc_en: 'Lively, cute, playful' },
    { id: 'female_cool',   icon: '\u{1F48E}',       name_zh: '\u77E5\u6027\u5FA1\u59D0',       name_en: 'Cool Beauty',     desc_zh: '\u72EC\u7ACB\u77E5\u6027\u3001\u6709\u4E3B\u89C1',       desc_en: 'Independent, intellectual' },
    { id: 'female_sweet',  icon: '\u{1F436}',       name_zh: '\u7518\u7F8E\u5C0F\u5976\u72D7', name_en: 'Sweet Puppy',     desc_zh: '\u9ECF\u4EBA\u751C\u871C\u3001\u5BB9\u6613\u5BB3\u7F9E',       desc_en: 'Clingy, sweet, shy' },
  ],
  male: [
    { id: 'male_ceo',      icon: '\u{1F3E2}',       name_zh: '\u9738\u9053\u603B\u88C1',       name_en: 'Tsundere CEO',    desc_zh: '\u51B7\u9177\u5916\u8868\u3001\u5185\u5FC3\u6E29\u67D4',       desc_en: 'Cool exterior, warm inside' },
    { id: 'male_warm',     icon: '\u{1F4DA}',       name_zh: '\u6E29\u67D4\u5B66\u957F',       name_en: 'Gentle Scholar', desc_zh: '\u6E29\u67D4\u77E5\u6027\u3001\u8010\u5FC3\u503E\u542C',       desc_en: 'Gentle, intellectual, patient' },
    { id: 'male_sunshine', icon: '\u2600\uFE0F',    name_zh: '\u9633\u5149\u5C11\u5E74',       name_en: 'Sunshine Boy',    desc_zh: '\u5F00\u6717\u6D3B\u6CFC\u3001\u6B63\u80FD\u91CF',       desc_en: 'Cheerful, energetic, positive' },
    { id: 'male_guardian', icon: '\u{1F6E1}\uFE0F', name_zh: '\u5FE0\u72AC\u7537\u53CB',       name_en: 'Loyal Guardian',  desc_zh: '\u9ED8\u9ED8\u5B88\u62A4\u3001\u5B89\u5168\u611F',       desc_en: 'Silent protector, reliable' },
  ],
};

// ==================== Subtype Default Names ====================

export const SUBTYPE_DEFAULTS: Record<string, string> = {
  male_ceo: 'Aiden',
  male_warm: 'Lucian',
  male_sunshine: 'Leo',
  male_guardian: 'Gavin',
  female_gentle: 'Abigail',
  female_cute: 'Mia',
  female_cool: 'Serena',
  female_sweet: 'Luna',
};

// ==================== Avatar Colour Presets ====================

export const AVATAR_COLOR_PRESETS: string[] = [
  '#6BA3D6',
  '#f093fb',
  '#4facfe',
  '#43e97b',
  '#fa709a',
  '#a8edea',
];

// ==================== Tarot Card Gradients (22 Major Arcana) ====================

/** CSS gradient pairs for each tarot card, indexed by card_id (0-21). */
export const TAROT_GRADIENTS: [string, string][] = [
  ['#6BA3D6', '#5A8DB8'], // 0  The Fool
  ['#f093fb', '#f5576c'], // 1  The Magician
  ['#4facfe', '#00f2fe'], // 2  The High Priestess
  ['#43e97b', '#38f9d7'], // 3  The Empress
  ['#fa709a', '#fee140'], // 4  The Emperor
  ['#a18cd1', '#fbc2eb'], // 5  The Hierophant
  ['#ff9a9e', '#fecfef'], // 6  The Lovers
  ['#fbc2eb', '#a6c1ee'], // 7  The Chariot
  ['#fdcbf1', '#e6dee9'], // 8  Strength
  ['#a1c4fd', '#c2e9fb'], // 9  The Hermit
  ['#d4fc79', '#96e6a1'], // 10 Wheel of Fortune
  ['#84fab0', '#8fd3f4'], // 11 Justice
  ['#cfd9df', '#e2ebf0'], // 12 The Hanged Man
  ['#a8edea', '#fed6e3'], // 13 Death
  ['#d299c2', '#fef9d7'], // 14 Temperance
  ['#f5576c', '#ff6f91'], // 15 The Devil
  ['#e8198b', '#c7eafd'], // 16 The Tower
  ['#fdfcfb', '#e2d1c3'], // 17 The Star
  ['#89f7fe', '#66a6ff'], // 18 The Moon
  ['#fddb92', '#d1fdff'], // 19 The Sun
  ['#9890e3', '#b1f4cf'], // 20 Judgement
  ['#ebc0fd', '#d9ded8'], // 21 The World
];

/** Dimension display name mapping (snake_case → human-readable). */
export const DIMENSION_LABELS: Record<string, { en: string; zh: string; low_en: string; high_en: string; low_zh: string; high_zh: string }> = {
  social_energy:        { en: 'Social Energy',        zh: '社交能量', low_en: 'Introvert', high_en: 'Extrovert', low_zh: '内向', high_zh: '外向' },
  emotional_expression: { en: 'Emotional Expression', zh: '情绪风格', low_en: 'Rational',  high_en: 'Emotional', low_zh: '理性', high_zh: '感性' },
  stress_response:      { en: 'Stress Response',      zh: '压力应对', low_en: 'Thinking',  high_en: 'Action',    low_zh: '思考', high_zh: '行动' },
  life_approach:        { en: 'Life Approach',         zh: '生活态度', low_en: 'Stable',    high_en: 'Adventure', low_zh: '稳定', high_zh: '冒险' },
  connection_style:     { en: 'Connection Style',      zh: '关系需求', low_en: 'Independent', high_en: 'Dependent', low_zh: '独立', high_zh: '依赖' },
};

// ==================== Mini-Games ====================

export const MINI_GAMES: MiniGame[] = [
  { id: 'breathing', emoji: '\u{1F9D8}', nameKey: 'games.breathing' },
  { id: 'bubbles',   emoji: '\u{1FAE7}', nameKey: 'games.bubbles' },
  { id: 'zen',       emoji: '\u26E9\uFE0F', nameKey: 'games.zen' },
  { id: 'colormix',  emoji: '\u{1F3A8}', nameKey: 'games.colormix' },
  { id: 'shapes',    emoji: '\u{1F537}', nameKey: 'games.shapes' },
];
