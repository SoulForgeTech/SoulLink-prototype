'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal, setSettingsTab, openModal, setCropImageSrc, setCroppedAvatarUrl } from '@/store/uiSlice';
import { updateSettings, setCustomPersonaActive } from '@/store/settingsSlice';
import { setUser } from '@/store/authSlice';
import { MODEL_DEFINITIONS, SUBTYPES } from '@/lib/constants';
import { useT } from '@/hooks/useT';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { updateProfile, updateSettings as apiUpdateSettings, uploadAvatar } from '@/lib/api/user';
import { searchCharacter, importPersona, confirmPersona as apiConfirmPersona, clearPersona as apiClearPersona, getCustomStatus, importLore, clearLore, importChatGPT } from '@/lib/api/persona';
import { getVoiceList, searchVoices, previewVoice } from '@/lib/api/voice';
import { setPresets, setCurrentPresetId } from '@/store/voiceSlice';
import type { SettingsTab, VoicePreset, LoreDocument, PersonaPreview } from '@/types';
import MemoryPanel from './MemoryPanel';
import PersonalityResultCard from '@/components/personality/PersonalityResultCard';
import GuestLockOverlay from '@/components/guest/GuestLockOverlay';

// ==================== Inline Style Constants ====================

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10000,
  background: 'rgba(255,255,255,0.1)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalContentStyle: CSSProperties = {
  border: '1px solid rgba(255,255,255,0.6)',
  borderRadius: '20px',
  background: 'rgba(255,255,255,0.78)',
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  width: 'min(90%, 500px)',
  minWidth: 'min(90%, 500px)',
  height: '85vh',
  boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: '#1a202c',
  animation: 'modalScaleIn 0.25s ease',
  position: 'relative',
};

const modalHeaderStyle: CSSProperties = {
  padding: '20px 24px 0 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  flexShrink: 0,
};

const modalHeaderTitleStyle: CSSProperties = {
  fontSize: '1.2rem',
  fontWeight: 600,
  color: '#1a202c',
  textAlign: 'center',
  marginBottom: 0,
};

const settingsTabsStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  padding: '0 24px',
  flexShrink: 0,
};

const settingsTabBaseStyle: CSSProperties = {
  padding: '10px 12px',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#718096',
  borderBottom: '2px solid transparent',
  background: 'none',
  border: 'none',
  borderBottomWidth: '2px',
  borderBottomStyle: 'solid',
  borderBottomColor: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  transition: 'color 0.2s, border-color 0.2s',
  whiteSpace: 'nowrap',
  marginBottom: '-1px',
};

const settingsTabActiveStyle: CSSProperties = {
  ...settingsTabBaseStyle,
  color: '#6BA3D6',
  borderBottomColor: '#6BA3D6',
};

const modalBodyStyle: CSSProperties = {
  padding: '24px',
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
} as CSSProperties;

const modalFooterStyle: CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid rgba(0,0,0,0.06)',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '12px',
  flexShrink: 0,
};

const btnSecondaryStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  fontSize: '0.95rem',
  fontWeight: 500,
  background: 'rgba(0,0,0,0.04)',
  border: '1px solid rgba(0,0,0,0.1)',
  color: '#4a5568',
  cursor: 'pointer',
  flex: 1,
};

const btnPrimaryStyle: CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  fontSize: '0.95rem',
  fontWeight: 500,
  background: '#6BA3D6',
  border: 'none',
  color: 'white',
  cursor: 'pointer',
  flex: 1,
};

const formLabelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '0.9rem',
  color: '#1a202c',
  fontWeight: 500,
};

const formInputStyle: CSSProperties = {
  padding: '10px 14px',
  background: 'rgba(255,255,255,0.5)',
  border: '1px solid rgba(0,0,0,0.1)',
  borderRadius: '8px',
  color: '#1a202c',
  fontSize: '0.95rem',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
};

const formInputDisabledStyle: CSSProperties = {
  ...formInputStyle,
  background: 'rgba(0,0,0,0.03)',
  color: '#a0aec0',
  cursor: 'not-allowed',
};

const formGroupStyle: CSSProperties = {
  marginBottom: '16px',
};

// ==================== Constants ====================

const AVATAR_COLORS = [
  '#6BA3D6', '#9DC4E6', '#7B68EE', '#DDA0DD',
  '#F08080', '#FFB347', '#77DD77', '#40E0D0',
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
];

const GENDER_OPTIONS: { value: 'female' | 'male'; labelKey: string }[] = [
  { value: 'female', labelKey: 'companion.gender.her' },
  { value: 'male', labelKey: 'companion.gender.him' },
];

const RELATIONSHIP_OPTIONS = [
  { value: 'lover', labelKey: 'companion.rel.lover' },
  { value: 'friend', labelKey: 'companion.rel.friend' },
];

