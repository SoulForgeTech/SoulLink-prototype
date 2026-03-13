'use client';

/**
 * Main chat page.
 *
 * Assembles the chat header, message list, panels, and input area
 * into the full conversation view. Background image is controlled
 * by the settings slice.
 *
 * Chat send is wired to useSSEStream for real-time streaming.
 */

import { useCallback, useRef, useState } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { addMessage, replaceLastMessage } from '@/store/chatSlice';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useVoiceRecording } from '@/hooks/useVoiceRecording';
import { useVoiceCallContext } from '@/contexts/VoiceCallContext';
import { textToSpeech } from '@/lib/api/voice';
import { editImage } from '@/lib/api/image';

import ChatHeader from '@/components/chat/ChatHeader';
import MessageList from '@/components/chat/MessageList';
import ChatInput from '@/components/input/ChatInput';
import VoiceRecordingBar from '@/components/input/VoiceRecordingBar';
import BackgroundPicker from '@/components/panels/BackgroundPicker';
import AmbientSoundPanel from '@/components/panels/AmbientSoundPanel';
import GamesPanel from '@/components/panels/GamesPanel';

import type { MessageAttachment } from '@/types';

export default function ChatPage() {
  const dispatch = useAppDispatch();
  const authFetch = useAuthFetch();
  const { sendStream } = useSSEStream(authFetch);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const currentConversationId = useAppSelector((s) => s.conversations.currentId);
  const voicePresetId = useAppSelector((s) => s.settings.voicePresetId);

  // Voice call — shared context so start() runs in user gesture context
  const { start: startVoiceCall } = useVoiceCallContext();

  // Voice recording hook (owned here, passed to ChatInput + VoiceRecordingBar)
  const voiceRecording = useVoiceRecording();

  // Handle TTS playback on message bubble
  const handleTTS = useCallback(
    async (text: string) => {
      // Stop any currently playing audio
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      try {
        const data = await textToSpeech(authFetch, text);
        if (data.success && data.audio_b64) {
          const audio = new Audio(`data:audio/mp3;base64,${data.audio_b64}`);
          currentAudioRef.current = audio;
          audio.play().catch((e) => console.error('TTS playback failed:', e));
          audio.onended = () => {
            currentAudioRef.current = null;
          };
        }
      } catch (err) {
        console.error('TTS error:', err);
      }
    },
    [authFetch],
  );

  // Handle image edit — call BFL Kontext API
  const [isEditingImage, setIsEditingImage] = useState(false);
  const handleImageEdit = useCallback(
    async (imageDataUrl: string, prompt: string) => {
      if (isEditingImage) return;
      setIsEditingImage(true);

      // Show a placeholder assistant message while editing
      dispatch(
        addMessage({
          role: 'assistant',
          content: '🖌️ Editing image...',
          timestamp: new Date().toISOString(),
        }),
      );

      try {
        const result = await editImage(authFetch, { image: imageDataUrl, prompt, conversation_id: currentConversationId || undefined });
        const editedUrl = result.url || (result.b64 ? `data:image/jpeg;base64,${result.b64}` : '');

        if (editedUrl) {
          // Replace the placeholder with the result
          dispatch(
            replaceLastMessage({
              role: 'assistant',
              content: '',
              image_urls: [editedUrl],
              timestamp: new Date().toISOString(),
            }),
          );
        }
      } catch (err) {
        dispatch(
          replaceLastMessage({
            role: 'assistant',
            content: `Image edit failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: new Date().toISOString(),
          }),
        );
      } finally {
        setIsEditingImage(false);
      }
    },
    [authFetch, dispatch, isEditingImage, currentConversationId],
  );

  // Handle chat input send — wired to SSE streaming
  // When user uploads image + text that looks like an edit instruction,
  // both AI chat and image edit run in parallel.
  const handleSend = useCallback(
    (message: string, attachments: MessageAttachment[]) => {
      // 1. Add user message to chat immediately
      dispatch(
        addMessage({
          role: 'user',
          content: message,
          attachments: attachments.length > 0 ? attachments : undefined,
          timestamp: new Date().toISOString(),
        }),
      );

      // 2. Start SSE stream for AI response (always)
      sendStream({
        message,
        conversationId: currentConversationId,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      // 3. If user uploaded 1 image + text looks like an edit intent, also trigger image edit
      const imageAtts = attachments.filter((a) => a.isImage && a.dataUrl);
      if (imageAtts.length === 1 && message.trim() && attachments.length === 1) {
        const lowerMsg = message.toLowerCase();
        // Edit intent keywords (CN + EN)
        const editPatterns = /改|换|变|修|调|去掉|加上|删除|替换|移除|添加|放|把.*成|把.*换|把.*改|把.*变|背景|头发|颜色|衣服|表情|风格|滤镜|change|replace|edit|modify|remove|add|make.*look|turn.*into|swap|transform|convert|background|hair|color|outfit|style|filter/i;
        if (editPatterns.test(lowerMsg)) {
          handleImageEdit(imageAtts[0].dataUrl!, message);
        }
      }
    },
    [dispatch, sendStream, currentConversationId, handleImageEdit],
  );

  // Handle voice call — MUST call start() here (user gesture context)
  // so AudioContext starts in 'running' state, not 'suspended'.
  // If start() were called from useEffect (non-gesture), AudioContext
  // stays suspended and AnalyserNode gets no data → VAD never detects speech.
  const handleVoiceCall = useCallback(() => {
    startVoiceCall();
  }, [startVoiceCall]);

  return (
    <div className="main-content">
      {/* Chat header */}
      <ChatHeader />

      {/* Panels (always rendered, CSS controls slide animation via .open class) */}
      <BackgroundPicker />
      <AmbientSoundPanel />
      <GamesPanel />

      {/* Messages — TTS speaker button only when voice preset is set */}
      <MessageList onTTS={voicePresetId ? handleTTS : undefined} onImageEdit={handleImageEdit} />

      {/* Voice recording bar (shown when recording/uploading) */}
      <VoiceRecordingBar
        isRecording={voiceRecording.isRecording}
        isUploading={voiceRecording.isUploading}
        duration={voiceRecording.duration}
        cancelRecording={voiceRecording.cancelRecording}
        stopRecording={voiceRecording.stopRecording}
      />

      {/* Input area */}
      <ChatInput
        onSend={handleSend}
        onVoiceCall={handleVoiceCall}
        onStartRecording={voiceRecording.startRecording}
        onStopRecording={voiceRecording.stopRecording}
      />
    </div>
  );
}
