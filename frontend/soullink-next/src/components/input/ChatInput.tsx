'use client';

/**
 * Chat input area component.
 *
 * Features:
 *   - Auto-expanding textarea (grows with content)
 *   - Attach file button with file type/size validation
 *   - Voice record button (push-to-talk)
 *   - Voice call button
 *   - Send button (enabled when there is text or files)
 *   - File preview bar showing attached files
 *   - Drag & drop overlay for files
 *   - Enter to send, Shift+Enter for new line
 *
 * Uses input-wrapper class from globals.css for glassmorphism effect.
 * All inline styles match the original monolithic index.html CSS values exactly.
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
  type DragEvent,
  type ChangeEvent,
} from 'react';
import { useAppSelector } from '@/store';
import type { MessageAttachment } from '@/types';

// ==================== Constants ====================

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_DOC_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];

// ==================== i18n ====================

const labels = {
  en: {
    placeholder: 'Type a message...',
    dropHint: 'Drop files here',
    tooLarge: 'File too large (max 10MB)',
    unsupported: 'Unsupported file type',
  },
  'zh-CN': {
    placeholder: '\u8F93\u5165\u6D88\u606F...',
    dropHint: '\u62D6\u653E\u6587\u4EF6\u5230\u8FD9\u91CC',
    tooLarge: '\u6587\u4EF6\u592A\u5927\uFF08\u6700\u5927 10MB\uFF09',
    unsupported: '\u4E0D\u652F\u6301\u7684\u6587\u4EF6\u7C7B\u578B',
  },
} as const;

// ==================== Types ====================

interface ChatInputProps {
  /** Called when the user sends a message. */
  onSend: (message: string, attachments: MessageAttachment[]) => void;
  /** Called when the user starts recording. */
  onStartRecording?: () => void;
  /** Called when the user stops recording. */
  onStopRecording?: () => void;
  /** Called when the user initiates a voice call. */
  onVoiceCall?: () => void;
  /** Whether input is disabled (e.g. while streaming). */
  disabled?: boolean;
}

// ==================== Styles (matching original CSS) ====================

/** Outer wrapper — positioned by CSS .input-container (absolute bottom overlay) */
const outerWrapperStyle: React.CSSProperties = {};

/** .input-wrapper layout + glassmorphism (inline to avoid Turbopack stripping)
 *  NOTE: padding/borderRadius are NOT set here — controlled by CSS class
 *  so mobile media queries can override without !important.
 */
const inputWrapperStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  /* Glassmorphism — duplicated inline to bypass Turbopack CSS transform issues */
  border: '1.5px solid transparent',
  background: `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 100%) padding-box, linear-gradient(160deg, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.35) 15%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.10) 80%, rgba(255,255,255,0.20) 100%) border-box`,
  backdropFilter: 'blur(40px) saturate(180%)',
  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.20), 0 2px 8px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 12px rgba(255,255,255,0.04)',
};

/** #message-input textarea */
const textareaStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  color: '#e2e8f0',
  fontSize: '0.95rem',
  outline: 'none',
  resize: 'none',
  maxHeight: 150,
  minHeight: 32,
  height: 32,
  lineHeight: 1.5,
  padding: '4px 0',
  margin: 0,
  overflowY: 'hidden',
  fontFamily: "'Poppins', sans-serif",
};

/** .attach-btn */
const attachBtnBase: React.CSSProperties = {
  width: 32,
  height: 32,
  minWidth: 32,
  background: 'none',
  border: 'none',
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s',
  color: 'rgba(255,255,255,0.65)',
  flexShrink: 0,
  padding: 0,
};

/** .send-btn */
const sendBtnBase: React.CSSProperties = {
  width: 32,
  height: 32,
  minWidth: 32,
  minHeight: 32,
  background: 'none',
  border: 'none',
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
  color: 'rgba(255,255,255,0.65)',
  flexShrink: 0,
  padding: 0,
};

/** .voice-btn */
const voiceBtnBase: React.CSSProperties = {
  width: 32,
  height: 32,
  minWidth: 32,
  background: 'none',
  border: 'none',
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s',
  flexShrink: 0,
  color: 'rgba(255,255,255,0.65)',
  padding: 0,
  position: 'relative',
};

