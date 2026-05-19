'use client';

/**
 * Guest upgrade modal — shown when guest hits a limit or tries a locked feature.
 */

import { useRouter } from 'next/navigation';
import { useAppSelector, useAppDispatch } from '@/store';
import { closeUpgradeModal, exitGuestMode } from '@/store/guestSlice';

export default function GuestUpgradeModal() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const isOpen = useAppSelector((s) => s.guest.upgradeModalOpen);
  const reason = useAppSelector((s) => s.guest.upgradeReason);
  const language = useAppSelector((s) => s.settings.language);

  if (!isOpen) return null;

  const isZh = language === 'zh-CN';

  const reasonText = {
    text: isZh ? '聊天消息额度已用完' : 'Chat message limit reached',
    voice: isZh ? '语音通话次数已用完' : 'Voice call limit reached',
    image: isZh ? '图片生成次数已用完' : 'Image generation limit reached',
    feature_locked: isZh ? '此功能需要注册后使用' : 'This feature requires an account',
  }[reason || 'feature_locked'];

  return (
    <div
      className="diary-modal-scrim diary-scope"
      style={{ zIndex: 20000, padding: 24 }}
      onClick={() => dispatch(closeUpgradeModal())}
    >
      <div
        className="diary-paper-panel"
        style={{
          borderRadius: 20,
          padding: '32px 28px',
          maxWidth: 380,
          width: '100%',
          textAlign: 'center',
          animation: 'modalScaleIn 0.25s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✨</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--ink)', margin: '0 0 8px 0' }}>
          {isZh ? '想继续聊吗？' : 'Want to keep chatting?'}
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 20px 0' }}>
          {reasonText}
        </p>

        <div style={{
          textAlign: 'left',
          background: 'rgba(26,26,28,0.05)',
          borderRadius: 12,
          padding: '14px 18px',
          marginBottom: 20,
          fontSize: '0.8rem',
          color: 'var(--ink-soft)',
          lineHeight: 1.8,
        }}>
          {isZh ? (
            <>
              <div>✓ 无限对话 + 永久记忆</div>
              <div>✓ 自定义角色与知识库</div>
              <div>✓ 语音通话无限使用</div>
              <div>✓ 多设备同步</div>
            </>
          ) : (
            <>
              <div>✓ Unlimited chat + permanent memory</div>
              <div>✓ Custom characters & knowledge base</div>
              <div>✓ Unlimited voice calls</div>
              <div>✓ Multi-device sync</div>
            </>
          )}
        </div>

        <button
          onClick={() => {
            dispatch(closeUpgradeModal());
            router.push('/login');
          }}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 2,
            border: 'none',
            background: 'var(--seal)',
            color: '#FFFAF0',
            fontSize: '0.95rem',
            fontWeight: 600,
            cursor: 'pointer',
            marginBottom: 8,
          }}
        >
          {isZh ? '创建免费账号' : 'Create Free Account'}
        </button>
        <button
          onClick={() => dispatch(closeUpgradeModal())}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.1)',
            background: 'transparent',
            color: '#718096',
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          {isZh ? '稍后再说' : 'Maybe Later'}
        </button>
      </div>
    </div>
  );
}