const TAB_CONFIG: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  {
    id: 'profile',
    labelKey: 'settings.tab.profile',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'companion',
    labelKey: 'settings.tab.companion',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
  {
    id: 'advanced',
    labelKey: 'settings.tab.advanced',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    id: 'memory',
    labelKey: 'settings.tab.memory',
    icon: (
      <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
];

// ==================== Component ====================

/**
 * Settings modal with three tabs: Profile, Companion, Advanced.
 * Controlled by uiSlice openModal/closeModal.
 * Uses inline styles matching the original index.html glassmorphism CSS.
 */
export default function SettingsModal() {
  const dispatch = useAppDispatch();
  const t = useT();
  const authFetch = useAuthFetch();
  const language = useAppSelector((s) => s.settings.language);
  const { open: isOpen, activeTab } = useAppSelector(
    (state) => state.ui.modals.settings,
  );

  const isGuest = useAppSelector((s) => s.guest.isGuest);

  // ---- Read data from Redux store ----
  const user = useAppSelector((s) => s.auth.user);
  const companionName = useAppSelector((s) => s.settings.companionName);
  const companionAvatar = useAppSelector((s) => s.settings.companionAvatar);
  const ttsEnabled = useAppSelector((s) => s.settings.ttsEnabled);
  const voicePresetId = useAppSelector((s) => s.settings.voicePresetId);
  const voicePresets = useAppSelector((s) => s.voice.presets);
  const model = useAppSelector((s) => s.settings.model);
  const kbEnabled = useAppSelector((s) => s.settings.kbEnabled);
  const customPersonaActive = useAppSelector((s) => s.settings.customPersonaActive);
  const croppedAvatarUrl = useAppSelector((s) => s.ui.croppedAvatarUrl);

  // ---- Not in Redux yet — use local state with defaults ----
  const [companionGender, setCompanionGenderState] = useState<'female' | 'male'>('female');
  const [companionRelationship, setCompanionRelationshipState] = useState('lover');
  const [companionSubtype, setCompanionSubtypeState] = useState('');
  const [customPersonaText] = useState('');
  const [customPersonaName, setCustomPersonaName] = useState('');
  const [customPersonaDate, setCustomPersonaDate] = useState('');
  const [personaPreview] = useState<PersonaPreview | null>(null);
  const [loreDocs, setLoreDocs] = useState<LoreDocument[]>([]);
  // Track local persona active state (only synced to Redux on Save)
  const [localPersonaActive, setLocalPersonaActive] = useState(false);
  const [localPersonaCleared, setLocalPersonaCleared] = useState(false);
  // Voice name for community voices not in presets
  const [localVoiceName, setLocalVoiceName] = useState('');

  // ---- Constants ----
  const models = MODEL_DEFINITIONS;
  const maxLoreDocs = 5;

  // ---- Local state for form fields ----
  const [nickname, setNickname] = useState('');
  const [avatarColor, setAvatarColor] = useState('');
  const [localGender, setLocalGender] = useState<'female' | 'male'>('female');
  const [localRelationship, setLocalRelationship] = useState('lover');
  const [localSubtype, setLocalSubtype] = useState('');
  const [localTts, setLocalTts] = useState(false);
  const [localVoiceId, setLocalVoiceId] = useState('');
  const [localModel, setLocalModel] = useState('');
  const [localKb, setLocalKb] = useState(false);
  const [personaText, setPersonaText] = useState('');
  const [localPreview, setLocalPreview] = useState<PersonaPreview | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractPhase, setExtractPhase] = useState<'' | 'searching' | 'extracting'>('');
  const [loreSubmitting, setLoreSubmitting] = useState(false);

  // Voice search
  const [voiceSearchQuery, setVoiceSearchQuery] = useState('');
  const [voiceSearchResults, setVoiceSearchResults] = useState<VoicePreset[]>([]);
  const [voiceSearching, setVoiceSearching] = useState(false);

  // Voice preview audio
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);

  // Hover states for buttons
  const [primaryHover, setPrimaryHover] = useState(false);

  // Derive subtypes from the form-local gender selection
  const subtypes = SUBTYPES[localGender] ?? SUBTYPES.female;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const loreFileRef = useRef<HTMLInputElement>(null);
  const chatgptFileRef = useRef<HTMLInputElement>(null);

  // Suppress unused-variable warnings for state setters used only for future features
  void setCompanionGenderState;
  void setCompanionRelationshipState;
  void setCompanionSubtypeState;

  // Reset local state when modal opens + load custom status
  useEffect(() => {
    if (isOpen) {
      // Read companion settings directly from user object (not in Redux yet)
      const userSettings = (user as { settings?: Record<string, unknown> })?.settings || {};
      const savedGender = (userSettings.companion_gender as 'female' | 'male') || 'female';
      const savedRelationship = (userSettings.companion_relationship as string) || 'lover';
      const savedSubtype = (userSettings.companion_subtype as string) || '';

      setNickname(user?.name ?? '');
      setAvatarColor(user?.avatar_color ?? AVATAR_COLORS[0]);
      setCompanionGenderState(savedGender);
      setCompanionRelationshipState(savedRelationship);
      setCompanionSubtypeState(savedSubtype);
      setLocalGender(savedGender);
      setLocalRelationship(savedRelationship);
      setLocalSubtype(savedSubtype);
      setLocalTts(ttsEnabled);
      setLocalVoiceId(voicePresetId);
      setLocalModel(model);
      setLocalKb(kbEnabled);
      setPersonaText(customPersonaText);
      setLocalPreview(personaPreview);
      setVoiceSearchQuery('');
      setVoiceSearchResults([]);
      setLocalPersonaCleared(false);
      setLocalPersonaActive(customPersonaActive);
      setLocalVoiceName('');

      // Load custom status (persona + lore docs) from API
      getCustomStatus(authFetch)
        .then((status) => {
          if (status.persona?.active) {
            dispatch(setCustomPersonaActive(true));
            setLocalPersonaActive(true);
            setCustomPersonaName(status.persona.name || '');
            setCustomPersonaDate(status.persona.imported_at || '');
          } else {
            setLocalPersonaActive(false);
          }
          if (status.lore?.docs) {
            setLoreDocs(status.lore.docs);
          }
        })
        .catch((err) => console.warn('Failed to load custom status:', err));

      // Load voice presets from Fish Audio API
      const lang = language === 'zh-CN' ? 'zh' : 'en';
      getVoiceList(authFetch, lang)
        .then((result) => {
          if (result.voices) {
            dispatch(setPresets(result.voices));
          }
          // Sync voice selection: prefer backend's current_voice_id,
          // then fall back to user's saved voice_id from settings
          const savedVoiceId = result.current_voice_id
            || user?.settings?.voice_id
            || voicePresetId;
          if (savedVoiceId) {
            dispatch(setCurrentPresetId(savedVoiceId));
            setLocalVoiceId(savedVoiceId);
            // Try to find voice name from presets; fall back to backend-saved name
            const foundVoice = result.voices?.find((v: VoicePreset) => v.id === savedVoiceId);
            setLocalVoiceName(foundVoice?.name || (user?.settings as Record<string, unknown>)?.voice_name as string || '');
          }
        })
        .catch((err) => console.warn('Failed to load voice presets:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = useCallback(() => {
    dispatch(closeModal('settings'));
  }, [dispatch]);

  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      // 1. Update user profile (name) if changed
      if (nickname !== (user?.name ?? '')) {
        await updateProfile(authFetch, { name: nickname });
        // Update user in Redux + localStorage
        if (user) {
          dispatch(setUser({ ...user, name: nickname }));
        }
      }

      // 2. If persona was marked for clearing, call the API now
      if (localPersonaCleared) {
        try {
          await apiClearPersona(authFetch);
          dispatch(setCustomPersonaActive(false));
        } catch (err) {
          console.error('Clear persona failed:', err);
        }
      }

      // 3. Update settings via API (send all changeable fields)
      const settingsPayload: Record<string, unknown> = {};
      if (localModel) settingsPayload.model = localModel;
      if (localGender) settingsPayload.companion_gender = localGender;
      if (localSubtype) settingsPayload.companion_subtype = localSubtype;
      if (localRelationship) settingsPayload.companion_relationship = localRelationship;
      settingsPayload.voice_id = localVoiceId;  // Always send — empty string clears selection
      // Also save voice name for display (check presets, then search results, then stored name)
      const selectedVoice = voicePresets.find(v => v.id === localVoiceId)
        || voiceSearchResults.find(v => v.id === localVoiceId);
      settingsPayload.voice_name = selectedVoice?.name || localVoiceName || '';
      settingsPayload.tts_enabled = localTts;
      settingsPayload.kb_enabled = localKb;

      if (Object.keys(settingsPayload).length > 0) {
        await apiUpdateSettings(authFetch, settingsPayload);
      }

      // 4. Update Redux settings store
      dispatch(updateSettings({
        model: localModel,
        voicePresetId: localVoiceId,
        ttsEnabled: localTts,
        kbEnabled: localKb,
      }));

      // 5. Sync user.settings in auth slice → persists to localStorage
      if (user) {
        const updatedSettings = {
          ...(user.settings || {}),
          model: localModel,
          companion_gender: localGender,
          companion_subtype: localSubtype,
          companion_relationship: localRelationship,
          voice_id: localVoiceId,
          voice_name: selectedVoice?.name || localVoiceName || '',
          tts_enabled: localTts,
          kb_enabled: localKb,
        };
        dispatch(setUser({ ...user, name: nickname, settings: updatedSettings }));
      }

      handleClose();
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert(language === 'zh-CN' ? '保存失败，请重试' : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [
    saving, nickname, user, localModel, localGender, localSubtype, localRelationship,
    localTts, localVoiceId, localVoiceName, localKb, localPersonaCleared,
    voicePresets, voiceSearchResults, language, authFetch, dispatch, handleClose,
  ]);

  // Open CropModal when user selects a file for avatar
  const handleAvatarFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) return;
      // Create object URL and open crop modal
      const url = URL.createObjectURL(file);
      dispatch(setCropImageSrc(url));
      dispatch(openModal({ modal: 'crop' }));
      if (e.target) e.target.value = '';
    },
    [dispatch],
  );

  // Watch for cropped avatar result from CropModal, then upload to backend
  useEffect(() => {
    if (!croppedAvatarUrl) return;
    (async () => {
      try {
        // Convert blob URL to actual Blob for upload
        const resp = await fetch(croppedAvatarUrl);
        const blob = await resp.blob();
        // Upload to Cloudinary via backend
        const url = await uploadAvatar(authFetch, blob, user?.avatar_url);
        if (user) dispatch(setUser({ ...user, avatar_url: url }));
        // Also persist to backend profile
        try {
          await updateProfile(authFetch, { avatar_url: url });
        } catch {
          // Non-critical
        }
      } catch (err) {
        console.error('Avatar upload failed:', err);
      } finally {
        // Clear the cropped URL so this doesn't re-trigger
        dispatch(setCroppedAvatarUrl(''));
      }
    })();
  }, [croppedAvatarUrl, authFetch, user, dispatch]);

  const handleVoiceSearch = useCallback(async () => {
    if (!voiceSearchQuery.trim() || voiceSearching) return;
    setVoiceSearching(true);
    try {
      const result = await searchVoices(authFetch, voiceSearchQuery.trim());
      setVoiceSearchResults(result.voices || []);
    } catch (err) {
      console.error('Voice search failed:', err);
      setVoiceSearchResults([]);
    } finally {
      setVoiceSearching(false);
    }
  }, [voiceSearchQuery, voiceSearching, authFetch]);

  const handleVoicePreview = useCallback(async (voiceId: string) => {
    // Stop any currently playing preview
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current = null;
    }
    try {
      const result = await previewVoice(authFetch, voiceId);
      if (result.audio_b64) {
        const audio = new Audio(`data:audio/mp3;base64,${result.audio_b64}`);
        voiceAudioRef.current = audio;
        audio.play();
      }
    } catch (err) {
      console.error('Voice preview failed:', err);
    }
  }, [authFetch]);

  const handleExtractPersona = useCallback(async () => {
    if (!personaText.trim() || extracting) return;
    setExtracting(true);
    setExtractPhase('');
    try {
      const text = personaText.trim();
      let result;

      if (text.length < 100) {
        // Short input: search character first, then extract
        setExtractPhase('searching');
        const searchResult = await searchCharacter(authFetch, text, language);
        if (searchResult.description) {
          // Auto-fill the text area with the search result
          setPersonaText(searchResult.description);
          // Now extract personality from the search result
          setExtractPhase('extracting');
          result = await importPersona(authFetch, searchResult.description, language);
          // Auto-upload search result to lore KB
          try {
            await importLore(authFetch, searchResult.description);
          } catch {
            // Non-critical, ignore
          }
        } else {
          setExtractPhase('extracting');
          result = await importPersona(authFetch, text, language);
        }
      } else {
        // Long input: extract directly
        setExtractPhase('extracting');
        result = await importPersona(authFetch, text, language);
      }

      const preview = result?.preview;
      if (preview?.core_persona) {
        setLocalPreview({
          core_persona: preview.core_persona,
          name: preview.name || '',
          appearance: preview.appearance || '',
          gender: preview.gender,
        });
        // Note: do NOT update localGender here — only update on confirm/save
      }
    } catch (err) {
      console.error('Persona extraction failed:', err);
      alert(language === 'zh-CN' ? '提取失败，请重试' : 'Extraction failed. Please try again.');
    } finally {
      setExtracting(false);
      setExtractPhase('');
    }
  }, [personaText, extracting, authFetch, language]);

  const handleConfirmPersona = useCallback(async () => {
    if (!localPreview) return;
    try {
      await apiConfirmPersona(
        authFetch,
        localPreview.core_persona,
        localPreview.name,
        localPreview.appearance,
        localPreview.gender,
      );
      dispatch(setCustomPersonaActive(true));
      setLocalPersonaActive(true);
      setLocalPersonaCleared(false);
      setCustomPersonaName(localPreview.name || '');
      // Auto-sync gender extracted from persona
      const extractedGender =
        localPreview.gender === 'female' || localPreview.gender === 'male'
          ? localPreview.gender
          : null;
      if (extractedGender) {
        setLocalGender(extractedGender);
      }
      // Update Redux user so next modal open reads correct gender
      if (user) {
        const updatedSettings = {
          ...(user.settings || {}),
          custom_persona: localPreview.core_persona,
          custom_persona_name: localPreview.name || null,
          ...(extractedGender ? { companion_gender: extractedGender } : {}),
        };
        dispatch(setUser({ ...user, settings: updatedSettings }));
      }
      setLocalPreview(null);
      setPersonaText('');
    } catch (err) {
      console.error('Confirm persona failed:', err);
    }
  }, [localPreview, authFetch, dispatch, user]);

  // Mark persona for clearing — actual API call happens on Save
  const handleClearPersona = useCallback(() => {
    setLocalPersonaCleared(true);
    setLocalPersonaActive(false);
    setLocalPreview(null);
    setPersonaText('');
    setCustomPersonaName('');
  }, []);

  const handleLoreFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLoreSubmitting(true);
      try {
        await importLore(authFetch, file);
        // Reload custom status to refresh lore docs
        const status = await getCustomStatus(authFetch);
        setLoreDocs(status.lore?.docs || []);
      } catch (err) {
        console.error('Lore upload failed:', err);
        alert(language === 'zh-CN' ? '上传失败，请重试' : 'Upload failed. Please try again.');
      } finally {
        setLoreSubmitting(false);
        if (e.target) e.target.value = '';
      }
    },
    [authFetch, language],
  );

  const handleDeleteLoreDoc = useCallback(async (docId: string) => {
    if (!confirm(t('settings.custom.lore.delete_confirm'))) return;
    try {
      await clearLore(authFetch, docId);
      setLoreDocs(prev => prev.filter(d => d.id !== docId));
    } catch (err) {
      console.error('Delete lore doc failed:', err);
    }
  }, [authFetch, t]);

  const handleChatGPTFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const result = await importChatGPT(authFetch, file, file.name);
        if (result.error) {
          alert(result.error);
        } else {
          alert(language === 'zh-CN'
            ? `已导入 ${result.imported_count || 0} 个对话`
            : `Imported ${result.imported_count || 0} conversations`);
        }
      } catch (err) {
        console.error('ChatGPT import failed:', err);
        alert(language === 'zh-CN' ? '导入失败，请重试' : 'Import failed. Please try again.');
      }
      if (e.target) e.target.value = '';
    },
    [authFetch, language],
  );

  if (!isOpen) return null;

  // Get user avatar display
  const userAvatar = user?.avatar_url || user?.avatar;
  const userInitial = (user?.name || 'U').charAt(0).toUpperCase();

  return (
    <div
      style={overlayStyle}
      onClick={handleClose}
    >
      {/* Modal Content */}
      <div
        style={modalContentStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={modalHeaderStyle}>
          <h3 style={modalHeaderTitleStyle}>{t('settings.title')}</h3>
          <button
            onClick={handleClose}
            style={{
              position: 'absolute',
              right: 20,
              top: 18,
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.04)',
              border: 'none',
              cursor: 'pointer',
              color: '#718096',
              transition: 'background 0.2s',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Bar */}
        <div style={settingsTabsStyle}>
          {TAB_CONFIG.map((tab) => (
            <button
              key={tab.id}
              onClick={() => dispatch(setSettingsTab(tab.id))}
              style={activeTab === tab.id ? settingsTabActiveStyle : settingsTabBaseStyle}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Tab Content (Modal Body) */}
        <div className="modal-body" style={modalBodyStyle}>
          {/* ===================== PROFILE TAB ===================== */}
          <div style={{ display: activeTab === 'profile' ? 'block' : 'none', maxWidth: '100%', overflow: 'hidden' }}>
              {/* User Avatar */}
              <div style={{ ...formGroupStyle, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: '2px solid rgba(255,255,255,0.6)',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {userAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={userAvatar}
                      alt="Avatar"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '1.5rem',
                        fontWeight: 700,
                        background: avatarColor,
                      }}
                    >
                      {userInitial}
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileChange}
                  style={{ display: 'none' }}
                />
                <p style={{ fontSize: '0.75rem', color: '#a0aec0', marginTop: 8 }}>{t('settings.upload')}</p>
              </div>

              {/* Nickname */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.nickname', { companion: companionName || 'Companion' })}</label>
                <input
                  type="text"
                  value={isGuest ? 'Guest' : nickname}
                  onChange={(e) => { if (!isGuest) setNickname(e.target.value); }}
                  disabled={isGuest}
                  placeholder={t('settings.nickname.placeholder')}
                  maxLength={30}
                  style={isGuest ? formInputDisabledStyle : formInputStyle}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#6BA3D6';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(107,163,214,0.15)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Email (disabled) */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.email')}</label>
                <input
                  type="email"
                  value={user?.email ?? ''}
                  disabled
                  style={formInputDisabledStyle}
                />
                <p style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: 4 }}>{t('settings.email.hint')}</p>
              </div>

              {/* Personality Test Results — not shown for guests */}
              {!isGuest && (
                <div style={formGroupStyle}>
                  <label style={formLabelStyle}>
                    {language === 'zh-CN' ? '🔮 性格测试' : '🔮 Personality Test'}
                  </label>
                  <PersonalityResultCard
                    onRetake={() => {
                      dispatch(closeModal('settings'));
                      import('@/store/personalitySlice').then(({ resetTest, setRetake }) => {
                        dispatch(resetTest());
                        dispatch(setRetake(true));
                      });
                      window.location.href = '/onboarding';
                    }}
                    onStartTest={() => {
                      dispatch(closeModal('settings'));
                      window.location.href = '/onboarding';
                    }}
                  />
                </div>
              )}

              {/* Export Chat History — not shown for guests */}
              {!isGuest && (
                <div style={formGroupStyle}>
                  <label style={formLabelStyle}>
                    {language === 'zh-CN' ? '📁 导出聊天记录' : '📁 Export Chat History'}
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => {
                        const token = localStorage.getItem('soullink_token');
                        const url = `${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/conversations/export-all?format=json`;
                        fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                          .then(r => r.blob())
                          .then(blob => {
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `soulforge-chats-${new Date().toISOString().slice(0,10)}.json`;
                            a.click();
                          });
                      }}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 8,
                        border: '1px solid rgba(107,163,214,0.3)',
                        background: 'rgba(107,163,214,0.06)',
                        color: '#4a5568', fontSize: '0.8rem', fontWeight: 500,
                        cursor: 'pointer', textAlign: 'center',
                      }}
                    >
                      JSON
                      <br/>
                      <span style={{ fontSize: '0.65rem', color: '#a0aec0' }}>
                        {language === 'zh-CN' ? '可导入其他AI工具' : 'Import to other AI tools'}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        const token = localStorage.getItem('soullink_token');
                        const url = `${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/conversations/export-all?format=txt`;
                        fetch(url, { headers: { Authorization: `Bearer ${token}` } })
                          .then(r => r.blob())
                          .then(blob => {
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `soulforge-chats-${new Date().toISOString().slice(0,10)}.txt`;
                            a.click();
                          });
                      }}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 8,
                        border: '1px solid rgba(107,163,214,0.3)',
                        background: 'rgba(107,163,214,0.06)',
                        color: '#4a5568', fontSize: '0.8rem', fontWeight: 500,
                        cursor: 'pointer', textAlign: 'center',
                      }}
                    >
                      TXT
                      <br/>
                      <span style={{ fontSize: '0.65rem', color: '#a0aec0' }}>
                        {language === 'zh-CN' ? '纯文本，可直接阅读' : 'Plain text, readable'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
          </div>

          {/* ===================== COMPANION TAB ===================== */}
          <div style={{ display: activeTab === 'companion' ? 'block' : 'none', maxWidth: '100%', overflow: 'hidden' }}>
            <GuestLockOverlay>
              {/* Companion Avatar + Name */}
              <div style={{ ...formGroupStyle, display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: '2px solid rgba(107,163,214,0.3)',
                    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  onClick={() => dispatch(openModal({ modal: 'companionAvatar' }))}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={companionAvatar || '/images/default-avatar.webp'}
                    alt="Companion"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '/images/default-avatar.webp';
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '0.9rem', fontWeight: 500, color: '#1a202c' }}>
                    {companionName || 'Companion'}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#a0aec0' }}>
                    {t('settings.companion.reset_avatar')}
                  </p>
                </div>
              </div>

              {/* Expression / animated character creation (beta: gated by email) */}
              {(() => {
                try {
                  const raw = typeof window !== 'undefined' ? localStorage.getItem('soullink_user') : null;
                  const u = raw ? JSON.parse(raw) : null;
                  const email = (u?.email || '').toLowerCase();
                  const BETA = ['s229178291@gmail.com'];
                  if (!BETA.includes(email)) return null;
                } catch { return null; }
                return (
                  <button
                    onClick={() => {
                      dispatch(closeModal('settings'));
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('open-expression-setup'));
                      }, 300);
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      borderRadius: 12,
                      border: '1px solid rgba(124,77,255,0.3)',
                      background: 'linear-gradient(135deg, rgba(124,77,255,0.08), rgba(68,138,255,0.05))',
                      color: '#7c4dff',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 16,
                    }}
                  >
                    <span>✨</span>
                    <span>{t('expr.create_btn')}</span>
                  </button>
                );
              })()}

              {/* Gender Selector — always editable (auto-filled from custom persona if set) */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.companion.style')}</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {GENDER_OPTIONS.map((opt) => {
                    const isSelected = localGender === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setLocalGender(opt.value)}
                        style={{
                          flex: 1,
                          padding: '12px 16px',
                          borderRadius: '12px',
                          fontSize: '15px',
                          fontWeight: 600,
                          textAlign: 'center',
                          border: isSelected
                            ? '2px solid #6BA3D6'
                            : '2px solid rgba(0,0,0,0.06)',
                          background: isSelected
                            ? 'rgba(107,163,214,0.08)'
                            : 'rgba(255,255,255,0.5)',
                          color: isSelected ? '#6BA3D6' : '#4a5568',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          boxShadow: isSelected
                            ? '0 2px 12px rgba(107,163,214,0.12)'
                            : 'none',
                        }}
                      >
                        {t(opt.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Relationship — matches original .settings-relationship-row */}
              <div style={formGroupStyle}>
                <div style={{ display: 'flex', gap: 10, marginTop: -8 }}>
                  {RELATIONSHIP_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setLocalRelationship(opt.value)}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 600,
                        textAlign: 'center',
                        border: localRelationship === opt.value
                          ? '2px solid #6BA3D6'
                          : '2px solid rgba(0,0,0,0.06)',
                        background: localRelationship === opt.value
                          ? 'rgba(107,163,214,0.08)'
                          : 'rgba(255,255,255,0.5)',
                        color: localRelationship === opt.value ? '#6BA3D6' : '#4a5568',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subtype Selector — 2-column grid, disabled when custom persona active */}
              <div style={formGroupStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, opacity: localPersonaActive ? 0.5 : 1 }}>
                  {subtypes.map((st) => {
                    const isSelected = !localPersonaActive && localSubtype === st.id;
                    return (
                      <button
                        key={st.id}
                        disabled={localPersonaActive}
                        onClick={() => { if (!localPersonaActive) setLocalSubtype(st.id); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '10px 14px',
                          borderRadius: '10px',
                          fontSize: '13px',
                          fontWeight: 500,
                          textAlign: 'left',
                          border: isSelected
                            ? '2px solid #6BA3D6'
                            : '2px solid rgba(0,0,0,0.06)',
                          background: isSelected
                            ? 'rgba(107,163,214,0.08)'
                            : 'rgba(255,255,255,0.5)',
                          color: isSelected ? '#6BA3D6' : '#4a5568',
                          cursor: localPersonaActive ? 'not-allowed' : 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        <span style={{ fontSize: '1.125rem' }}>{st.icon}</span>
                        <span>{language === 'zh-CN' ? st.name_zh : st.name_en}</span>
                      </button>
                    );
                  })}
                </div>
                {localPersonaActive && (
                  <p style={{
                    fontSize: '0.7rem',
                    color: '#a0aec0',
                    margin: '6px 0 0 0',
                    fontStyle: 'italic',
                  }}>
                    {language === 'zh-CN'
                      ? '已启用自定义性格，角色预设暂不可用'
                      : 'Custom persona active — presets unavailable'}
                  </p>
                )}
              </div>

              {/* Voice Section — matches original: title, TTS toggle, current voice, presets, search */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>
                  {t('settings.voice.title')}
                </label>

                {/* TTS Toggle Row */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'rgba(107,163,214,0.06)',
                  borderRadius: '12px',
                  gap: 12,
                  fontSize: '14px',
                  color: '#4a5568',
                }}>
                  <span>{t('settings.voice.desc')}</span>
                  <button
                    onClick={() => setLocalTts(!localTts)}
                    style={{
                      position: 'relative',
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      background: localTts ? '#6BA3D6' : '#CBD5E0',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        top: 2,
                        left: localTts ? 22 : 2,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: 'white',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                        transition: 'left 0.2s',
                      }}
                    />
                  </button>
                </div>

                {/* Current Voice Display */}
                {localVoiceId && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'rgba(107,163,214,0.08)',
                    borderRadius: '10px',
                    marginTop: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500, color: '#1a202c' }}>
                        {voicePresets.find(v => v.id === localVoiceId)?.name
                          || voiceSearchResults.find(v => v.id === localVoiceId)?.name
                          || localVoiceName
                          || localVoiceId.slice(0, 8)}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontWeight: 500,
                        background: voicePresets.some(v => v.id === localVoiceId)
                          ? 'rgba(107,163,214,0.15)'
                          : '#E8F5E9',
                        color: voicePresets.some(v => v.id === localVoiceId)
                          ? '#6BA3D6'
                          : '#2E7D32',
                      }}>
                        {voicePresets.some(v => v.id === localVoiceId)
                          ? (language === 'zh-CN' ? '预设' : 'Preset')
                          : (language === 'zh-CN' ? '社区' : 'Community')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => handleVoicePreview(localVoiceId)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          background: 'rgba(107,163,214,0.1)',
                          border: '1px solid rgba(107,163,214,0.2)',
                          color: '#6BA3D6',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <svg style={{ width: 12, height: 12 }} fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                        {language === 'zh-CN' ? '试听' : 'Try'}
                      </button>
                      <button
                        onClick={() => setLocalVoiceId('')}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.04)',
                          border: 'none',
                          cursor: 'pointer',
                          color: '#a0aec0',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Voice Preset Grid — always visible */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.voice.preset')}</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {voicePresets.map((voice) => (
                    <button
                      key={voice.id}
                      onClick={() => {
                        setLocalVoiceId(voice.id);
                        setLocalVoiceName(voice.name);
                        handleVoicePreview(voice.id);
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        fontSize: '0.85rem',
                        textAlign: 'left',
                        border: localVoiceId === voice.id
                          ? '2px solid #6BA3D6'
                          : '2px solid transparent',
                        background: localVoiceId === voice.id
                          ? 'rgba(107,163,214,0.12)'
                          : 'rgba(107,163,214,0.06)',
                        color: localVoiceId === voice.id ? '#6BA3D6' : '#4a5568',
                        fontWeight: localVoiceId === voice.id ? 500 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {voice.name}
                    </button>
                  ))}
                  </div>

                  {/* Community Voice Search */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ ...formLabelStyle, fontSize: '0.8rem' }}>
                      {t('settings.voice.search')}
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={voiceSearchQuery}
                        onChange={(e) => setVoiceSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleVoiceSearch()}
                        placeholder={t('settings.voice.search.placeholder')}
                        style={{ ...formInputStyle, flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderColor = '#6BA3D6';
                          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(107,163,214,0.15)';
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      />
                      <button
                        onClick={handleVoiceSearch}
                        disabled={voiceSearching}
                        style={{
                          ...btnPrimaryStyle,
                          flex: 'none',
                          padding: '8px 12px',
                          fontSize: '0.8rem',
                          opacity: voiceSearching ? 0.4 : 1,
                        }}
                      >
                        {voiceSearching ? t('settings.voice.searching') : t('settings.voice.search.btn')}
                      </button>
                    </div>

                    {/* Search Results */}
                    {voiceSearchResults.length > 0 && (
                      <div style={{
                        marginTop: 8,
                        maxHeight: 240,
                        overflowY: 'auto',
                        border: '1px solid rgba(0,0,0,0.06)',
                        borderRadius: 10,
                      }}>
                        {voiceSearchResults.map((voice, idx) => {
                          const avatarUrl = `https://public-platform.r2.fish.audio/cdn-cgi/image/format=webp,width=64/coverimage/${voice.id}`;
                          const langs = (voice.languages || (voice.language ? [voice.language] : [])).join(', ') || '?';
                          const authorStr = voice.author ? `by ${voice.author}` : '';
                          const usesStr = `${(voice.task_count || 0).toLocaleString()} uses`;
                          return (
                            <div
                              key={voice.id}
                              onClick={() => handleVoicePreview(voice.id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 14px',
                                cursor: 'pointer',
                                transition: 'background 0.15s',
                                borderBottom: idx < voiceSearchResults.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                                background: localVoiceId === voice.id ? 'rgba(107,163,214,0.08)' : 'transparent',
                              }}
                              onMouseEnter={(e) => { if (localVoiceId !== voice.id) e.currentTarget.style.background = 'rgba(107,163,214,0.08)'; }}
                              onMouseLeave={(e) => { if (localVoiceId !== voice.id) e.currentTarget.style.background = 'transparent'; }}
                            >
                              {/* Avatar from Fish Audio CDN */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={avatarUrl}
                                alt=""
                                loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  flexShrink: 0,
                                  background: 'linear-gradient(135deg, #9DC4E6 0%, #93c5fd 100%)',
                                }}
                              />
                              {/* Info */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: '#4a5568',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}>{voice.name || 'Untitled'}</div>
                                <div style={{ fontSize: 11, color: '#a0aec0', marginTop: 2 }}>
                                  {langs} {authorStr} · {usesStr}
                                </div>
                              </div>
                              {/* Use button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLocalVoiceId(voice.id);
                                  setLocalVoiceName(voice.name);
                                }}
                                style={{
                                  padding: '4px 12px',
                                  border: localVoiceId === voice.id ? '1.5px solid #6BA3D6' : '1.5px solid #6BA3D6',
                                  borderRadius: 8,
                                  background: localVoiceId === voice.id ? '#6BA3D6' : 'transparent',
                                  color: localVoiceId === voice.id ? 'white' : '#6BA3D6',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s',
                                  marginLeft: 8,
                                  flexShrink: 0,
                                }}
                                onMouseEnter={(e) => {
                                  if (localVoiceId !== voice.id) {
                                    e.currentTarget.style.background = '#6BA3D6';
                                    e.currentTarget.style.color = 'white';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (localVoiceId !== voice.id) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = '#6BA3D6';
                                  }
                                }}
                              >
                                {t('settings.voice.use')}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
            </GuestLockOverlay>
          </div>

          {/* ===================== ADVANCED TAB ===================== */}
          <div style={{ display: activeTab === 'advanced' ? 'block' : 'none', maxWidth: '100%', overflow: 'hidden' }}>
            <GuestLockOverlay>
              {/* AI Model Selector — uses .model-selector, .model-option CSS */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.model')}</label>
                <div className="model-selector">
                  {models.map((m) => (
                    <div
                      key={m.id}
                      className={`model-option${localModel === m.id ? ' selected' : ''}`}
                      onClick={() => setLocalModel(m.id)}
                    >
                      <div
                        className={`model-option-icon ${m.iconClass || ''}`}
                        dangerouslySetInnerHTML={{ __html: m.svg }}
                      />
                      <div className="model-option-info">
                        <div className="model-option-name">
                          {m.name}
                          {m.recommended && <span className="model-rec-tag">{t('settings.model.recommended')}</span>}
                        </div>
                        <div className="model-option-desc">{language === 'zh-CN' ? m.desc_zh : m.desc_en}</div>
                      </div>
                      {(language === 'zh-CN' ? m.badge_zh : m.badge_en) && <span className="model-option-badge">{language === 'zh-CN' ? m.badge_zh : m.badge_en}</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Psychology KB Toggle */}
              <div style={{
                ...formGroupStyle,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 12,
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(0,0,0,0.1)',
              }}>
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 500, color: '#1a202c' }}>
                    {t('settings.kb')}
                  </p>
                  <p style={{ fontSize: '0.75rem', color: '#a0aec0', marginTop: 2 }}>
                    {t('settings.kb.hint')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    const next = !localKb;
                    setLocalKb(next);
                    // Save KB toggle immediately like the original
                    apiUpdateSettings(authFetch, { kb_enabled: next }).catch(console.error);
                  }}
                  style={{
                    position: 'relative',
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    background: localKb ? '#6BA3D6' : '#CBD5E0',
                    border: 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'background 0.2s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: localKb ? 22 : 2,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'white',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                      transition: 'left 0.2s',
                    }}
                  />
                </button>
              </div>

              {/* Custom Persona Section */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.custom.persona.title')} <span style={{ fontSize: '0.7rem', color: '#a0aec0', fontWeight: 400 }}>({t('settings.custom.optional')})</span></label>
                {localPersonaActive && customPersonaName && (
                  <div style={{
                    marginBottom: 8,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#F0FFF4',
                    border: '1px solid #C6F6D5',
                    fontSize: '0.75rem',
                    color: '#276749',
                  }}>
                    {language === 'zh-CN'
                      ? `生效中：${customPersonaName}${customPersonaDate ? `（${customPersonaDate}）` : ''}`
                      : `Active: ${customPersonaName}${customPersonaDate ? ` (${customPersonaDate})` : ''}`}
                  </div>
                )}
                <textarea
                  value={personaText}
                  onChange={(e) => setPersonaText(e.target.value)}
                  placeholder={t('settings.custom.persona.placeholder')}
                  rows={4}
                  style={{
                    ...formInputStyle,
                    resize: 'none',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#6BA3D6';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(107,163,214,0.15)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
                <button
                  onClick={handleExtractPersona}
                  disabled={!personaText.trim() || extracting}
                  style={{
                    ...btnPrimaryStyle,
                    width: '100%',
                    marginTop: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: (!personaText.trim() || extracting) ? 0.4 : 1,
                    cursor: (!personaText.trim() || extracting) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {extracting ? (
                    <>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 16,
                          height: 16,
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: 'white',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                      {extractPhase === 'searching'
                        ? (language === 'zh-CN' ? '网页搜索中...' : 'Searching web...')
                        : extractPhase === 'extracting'
                          ? (language === 'zh-CN' ? '提取性格中...' : 'Extracting personality...')
                          : t('settings.custom.persona.extracting')}
                    </>
                  ) : (
                    <>
                      <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      {t('settings.custom.persona.extract')}
                    </>
                  )}
                </button>

                {/* Preview Card */}
                {localPreview && (
                  <div style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(0,0,0,0.1)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: 'rgba(107,163,214,0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.875rem',
                      }}>
                        {localPreview.name?.charAt(0) || '?'}
                      </div>
                      <div>
                        <p style={{ fontSize: '0.9rem', fontWeight: 500, color: '#1a202c' }}>
                          {localPreview.name || 'Unknown'}
                        </p>
                      </div>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#718096', lineHeight: 1.6 }}>
                      {localPreview.core_persona}
                    </p>
                    {localPreview.appearance && (
                      <p style={{ fontSize: '0.75rem', color: '#a0aec0', marginTop: 4, fontStyle: 'italic' }}>
                        {localPreview.appearance}
                      </p>
                    )}
                    {/* Confirm / Edit / Cancel buttons */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        onClick={handleConfirmPersona}
                        style={{ ...btnPrimaryStyle, flex: 1, padding: '8px 12px', fontSize: '0.8rem' }}
                      >
                        {t('settings.custom.persona.confirm')}
                      </button>
                      <button
                        onClick={() => { setLocalPreview(null); }}
                        style={{ ...btnSecondaryStyle, flex: 1, padding: '8px 12px', fontSize: '0.8rem', marginTop: 0 }}
                      >
                        {t('settings.custom.persona.edit')}
                      </button>
                      <button
                        onClick={() => { setLocalPreview(null); setPersonaText(''); }}
                        style={{ ...btnSecondaryStyle, flex: 1, padding: '8px 12px', fontSize: '0.8rem', marginTop: 0 }}
                      >
                        {t('settings.custom.persona.cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Clear persona button when active */}
                {localPersonaActive && (
                  <button
                    onClick={handleClearPersona}
                    style={{
                      marginTop: 8,
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      color: '#E53E3E',
                      background: 'rgba(229,62,62,0.05)',
                      border: '1px solid rgba(229,62,62,0.2)',
                      cursor: 'pointer',
                    }}
                  >
                    {t('settings.custom.persona.cleared').replace('\u5DF2\u6E05\u9664', '\u6E05\u9664').replace('Custom personality cleared', 'Clear Custom Persona')}
                  </button>
                )}
              </div>

              {/* Knowledge Base Section — instant actions, no save button needed */}
              <div style={formGroupStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: '1rem' }}>📚</span>
                  <label style={{ ...formLabelStyle, marginBottom: 0, flex: 1 }}>
                    {t('settings.custom.lore.title')}
                  </label>
                  <span style={{ fontSize: '0.7rem', color: '#a0aec0', fontWeight: 400 }}>
                    {t('settings.custom.optional')}
                  </span>
                </div>

                {/* Action buttons row */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button
                    onClick={() => loreFileRef.current?.click()}
                    disabled={loreDocs.length >= maxLoreDocs || loreSubmitting}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
                      color: '#4a5568', background: 'rgba(255,255,255,0.6)', border: '2px solid rgba(0,0,0,0.06)',
                      cursor: (loreDocs.length >= maxLoreDocs || loreSubmitting) ? 'not-allowed' : 'pointer',
                      opacity: (loreDocs.length >= maxLoreDocs || loreSubmitting) ? 0.4 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    {loreSubmitting ? '⏳' : '📁'} {loreSubmitting
                      ? (language === 'zh-CN' ? '上传中...' : 'Uploading...')
                      : (language === 'zh-CN' ? '上传文件' : 'Upload File')}
                  </button>
                  <button
                    onClick={() => {
                      const text = prompt(language === 'zh-CN'
                        ? '粘贴背景资料、世界观设定、专业知识等：'
                        : 'Paste background materials, world settings, etc.:');
                      if (!text?.trim()) return;
                      setLoreSubmitting(true);
                      importLore(authFetch, text.trim())
                        .then(() => getCustomStatus(authFetch))
                        .then((status) => setLoreDocs(status.lore?.docs || []))
                        .catch((err) => {
                          console.error('Lore text submit failed:', err);
                          alert(language === 'zh-CN' ? '提交失败，请重试' : 'Submit failed.');
                        })
                        .finally(() => setLoreSubmitting(false));
                    }}
                    disabled={loreDocs.length >= maxLoreDocs || loreSubmitting}
                    style={{
                      flex: 1, padding: '10px 12px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
                      color: '#4a5568', background: 'rgba(255,255,255,0.6)', border: '2px solid rgba(0,0,0,0.06)',
                      cursor: (loreDocs.length >= maxLoreDocs || loreSubmitting) ? 'not-allowed' : 'pointer',
                      opacity: (loreDocs.length >= maxLoreDocs || loreSubmitting) ? 0.4 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    📝 {language === 'zh-CN' ? '粘贴文本' : 'Paste Text'}
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: -4, marginBottom: 8 }}>
                  {language === 'zh-CN' ? '支持 txt, pdf, docx 格式' : 'Supports txt, pdf, docx'}
                </p>
                <input
                  ref={loreFileRef}
                  type="file"
                  accept=".txt,.md,.json,.pdf,.doc,.docx"
                  onChange={handleLoreFileChange}
                  style={{ display: 'none' }}
                />

                {/* Doc List */}
                {loreDocs.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                    {loreDocs.map((doc) => (
                      <div
                        key={doc.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: '8px',
                          background: doc.status === 'ready' ? '#F0FFF4' : doc.status === 'processing' ? '#FFFFF0' : '#FFF5F5',
                          border: doc.status === 'ready' ? '1px solid #C6F6D5' : doc.status === 'processing' ? '1px solid #FEFCBF' : '1px solid #FED7D7',
                        }}
                      >
                        <span style={{ fontSize: '14px' }}>
                          {doc.status === 'ready' ? '✅' : doc.status === 'processing' ? '⏳' : '❌'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: doc.status === 'ready' ? '#276749' : '#4a5568', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {doc.original_filename || doc.doc_name || doc.id}
                        </span>
                        <span style={{ fontSize: '11px', color: '#a0aec0', flexShrink: 0 }}>
                          {doc.imported_at ? new Date(doc.imported_at).toLocaleDateString() : ''}
                        </span>
                        <button
                          onClick={() => handleDeleteLoreDoc(doc.id)}
                          style={{
                            width: 24, height: 24, borderRadius: '50%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', color: '#E53E3E',
                            background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, fontSize: '14px',
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tip */}
                <p style={{ fontSize: '0.7rem', color: '#a0aec0', marginTop: 8, fontStyle: 'italic' }}>
                  💡 {language === 'zh-CN'
                    ? '导入的背景资料越多，AI越能准确地演绎角色'
                    : 'The more background info you import, the more accurately the AI embodies the character'}
                </p>
              </div>

              {/* ChatGPT Import Section */}
              <div style={formGroupStyle}>
                <label style={formLabelStyle}>{t('settings.importChat')}</label>
                <div style={{
                  padding: 12,
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.5)',
                  border: '1px solid rgba(0,0,0,0.1)',
                }}>
                  <p style={{ fontSize: '0.75rem', color: '#718096', marginBottom: 8 }}>
                    {t('settings.importChatHint')}
                  </p>
                  <button
                    onClick={() => chatgptFileRef.current?.click()}
                    style={{
                      width: '100%',
                      padding: '8px',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      color: '#4a5568',
                      background: '#EDF2F7',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <svg style={{ width: 14, height: 14 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    {t('settings.importChatBtn')}
                  </button>
                </div>
                <input
                  ref={chatgptFileRef}
                  type="file"
                  accept=".json,.zip"
                  onChange={handleChatGPTFileChange}
                  style={{ display: 'none' }}
                />
              </div>
            </GuestLockOverlay>
          </div>

          {/* ===================== MEMORY TAB ===================== */}
          <div style={{ display: activeTab === 'memory' ? 'block' : 'none', maxWidth: '100%', overflow: 'hidden' }}>
            <MemoryPanel />
          </div>

        </div>

        {/* Footer */}
        <div style={modalFooterStyle}>
          <button
            onClick={handleClose}
            style={btnSecondaryStyle}
          >
            {t('settings.cancel')}
          </button>
          <button
            onClick={handleSave}
            onMouseEnter={() => setPrimaryHover(true)}
            onMouseLeave={() => setPrimaryHover(false)}
            style={{
              ...btnPrimaryStyle,
              background: primaryHover ? '#5A92C5' : '#6BA3D6',
            }}
          >
            {saving ? (language === 'zh-CN' ? '保存中...' : 'Saving...') : t('settings.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