/** Drag overlay */
const dragOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 36,
  border: '2px dashed rgba(107,163,214,0.5)',
  background: 'rgba(107,163,214,0.1)',
  backdropFilter: 'blur(4px)',
};

/** File error toast */
const fileErrorStyle: React.CSSProperties = {
  marginBottom: 8,
  padding: '6px 12px',
  borderRadius: 8,
  background: 'rgba(239,68,68,0.2)',
  color: '#fca5a5',
  fontSize: '0.75rem',
  animation: 'hintFadeIn 0.2s ease-out',
};

/** File preview bar */
const filePreviewBarStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 8,
  padding: '0 4px',
};

/** File preview item */
const filePreviewItemStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  background: 'rgba(255,255,255,0.08)',
  borderRadius: 8,
  padding: '6px 8px',
  border: '1px solid rgba(255,255,255,0.1)',
};

/** File preview remove button */
const fileRemoveBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: 'rgba(239,68,68,0.8)',
  color: 'white',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  lineHeight: 1,
  opacity: 0,
  transition: 'opacity 0.15s',
  padding: 0,
};

// ==================== File Helpers ====================

function isAllowedType(file: File): boolean {
  return ALLOWED_TYPES.includes(file.type);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function fileToAttachment(file: File): Promise<MessageAttachment | null> {
  const isImage = ALLOWED_IMAGE_TYPES.includes(file.type);

  if (isImage) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      name: file.name,
      isImage: true,
      mime: file.type,
      dataUrl,
      contentString: dataUrl,
    };
  }

  const text = await readFileAsText(file);
  return {
    name: file.name,
    isImage: false,
    mime: file.type,
    contentString: text,
  };
}

// ==================== Component ====================

