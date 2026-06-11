'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Forward the client-side error to the server so it appears in Vercel logs.
    // This is the only way to get client-side crash visibility without a third-party service.
    fetch('/api/log-error', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack:   error.stack,
        digest:  error.digest,
        page:    typeof window !== 'undefined' ? window.location.pathname : undefined,
      }),
    }).catch(() => {
      // Silently ignore — if the log endpoint itself fails, don't cascade
    })
  }, [error])
  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>
      <nav style={{ background: '#fff', borderBottom: '1px solid #F0F0F0', padding: '0 32px', height: '80px', display: 'flex', alignItems: 'center' }}>
        <a href="/"><img src="/logo.png" alt="Catch Comics" style={{ height: '48px', width: 'auto' }} /></a>
      </nav>

      <div style={{ minHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: '28px' }}>
          !
        </div>
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111', margin: '0 0 10px' }}>Something went wrong</h1>
        <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 32px', maxWidth: '300px', lineHeight: 1.6 }}>
          An unexpected error occurred. Try refreshing the page or head back to search.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              padding: '10px 24px', background: '#0A0A0A', color: '#fff',
              borderRadius: '999px', fontSize: '14px', fontWeight: 600,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#E8272A')}
            onMouseLeave={e => (e.currentTarget.style.background = '#0A0A0A')}
          >
            Try again
          </button>
          <a href="/" style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '10px 24px', background: '#fff', color: '#6B7280',
            borderRadius: '999px', fontSize: '14px', fontWeight: 500,
            textDecoration: 'none', border: '1px solid #E5E7EB',
          }}>
            Home →
          </a>
        </div>
      </div>
    </main>
  )
}
