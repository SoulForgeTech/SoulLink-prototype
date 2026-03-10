'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store';
import {
  setConversations,
  removeConversation,
  updateConversation,
  setCurrentId,
} from '@/store/conversationsSlice';
import { clearMessages, setMessages } from '@/store/chatSlice';
import { updateSettings } from '@/store/settingsSlice';
import { setUser } from '@/store/authSlice';
import { setLoading, updateLoadingProgress } from '@/store/uiSlice';
import { setPresets, setCurrentPresetId } from '@/store/voiceSlice';
import { BACKGROUNDS } from '@/lib/constants';
import { extractWallpaperColor } from '@/lib/extractWallpaperColor';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { getVoiceList } from '@/lib/api/voice';
import {
  getConversations,
  getConversation,
  deleteConversation as apiDeleteConversation,
  updateConversation as apiUpdateConversation,
} from '@/lib/api/conversations';
import { WORKSPACE } from '@/lib/api/endpoints';
import AuthGuard from '@/components/auth/AuthGuard';
import Sidebar from '@/components/sidebar/Sidebar';

// Modals
import SettingsModal from '@/components/modals/SettingsModal';
import ChangelogModal from '@/components/modals/ChangelogModal';
import AboutModal from '@/components/modals/AboutModal';
import RenameModal from '@/components/modals/RenameModal';
import CropModal from '@/components/modals/CropModal';
import CompanionAvatarModal from '@/components/modals/CompanionAvatarModal';
import CommunityPopup from '@/components/modals/CommunityPopup';

// Voice call context (shared hook instance for user-gesture AudioContext)
import { VoiceCallProvider } from '@/contexts/VoiceCallContext';

