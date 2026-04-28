'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<'uk' | 'us'>('uk');
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query.trim())}&region=${region}`);
    }
  };

  const categories = [
    {
      label: 'Graphic Novels',
      icon: (
        <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
          <rect x="5" y="3" width="16" height="22" rx="2" fill="#E8272A" opacity="0.12"/>
          <rect x="7" y="5" width="16" height="22" rx="2" fill="#E8272A" opacity="0.2"/>
          <rect x="9" y="7" width="16" height="22" rx="2" fill="none" stroke="#E8272A" strokeWidth="1.5"/>
          <line x1="13" y1="13" x2="21" y2="13" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="13" y1="17" x2="21" y2="17" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="13" y1="21" x2="18" y2="21" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: 'Manga',
      icon: (
        <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
          <circle cx="16" cy="16" r="10" stroke="#E8272A" strokeWidth="1.5"/>
          <path d="M16 6 C16 6 20 11 20 16 C20 21 16 26 16 26 C16 26 12 21 12 16 C12 11 16 6 16 6Z" fill="#E8272A" opacity="0.15" stroke="#E8272A" strokeWidth="1.5"/>
          <path d="M6 16 Q11 13 16 16 Q21 19 26 16" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: 'Single Issues',
      icon: (
        <svg viewBox="0 0 32 32" fill="none" className="w-6 h-6">
          <rect x="7" y="3" width="18" height="26" rx="2" stroke="#E8272A" strokeWidth="1.5"/>
          <rect x="7" y="3" width="18" height="10" rx="2" fill="#E8272A" opacity="0.12"/>
          <line x1="11" y1="18" x2="21" y2="18" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="11" y1="22" x2="17" y2="22" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  const trending = ['Batman', 'Spider-Man', 'Saga', 'Watchmen', 'X-Men', 'Invincible'];

  const covers = [
    { title: 'Absolute Batman', src: 'https://comicvine.gamespot.com/a/uploads/scale_large/14/149814/9881791-absbm_v1_zoo%28cover%29copy.jpg', rotate: '-5deg', left: '30px', top: '28px', width: '158px', height: '228px', zIndex: 3 },
    { title: 'Ultimate Spider-Man', src: 'https://comicvine.gamespot.com/a/uploads/scale_large/11/110017/9226620-wwww.jpg', rotate: '2deg', left: '175px', top: '14px', width: '170px', height: '246px', zIndex: 5 },
    { title: 'Jujutsu Kaisen', src: 'https://comicvine.gamespot.com/a/uploads/scale_large/6/67663/6491809-01.jpg', rotate: '-3deg', left: '330px', top: '36px', width: '152px', height: '220px', zIndex: 3 },
  ];

  const publisherLogos = [
    <svg key="marvel" viewBox="0 0 48 20" fill="none" width="48" height="20">
      <rect width="48" height="20" rx="2" fill="rgba(255,255,255,0.15)"/>
      <text x="24" y="14" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="Arial Black, sans-serif" fill="white" letterSpacing="1">MARVEL</text>
    </svg>,
    <svg key="shueisha" viewBox="0 0 28 28" fill="none" width="28" height="28">
      <circle cx="14" cy="14" r="12" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"/>
      <text x="14" y="19" textAnchor="middle" fontSize="13" fontWeight="700" fontFamily="serif" fill="rgba(255,255,255,0.7)">集</text>
    </svg>,
    <svg key="dc" viewBox="0 0 32 32" fill="none" width="32" height="32">
      <circle cx="16" cy="16" r="14" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"/>
      <text x="16" y="21" textAnchor="middle" fontSize="12" fontWeight="800" fontFamily="Arial Black, sans-serif" fill="rgba(255,255,255,0.7)">DC</text>
    </svg>,
    <svg key="image" viewBox="0 0 32 32" fill="none" width="32" height="32">
      <polygon points="16,3 30,27 2,27" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" fill="none"/>
      <text x="16" y="23" textAnchor="middle" fontSize="7" fontWeight="700" fontFamily="Arial, sans-serif" fill="rgba(255,255,255,0.6)">IMAGE</text>
    </svg>,
    <svg key="kodansha" viewBox="0 0 28 28" fill="none" width="28" height="28">
      <rect x="2" y="2" width="24" height="24" rx="3" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/>
      <text x="14" y="20" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif" fill="rgba(255,255,255,0.65)">K</text>
    </svg>,
    <svg key="darkhorse" viewBox="0 0 32 32" fill="none" width="32" height="32">
      <path d="M8 28 C8 20 12 16 14 12 C15 9 14 6 16 4 C18 6 20 8 19 12 C22 10 24 12 23 16 C25 15 27 17 25 20 C24 23 20 25 16 26 Z" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" fill="none" strokeLinejoin="round"/>
    </svg>,
    <svg key="viz" viewBox="0 0 40 20" fill="none" width="40" height="20">
      <text x="20" y="15" textAnchor="middle" fontSize="13" fontWeight="800" fontFamily="Arial Black, sans-serif" fill="rgba(255,255,255,0.6)" letterSpacing="1">VIZ</text>
    </svg>,
    <svg key="idw" viewBox="0 0 36 20" fill="none" width="36" height="20">
      <text x="18" y="15" textAnchor="middle" fontSize="12" fontWeight="800" fontFamily="Arial Black, sans-serif" fill="rgba(255,255,255,0.5)" letterSpacing="1">IDW</text>
    </svg>,
    <svg key="boom" viewBox="0 0 32 32" fill="none" width="32" height="32">
      <path d="M16 2 L18 12 L28 8 L21 16 L30 20 L20 20 L22 30 L16 23 L10 30 L12 20 L2 20 L11 16 L4 8 L14 12 Z" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" fill="none" strokeLinejoin="round"/>
      <text x="16" y="19" textAnchor="middle" fontSize="5" fontWeight="700" fontFamily="Arial, sans-serif" fill="rgba(255,255,255,0.6)">BOOM!</text>
    </svg>,
    <svg key="shogakukan" viewBox="0 0 28 28" fill="none" width="28" height="28">
      <rect x="2" y="2" width="24" height="24" rx="3" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/>
      <text x="14" y="20" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="serif" fill="rgba(255,255,255,0.6)">小</text>
    </svg>,
    <svg key="dynamite" viewBox="0 0 40 20" fill="none" width="40" height="20">
      <path d="M4 10 L8 4 L20 7 L32 4 L36 10 L32 16 L20 13 L8 16 Z" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" fill="none"/>
      <text x="20" y="13" textAnchor="middle" fontSize="5.5" fontWeight="700" fontFamily="Arial, sans-serif" fill="rgba(255,255,255,0.5)">DYNAMITE</text>
    </svg>,
    <svg key="yenpress" viewBox="0 0 28 28" fill="none" width="28" height="28">
      <circle cx="14" cy="14" r="12" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/>
      <text x="14" y="20" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif" fill="rgba(255,255,255,0.6)">Y</text>
    </svg>,
    <svg key="valiant" viewBox="0 0 28 28" fill="none" width="28" height="28">
      <path d="M4 6 L14 24 L24 6" stroke="rgba(255,255,255,0.45)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>,
    <svg key="aftershock" viewBox="0 0 24 32" fill="none" width="24" height="32">
      <path d="M16 2 L6 18 L13 18 L8 30 L20 12 L13 12 L18 2 Z" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" fill="none" strokeLinejoin="round"/>
    </svg>,
    <svg key="sevenseas" viewBox="0 0 40 20" fill="none" width="40" height="20">
      <path d="M2 12 Q8 4 14 12 Q20 20 26 12 Q32 4 38 12" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      <path d="M2 16 Q8 8 14 16 Q20 24 26 16 Q32 8 38 16" stroke="rgba(255,255,255,0.2)" strokeWidth="1" fill="none" strokeLinecap="round"/>
    </svg>,
  ];

  const UKFlag = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="24" height="12" aria-label="UK flag">
      <path d="M0 0v30h60V0z" fill="#012169"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="4"/>
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10"/>
      <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6"/>
    </svg>
  );

  const USFlag = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="24" height="12" aria-label="US flag">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">
        {[...Array(5)].map((_, row) =>
          [...Array(row % 2 === 0 ? 6 : 5)].map((_, col) => (
            <circle key={`${row}-${col}`}
              cx={row % 2 === 0 ? 2 + col * 4 : 4 + col * 4}
              cy={2 + row * 3} r="0.9"
            />
          ))
        )}
      </g>
    </svg>
  );

  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>

      <style>{`
        @keyframes scrollPublishers {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .pub-track {
          display: flex;
          align-items: center;
          width: max-content;
          animation: scrollPublishers 31s linear infinite;
          will-change: transform;
        }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ background: '#fff', borderBottom: '1px solid #F0F0F0' }}>
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center justify-between">
          <a href="/"><img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" /></a>
          <div className="flex items-center gap-3">
            <button onClick={() => setRegion('uk')}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{ borderColor: region === 'uk' ? '#0A0A0A' : '#E5E7EB', background: region === 'uk' ? '#0A0A0A' : '#fff' }}
              aria-label="Switch to UK prices">
              <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0"
                style={{ width: '32px', height: '32px', background: '#f3f4f6' }}>
                <UKFlag />
              </span>
              <span className="text-sm font-medium" style={{ color: region === 'uk' ? '#fff' : '#6B7280' }}>United Kingdom</span>
            </button>
            <button onClick={() => setRegion('us')}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{ borderColor: region === 'us' ? '#0A0A0A' : '#E5E7EB', background: region === 'us' ? '#0A0A0A' : '#fff' }}
              aria-label="Switch to US prices">
              <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0"
                style={{ width: '32px', height: '32px', background: '#f3f4f6' }}>
                <USFlag />
              </span>
              <span className="text-sm font-medium" style={{ color: region === 'us' ? '#fff' : '#6B7280' }}>United States</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── HERO CARD ── */}
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-4">
        <div className="relative overflow-hidden flex items-stretch"
          style={{ background: '#111827', borderRadius: '28px', minHeight: '420px' }}>

          {/* halftone */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }} />
          {/* red glow */}
          <div className="absolute pointer-events-none" style={{
            top: '-80px', right: '-80px', width: '480px', height: '480px',
            background: 'radial-gradient(circle, rgba(232,39,42,0.16) 0%, transparent 65%)',
          }} />

          {/* ── LEFT ── */}
          <div className="relative z-10 flex flex-col justify-center px-12 py-10 w-1/2 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-widest mb-5" style={{ color: '#E8272A' }}>
              The world's only comic price comparison
            </p>
            <h1 className="font-semibold text-white leading-tight mb-4"
              style={{ fontSize: 'clamp(2rem, 3.5vw, 3rem)', letterSpacing: '-0.03em' }}>
              Search, compare,<br />save on comics
            </h1>
            <p className="text-sm mb-8 leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)', maxWidth: '340px' }}>
              Every comic, graphic novel and manga — compared across the web in seconds.
            </p>
            <form onSubmit={handleSearch}
              className="flex items-center bg-white pl-5 pr-1.5 py-1.5"
              style={{ borderRadius: '999px', maxWidth: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
              <svg className="w-4 h-4 shrink-0 mr-3" fill="none" viewBox="0 0 24 24" style={{ color: '#9CA3AF' }}>
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
                <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search any title, character or ISBN..."
                className="flex-1 bg-transparent text-sm outline-none py-2.5"
                style={{ color: '#0A0A0A' }} autoComplete="off" />
              <button type="submit" className="flex items-center justify-center shrink-0"
                style={{ width: '42px', height: '42px', borderRadius: '999px', background: '#E8272A' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#c41f22')}
                onMouseLeave={e => (e.currentTarget.style.background = '#E8272A')}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" style={{ color: '#fff' }}>
                  <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
          </div>

          {/* ── RIGHT: covers + publisher strip ── */}
          {/* marginTop: -32px lifts the entire right column up */}
          <div className="relative flex-1 flex flex-col justify-center overflow-hidden"
            style={{ marginTop: '-32px' }}>

            {/* right edge fade */}
            <div className="absolute right-0 top-0 bottom-0 w-12 z-20 pointer-events-none"
              style={{ background: 'linear-gradient(to left, #111827 0%, transparent 100%)' }} />

            {/* COVERS */}
            <div className="relative" style={{ height: '280px' }}>
              {covers.map((cover, i) => (
                <div key={i} className="absolute" style={{
                  left: cover.left, top: cover.top,
                  width: cover.width, height: cover.height,
                  borderRadius: '8px', overflow: 'hidden',
                  transform: `rotate(${cover.rotate})`,
                  boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
                  zIndex: cover.zIndex,
                  background: '#1a1a2e',
                }}>
                  <img src={cover.src} alt={cover.title}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
                </div>
              ))}
            </div>

            {/* PUBLISHER LOGO STRIP */}
            {/* marginTop: 10px — tighter gap after lifting */}
            {/* Aligned so strip centre hits same vertical as search bar centre */}
            <div style={{
              position: 'relative',
              marginTop: '10px',
              marginLeft: '30px',
              width: '452px',
              overflow: 'hidden',
              height: '36px',
            }}>
              {/* left fade */}
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: '28px', zIndex: 2,
                background: 'linear-gradient(to right, #111827 0%, transparent 100%)',
                pointerEvents: 'none',
              }} />
              {/* right fade */}
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0, width: '28px', zIndex: 2,
                background: 'linear-gradient(to left, #111827 0%, transparent 100%)',
                pointerEvents: 'none',
              }} />

              <div className="pub-track">
                {[...publisherLogos, ...publisherLogos].map((logo, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 18px',
                    flexShrink: 0,
                    opacity: 0.7,
                  }}>
                    {logo}
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── CATEGORIES ── */}
      <div className="max-w-6xl mx-auto px-6 pt-6 pb-2">
        <div className="flex gap-3">
          {categories.map((cat) => (
            <button key={cat.label}
              onClick={() => router.push(`/search?q=${encodeURIComponent(cat.label)}&region=${region}`)}
              className="flex items-center gap-3 px-5 py-3.5 bg-white rounded-2xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all group">
              <div className="transition-transform group-hover:scale-110">{cat.icon}</div>
              <span className="text-sm text-gray-600 font-medium group-hover:text-[#E8272A] transition-colors whitespace-nowrap">
                {cat.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── TRENDING ── */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-300 mb-3">Popular right now</p>
        <div className="flex flex-wrap gap-2">
          {trending.map((term) => (
            <button key={term}
              onClick={() => router.push(`/search?q=${encodeURIComponent(term)}&region=${region}`)}
              className="px-4 py-1.5 text-sm border border-gray-200 rounded-full text-gray-500 bg-white hover:border-[#E8272A] hover:text-[#E8272A] transition-colors">
              {term}
            </button>
          ))}
        </div>
      </div>

    </main>
  );
}