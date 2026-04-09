'use client';

import { useState, useCallback, type CSSProperties } from 'react';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeModal } from '@/store/uiSlice';
import { useT } from '@/hooks/useT';
import { useAuthFetch } from '@/hooks/useAuthFetch';
import { submitFeedback as apiSubmitFeedback } from '@/lib/api/user';
import type { FeedbackRequest } from '@/types';

// ==================== Types ====================

type DonateMethod = 'zelle' | 'wechat' | 'alipay' | null;
type FeedbackType = FeedbackRequest['type'];

interface AboutModalProps {
  /** Called when user submits feedback */
  onSubmitFeedback?: (feedback: FeedbackRequest) => Promise<void>;
}

// ==================== Constants ====================

const FEEDBACK_TYPES: { value: FeedbackType; labelKey: string; icon: string }[] = [
  { value: 'suggestion', labelKey: 'about.feedback.suggestion', icon: '\u{1F4A1}' },
  { value: 'bug', labelKey: 'about.feedback.bug', icon: '\u{1F41B}' },
  { value: 'other', labelKey: 'about.feedback.other', icon: '\u{1F4AC}' },
];

const DONATE_METHODS: { id: DonateMethod; label: string; labelKey?: string; color: string; icon: string; iconStyle?: CSSProperties }[] = [
  { id: 'zelle', label: 'Zelle', color: '#6C1CD3', icon: '/paytous/zelle_icon.png', iconStyle: { borderRadius: '50%' } },
  { id: 'wechat', label: 'WeChat', labelKey: 'about.wechat', color: '#07C160', icon: '/paytous/wechat_pay_icon.png' },
  { id: 'alipay', label: 'Alipay', labelKey: 'about.alipay', color: '#1677FF', icon: '/paytous/alipay_icon.png', iconStyle: { borderRadius: '4px' } },
];

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
  width: '90%',
  maxWidth: '500px',
  maxHeight: '85vh',
  boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: '#1a202c',
  animation: 'modalScaleIn 0.25s ease',
  position: 'relative',
};

const modalBodyStyle: CSSProperties = {
  padding: '24px',
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
};

const modalFooterStyle: CSSProperties = {
  padding: '16px 24px',
  borderTop: '1px solid rgba(0,0,0,0.06)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
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
  width: '100%',
  marginTop: 12,
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

const formLabelStyle: CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '0.9rem',
  color: '#1a202c',
  fontWeight: 500,
};

const formGroupStyle: CSSProperties = {
  marginBottom: '16px',
};