// Overlays
import VoiceCallOverlay from '@/components/voice/VoiceCallOverlay';
import GameFullscreen from '@/components/games/GameFullscreen';
import LoadingOverlay from '@/components/ui/LoadingOverlay';
import ImageViewer from '@/components/ui/ImageViewer';
import Toast from '@/components/ui/Toast';

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const authFetch = useAuthFetch();
  const callActive = useAppSelector((s) => s.voice.callActive);
  const gameFullscreen = useAppSelector((s) => s.ui.gameFullscreen);
  const loadingVisible = useAppSelector((s) => s.ui.loading.visible);
  const modals = useAppSelector((s) => s.ui.modals);
  const user = useAppSelector((s) => s.auth.user);
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const language = useAppSelector((s) => s.settings.language);

  // ---- App initialization (runs once after auth) ----
  const initDone = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || initDone.current) return;
    initDone.current = true;

    (async () => {
      try {
        let isNewUser = false;

        // 1. Workspace initialization (for first-time users)
        if (user && !user.workspace_slug) {
          isNewUser = true;
          dispatch(setLoading({ visible: true, text: 'Initializing workspace...', showProgress: true, percent: 10 }));
          try {
            const wsResp = await authFetch(WORKSPACE.INIT);
            if (wsResp.ok) {
              const wsData = await wsResp.json();
              dispatch(updateLoadingProgress({ percent: 60 }));
              if (wsData.workspace && user) {
                dispatch(setUser({ ...user, workspace_slug: wsData.workspace.slug }));
              }
            }
            dispatch(updateLoadingProgress({ percent: 90 }));
            await new Promise((r) => setTimeout(r, 500));
            dispatch(setLoading({ visible: false }));
          } catch (err) {
            console.error('Workspace init failed:', err);
            dispatch(setLoading({ visible: false }));
          }
        }

        // 2. Sync settings from user object (returned at login, stored in localStorage)
        // Backend doesn't have a separate GET /settings endpoint — settings are
        // embedded in the user object (user.settings.*).
        if (user?.settings) {
          const s = user.settings as Record<string, unknown>;
          // Build payload, only including truthy string values to avoid overwriting
          // Redux defaults with undefined (which would cause runtime errors).
          const settingsPayload: Record<string, unknown> = {};
          if (s.model) settingsPayload.model = s.model as string;
          if (s.companion_name) settingsPayload.companionName = s.companion_name as string;
          if (s.companion_avatar) settingsPayload.companionAvatar = s.companion_avatar as string;
          if (s.chat_background) settingsPayload.chatBackground = s.chat_background as string;
          if (s.custom_background_url) settingsPayload.customBackgroundUrl = s.custom_background_url as string;
          if (s.user_bubble_color) settingsPayload.userBubbleColor = s.user_bubble_color as string;
          if (s.voice_id) settingsPayload.voicePresetId = s.voice_id as string;
          if (s.tts_enabled != null) settingsPayload.ttsEnabled = Boolean(s.tts_enabled);
          if (s.kb_enabled != null) settingsPayload.kbEnabled = Boolean(s.kb_enabled);
          if (s.custom_persona_active != null) settingsPayload.customPersonaActive = Boolean(s.custom_persona_active);

          if (Object.keys(settingsPayload).length > 0) {
            dispatch(updateSettings(settingsPayload));
          }
        }

        // 2.5 Detect new user: no model selected means they haven't completed onboarding
        if (!isNewUser && user?.settings) {
          const s = user.settings as Record<string, unknown>;
          if (!s.model && !s.companion_name) {
            isNewUser = true;
          }
        }

        // 3. Redirect new users to onboarding (personality test + gender/nickname/model)
        if (isNewUser) {
          router.replace('/onboarding');
          return; // Skip loading conversations for new users
        }

        // 4. Load conversations
        try {
          const data = await getConversations(authFetch);
          dispatch(setConversations(data.conversations));
          // Auto-select first conversation (most recent)
          if (data.conversations.length > 0) {
            const firstId = data.conversations[0].id;
            dispatch(setCurrentId(firstId));
            // Load messages for the first conversation
            try {
              const convData = await getConversation(authFetch, firstId);
              dispatch(setMessages(convData.messages || []));
            } catch {
              // silent — messages will be empty
            }
          }
        } catch (err) {
          console.error('Failed to load conversations:', err);
        }

        // 5. Load voice presets from Fish Audio (non-blocking)
        const voiceLang = language === 'zh-CN' ? 'zh' : 'en';
        getVoiceList(authFetch, voiceLang)
          .then((result) => {
            if (result.voices) {
              dispatch(setPresets(result.voices));
            }
            if (result.current_voice_id) {
              dispatch(setCurrentPresetId(result.current_voice_id));
            }
          })
          .catch((err) => console.warn('Failed to load voice presets:', err));
      } catch (err) {
        console.error('App initialization failed:', err);
      }
    })();
  }, [isAuthenticated, authFetch, dispatch, user, router, language]);

  // Background — matches original .bg-layer (child of #app, not .main-content)
  const chatBackground = useAppSelector((s) => s.settings.chatBackground);
  const customBackgroundUrl = useAppSelector((s) => s.settings.customBackgroundUrl);
  const backgroundUrl = useMemo(() => {
    if (chatBackground === 'custom' && customBackgroundUrl) return customBackgroundUrl;
    const bg = BACKGROUNDS.find((b) => b.id === chatBackground);
    return bg?.path || bg?.file
      ? `/${bg.path || `images/Background/${bg.file}`}`
      : '/images/bg.png';
  }, [chatBackground, customBackgroundUrl]);

  // ---- Background crossfade (matches original dual-layer approach) ----
  // States: 'entering' (opacity 0) → 'active' (opacity 1) → 'exiting' (opacity 0)
  const [bgLayers, setBgLayers] = useState<
    { url: string; key: number; state: 'entering' | 'active' | 'exiting' }[]
  >([]);
  const bgKeyRef = useRef(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    bgKeyRef.current += 1;
    const newKey = bgKeyRef.current;

    if (isFirstRender.current) {
      // First render: show immediately, no animation
      isFirstRender.current = false;
      setBgLayers([{ url: backgroundUrl, key: newKey, state: 'active' }]);
      return;
    }

    // Preload image, then crossfade
    const img = new Image();
    img.onload = () => {
      // Step 1: Add new layer at opacity 0, mark old layers as exiting
      setBgLayers((prev) => {
        const marked = prev.map((l) => ({ ...l, state: 'exiting' as const }));
        return [...marked, { url: backgroundUrl, key: newKey, state: 'entering' as const }];
      });

      // Step 2: After repaint, transition new layer to opacity 1
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setBgLayers((prev) =>
            prev.map((l) =>
              l.state === 'entering' ? { ...l, state: 'active' } : l,
            ),
          );
        });
      });

      // Step 3: Remove old layers after transition completes
      setTimeout(() => {
        setBgLayers((prev) => prev.filter((l) => l.state !== 'exiting'));
      }, 700);
    };
    img.src = backgroundUrl;
  }, [backgroundUrl]);

  // ---- Extract dominant color from background for user bubble color ----
  useEffect(() => {
    extractWallpaperColor(backgroundUrl);
  }, [backgroundUrl]);

  // ---- Conversation CRUD (wired to API) ----

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      try {
        await apiDeleteConversation(authFetch, id);
      } catch (err) {
        console.error('Failed to delete conversation:', err);
      }
      dispatch(removeConversation(id));
      // If we deleted the current conversation, clear messages
      dispatch(clearMessages());
    },
    [dispatch, authFetch],
  );

  const handleRenameConversation = useCallback(
    async (id: string, newTitle: string) => {
      try {
        await apiUpdateConversation(authFetch, id, newTitle);
      } catch (err) {
        console.error('Failed to rename conversation:', err);
      }
      dispatch(updateConversation({ id, title: newTitle }));
    },
    [dispatch, authFetch],
  );

  return (
    <AuthGuard>
      <VoiceCallProvider>
      {/* Original #app container */}
      <div
        id="app"
        style={{
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
          background: '#1a1a2e',
          gap: 10,
          padding: 10,
        }}
      >
        {/* .bg-layer — crossfade background layers (CSS: #app .bg-layer) */}
        {bgLayers.map((layer) => (
          <div
            key={layer.key}
            className="bg-layer"
            style={{
              backgroundImage: `url(${layer.url})`,
              opacity: layer.state === 'active' ? 1 : 0,
              transition: 'opacity 0.6s ease',
            }}
          />
        ))}
        {/* #app::before overlay is handled by CSS pseudo-element now */}

        {/* Sidebar */}
        <Sidebar
          onDeleteConversation={handleDeleteConversation}
          onRenameConversation={handleRenameConversation}
        />

        {/* Main chat area */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
          {children}
        </main>
      </div>

      {/* ---- Modals ---- */}
      {modals.settings.open && <SettingsModal />}
      {modals.changelog && <ChangelogModal />}
      {modals.about && <AboutModal />}
      {modals.rename && <RenameModal />}
      {modals.crop && <CropModal />}
      {modals.companionAvatar && <CompanionAvatarModal />}
      {modals.community && <CommunityPopup />}

      {/* ---- Overlays ---- */}
      {callActive && <VoiceCallOverlay />}
      {gameFullscreen.isActive && <GameFullscreen />}
      {loadingVisible && <LoadingOverlay />}
      <ImageViewer />
      <Toast />
      </VoiceCallProvider>
    </AuthGuard>
  );
}
