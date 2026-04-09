'use client';

/**
 * Version changelog modal.
 *
 * Uses original CSS classes:
 * .changelog-modal-overlay, .changelog-modal, .changelog-header,
 * .changelog-close, .changelog-body, .changelog-version,
 * .changelog-version-tag, .changelog-list, .changelog-badge,
 * .badge-feat, .badge-fix, .badge-opt, .badge-ui
 */

import { useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal } from '@/store/uiSlice';
import { useT } from '@/hooks/useT';

// ==================== Types ====================

type BadgeType = 'feat' | 'ui' | 'fix' | 'opt';

interface ChangeEntry {
  badge: BadgeType;
  text: string;
  text_zh?: string;
}

interface VersionEntry {
  version: string;
  date: string;
  changes: ChangeEntry[];
}

// ==================== Badge label map ====================

const BADGE_LABELS: Record<BadgeType, string> = {
  feat: 'NEW',
  ui: 'UI',
  fix: 'FIX',
  opt: 'OPT',
};

// ==================== Changelog Data (matches original index.html) ====================

const CHANGELOG: VersionEntry[] = [
  {
    version: 'v0.2.0-beta', date: '2026-04-09',
    changes: [
      { badge: 'feat', text: 'Memory panel — view and delete what AI remembers about you in Settings', text_zh: '\u8BB0\u5FC6\u9762\u677F \u2014 \u8BBE\u7F6E\u9875\u53EF\u67E5\u770B/\u5220\u9664 AI \u8BB0\u4F4F\u7684\u5173\u4E8E\u4F60\u7684\u4E8B' },
      { badge: 'opt', text: 'Voice call optimized — WebSocket full-duplex, lower latency, auto-detect speech end', text_zh: '\u8BED\u97F3\u901A\u8BDD\u4F18\u5316 \u2014 WebSocket \u5168\u53CC\u5DE5\uFF0C\u5EF6\u8FDF\u964D\u4F4E\uFF0C\u8BF4\u5B8C\u81EA\u52A8\u8BC6\u522B\u56DE\u590D' },
      { badge: 'opt', text: 'Voice auto-switches to fast model (non-reasoning), text chat unaffected', text_zh: '\u8BED\u97F3\u81EA\u52A8\u5207\u6362\u5FEB\u901F\u6A21\u578B\uFF08non-reasoning\uFF09\uFF0C\u6587\u5B57\u804A\u5929\u4E0D\u53D7\u5F71\u54CD' },
      { badge: 'opt', text: 'Deepgram streaming STT + sub-clause TTS pipeline', text_zh: 'Deepgram \u6D41\u5F0F STT + \u5B50\u53E5\u7EA7 TTS \u6D41\u6C34\u7EBF' },
      { badge: 'ui', text: 'Voice call messages shown as WeChat-style voice bubbles', text_zh: '\u8BED\u97F3\u901A\u8BDD\u6D88\u606F\u663E\u793A\u4E3A\u5FAE\u4FE1\u98CE\u683C\u8BED\u97F3\u6C14\u6CE1' },
      { badge: 'ui', text: 'New "Memory" tab in Settings', text_zh: '\u8BBE\u7F6E\u9875\u65B0\u589E\u201C\u8BB0\u5FC6\u201D\u6807\u7B7E\u9875' },
      { badge: 'fix', text: 'Voice call AI replies now saved to chat history', text_zh: '\u8BED\u97F3\u901A\u8BDD AI \u56DE\u590D\u73B0\u5728\u4E5F\u4FDD\u5B58\u5230\u804A\u5929\u8BB0\u5F55' },
      { badge: 'fix', text: 'Mem0 memory system fixed (Qdrant version compatibility)', text_zh: 'Mem0 \u8BB0\u5FC6\u7CFB\u7EDF\u4FEE\u590D\uFF08Qdrant \u7248\u672C\u517C\u5BB9\u6027\uFF09' },
      { badge: 'fix', text: 'Settings modal height consistent across all tabs', text_zh: '\u8BBE\u7F6E\u9875\u5404\u6807\u7B7E\u9875\u5185\u5BB9\u9AD8\u5EA6\u7EDF\u4E00' },
    ],
  },
  {
    version: 'v0.1.9-beta', date: '2026-03-10',
    changes: [
      { badge: 'opt', text: 'Full frontend rewrite \u2014 pages load faster, animations smoother, ~30% less GPU usage on your device', text_zh: '\u524D\u7AEF\u5168\u9762\u91CD\u5199 \u2014 \u9875\u9762\u52A0\u8F7D\u66F4\u5FEB\u3001\u52A8\u753B\u66F4\u6D41\u7545\u3001\u8BBE\u5907GPU\u538B\u529B\u964D\u4F4E\u7EA630%' },
      { badge: 'ui', text: 'Chat text always readable \u2014 white with shadow, works on any wallpaper', text_zh: '\u804A\u5929\u6587\u5B57\u6C38\u8FDC\u6E05\u6670 \u2014 \u767D\u5B57\u52A0\u9634\u5F71\uFF0C\u6362\u4EFB\u4F55\u58C1\u7EB8\u90FD\u80FD\u770B\u6E05' },
      { badge: 'ui', text: 'Cleaner chat bubbles \u2014 less see-through, content easier to read', text_zh: '\u6C14\u6CE1\u66F4\u6E05\u6670 \u2014 \u4E0D\u518D\u900F\u660E\uFF0C\u5185\u5BB9\u4E00\u773C\u5373\u53EF\u770B\u6E05' },
      { badge: 'ui', text: 'Mobile layout optimized \u2014 slimmer header & input bar, larger message text', text_zh: '\u79FB\u52A8\u7AEF\u5E03\u5C40\u4F18\u5316 \u2014 \u5934\u90E8\u548C\u8F93\u5165\u680F\u66F4\u7D27\u51D1\uFF0C\u6D88\u606F\u6587\u5B57\u66F4\u5927' },
    ],
  },
  {
    version: 'v0.1.8-beta', date: '2026-03-09',
    changes: [
      { badge: 'ui', text: 'Real-time rendered glassmorphism UI \u2014 sidebar, chat, modals, input bar all upgraded with unified theme', text_zh: '\u5B9E\u65F6\u6E32\u67D3\u6BDB\u73BB\u7483UI \u2014 \u4FA7\u8FB9\u680F\u3001\u804A\u5929\u3001\u5F39\u7A97\u3001\u8F93\u5165\u680F\u7EDF\u4E00\u4E3B\u9898\u5347\u7EA7' },
      { badge: 'ui', text: 'Smoother modal open/close animations, overall layout alignment improvements', text_zh: '\u66F4\u6D41\u7545\u7684\u5F39\u7A97\u5F00\u5173\u52A8\u753B\uFF0C\u6574\u4F53\u5E03\u5C40\u5BF9\u9F50\u4F18\u5316' },
      { badge: 'fix', text: 'Fixed image generation occasionally failing after multiple consecutive generations', text_zh: '\u4FEE\u590D\u8FDE\u7EED\u591A\u6B21\u751F\u6210\u56FE\u7247\u540E\u5076\u5C14\u5931\u8D25' },
      { badge: 'opt', text: 'Removed daily image generation limit \u2014 generate as many as you want', text_zh: '\u53D6\u6D88\u6BCF\u65E5\u56FE\u7247\u751F\u6210\u9650\u5236 \u2014 \u968F\u4FBF\u751F\u6210' },
    ],
  },
  {
    version: 'v0.1.7-beta', date: '2026-03-08',
    changes: [
      { badge: 'feat', text: 'Avatar cropping \u2014 drag, zoom, and precisely crop your avatar after uploading', text_zh: '\u5934\u50CF\u88C1\u526A \u2014 \u4E0A\u4F20\u540E\u62D6\u62FD\u3001\u7F29\u653E\u3001\u7CBE\u786E\u88C1\u526A' },
      { badge: 'feat', text: 'Custom chat background \u2014 upload your own images as chat wallpaper', text_zh: '\u81EA\u5B9A\u4E49\u804A\u5929\u80CC\u666F \u2014 \u4E0A\u4F20\u81EA\u5DF1\u7684\u56FE\u7247\u4F5C\u4E3A\u58C1\u7EB8' },
      { badge: 'feat', text: 'User-uploaded images are now permanently saved, no longer lost on page refresh', text_zh: '\u7528\u6237\u4E0A\u4F20\u7684\u56FE\u7247\u73B0\u5728\u6C38\u4E45\u4FDD\u5B58\uFF0C\u4E0D\u518D\u5237\u65B0\u4E22\u5931' },
      { badge: 'feat', text: 'Image viewer zoom \u2014 double-click, pinch, or scroll wheel to zoom in on images', text_zh: '\u56FE\u7247\u67E5\u770B\u5668\u7F29\u653E \u2014 \u53CC\u51FB\u3001\u6368\u5408\u3001\u6EDA\u8F6E\u653E\u5927\u56FE\u7247' },
    ],
  },
  {
    version: 'v0.1.6-beta', date: '2026-03-07',
    changes: [
      { badge: 'feat', text: 'Image engine upgrade \u2014 better quality! But server costs went up too... please support us', text_zh: '\u56FE\u7247\u5F15\u64CE\u5347\u7EA7 \u2014 \u66F4\u597D\u7684\u8D28\u91CF\uFF01\u4F46\u670D\u52A1\u5668\u6210\u672C\u4E5F\u589E\u52A0\u4E86...\u8BF7\u652F\u6301\u6211\u4EEC' },
      { badge: 'feat', text: 'Smart anime detection \u2014 Genshin, Re:Zero and other anime characters auto-match anime art style', text_zh: '\u667A\u80FD\u52A8\u6F2B\u68C0\u6D4B \u2014 \u539F\u795E\u3001Re:Zero\u7B49\u52A8\u6F2B\u89D2\u8272\u81EA\u52A8\u5339\u914D\u52A8\u6F2B\u753B\u98CE' },
      { badge: 'feat', text: 'Unlimited images per message (previously limited to 2)', text_zh: '\u6BCF\u6761\u6D88\u606F\u65E0\u9650\u56FE\u7247\uFF08\u4E4B\u524D\u9650\u52362\u5F20\uFF09' },
      { badge: 'fix', text: 'Fixed AI internal reasoning occasionally leaking into chat bubbles', text_zh: '\u4FEE\u590DAI\u5185\u90E8\u63A8\u7406\u5076\u5C14\u6CC4\u6F0F\u5230\u804A\u5929\u6C14\u6CE1' },
      { badge: 'fix', text: 'Fixed connection timeout during image generation', text_zh: '\u4FEE\u590D\u56FE\u7247\u751F\u6210\u65F6\u8FDE\u63A5\u8D85\u65F6' },
    ],
  },
  {
    version: 'v0.1.5-beta', date: '2026-03-07',
    changes: [
      { badge: 'feat', text: 'Memory engine upgrade \u2014 switched from full memory dump to semantic search, AI now recalls only the most relevant memories', text_zh: '\u8BB0\u5FC6\u5F15\u64CE\u5347\u7EA7 \u2014 \u4ECE\u5168\u91CF\u8BB0\u5FC6\u8F6C\u4E3A\u8BED\u4E49\u641C\u7D22\uFF0CAI\u53EA\u56DE\u5FC6\u6700\u76F8\u5173\u7684\u8BB0\u5FC6' },
      { badge: 'feat', text: 'Every message now automatically extracts and saves key facts \u2014 your name, hobbies, preferences, family, work, life events', text_zh: '\u6BCF\u6761\u6D88\u606F\u81EA\u52A8\u63D0\u53D6\u5E76\u4FDD\u5B58\u5173\u952E\u4FE1\u606F \u2014 \u59D3\u540D\u3001\u7231\u597D\u3001\u504F\u597D\u3001\u5BB6\u5EAD\u3001\u5DE5\u4F5C\u3001\u751F\u6D3B\u4E8B\u4EF6' },
      { badge: 'feat', text: 'Core memories are always remembered; temporary events auto-expire after 14 days', text_zh: '\u6838\u5FC3\u8BB0\u5FC6\u6C38\u4E45\u8BB0\u4F4F\uFF1B\u4E34\u65F6\u4E8B\u4EF614\u5929\u540E\u81EA\u52A8\u8FC7\u671F' },
    ],
  },
  {
    version: 'v0.1.4-beta', date: '2026-03-06',
    changes: [
      { badge: 'feat', text: 'Image generation upgrade \u2014 smarter character matching, imported characters are now accurately depicted', text_zh: '\u56FE\u7247\u751F\u6210\u5347\u7EA7 \u2014 \u66F4\u667A\u80FD\u7684\u89D2\u8272\u5339\u914D\uFF0C\u5BFC\u5165\u89D2\u8272\u73B0\u5728\u80FD\u7CBE\u786E\u63CF\u7ED8' },
      { badge: 'ui', text: 'WeChat-style multi-bubble \u2014 AI replies auto-split into chat bubbles + image generating placeholder', text_zh: '\u5FAE\u4FE1\u98CE\u683C\u591A\u6C14\u6CE1 \u2014 AI\u56DE\u590D\u81EA\u52A8\u62C6\u5206\u4E3A\u804A\u5929\u6C14\u6CE1+\u56FE\u7247\u751F\u6210\u5360\u4F4D\u7B26' },
      { badge: 'fix', text: 'Fixed image tags leaking as raw text during streaming replies', text_zh: '\u4FEE\u590D\u6D41\u5F0F\u56DE\u590D\u65F6\u56FE\u7247\u6807\u7B7E\u4EE5\u539F\u59CB\u6587\u672C\u6CC4\u6F0F' },
    ],
  },
  {
    version: 'v0.1.3-beta', date: '2026-03-05',
    changes: [
      { badge: 'feat', text: 'Psychology knowledge base \u2014 AI references professional resources for deeper emotional support (toggle in Settings)', text_zh: '\u5FC3\u7406\u5B66\u77E5\u8BC6\u5E93 \u2014 AI\u53C2\u8003\u4E13\u4E1A\u8D44\u6E90\u63D0\u4F9B\u66F4\u6DF1\u5165\u7684\u60C5\u611F\u652F\u6301\uFF08\u8BBE\u7F6E\u4E2D\u5F00\u5173\uFF09' },
      { badge: 'feat', text: 'Stress-relief mini games \u2014 Breathing guide, Bubble Pop, Zen Sand, Color Mix, Shape Catcher', text_zh: '\u51CF\u538B\u5C0F\u6E38\u620F \u2014 \u547C\u5438\u5F15\u5BFC\u3001\u6CE1\u6CE1\u6D88\u9664\u3001\u7981\u6C99\u753B\u3001\u989C\u8272\u6DF7\u5408\u3001\u6355\u6349\u5F62\u72B6' },
      { badge: 'feat', text: 'Ambient sound mixer \u2014 13 preset nature & lo-fi sounds with individual volume control', text_zh: '\u73AF\u5883\u97F3\u6DF7\u97F3\u5668 \u2014 13\u79CD\u9884\u8BBE\u81EA\u7136\u548Clo-fi\u97F3\u6548\uFF0C\u5355\u72EC\u97F3\u91CF\u63A7\u5236' },
      { badge: 'fix', text: 'Server upgrade \u2014 doubled memory for faster and more stable responses', text_zh: '\u670D\u52A1\u5668\u5347\u7EA7 \u2014 \u5185\u5B58\u52A0\u500D\uFF0C\u54CD\u5E94\u66F4\u5FEB\u66F4\u7A33\u5B9A' },
      { badge: 'fix', text: 'Improved connection stability for overseas users \u2014 async streaming with auto-retry', text_zh: '\u6D77\u5916\u7528\u6237\u8FDE\u63A5\u7A33\u5B9A\u6027\u63D0\u5347 \u2014 \u5F02\u6B65\u6D41\u5F0F\u4F20\u8F93+\u81EA\u52A8\u91CD\u8BD5' },
      { badge: 'fix', text: 'Fixed Gemini thinking content not showing in thinking bubble', text_zh: '\u4FEE\u590DGemini\u601D\u8003\u5185\u5BB9\u4E0D\u663E\u793A\u5728\u601D\u8003\u6C14\u6CE1\u4E2D' },
    ],
  },
  {
    version: 'v0.1.2-beta', date: '2026-03-01',
    changes: [
      { badge: 'fix', text: 'Improved voice recognition speed', text_zh: '\u63D0\u5347\u8BED\u97F3\u8BC6\u522B\u901F\u5EA6' },
      { badge: 'fix', text: 'Instant voice bubble \u2014 WeChat-style, appears immediately after recording', text_zh: '\u5373\u65F6\u8BED\u97F3\u6C14\u6CE1 \u2014 \u5FAE\u4FE1\u98CE\u683C\uFF0C\u5F55\u97F3\u540E\u7ACB\u5373\u663E\u793A' },
      { badge: 'fix', text: 'Voice call no longer causes short text replies in subsequent chats', text_zh: '\u8BED\u97F3\u901A\u8BDD\u4E0D\u518D\u5BFC\u81F4\u540E\u7EED\u804A\u5929\u56DE\u590D\u8FC7\u77ED' },
    ],
  },
  {
    version: 'v0.1.1-beta', date: '2026-02-27',
    changes: [
      { badge: 'feat', text: 'Voice call \u2014 Gemini Live-style full-screen call with auto voice detection, interruption & auto-play', text_zh: '\u8BED\u97F3\u901A\u8BDD \u2014 Gemini Live\u98CE\u683C\u5168\u5C4F\u901A\u8BDD\uFF0C\u81EA\u52A8\u8BED\u97F3\u68C0\u6D4B\u3001\u4E2D\u65AD\u548C\u81EA\u52A8\u64AD\u653E' },
      { badge: 'feat', text: 'Streaming text chat \u2014 AI replies appear word by word in real-time, typewriter effect', text_zh: '\u6D41\u5F0F\u6587\u5B57\u804A\u5929 \u2014 AI\u56DE\u590D\u5B9E\u65F6\u9010\u5B57\u663E\u793A\uFF0C\u6253\u5B57\u673A\u6548\u679C' },
      { badge: 'ui', text: 'Input bar button redesign \u2014 unified icon style, call button moved to input area', text_zh: '\u8F93\u5165\u680F\u6309\u94AE\u91CD\u65B0\u8BBE\u8BA1 \u2014 \u7EDF\u4E00\u56FE\u6807\u98CE\u683C\uFF0C\u901A\u8BDD\u6309\u94AE\u79FB\u81F3\u8F93\u5165\u533A' },
      { badge: 'fix', text: 'Reply speed boost \u2014 streaming transmission + parallel voice synthesis, reduced wait time', text_zh: '\u56DE\u590D\u901F\u5EA6\u63D0\u5347 \u2014 \u6D41\u5F0F\u4F20\u8F93+\u5E76\u884C\u8BED\u97F3\u5408\u6210\uFF0C\u51CF\u5C11\u7B49\u5F85\u65F6\u95F4' },
    ],
  },
  {
    version: 'v0.1.0-beta', date: '2026-02-26',
    changes: [
      { badge: 'feat', text: 'Fish Audio TTS \u2014 all-new voice engine, 2M+ community voices available', text_zh: 'Fish Audio TTS \u2014 \u5168\u65B0\u8BED\u97F3\u5F15\u64CE\uFF0C200\u4E07+\u793E\u533A\u58F0\u97F3\u53EF\u7528' },
      { badge: 'feat', text: 'Voice picker \u2014 8 preset voices per language + community search, preview & use', text_zh: '\u58F0\u97F3\u9009\u62E9\u5668 \u2014 \u6BCF\u79CD\u8BED\u8A008\u4E2A\u9884\u8BBE+\u793E\u533A\u641C\u7D22\u3001\u8BD5\u542C\u548C\u4F7F\u7528' },
      { badge: 'feat', text: 'ChatGPT history import \u2014 bring your old conversations into SoulLink', text_zh: 'ChatGPT\u5386\u53F2\u5BFC\u5165 \u2014 \u5C06\u65E7\u5BF9\u8BDD\u5E26\u5165SoulLink' },
      { badge: 'ui', text: 'Settings tabs \u2014 Profile / Companion / Advanced three-panel layout', text_zh: '\u8BBE\u7F6E\u6807\u7B7E\u9875 \u2014 \u4E2A\u4EBA/\u4F34\u4FA3/\u9AD8\u7EA7 \u4E09\u680F\u5E03\u5C40' },
      { badge: 'ui', text: 'Click model badge in chat header to jump to model settings', text_zh: '\u70B9\u51FB\u804A\u5929\u5934\u90E8\u6A21\u578B\u5FBD\u7AE0\u8DF3\u8F6C\u5230\u6A21\u578B\u8BBE\u7F6E' },
      { badge: 'ui', text: 'Voice presets refresh in real-time when switching language', text_zh: '\u5207\u6362\u8BED\u8A00\u65F6\u8BED\u97F3\u9884\u8BBE\u5B9E\u65F6\u5237\u65B0' },
    ],
  },
  {
    version: 'v0.0.9-beta', date: '2026-02-25',
    changes: [
      { badge: 'feat', text: 'Gemini 3 Flash \u2014 upgraded AI engine, smarter & more expressive replies', text_zh: 'Gemini 3 Flash \u2014 \u5347\u7EA7AI\u5F15\u64CE\uFF0C\u66F4\u806A\u660E\u3001\u66F4\u5BCC\u8868\u73B0\u529B' },
      { badge: 'feat', text: 'GPT-4o smart switch hint \u2014 auto-suggests Grok when GPT replies are short or refused', text_zh: 'GPT-4o\u667A\u80FD\u5207\u6362\u63D0\u793A \u2014 \u5F53GPT\u56DE\u590D\u8FC7\u77ED\u6216\u62D2\u7EDD\u65F6\u81EA\u52A8\u63A8\u8350Grok' },
      { badge: 'feat', text: 'Dual image engine \u2014 added Flux as backup, image generation more reliable', text_zh: '\u53CC\u56FE\u7247\u5F15\u64CE \u2014 \u6DFB\u52A0Flux\u4F5C\u4E3A\u5907\u7528\uFF0C\u56FE\u7247\u751F\u6210\u66F4\u53EF\u9760' },
      { badge: 'fix', text: 'Richer AI replies \u2014 no more one-liners, conversations feel more real', text_zh: '\u66F4\u4E30\u5BCC\u7684AI\u56DE\u590D \u2014 \u4E0D\u518D\u4E00\u53E5\u8BDD\u56DE\u590D\uFF0C\u5BF9\u8BDD\u66F4\u771F\u5B9E' },
      { badge: 'fix', text: 'Fixed Gemini thinking content occasionally leaking into chat', text_zh: '\u4FEE\u590DGemini\u601D\u8003\u5185\u5BB9\u5076\u5C14\u6CC4\u6F0F\u5230\u804A\u5929' },
      { badge: 'fix', text: 'Fixed occasional image generation failures', text_zh: '\u4FEE\u590D\u5076\u5C14\u56FE\u7247\u751F\u6210\u5931\u8D25' },
    ],
  },
  {
    version: 'v0.0.8-beta', date: '2026-02-23',
    changes: [
      { badge: 'feat', text: 'AI image generation \u2014 your companion can now send selfies & scene photos', text_zh: 'AI\u56FE\u7247\u751F\u6210 \u2014 \u4F34\u4FA3\u73B0\u5728\u53EF\u4EE5\u53D1\u81EA\u62CD\u548C\u573A\u666F\u7167' },
      { badge: 'feat', text: 'Character appearance matching \u2014 images auto-match your character\'s look', text_zh: '\u89D2\u8272\u5916\u89C2\u5339\u914D \u2014 \u56FE\u7247\u81EA\u52A8\u5339\u914D\u89D2\u8272\u5916\u8C8C' },
      { badge: 'feat', text: 'Voice messaging \u2014 record and send voice, AI understands your speech', text_zh: '\u8BED\u97F3\u6D88\u606F \u2014 \u5F55\u5236\u53D1\u9001\u8BED\u97F3\uFF0CAI\u7406\u89E3\u4F60\u7684\u8BED\u97F3' },
      { badge: 'feat', text: 'AI voice reply \u2014 enable in settings, AI replies with voice too', text_zh: 'AI\u8BED\u97F3\u56DE\u590D \u2014 \u5728\u8BBE\u7F6E\u4E2D\u5F00\u542F\uFF0CAI\u4E5F\u7528\u8BED\u97F3\u56DE\u590D' },
      { badge: 'ui', text: 'Images saved to cloud \u2014 persist after refresh, click to fullscreen', text_zh: '\u56FE\u7247\u4FDD\u5B58\u5230\u4E91\u7AEF \u2014 \u5237\u65B0\u540E\u4FDD\u7559\uFF0C\u70B9\u51FB\u5168\u5C4F' },
      { badge: 'ui', text: 'Voice toggle in settings \u2014 enable/disable AI voice reply anytime', text_zh: '\u8BBE\u7F6E\u4E2D\u8BED\u97F3\u5F00\u5173 \u2014 \u968F\u65F6\u5F00\u542F/\u5173\u95EDAI\u8BED\u97F3\u56DE\u590D' },
    ],
  },
  {
    version: 'v0.0.7-beta', date: '2026-02-22',
    changes: [
      { badge: 'feat', text: 'Custom character persona \u2014 enter a character name, AI auto-searches & extracts personality', text_zh: '\u81EA\u5B9A\u4E49\u89D2\u8272\u4EBA\u8BBE \u2014 \u8F93\u5165\u89D2\u8272\u540D\uFF0CAI\u81EA\u52A8\u641C\u7D22\u5E76\u63D0\u53D6\u4EBA\u683C' },
      { badge: 'feat', text: 'Multi-file knowledge base \u2014 upload up to 10 docs, each independently manageable', text_zh: '\u591A\u6587\u4EF6\u77E5\u8BC6\u5E93 \u2014 \u6700\u591A10\u4E2A\u6587\u6863\uFF0C\u6BCF\u4E2A\u72EC\u7ACB\u7BA1\u7406' },
      { badge: 'feat', text: 'Relationship toggle \u2014 choose Lover or Friend mode for your companion', text_zh: '\u5173\u7CFB\u5207\u6362 \u2014 \u9009\u62E9\u604B\u4EBA\u6216\u670B\u53CB\u6A21\u5F0F' },
      { badge: 'ui', text: 'Knowledge base file list with per-item delete', text_zh: '\u77E5\u8BC6\u5E93\u6587\u4EF6\u5217\u8868\uFF0C\u652F\u6301\u5355\u72EC\u5220\u9664' },
      { badge: 'ui', text: 'Show estimated wait time during persona extraction', text_zh: '\u4EBA\u8BBE\u63D0\u53D6\u65F6\u663E\u793A\u9884\u4F30\u7B49\u5F85\u65F6\u95F4' },
      { badge: 'ui', text: 'Lock settings modal during extraction to prevent accidental close', text_zh: '\u63D0\u53D6\u65F6\u9501\u5B9A\u8BBE\u7F6E\u7A97\u53E3\u9632\u6B62\u8BEF\u5173' },
      { badge: 'fix', text: 'Switching gender now requires re-selecting companion style', text_zh: '\u5207\u6362\u6027\u522B\u73B0\u5728\u9700\u8981\u91CD\u65B0\u9009\u62E9\u4F34\u4FA3\u98CE\u683C' },
      { badge: 'fix', text: 'Fixed Grok immersion rules lost on style change', text_zh: '\u4FEE\u590DGrok\u6C89\u6D78\u89C4\u5219\u5728\u98CE\u683C\u5207\u6362\u65F6\u4E22\u5931' },
      { badge: 'fix', text: 'Fixed blank persona for users who skipped personality test', text_zh: '\u4FEE\u590D\u8DF3\u8FC7\u6027\u683C\u6D4B\u8BD5\u7528\u6237\u7684\u7A7A\u4EBA\u8BBE' },
    ],
  },
  {
    version: 'v0.0.6-beta', date: '2026-02-21',
    changes: [
      { badge: 'feat', text: 'Name your companion during registration \u2014 make them truly yours', text_zh: '\u6CE8\u518C\u65F6\u547D\u540D\u4F34\u4FA3 \u2014 \u8BA9\u4ED6\u4EEC\u771F\u6B63\u5C5E\u4E8E\u4F60' },
      { badge: 'feat', text: 'Choose your AI model at signup \u2014 Gemini, GPT-4o, or Grok', text_zh: '\u6CE8\u518C\u65F6\u9009\u62E9AI\u6A21\u578B \u2014 Gemini\u3001GPT-4o\u6216Grok' },
      { badge: 'feat', text: 'Skip personality test \u2014 jump straight into chatting, take it later anytime', text_zh: '\u8DF3\u8FC7\u6027\u683C\u6D4B\u8BD5 \u2014 \u76F4\u63A5\u5F00\u59CB\u804A\u5929\uFF0C\u968F\u65F6\u88650\u6D4B\u8BD5' },
      { badge: 'ui', text: 'Auto-resize chat input \u2014 expands as you type, like WeChat', text_zh: '\u81EA\u52A8\u8C03\u6574\u8F93\u5165\u6846 \u2014 \u8F93\u5165\u65F6\u81EA\u52A8\u6269\u5C55\uFF0C\u50CF\u5FAE\u4FE1' },
      { badge: 'ui', text: 'Redesigned model selector with official brand icons', text_zh: '\u91CD\u65B0\u8BBE\u8BA1\u6A21\u578B\u9009\u62E9\u5668\uFF0C\u4F7F\u7528\u5B98\u65B9\u54C1\u724C\u56FE\u6807' },
      { badge: 'fix', text: 'Increased chat memory to 30 messages for deeper conversations', text_zh: '\u804A\u5929\u8BB0\u5FC6\u589E\u52A0\u523030\u6761\uFF0C\u5BF9\u8BDD\u66F4\u6DF1\u5165' },
      { badge: 'fix', text: 'Fixed model switch losing memory & relationship data', text_zh: '\u4FEE\u590D\u6A21\u578B\u5207\u6362\u4E22\u5931\u8BB0\u5FC6\u548C\u5173\u7CFB\u6570\u636E' },
      { badge: 'fix', text: 'Fixed new workspaces defaulting to wrong AI provider', text_zh: '\u4FEE\u590D\u65B0\u5DE5\u4F5C\u533A\u9ED8\u8BA4\u9519\u8BEFAI\u63D0\u4F9B\u5546' },
      { badge: 'fix', text: 'Enhanced Gemini thinking content filter for edge cases', text_zh: '\u589E\u5F3AGemini\u601D\u8003\u5185\u5BB9\u8FC7\u6EE4\u5668\u5904\u7406\u8FB9\u7F18\u60C5\u51B5' },
    ],
  },
  {
    version: 'v0.0.5-beta', date: '2026-02-20',
    changes: [
      { badge: 'feat', text: 'File upload in chat \u2014 send images & documents to AI', text_zh: '\u804A\u5929\u4E2D\u6587\u4EF6\u4E0A\u4F20 \u2014 \u53D1\u9001\u56FE\u7247\u548C\u6587\u6863\u7ED9AI' },
      { badge: 'feat', text: 'AI Thinking Process \u2014 see Gemini\'s reasoning before it replies (Gemini only)', text_zh: 'AI\u601D\u8003\u8FC7\u7A0B \u2014 \u67E5\u770BGemini\u56DE\u590D\u524D\u7684\u63A8\u7406\uFF08\u4EC5Gemini\uFF09' },
      { badge: 'feat', text: 'Markdown rendering \u2014 AI replies now show bold, headings, lists & more', text_zh: 'Markdown\u6E32\u67D3 \u2014 AI\u56DE\u590D\u73B0\u5728\u663E\u793A\u52A0\u7C97\u3001\u6807\u9898\u3001\u5217\u8868\u7B49' },
      { badge: 'feat', text: 'WeChat-style timestamps \u2014 time separators auto-appear between messages', text_zh: '\u5FAE\u4FE1\u98CE\u683C\u65F6\u95F4\u6233 \u2014 \u6D88\u606F\u4E4B\u95F4\u81EA\u52A8\u663E\u793A\u65F6\u95F4\u5206\u9694' },
      { badge: 'feat', text: 'Grok 4.1 \u2014 a more intimate & unfiltered companion experience', text_zh: 'Grok 4.1 \u2014 \u66F4\u4EB2\u5BC6\u3001\u65E0\u9650\u5236\u7684\u4F34\u4FA3\u4F53\u9A8C' },
      { badge: 'fix', text: 'Fixed Gemini thinking content leaking into chat replies', text_zh: '\u4FEE\u590DGemini\u601D\u8003\u5185\u5BB9\u6CC4\u6F0F\u5230\u804A\u5929\u56DE\u590D' },
      { badge: 'ui', text: 'Optimized thinking bubble design', text_zh: '\u4F18\u5316\u601D\u8003\u6C14\u6CE1\u8BBE\u8BA1' },
    ],
  },
  {
    version: 'v0.0.4-beta', date: '2026-02-19',
    changes: [
      { badge: 'feat', text: 'AI Memory (Basic) \u2014 your companion can now remember key facts about you', text_zh: 'AI\u8BB0\u5FC6\uFF08\u57FA\u7840\uFF09 \u2014 \u4F34\u4FA3\u73B0\u5728\u53EF\u4EE5\u8BB0\u4F4F\u5173\u4E8E\u4F60\u7684\u5173\u952E\u4FE1\u606F' },
      { badge: 'feat', text: 'Trust Device \u2014 stay logged in for 90 days, no more repeated logins', text_zh: '\u4FE1\u4EFB\u8BBE\u5907 \u2014 \u4FDD\u6301\u767B\u5F5590\u5929\uFF0C\u4E0D\u518D\u91CD\u590D\u767B\u5F55' },
      { badge: 'feat', text: 'Chat background picker \u2014 15 curated wallpapers to choose from', text_zh: '\u804A\u5929\u80CC\u666F\u9009\u62E9\u5668 \u2014 15\u5F20\u7CBE\u9009\u58C1\u7EB8\u53EF\u9009' },
      { badge: 'feat', text: 'Companion gender & personality \u2014 boyfriend or girlfriend with 4 unique styles', text_zh: '\u4F34\u4FA3\u6027\u522B\u548C\u4E2A\u6027 \u2014 \u7537\u53CB\u6216\u5973\u53CB\uFF0C4\u79CD\u72EC\u7279\u98CE\u683C' },
      { badge: 'feat', text: 'AI auto-generates conversation titles based on chat content', text_zh: 'AI\u6839\u636E\u804A\u5929\u5185\u5BB9\u81EA\u52A8\u751F\u6210\u5BF9\u8BDD\u6807\u9898' },
      { badge: 'feat', text: 'Web Search \u2014 AI can now search the internet for real-time weather, news & more', text_zh: '\u7F51\u7EDC\u641C\u7D22 \u2014 AI\u73B0\u5728\u53EF\u4EE5\u641C\u7D22\u5B9E\u65F6\u5929\u6C14\u3001\u65B0\u95FB\u7B49' },
      { badge: 'fix', text: 'Smarter session handling & major stability improvements', text_zh: '\u66F4\u667A\u80FD\u7684\u4F1A\u8BDD\u7BA1\u7406\u548C\u91CD\u5927\u7A33\u5B9A\u6027\u63D0\u5347' },
    ],
  },
  {
    version: 'v0.0.3-beta', date: '2026-02-17',
    changes: [
      { badge: 'feat', text: 'About & Feedback page with donation support (Zelle / WeChat / Alipay)', text_zh: '\u5173\u4E8E\u548C\u53CD\u9988\u9875\u9762\uFF0C\u652F\u6301\u6350\u8D60\uFF08Zelle/\u5FAE\u4FE1/\u652F\u4ED8\u5B9D\uFF09' },
      { badge: 'feat', text: 'Custom companion avatar \u2014 click to upload your own image', text_zh: '\u81EA\u5B9A\u4E49\u4F34\u4FA3\u5934\u50CF \u2014 \u70B9\u51FB\u4E0A\u4F20\u56FE\u7247' },
      { badge: 'feat', text: 'Smart companion rename \u2014 rename via chat conversation', text_zh: '\u667A\u80FD\u4F34\u4FA3\u6539\u540D \u2014 \u901A\u8FC7\u804A\u5929\u5BF9\u8BDD\u6539\u540D' },
      { badge: 'ui', text: 'Personality test now has close button', text_zh: '\u6027\u683C\u6D4B\u8BD5\u73B0\u5728\u6709\u5173\u95ED\u6309\u94AE' },
      { badge: 'ui', text: 'Sidebar layout & spacing improvements', text_zh: '\u4FA7\u8FB9\u680F\u5E03\u5C40\u548C\u95F4\u8DDD\u4F18\u5316' },
    ],
  },
  {
    version: 'v0.0.2-beta', date: '2026-02-15',
    changes: [
      { badge: 'feat', text: 'AI model selection \u2014 switch between GPT-4o & Gemini', text_zh: 'AI\u6A21\u578B\u9009\u62E9 \u2014 \u5728GPT-4o\u548CGemini\u4E4B\u95F4\u5207\u6362' },
      { badge: 'feat', text: 'Email verification with 6-digit code', text_zh: '\u90AE\u7BB1\u9A8C\u8BC1\u7801\uFF086\u4F4D\uFF09' },
      { badge: 'feat', text: 'Comprehensive mobile responsive layout', text_zh: '\u5168\u9762\u79FB\u52A8\u7AEF\u54CD\u5E94\u5F0F\u5E03\u5C40' },
      { badge: 'feat', text: 'Language toggle on login page', text_zh: '\u767B\u5F55\u9875\u8BED\u8A00\u5207\u6362' },
      { badge: 'fix', text: 'Model switch stability improvements', text_zh: '\u6A21\u578B\u5207\u6362\u7A33\u5B9A\u6027\u63D0\u5347' },
    ],
  },
  {
    version: 'v0.0.1-beta', date: '2026-02-04',
    changes: [
      { badge: 'feat', text: 'Personality test & tarot card feature', text_zh: '\u6027\u683C\u6D4B\u8BD5\u548C\u5854\u7F57\u724C\u529F\u80FD' },
      { badge: 'feat', text: 'Google OAuth login', text_zh: 'Google OAuth\u767B\u5F55' },
      { badge: 'feat', text: 'Real-time AI chat with personalized companion', text_zh: '\u5B9E\u65F6AI\u804A\u5929\uFF0C\u4E2A\u6027\u5316\u4F34\u4FA3' },
      { badge: 'feat', text: 'Bilingual support (English / Chinese)', text_zh: '\u53CC\u8BED\u652F\u6301\uFF08\u82F1\u6587/\u4E2D\u6587\uFF09' },
    ],
  },
];