const sectionHeaderStyle: CSSProperties = {
  fontSize: '0.9rem',
  fontWeight: 600,
  color: '#1a202c',
  marginBottom: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

// ==================== Component ====================

/**
 * About & Feedback modal.
 * Contains app info, community section, donation buttons,
 * feedback form, survey QR, and copyright footer.
 * Uses inline styles matching the original index.html glassmorphism CSS.
 */
export default function AboutModal({ onSubmitFeedback }: AboutModalProps) {
  const dispatch = useAppDispatch();
  const t = useT();
  const authFetch = useAuthFetch();
  const isOpen = useAppSelector((state) => state.ui.modals.about);

  const [activeDonate, setActiveDonate] = useState<DonateMethod>(null);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('suggestion');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const handleClose = useCallback(() => {
    dispatch(closeModal('about'));
    // Reset state
    setActiveDonate(null);
    setFeedbackText('');
    setFeedbackSent(false);
  }, [dispatch]);

  const handleSubmitFeedback = useCallback(async () => {
    if (!feedbackText.trim() || feedbackSubmitting) return;

    setFeedbackSubmitting(true);
    try {
      const feedback: FeedbackRequest = {
        type: feedbackType,
        content: feedbackText.trim(),
      };
      if (onSubmitFeedback) {
        await onSubmitFeedback(feedback);
      } else {
        // Call API directly if no callback provided
        await apiSubmitFeedback(authFetch, feedback);
      }
      setFeedbackSent(true);
      setFeedbackText('');
      // Auto-hide success after 3 seconds
      setTimeout(() => setFeedbackSent(false), 3000);
    } catch {
      alert(t('about.feedback.placeholder'));
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [feedbackText, feedbackType, feedbackSubmitting, onSubmitFeedback, authFetch, t]);

  if (!isOpen) return null;

  return (
    <div
      className="about-modal-overlay active"
      style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      onClick={handleClose}
    >
      {/* Modal Content */}
      <div
        className="about-modal"
        style={{ backdropFilter: 'blur(40px) saturate(180%)', WebkitBackdropFilter: 'blur(40px) saturate(180%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button className="about-modal-close" onClick={handleClose} aria-label="Close">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header — fixed top section */}
        <div className="about-modal-header">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a202c', margin: 0 }}>SoulLink</h2>
            <p style={{ fontSize: '0.875rem', color: '#718096', marginTop: 4, marginBottom: 0 }}>
              {t('about.tagline')}
            </p>
            <span style={{
              display: 'inline-block',
              marginTop: 8,
              padding: '2px 10px',
              borderRadius: 9999,
              fontSize: '0.75rem',
              fontWeight: 500,
              background: 'rgba(107,163,214,0.1)',
              color: '#6BA3D6',
            }}>
              v0.2.0-beta
            </span>
          </div>
        </div>

        {/* Scrollable Content — hidden scrollbar via CSS */}
        <div className="about-modal-body">
          {/* Description */}
          <p style={{ fontSize: '0.875rem', color: '#4a5568', textAlign: 'center', marginBottom: 24, lineHeight: 1.6 }}>
            {t('about.description')}
          </p>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '20px 0' }} />

          {/* Community Section */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={sectionHeaderStyle}>
              <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {t('about.community')}
            </h4>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.5)',
              border: '1px solid rgba(0,0,0,0.1)',
            }}>
              <div style={{
                width: 120,
                height: 120,
                borderRadius: '8px',
                background: 'white',
                border: '1px solid rgba(0,0,0,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/wechat_group_qr.jpg"
                  alt="WeChat QR"
                  style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, cursor: 'pointer' }}
                  onClick={() => window.open('/images/wechat_group_qr.jpg', '_blank')}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
              <div>
                <p style={{ fontSize: '0.9rem', fontWeight: 500, color: '#1a202c' }}>{t('about.community')}</p>
                <p style={{ fontSize: '0.75rem', color: '#718096' }}>{t('about.community.desc')}</p>
              </div>
            </div>
          </div>

          {/* Support / Donate Section */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={sectionHeaderStyle}>
              <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {t('about.support')}
            </h4>

            {/* Donate Method Buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {DONATE_METHODS.map((method) => (
                <button
                  key={method.id}
                  onClick={() =>
                    setActiveDonate(
                      activeDonate === method.id ? null : method.id,
                    )
                  }
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: 'white',
                    background: method.color,
                    border: 'none',
                    outline: 'none',
                    cursor: 'pointer',
                    opacity: activeDonate && activeDonate !== method.id ? 0.45 : 1,
                    transition: 'opacity 0.2s, transform 0.15s',
                    transform: activeDonate === method.id ? 'scale(1.03)' : 'scale(1)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={method.icon} alt="" width={20} height={20} style={{ verticalAlign: 'middle', marginRight: 4, ...method.iconStyle }} />
                  {method.labelKey ? t(method.labelKey) : method.label}
                </button>
              ))}
            </div>

            {/* Donate QR Display */}
            {activeDonate && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                padding: 12,
                borderRadius: '8px',
                background: 'rgba(255,255,255,0.5)',
                border: '1px solid rgba(0,0,0,0.1)',
              }}>
                <div style={{
                  width: 220,
                  height: 220,
                  borderRadius: '12px',
                  background: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/paytous/${activeDonate}.jpg`}
                    alt={`${activeDonate} QR`}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).parentElement!.innerHTML =
                        '<span style="color:#a0aec0;font-size:0.75rem">QR Code</span>';
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '20px 0' }} />

          {/* Feedback Form */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={sectionHeaderStyle}>
              <svg style={{ width: 16, height: 16 }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              {t('about.feedback')}
            </h4>

            {feedbackSent ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{'\u2705'}</div>
                <p style={{ fontSize: '0.875rem', color: '#718096' }}>
                  {t('about.feedback.thanks')}
                </p>
                <button
                  onClick={() => setFeedbackSent(false)}
                  style={{
                    marginTop: 12,
                    fontSize: '0.875rem',
                    color: '#6BA3D6',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {t('about.feedback.submit')}
                </button>
              </div>
            ) : (
              <>
                {/* Type Selector */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {FEEDBACK_TYPES.map((ft) => (
                    <button
                      key={ft.value}
                      onClick={() => setFeedbackType(ft.value)}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '8px',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        border: feedbackType === ft.value
                          ? '1px solid rgba(107,163,214,0.3)'
                          : '1px solid rgba(0,0,0,0.1)',
                        background: feedbackType === ft.value
                          ? 'rgba(107,163,214,0.1)'
                          : 'rgba(255,255,255,0.5)',
                        color: feedbackType === ft.value ? '#6BA3D6' : '#4a5568',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ marginRight: 4 }}>{ft.icon}</span>
                      {t(ft.labelKey)}
                    </button>
                  ))}
                </div>

                {/* Textarea */}
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value.slice(0, 1000))}
                  placeholder={t('about.feedback.placeholder')}
                  rows={3}
                  maxLength={1000}
                  style={{
                    ...formInputStyle,
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    minHeight: 80,
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

                {/* Footer: char count + submit button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: '0.75rem', color: '#a0aec0' }}>
                    {feedbackText.length}/1000
                  </span>
                  <button
                    onClick={handleSubmitFeedback}
                    disabled={!feedbackText.trim() || feedbackSubmitting}
                    style={{
                      ...btnPrimaryStyle,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      opacity: (!feedbackText.trim() || feedbackSubmitting) ? 0.4 : 1,
                      cursor: (!feedbackText.trim() || feedbackSubmitting) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {feedbackSubmitting ? (
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
                        {t('settings.custom.persona.saving')}
                      </>
                    ) : (
                      t('about.feedback.submit')
                    )}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Survey Section — full-width image like original */}
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ ...sectionHeaderStyle, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {t('about.survey')}
            </h4>
            <p style={{ fontSize: '0.8rem', color: '#4a5568', marginBottom: 12 }}>
              {t('about.survey.desc')}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/survey.png"
              alt="AI Soul Companionship Survey"
              style={{
                width: '100%',
                borderRadius: 12,
                boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transition: 'transform 0.2s ease',
              }}
              onClick={() => window.open('/images/survey.png', '_blank')}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 30px', borderTop: '1px solid rgba(0,0,0,0.06)', textAlign: 'center', flexShrink: 0 }}>
          <p style={{ fontSize: '0.75rem', color: '#a0aec0', margin: 0 }}>
            &copy; {new Date().getFullYear()} SoulLink. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
