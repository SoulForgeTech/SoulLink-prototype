'use client';

/**
 * Onboarding layout — full-page diary paper, same module as /login.
 * Client component so it can read the user's theme preference from
 * Redux and propagate it via data-theme. Onboarding only runs after
 * login so the store is hydrated by the time we get here.
 */
import DiaryBackground from '@/app/login/_components/DiaryBackground';
import { useAppSelector } from '@/store';
import '@/styles/diary.css';

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = useAppSelector((s) => s.settings.theme);
  return (
    <div
      className="auth-scope diary-scope"
      data-theme={theme}
      style={{ minHeight: '100vh', width: '100%', overflowX: 'hidden', overflowY: 'auto' }}
    >
      <DiaryBackground />
      {children}
    </div>
  );
}
