/**
 * Internationalization (i18n) module.
 *
 * Ported from the original index.html TRANSLATIONS object.
 * Supports English ('en') and Simplified Chinese ('zh-CN').
 *
 * Usage:
 *   import { t } from '@/lib/i18n';
 *   const label = t('settings.title', language);
 *   const label = t('settings.nickname', language, { companion: 'Luna' });
 */

import type { Language } from '@/types';

// ==================== Translations ====================

const TRANSLATIONS: Record<string, Record<string, string>> = {
  en: {
    // ---- Sidebar ----
    'sidebar.newchat': 'New Chat',
    'sidebar.logout': 'Logout',
    'sidebar.test': 'Personality Test',
    'sidebar.guide': 'User Guide',
    'sidebar.changelog': 'Changelog',
    'sidebar.about': 'About & Feedback',
    'sidebar.no_conversations': 'No conversations yet',

    // ---- Chat ----
    'chat.online': 'Online',
    'chat.welcome.title': 'Welcome back!',
    'chat.welcome.subtitle': 'Start a conversation with your AI companion...',
    'chat.input.placeholder': 'Type a message...',

    // ---- Settings - General ----
    'settings.title': 'Settings',
    'settings.tab.profile': 'Profile',
    'settings.tab.companion': 'Companion',
    'settings.tab.advanced': 'Advanced',
    'settings.tab.memory': 'Memory',
    'settings.memory.title': 'What I Remember About You',
    'settings.memory.empty': 'No memories yet. Chat more and I\'ll remember!',
    'settings.memory.permanent': 'Core',
    'settings.memory.long_term': 'Important',
    'settings.memory.short_term': 'Recent',
    'settings.memory.delete.confirm': 'Delete this memory?',
    'settings.memory.loading': 'Loading memories...',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save Changes',

    // ---- Settings - Profile ----
    'settings.upload': 'Upload',
    'settings.color': 'Or choose a color:',
    'settings.nickname': 'Nickname (How {companion} calls you)',
    'settings.nickname.placeholder': 'Your nickname',
    'settings.email': 'Email',
    'settings.email.hint': 'Email cannot be changed',

    // ---- Settings - Companion ----
    'settings.companion.profile': 'Companion Profile',
    'settings.companion.name_label': 'Nickname',
    'settings.companion.reset_avatar': 'Reset avatar',
    'settings.companion.style': 'Companion Style',
    'settings.companion.hint': "Changes will update your companion's personality",
    'companion.gender.her': 'Her',
    'companion.gender.him': 'Him',
    'companion.rel.lover': 'Lover',
    'companion.rel.friend': 'Friend',

    // ---- Settings - Voice ----
    'settings.voice.title': '\uD83D\uDD0A AI Voice Reply',
    'settings.voice.desc': 'AI auto-replies with voice when you send voice messages',
    'settings.voice.hint': 'Powered by Fish Audio -- 2M+ community voices',
    'settings.voice.preset': 'Preset Voices',
    'settings.voice.search': 'Search Community (2M+ voices)',
    'settings.voice.search.placeholder': 'Search voices... e.g. anime, deep, sweet',
    'settings.voice.search.btn': 'Search',
    'settings.voice.try': 'Try',
    'settings.voice.use': 'Use',
    'settings.voice.auto': 'Auto (default)',
    'settings.voice.preset.tag': 'preset',
    'settings.voice.community.tag': 'community',
    'settings.voice.searching': 'Searching...',
    'settings.voice.no_results': 'No voices found. Try different keywords.',
    'settings.voice.search.fail': 'Search failed. Please try again.',

    // ---- Settings - Advanced ----
    'settings.model': 'AI Model',
    'settings.model.hint': 'Choose the AI model that powers {companion}',
    'settings.model.recommended': 'Recommended',
    'settings.kb': '\uD83E\uDDE0 Psychology KB',
    'settings.kb.hint': 'Enable psychology knowledge for deeper emotional support',

    // ---- Settings - Custom ----
    'settings.custom.title': '\uD83D\uDD2E Custom Settings',
    'settings.custom.optional': 'Optional',
    'settings.custom.hint': 'Customize personality and import knowledge independently',
    'settings.custom.persona.title': 'Character Personality',
    'settings.custom.persona.placeholder': 'Enter a character name (e.g., Rem, Ganyu) or describe personality. To rename, tap the name next to the avatar.',
    'settings.custom.persona.extract': 'Extract Personality',
    'settings.custom.persona.preview': 'AI Extracted Preview:',
    'settings.custom.persona.confirm': 'Use',
    'settings.custom.persona.edit': 'Edit',
    'settings.custom.persona.cancel': 'Cancel',
    'settings.custom.persona.extracting': 'Extracting...',
    'settings.custom.persona.saving': 'Saving...',
    'settings.custom.persona.active': 'Active: {name} ({date})',
    'settings.custom.persona.cleared': 'Custom personality cleared',
    'settings.custom.lore.title': 'Knowledge Base',
    'settings.custom.lore.placeholder': 'Paste background materials, world settings, specialized knowledge, etc.',
    'settings.custom.lore.upload': 'Upload File',
    'settings.custom.lore.submit': 'Submit to KB',
    'settings.custom.lore.submitting': 'Vectorizing (~15s)...',
    'settings.custom.lore.ready': 'Ready: {name} ({date})',
    'settings.custom.lore.processing': 'Processing...',
    'settings.custom.lore.failed': 'Failed -- please retry',
    'settings.custom.lore.cleared': 'Knowledge base cleared',
    'settings.custom.lore.hint': '\uD83D\uDCA1 The more background info you import, the more accurately the AI embodies the character.',
    'settings.custom.lore.doc_count': '{count}/{max} documents',
    'settings.custom.lore.limit_reached': 'Maximum documents reached',
    'settings.custom.lore.delete_confirm': 'Remove this document from knowledge base?',

    // ---- Settings - Import ----
    'settings.importChat': '\uD83D\uDCE5 Import Chat History',
    'settings.importChatHint': 'Import conversations from ChatGPT.',
    'settings.importChatLink': 'Go to ChatGPT Export \u2192',
    'settings.importChatBtn': 'Select File',
    'settings.importChatSubmit': 'Import',
    'settings.importChatPreview': 'Found',
    'settings.importChatConvs': 'conversations',
    'settings.importChatMsgs': 'messages',
    'settings.importChatLoading': 'Importing...',
    'settings.importChatSuccess': 'Imported',
    'settings.importSelectAll': 'Select All',
    'settings.importDeselectAll': 'Deselect',
    'settings.importSelected': 'selected',
    'settings.importZipHint': 'ZIP files import all conversations. For selective import, use the .json file inside.',

    // ---- About ----
    'about.tagline': 'Your AI Soul Companion',
    'about.description': 'SoulLink is an AI companion app designed to provide meaningful conversations, emotional support, and personalized interactions through advanced AI technology.',
    'about.community': 'Join Our Community',
    'about.community.desc': 'Join our WeChat group for updates, feedback & discussion!',
    'about.support': 'Support Us',
    'about.support.desc': 'If you enjoy SoulLink, consider buying us a coffee!',
    'about.wechat': 'WeChat',
    'about.alipay': 'Alipay',
    'about.feedback': 'Feedback',
    'about.feedback.desc': "We'd love to hear your thoughts, suggestions, or bug reports!",
    'about.feedback.suggestion': 'Suggestion',
    'about.feedback.bug': 'Bug Report',
    'about.feedback.other': 'Other',
    'about.feedback.placeholder': 'Tell us what you think...',
    'about.feedback.submit': 'Submit Feedback',
    'about.feedback.thanks': 'Thank you for your feedback!',
    'about.survey': 'Survey',
    'about.survey.desc': 'Help us improve \u2014 take our quick 4-5 min survey!',

    // ---- Companion Avatar ----
    'companion.avatar.title': 'Change Companion Avatar',
    'companion.avatar.upload': 'Upload Image',
    'companion.avatar.reset': 'Reset to Default',

    // ---- Chat - Image ----
    'chat.image.generating': 'Generating',
    'chat.image.editing': 'Editing image',

    // ---- Changelog ----
    'changelog.title': 'Changelog',
    'changelog.subtitle': 'SoulLink Release Notes',

    // ---- Companion Avatar (description) ----
    'companion.avatar.description': 'Upload an image for your companion',

    // ---- Community Popup ----
    'community.popup.title': 'Join Our Community',
    'community.popup.desc': 'Scan to join our WeChat group for updates & feedback!',
    'community.popup.close': 'Got it',

    // ---- Crop ----
    'crop.title': 'Crop Image',
    'crop.confirm': 'Confirm',

    // ---- Background Picker ----
    'bg.picker.title': 'Background',
    'bg.upload': 'Upload',
    'bg.custom.label': 'Custom',
    'bg.label.default': 'Default',
    'bg.label.bg01': 'Mt. Fuji',
    'bg.label.bg02': 'Red Pagoda',
    'bg.label.bg03': 'Misty Forest',
    'bg.label.bg04': 'Cherry Blossom',
    'bg.label.bg05': 'Starry Night',
    'bg.label.bg06': 'Frost Sunset',
    'bg.label.bg07': 'Star Trails',
    'bg.label.bg08': 'Fuji Store',
    'bg.label.bg09': 'Architecture',
    'bg.label.bg10': 'Sand Dunes',
    'bg.label.bg11': 'Misty Woods',
    'bg.label.bg12': 'Beach Chapel',
    'bg.label.bg13': 'Hollywood',
    'bg.label.bg14': 'Glacier',
    'bg.label.bg15': 'Ocean Wave',
    'bg.label.bg16': 'Abstract',
    'bg.label.bg17': 'Night Canal',

    // ---- Ambient Sounds ----
    'ambient.no_sounds': 'Ambient sounds',
    'ambient.n_sounds': '{n} sounds playing',
    'ambient.cat.rain': 'Rain',
    'ambient.cat.nature': 'Nature',
    'ambient.cat.urban': 'Urban',
    'ambient.cat.noise': 'Noise',
    'ambient.sound.light_rain': 'Light Rain',
    'ambient.sound.heavy_rain': 'Heavy Rain',
    'ambient.sound.thunder': 'Thunder',
    'ambient.sound.birds': 'Birds',
    'ambient.sound.campfire': 'Campfire',
    'ambient.sound.ocean': 'Ocean Waves',
    'ambient.sound.wind': 'Wind',
    'ambient.sound.river': 'River',
    'ambient.sound.cafe': 'Cafe',
    'ambient.sound.keyboard_typing': 'Keyboard',
    'ambient.sound.train': 'Train',
    'ambient.sound.white_noise': 'White Noise',
    'ambient.sound.brown_noise': 'Brown Noise',

    // ---- Mini Games ----
    'games.title': 'Stress Relief',
    'games.breathing': 'Breathing',
    'games.bubbles': 'Bubble Pop',
    'games.zen': 'Zen Sand',
    'games.zen.clear': 'Clear',
    'games.colormix': 'Color Mix',
    'games.shapes': 'Shape Catcher',
    'games.exit': 'Exit',

    // ---- Thinking ----
    'thinking.header': 'Thought Process',

    // ---- Voice Call ----
    'voicecall.status.connecting': 'Connecting...',
    'voicecall.status.listening': 'Listening...',
    'voicecall.status.thinking': 'Thinking...',
    'voicecall.status.speaking': 'Speaking...',

    // ---- Naming/Onboarding ----
    'naming.title': 'Give your companion a name',
    'naming.subtitle': 'You can always change it later in settings',
    'naming.confirm': '\u2728 Start Chatting',
    'naming.model.title': 'Choose an AI model',
    'naming.model.recommended': 'Recommended',

    // ---- Loading ----
    'loading.workspace': 'Preparing your personal AI companion...',
    'loading.workspace.init': 'Initializing workspace...',
    'loading.workspace.config': 'Configuring AI companion...',
    'loading.workspace.almost': 'Almost ready...',
    'loading.workspace.done': 'All set! Welcome!',

    // ---- Hint ----
    'hint.switch.grok': 'GPT-4o may have content restrictions. Try Grok for a more open experience.',
    'hint.switch.grok.btn': 'Switch to Grok \u2192',
  },

  'zh-CN': {
    // ---- Sidebar ----
    'sidebar.newchat': '\u65B0\u5BF9\u8BDD',
    'sidebar.logout': '\u9000\u51FA\u767B\u5F55',
    'sidebar.test': '\u6027\u683C\u6D4B\u8BD5',
    'sidebar.guide': '\u4F7F\u7528\u6307\u5357',
    'sidebar.changelog': '\u66F4\u65B0\u65E5\u5FD7',
    'sidebar.about': '\u5173\u4E8E & \u53CD\u9988',
    'sidebar.no_conversations': '\u6682\u65E0\u5BF9\u8BDD',

    // ---- Chat ----
    'chat.online': '\u5728\u7EBF',
    'chat.welcome.title': '\u6B22\u8FCE\u56DE\u6765\uFF01',
    'chat.welcome.subtitle': '\u5F00\u59CB\u4E0E\u4F60\u7684AI\u4F34\u4FA3\u804A\u5929...',
    'chat.input.placeholder': '\u8F93\u5165\u6D88\u606F...',

    // ---- Settings - General ----
    'settings.title': '\u8BBE\u7F6E',
    'settings.tab.profile': '\u4E2A\u4EBA\u8D44\u6599',
    'settings.tab.companion': '\u89D2\u8272\u8BBE\u7F6E',
    'settings.tab.advanced': '\u9AD8\u7EA7',
    'settings.tab.memory': '\u8BB0\u5FC6',
    'settings.memory.title': '\u6211\u8BB0\u5F97\u7684\u5173\u4E8E\u4F60',
    'settings.memory.empty': '\u8FD8\u6CA1\u6709\u8BB0\u5FC6\u5462\uFF0C\u591A\u548C\u6211\u804A\u5929\u5427\uFF01',
    'settings.memory.permanent': '\u6838\u5FC3',
    'settings.memory.long_term': '\u91CD\u8981',
    'settings.memory.short_term': '\u8FD1\u671F',
    'settings.memory.delete.confirm': '\u5220\u9664\u8FD9\u6761\u8BB0\u5FC6\uFF1F',
    'settings.memory.loading': '\u52A0\u8F7D\u8BB0\u5FC6\u4E2D...',
    'settings.cancel': '\u53D6\u6D88',
    'settings.save': '\u4FDD\u5B58\u4FEE\u6539',

    // ---- Settings - Profile ----
    'settings.upload': '\u4E0A\u4F20',
    'settings.color': '\u6216\u9009\u62E9\u4E00\u4E2A\u989C\u8272\uFF1A',
    'settings.nickname': '\u6635\u79F0\uFF08{companion}\u600E\u4E48\u79F0\u547C\u4F60\uFF09',
    'settings.nickname.placeholder': '\u4F60\u7684\u6635\u79F0',
    'settings.email': '\u90AE\u7BB1',
    'settings.email.hint': '\u90AE\u7BB1\u4E0D\u80FD\u4FEE\u6539',

    // ---- Settings - Companion ----
    'settings.companion.profile': '\u89D2\u8272\u5F62\u8C61',
    'settings.companion.name_label': '\u6635\u79F0',
    'settings.companion.reset_avatar': '\u6062\u590D\u9ED8\u8BA4\u5934\u50CF',
    'settings.companion.style': '\u4F34\u4FA3\u98CE\u683C',
    'settings.companion.hint': '\u66F4\u6539\u5C06\u66F4\u65B0\u4F34\u4FA3\u7684\u6027\u683C\u98CE\u683C',
    'companion.gender.her': '\u5979',
    'companion.gender.him': '\u4ED6',
    'companion.rel.lover': '\u604B\u4EBA',
    'companion.rel.friend': '\u670B\u53CB',

    // ---- Settings - Voice ----
    'settings.voice.title': '\uD83D\uDD0A AI \u8BED\u97F3\u56DE\u590D',
    'settings.voice.desc': '\u53D1\u9001\u8BED\u97F3\u6D88\u606F\u65F6\uFF0CAI \u81EA\u52A8\u8BED\u97F3\u56DE\u590D',
    'settings.voice.hint': '\u7531 Fish Audio \u63D0\u4F9B -- 200\u4E07+ \u793E\u533A\u97F3\u8272',
    'settings.voice.preset': '\u9884\u8BBE\u97F3\u8272',
    'settings.voice.search': '\u641C\u7D22\u793E\u533A\u97F3\u8272\uFF08200\u4E07+\uFF09',
    'settings.voice.search.placeholder': '\u641C\u7D22\u97F3\u8272... \u5982\uFF1A\u6E29\u67D4\u3001\u5FA1\u59D0\u3001\u751C\u7F8E',
    'settings.voice.search.btn': '\u641C\u7D22',
    'settings.voice.try': '\u8BD5\u542C',
    'settings.voice.use': '\u4F7F\u7528',
    'settings.voice.auto': '\u81EA\u52A8\uFF08\u9ED8\u8BA4\uFF09',
    'settings.voice.preset.tag': '\u9884\u8BBE',
    'settings.voice.community.tag': '\u793E\u533A',
    'settings.voice.searching': '\u641C\u7D22\u4E2D...',
    'settings.voice.no_results': '\u672A\u627E\u5230\u97F3\u8272\uFF0C\u8BF7\u6362\u4E2A\u5173\u952E\u8BCD\u8BD5\u8BD5',
    'settings.voice.search.fail': '\u641C\u7D22\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5',

    // ---- Settings - Advanced ----
    'settings.model': 'AI \u6A21\u578B',
    'settings.model.hint': '\u9009\u62E9\u9A71\u52A8 {companion} \u7684AI\u6A21\u578B',
    'settings.model.recommended': '\u63A8\u8350',
    'settings.kb': '\uD83E\uDDE0 \u5FC3\u7406\u77E5\u8BC6\u5E93',
    'settings.kb.hint': '\u5F00\u542F\u5FC3\u7406\u5B66\u77E5\u8BC6\uFF0C\u63D0\u4F9B\u66F4\u6DF1\u5C42\u7684\u60C5\u611F\u652F\u6301',

    // ---- Settings - Custom ----
    'settings.custom.title': '\uD83D\uDD2E \u81EA\u5B9A\u4E49\u8BBE\u5B9A',
    'settings.custom.optional': '\u53EF\u9009',
    'settings.custom.hint': '\u89D2\u8272\u6027\u683C\u548C\u77E5\u8BC6\u5E93\u53EF\u72EC\u7ACB\u4F7F\u7528',
    'settings.custom.persona.title': '\u89D2\u8272\u6027\u683C',
    'settings.custom.persona.placeholder': '\u8F93\u5165\u89D2\u8272\u540D\u641C\u7D22\uFF08\u5982\uFF1A\u96F7\u59C6\u3001\u7518\u96E8\uFF09\u6216\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u89D2\u8272\u6027\u683C\u3002\u6539\u540D\u8BF7\u5728\u4E0A\u65B9\u5934\u50CF\u6846\u65C1\u8FB9\u6539',
    'settings.custom.persona.extract': '\u63D0\u53D6\u6027\u683C',
    'settings.custom.persona.preview': 'AI \u63D0\u53D6\u9884\u89C8\uFF1A',
    'settings.custom.persona.confirm': '\u4F7F\u7528',
    'settings.custom.persona.edit': '\u4FEE\u6539',
    'settings.custom.persona.cancel': '\u53D6\u6D88',
    'settings.custom.persona.extracting': '\u6B63\u5728\u63D0\u53D6...',
    'settings.custom.persona.saving': '\u4FDD\u5B58\u4E2D...',
    'settings.custom.persona.active': '\u751F\u6548\u4E2D\uFF1A{name}\uFF08{date}\uFF09',
    'settings.custom.persona.cleared': '\u81EA\u5B9A\u4E49\u6027\u683C\u5DF2\u6E05\u9664',
    'settings.custom.lore.title': '\u77E5\u8BC6\u5E93',
    'settings.custom.lore.placeholder': '\u7C98\u8D34\u80CC\u666F\u8D44\u6599\u3001\u4E16\u754C\u89C2\u3001\u4E13\u4E1A\u77E5\u8BC6\u7B49\u5185\u5BB9',
    'settings.custom.lore.upload': '\u4E0A\u4F20\u6587\u4EF6',
    'settings.custom.lore.submit': '\u63D0\u4EA4\u5230\u77E5\u8BC6\u5E93',
    'settings.custom.lore.submitting': '\u6B63\u5728\u5411\u91CF\u5316(\u7EA615\u79D2)...',
    'settings.custom.lore.ready': '\u5DF2\u5C31\u7EEA\uFF1A{name}\uFF08{date}\uFF09',
    'settings.custom.lore.processing': '\u5904\u7406\u4E2D...',
    'settings.custom.lore.failed': '\u5931\u8D25 -- \u8BF7\u91CD\u8BD5',
    'settings.custom.lore.cleared': '\u77E5\u8BC6\u5E93\u5DF2\u6E05\u9664',
    'settings.custom.lore.hint': '\uD83D\uDCA1 \u5BFC\u5165\u7684\u80CC\u666F\u8D44\u6599\u8D8A\u4E30\u5BCC\uFF0CAI\u5C31\u8D8A\u80FD\u7CBE\u51C6\u8FD8\u539F\u89D2\u8272\u4EBA\u8BBE',
    'settings.custom.lore.doc_count': '{count}/{max} \u4E2A\u6587\u6863',
    'settings.custom.lore.limit_reached': '\u5DF2\u8FBE\u6587\u6863\u4E0A\u9650',
    'settings.custom.lore.delete_confirm': '\u786E\u5B9A\u4ECE\u77E5\u8BC6\u5E93\u79FB\u9664\u6B64\u6587\u6863\uFF1F',

    // ---- Settings - Import ----
    'settings.importChat': '\uD83D\uDCE5 \u5BFC\u5165\u804A\u5929\u8BB0\u5F55',
    'settings.importChatHint': '\u4ECE ChatGPT \u5BFC\u5165\u5BF9\u8BDD\u8BB0\u5F55\u3002',
    'settings.importChatLink': '\u524D\u5F80 ChatGPT \u5BFC\u51FA \u2192',
    'settings.importChatBtn': '\u9009\u62E9\u6587\u4EF6',
    'settings.importChatSubmit': '\u5F00\u59CB\u5BFC\u5165',
    'settings.importChatPreview': '\u53D1\u73B0',
    'settings.importChatConvs': '\u4E2A\u5BF9\u8BDD',
    'settings.importChatMsgs': '\u6761\u6D88\u606F',
    'settings.importChatLoading': '\u5BFC\u5165\u4E2D...',
    'settings.importChatSuccess': '\u5DF2\u5BFC\u5165',
    'settings.importSelectAll': '\u5168\u9009',
    'settings.importDeselectAll': '\u53D6\u6D88',
    'settings.importSelected': '\u5DF2\u9009',
    'settings.importZipHint': 'ZIP \u6587\u4EF6\u5C06\u5BFC\u5165\u6240\u6709\u5BF9\u8BDD\u3002\u5982\u9700\u9009\u62E9\u6027\u5BFC\u5165\uFF0C\u8BF7\u89E3\u538B\u540E\u4F7F\u7528 .json \u6587\u4EF6\u3002',

    // ---- About ----
    'about.tagline': '\u4F60\u7684 AI \u7075\u9B42\u4F34\u4FA3',
    'about.description': 'SoulLink \u662F\u4E00\u6B3E AI \u4F34\u4FA3\u5E94\u7528\uFF0C\u65E8\u5728\u901A\u8FC7\u5148\u8FDB\u7684 AI \u6280\u672F\u63D0\u4F9B\u6709\u610F\u4E49\u7684\u5BF9\u8BDD\u3001\u60C5\u611F\u652F\u6301\u548C\u4E2A\u6027\u5316\u4E92\u52A8\u3002',
    'about.community': '\u52A0\u5165\u6211\u4EEC\u7684\u793E\u533A',
    'about.community.desc': '\u52A0\u5165\u5FAE\u4FE1\u7FA4\uFF0C\u83B7\u53D6\u66F4\u65B0\u3001\u53CD\u9988\u548C\u8BA8\u8BBA\uFF01',
    'about.support': '\u652F\u6301\u6211\u4EEC',
    'about.support.desc': '\u5982\u679C\u4F60\u559C\u6B22 SoulLink\uFF0C\u8003\u8651\u8BF7\u6211\u4EEC\u559D\u676F\u5496\u5561\uFF01',
    'about.wechat': '\u5FAE\u4FE1\u652F\u4ED8',
    'about.alipay': '\u652F\u4ED8\u5B9D',
    'about.feedback': '\u53CD\u9988',
    'about.feedback.desc': '\u6211\u4EEC\u5F88\u60F3\u542C\u542C\u4F60\u7684\u60F3\u6CD5\u3001\u5EFA\u8BAE\u6216\u95EE\u9898\u62A5\u544A\uFF01',
    'about.feedback.suggestion': '\u5EFA\u8BAE',
    'about.feedback.bug': 'Bug \u62A5\u544A',
    'about.feedback.other': '\u5176\u4ED6',
    'about.feedback.placeholder': '\u544A\u8BC9\u6211\u4EEC\u4F60\u7684\u60F3\u6CD5...',
    'about.feedback.submit': '\u63D0\u4EA4\u53CD\u9988',
    'about.feedback.thanks': '\u611F\u8C22\u4F60\u7684\u53CD\u9988\uFF01',
    'about.survey': '\u95EE\u5377',
    'about.survey.desc': '\u5E2E\u52A9\u6211\u4EEC\u6539\u8FDB \u2014 \u53C2\u52A0 4-5 \u5206\u949F\u7684\u5FEB\u901F\u95EE\u5377\uFF01',

    // ---- Companion Avatar ----
    'companion.avatar.title': '\u66F4\u6362\u89D2\u8272\u5934\u50CF',
    'companion.avatar.upload': '\u4E0A\u4F20\u56FE\u7247',
    'companion.avatar.reset': '\u6062\u590D\u9ED8\u8BA4',

    // ---- Chat - Image ----
    'chat.image.generating': '\u751F\u6210\u4E2D',
    'chat.image.editing': '\u7F16\u8F91\u56FE\u7247\u4E2D',

    // ---- Changelog ----
    'changelog.title': '\u66F4\u65B0\u65E5\u5FD7',
    'changelog.subtitle': 'SoulLink \u7248\u672C\u66F4\u65B0',

    // ---- Companion Avatar (description) ----
    'companion.avatar.description': '\u4E0A\u4F20\u56FE\u7247\u4F5C\u4E3A\u4F34\u4FA3\u5934\u50CF',

    // ---- Community Popup ----
    'community.popup.title': '\u52A0\u5165\u6211\u4EEC\u7684\u793E\u533A',
    'community.popup.desc': '\u626B\u7801\u52A0\u5165\u5FAE\u4FE1\u7FA4\uFF0C\u83B7\u53D6\u66F4\u65B0\u548C\u53CD\u9988\uFF01',
    'community.popup.close': '\u77E5\u9053\u4E86',

    // ---- Crop ----
    'crop.title': '\u88C1\u526A\u56FE\u7247',
    'crop.confirm': '\u786E\u8BA4',

    // ---- Background Picker ----
    'bg.picker.title': '\u80CC\u666F',
    'bg.upload': '\u4E0A\u4F20',
    'bg.custom.label': '\u81EA\u5B9A\u4E49',
    'bg.label.default': '\u9ED8\u8BA4',
    'bg.label.bg01': '\u5BCC\u58EB\u5C71',
    'bg.label.bg02': '\u7EA2\u8272\u5854\u697C',
    'bg.label.bg03': '\u96FE\u6797',
    'bg.label.bg04': '\u6A31\u82B1\u5BCC\u58EB',
    'bg.label.bg05': '\u661F\u7A7A',
    'bg.label.bg06': '\u971C\u6676\u65E5\u843D',
    'bg.label.bg07': '\u661F\u8F68\u96EA\u5C71',
    'bg.label.bg08': '\u5BCC\u58EB\u4FBF\u5229\u5E97',
    'bg.label.bg09': '\u5EFA\u7B51',
    'bg.label.bg10': '\u6C99\u4E18',
    'bg.label.bg11': '\u6668\u96FE\u68EE\u6797',
    'bg.label.bg12': '\u6D77\u8FB9\u6559\u5802',
    'bg.label.bg13': '\u597D\u83B1\u575E',
    'bg.label.bg14': '\u51B0\u5DDD',
    'bg.label.bg15': '\u6D77\u6D6A',
    'bg.label.bg16': '\u62BD\u8C61',
    'bg.label.bg17': '\u591C\u666F\u6CB3\u7554',

    // ---- Ambient Sounds ----
    'ambient.no_sounds': '\u73AF\u5883\u97F3',
    'ambient.n_sounds': '{n} \u4E2A\u97F3\u6548\u64AD\u653E\u4E2D',
    'ambient.cat.rain': '\u96E8\u58F0',
    'ambient.cat.nature': '\u81EA\u7136',
    'ambient.cat.urban': '\u57CE\u5E02',
    'ambient.cat.noise': '\u566A\u97F3',
    'ambient.sound.light_rain': '\u5C0F\u96E8',
    'ambient.sound.heavy_rain': '\u5927\u96E8',
    'ambient.sound.thunder': '\u96F7\u96E8',
    'ambient.sound.birds': '\u9E1F\u9E23',
    'ambient.sound.campfire': '\u7BC7\u706B',
    'ambient.sound.ocean': '\u6D77\u6D6A',
    'ambient.sound.wind': '\u98CE\u58F0',
    'ambient.sound.river': '\u6CB3\u6D41',
    'ambient.sound.cafe': '\u5496\u5561\u5385',
    'ambient.sound.keyboard_typing': '\u952E\u76D8',
    'ambient.sound.train': '\u706B\u8F66',
    'ambient.sound.white_noise': '\u767D\u566A\u97F3',
    'ambient.sound.brown_noise': '\u68D5\u566A\u97F3',

    // ---- Mini Games ----
    'games.title': '\u89E3\u538B',
    'games.breathing': '\u547C\u5438',
    'games.bubbles': '\u6CE1\u6CE1',
    'games.zen': '\u7981\u6C99',
    'games.zen.clear': '\u6E05\u9664',
    'games.colormix': '\u8C03\u8272',
    'games.shapes': '\u6355\u6349',
    'games.exit': '\u9000\u51FA',

    // ---- Thinking ----
    'thinking.header': '\u601D\u8003\u8FC7\u7A0B',

    // ---- Voice Call ----
    'voicecall.status.connecting': '\u8FDE\u63A5\u4E2D...',
    'voicecall.status.listening': '\u6B63\u5728\u542C...',
    'voicecall.status.thinking': '\u601D\u8003\u4E2D...',
    'voicecall.status.speaking': '\u8BF4\u8BDD\u4E2D...',

    // ---- Naming/Onboarding ----
    'naming.title': '\u7ED9\u4F60\u7684\u4F34\u4FA3\u53D6\u4E2A\u540D\u5B57',
    'naming.subtitle': '\u4F60\u53EF\u4EE5\u968F\u65F6\u5728\u8BBE\u7F6E\u4E2D\u4FEE\u6539',
    'naming.confirm': '\u2728 \u5F00\u59CB\u804A\u5929',
    'naming.model.title': '\u9009\u62E9\u4E00\u4E2A AI \u6A21\u578B',
    'naming.model.recommended': '\u63A8\u8350',

    // ---- Loading ----
    'loading.workspace': '\u6B63\u5728\u51C6\u5907\u4F60\u7684\u4E13\u5C5E AI \u4F34\u4FA3...',
    'loading.workspace.init': '\u521D\u59CB\u5316\u5DE5\u4F5C\u533A...',
    'loading.workspace.config': '\u914D\u7F6E AI \u4F34\u4FA3...',
    'loading.workspace.almost': '\u5373\u5C06\u5C31\u7EEA...',
    'loading.workspace.done': '\u5168\u90E8\u5B8C\u6210\uFF01\u6B22\u8FCE\uFF01',

    // ---- Hint ----
    'hint.switch.grok': 'GPT-4o \u53EF\u80FD\u6709\u5185\u5BB9\u9650\u5236\u3002\u8BD5\u8BD5 Grok \u83B7\u53D6\u66F4\u5F00\u653E\u7684\u4F53\u9A8C\u3002',
    'hint.switch.grok.btn': '\u5207\u6362\u5230 Grok \u2192',
  },
};

// ==================== Public API ====================

/**
 * Look up a translation key for the given language.
 * Falls back to English, then returns the raw key.
 * Supports `{variable}` interpolation via the `vars` parameter.
 */
export function t(
  key: string,
  language: Language,
  vars?: Record<string, string | number>,
): string {
  let text = TRANSLATIONS[language]?.[key] || TRANSLATIONS.en?.[key] || key;

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return text;
}

/**
 * Create a bound translation function for a specific language.
 * Useful in components: `const t = useT();`
 */
export function createT(language: Language) {
  return (key: string, vars?: Record<string, string | number>) =>
    t(key, language, vars);
}