// ==================== Component ====================

export default function ChangelogModal() {
  const dispatch = useAppDispatch();
  const isOpen = useAppSelector((s) => s.ui.modals.changelog);
  const language = useAppSelector((s) => s.settings.language);

  const isZh = language === 'zh-CN';
  const t = useT();

  const handleClose = useCallback(() => {
    dispatch(closeModal('changelog'));
  }, [dispatch]);

  if (!isOpen) return null;

  return (
    <div
      className="changelog-modal-overlay active"
      onClick={handleClose}
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
    >
      <div
        className="changelog-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)' }}
      >
        {/* Header */}
        <div className="changelog-header">
          <button className="changelog-close" onClick={handleClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <h2>{t('changelog.title')}</h2>
          <p>{t('changelog.subtitle')}</p>
        </div>

        {/* Scrollable body */}
        <div className="changelog-body">
          {CHANGELOG.map((ver) => (
            <div key={ver.version} className="changelog-version">
              <div className="changelog-version-tag">
                <span className="ver">{ver.version}</span>
                <span className="date">{ver.date}</span>
              </div>
              <ul className="changelog-list">
                {ver.changes.map((change, ci) => (
                  <li key={ci}>
                    <span className={`changelog-badge badge-${change.badge}`}>
                      {BADGE_LABELS[change.badge]}
                    </span>
                    <span>{isZh ? (change.text_zh || change.text) : change.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
