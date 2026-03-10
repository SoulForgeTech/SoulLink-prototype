"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppSelector } from "@/store";

/**
 * Root page — redirects to /chat if authenticated, /login otherwise.
 */
export default function Home() {
  const router = useRouter();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/chat");
    } else {
      router.replace("/login");
    }
  }, [isAuthenticated, router]);

  // Show loading while redirect is happening
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-dark)' }}>
      <div className="loading-spinner" />
    </div>
  );
}
