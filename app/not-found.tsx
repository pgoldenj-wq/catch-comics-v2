export default function NotFound() {
  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>
      <nav style={{ background: '#fff', borderBottom: '1px solid #F0F0F0', padding: '0 32px', height: '80px', display: 'flex', alignItems: 'center' }}>
        <a href="/"><img src="/logo.png" alt="Catch Comics" style={{ height: '48px', width: 'auto' }} /></a>
      </nav>

      <div style={{ minHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 24px' }}>
        <p style={{ fontSize: '96px', fontWeight: 800, color: '#F0F0F0', lineHeight: 1, margin: '0 0 8px', letterSpacing: '-0.04em' }}>404</p>
        <h1 style={{ fontSize: '22px', fontWeight: 600, color: '#111', margin: '0 0 10px' }}>Page not found</h1>
        <p style={{ fontSize: '14px', color: '#9CA3AF', margin: '0 0 32px', maxWidth: '300px', lineHeight: 1.6 }}>
          That page doesn&apos;t exist. Try searching for a comic instead.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <a href="/" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '10px 24px', background: '#E8272A', color: '#fff',
            borderRadius: '999px', fontSize: '14px', fontWeight: 600,
            textDecoration: 'none',
          }}>
            ← Back to home
          </a>
          <a href="/search?q=batman" style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '10px 24px', background: '#fff', color: '#6B7280',
            borderRadius: '999px', fontSize: '14px', fontWeight: 500,
            textDecoration: 'none', border: '1px solid #E5E7EB',
          }}>
            Search comics
          </a>
        </div>
      </div>
    </main>
  )
}