export default function ChatInput({
  onSend,
  onStartRecording,
  onStopRecording,
  onVoiceCall,
  disabled = false,
}: ChatInputProps) {
  const language = useAppSelector((s) => s.settings.language);
  const isRecording = useAppSelector((s) => s.voice.isRecording);
  const t = labels[language] || labels.en;

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Hover states
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [hoveredFileIdx, setHoveredFileIdx] = useState<number | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Auto-expand textarea ----
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [text]);

  // ---- Clear file error after 3 seconds ----
  useEffect(() => {
    if (fileError) {
      const timer = setTimeout(() => setFileError(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [fileError]);

  // ---- Send message ----
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (disabled) return;

    onSend(trimmed, attachments);
    setText('');
    setAttachments([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [text, attachments, disabled, onSend]);

  // ---- Keyboard handling ----
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ---- File processing ----
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const newAttachments: MessageAttachment[] = [];

      for (const file of fileArray) {
        if (file.size > MAX_FILE_SIZE) {
          setFileError(t.tooLarge);
          continue;
        }
        if (!isAllowedType(file)) {
          setFileError(t.unsupported);
          continue;
        }

        try {
          const attachment = await fileToAttachment(file);
          if (attachment) {
            newAttachments.push(attachment);
          }
        } catch (err) {
          console.error('Failed to read file:', err);
        }
      }

      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    },
    [t.tooLarge, t.unsupported],
  );

  // ---- File input change ----
  const handleFileChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(e.target.files);
      }
      e.target.value = '';
    },
    [processFiles],
  );

  // ---- Drag & drop ----
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // 1. Handle file drops (normal file upload)
      if (e.dataTransfer?.files?.length) {
        processFiles(e.dataTransfer.files);
        return;
      }

      // 2. Handle image URL drops (dragging <img> from chat)
      const url = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
      if (url && /^https?:\/\/.+/i.test(url)) {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          if (blob.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = reader.result as string;
              setAttachments((prev) => [...prev, {
                name: 'image.png',
                isImage: true,
                mime: blob.type,
                dataUrl,
                contentString: dataUrl,
              }]);
            };
            reader.readAsDataURL(blob);
          }
        } catch (err) {
          console.error('Failed to fetch dropped image:', err);
        }
      }
    },
    [processFiles],
  );

  // ---- Remove attachment ----
  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---- Voice recording ----
  const handleRecordToggle = useCallback(() => {
    if (isRecording) {
      onStopRecording?.();
    } else {
      onStartRecording?.();
    }
  }, [isRecording, onStartRecording, onStopRecording]);

  const hasContent = text.trim().length > 0 || attachments.length > 0;

  // ---- Dynamic button styles ----
  const getAttachBtnStyle = (): React.CSSProperties => ({
    ...attachBtnBase,
    color: hoveredBtn === 'attach' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
  });

  const getSendBtnStyle = (): React.CSSProperties => {
    const isDisabled = !hasContent || disabled;
    if (isDisabled) {
      return { ...sendBtnBase, opacity: 0.5, cursor: 'not-allowed' };
    }
    if (hoveredBtn === 'send') {
      return { ...sendBtnBase, transform: 'scale(1.05)', color: 'rgba(255,255,255,0.9)' };
    }
    return sendBtnBase;
  };

  const getMicBtnStyle = (): React.CSSProperties => {
    if (isRecording) {
      return {
        ...voiceBtnBase,
        color: '#e53e3e',
        animation: 'voicePulse 1s ease-in-out infinite',
      };
    }
    return {
      ...voiceBtnBase,
      color: hoveredBtn === 'mic' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
    };
  };

  const getPhoneBtnStyle = (): React.CSSProperties => ({
    ...voiceBtnBase,
    color: hoveredBtn === 'phone' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
  });

  return (
    <div
      className="input-container"
      style={outerWrapperStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & drop overlay */}
      {isDragging && (
        <div style={dragOverlayStyle}>
          <span style={{ fontSize: '0.875rem', color: 'var(--primary-light, #9DC4E6)', fontWeight: 500 }}>
            {t.dropHint}
          </span>
        </div>
      )}

      {/* Glass input wrapper */}
      <div className="input-wrapper" style={inputWrapperStyle}>
        {/* File error toast */}
        {fileError && (
          <div style={fileErrorStyle}>
            {fileError}
          </div>
        )}

        {/* File preview bar */}
        {attachments.length > 0 && (
          <div style={filePreviewBarStyle}>
            {attachments.map((att, i) => (
              <div
                key={i}
                style={filePreviewItemStyle}
                onMouseEnter={() => setHoveredFileIdx(i)}
                onMouseLeave={() => setHoveredFileIdx(null)}
              >
                {att.isImage && att.dataUrl ? (
                  <img
                    src={att.dataUrl}
                    alt={att.name}
                    style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }}
                  />
                ) : (
                  <svg width={16} height={16} fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                )}
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
                {/* Remove button */}
                <button
                  onClick={() => removeAttachment(i)}
                  style={{
                    ...fileRemoveBtnStyle,
                    opacity: hoveredFileIdx === i ? 1 : 0,
                  }}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attach file button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          style={getAttachBtnStyle()}
          onMouseEnter={() => setHoveredBtn('attach')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label="Attach file"
        >
          {/* Paperclip SVG */}
          <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6h-1.5v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6H16.5z"/>
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          disabled={disabled}
          rows={1}
          style={{
            ...textareaStyle,
            opacity: disabled ? 0.4 : 1,
          }}
        />

        {/* Voice record button (mic) */}
        <button
          onClick={handleRecordToggle}
          style={getMicBtnStyle()}
          onMouseEnter={() => setHoveredBtn('mic')}
          onMouseLeave={() => setHoveredBtn(null)}
          aria-label={isRecording ? 'Stop recording' : 'Record voice'}
        >
          {/* Mic SVG */}
          <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
          {isRecording && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#f87171',
                animation: 'recBlink 1s infinite',
              }}
            />
          )}
        </button>

        {/* Voice call button (phone) */}
        {onVoiceCall && (
          <button
            onClick={onVoiceCall}
            style={getPhoneBtnStyle()}
            onMouseEnter={() => setHoveredBtn('phone')}
            onMouseLeave={() => setHoveredBtn(null)}
            aria-label="Voice call"
          >
            {/* Phone SVG */}
            <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </button>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!hasContent || disabled}
          style={getSendBtnStyle()}
          onMouseEnter={() => setHoveredBtn('send')}
          onMouseLeave={() => setHoveredBtn(null)}
          onMouseDown={(e) => {
            if (hasContent && !disabled) {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.95)';
            }
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = '';
          }}
          aria-label="Send"
        >
          {/* Arrow/plane SVG — 18x18 matching original .send-btn svg */}
          <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
