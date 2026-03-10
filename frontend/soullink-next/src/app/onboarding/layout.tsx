/**
 * Onboarding layout — full-screen dark background.
 *
 * No sidebar, no header. Just a clean canvas for the onboarding flow.
 */
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', width: '100%', background: '#0a0a1a', color: 'white', overflowX: 'hidden', overflowY: 'auto' }}>
      {children}
    </div>
  );
}
