'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SearchBar from '../components/SearchBar';

type HoverZone = 'left' | 'right' | null;
const TOP_DEALS = [
  { id: 796,    title: 'Batman',             publisher: 'DC Comics',    discount: '-15%' },
  { id: 2127,   title: 'Amazing Spider-Man', publisher: 'Marvel',       discount: '-20%' },
  { id: 31022,  title: 'One Piece',          publisher: 'Viz Media',    discount: '-12%' },
  { id: 46568,  title: 'Saga',               publisher: 'Image Comics', discount: '-18%' },
  { id: 111792, title: 'Jujutsu Kaisen',     publisher: 'Viz Media',    discount: '-10%' },
  { id: 2133,   title: 'X-Men',              publisher: 'Marvel',       discount: '-22%' },
  { id: 18166,  title: 'The Walking Dead',   publisher: 'Image Comics', discount: '-30%' },
  { id: 17993,  title: 'Invincible',         publisher: 'Image Comics', discount: '-14%' },
  { id: 18836,  title: 'Naruto',             publisher: 'Viz Media',    discount: '-16%' },
  { id: 72157,  title: 'Hellboy',            publisher: 'Dark Horse',   discount: '-25%' },
];

export default function Home() {
  const [region, setRegion] = useState<'uk' | 'us'>('uk');
  const [dealCovers, setDealCovers] = useState<Record<number, string>>({});
  const [carouselOffset, setCarouselOffset] = useState(0);
  const [hoverZone, setHoverZone] = useState<HoverZone>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const hoverZoneRef = useRef<HoverZone>(null);
  const router = useRouter();



  const CARD_W = 148;
  const SET_W = TOP_DEALS.length * CARD_W;

  // Fetch deal covers from Comic Vine
  useEffect(() => {
    TOP_DEALS.forEach((deal) => {
      fetch(`/api/comic/${deal.id}`)
        .then(r => r.json())
        .then(d => {
          const img = d.comic?.image?.medium_url || d.comic?.image?.original_url;
          if (img) setDealCovers(prev => ({ ...prev, [deal.id]: img }));
        })
        .catch(() => {});
    });
  }, []);

  // Carousel — LEFT→RIGHT default, starts in middle copy for seamless wrap
  useEffect(() => {
    offsetRef.current = SET_W;
    setCarouselOffset(SET_W);
    const tick = () => {
      const zone = hoverZoneRef.current;
      const speed = zone === 'right' ? 0.55 : zone === 'left' ? -0.55 : -0.1;
      offsetRef.current += speed;
      if (offsetRef.current >= SET_W * 2) offsetRef.current -= SET_W;
      if (offsetRef.current < SET_W) offsetRef.current += SET_W;
      setCarouselOffset(offsetRef.current);
    };
    const id = setInterval(tick, 16);
    return () => clearInterval(id);
  }, [SET_W]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const threshold = rect.width * 0.2;
    const zone: HoverZone = x < threshold ? 'left' : x > rect.width - threshold ? 'right' : null;
    hoverZoneRef.current = zone;
    setHoverZone(zone);
  };

  const covers = [
    { title: 'Absolute Batman',    src: 'https://comicvine.gamespot.com/a/uploads/scale_large/14/149814/9881791-absbm_v1_zoo%28cover%29copy.jpg', rotate: '-5deg', left: '30px',  top: '8px',  width: '120px', height: '173px', zIndex: 3 },
    { title: 'Ultimate Spider-Man',src: 'https://comicvine.gamespot.com/a/uploads/scale_large/11/110017/9226620-wwww.jpg',                         rotate: '2deg',  left: '175px', top: '-3px', width: '129px', height: '187px', zIndex: 5 },
    { title: 'Jujutsu Kaisen',     src: 'https://comicvine.gamespot.com/a/uploads/scale_large/6/67663/6491809-01.jpg',                             rotate: '-3deg', left: '330px', top: '14px', width: '116px', height: '167px', zIndex: 3 },
  ];

  const publisherLogos = [
    <svg key="marvel"    viewBox="0 0 58 28"  width="58"  height="28"><rect x="1" y="4" width="56" height="20" rx="2.5" fill="rgba(255,255,255,0.18)"/><text x="29" y="18.5" textAnchor="middle" fontSize="9.5" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="white" letterSpacing="0.8">MARVEL</text></svg>,
    <svg key="dc"        viewBox="0 0 40 28"  width="40"  height="28"><text x="20" y="20" textAnchor="middle" fontSize="16" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1">DC</text></svg>,
    <svg key="image"     viewBox="0 0 72 28"  width="72"  height="28"><text x="36" y="19" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.6)" letterSpacing="2">IMAGE</text></svg>,
    <svg key="darkhorse" viewBox="0 0 96 28"  width="96"  height="28"><text x="48" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.55)" letterSpacing="1.5">DARK HORSE</text></svg>,
    <svg key="viz"       viewBox="0 0 52 28"  width="52"  height="28"><text x="26" y="21" textAnchor="middle" fontSize="15" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="rgba(255,255,255,0.65)" letterSpacing="1">VIZ</text></svg>,
    <svg key="idw"       viewBox="0 0 48 28"  width="48"  height="28"><text x="24" y="21" textAnchor="middle" fontSize="13" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="rgba(255,255,255,0.55)" letterSpacing="1">IDW</text></svg>,
    <svg key="boom"      viewBox="0 0 110 28" width="110" height="28"><text x="55" y="19" textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.55)" letterSpacing="1.5">BOOM! STUDIOS</text></svg>,
    <svg key="vertigo"   viewBox="0 0 72 28"  width="72"  height="28"><text x="36" y="19" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.5)" letterSpacing="2" transform="skewX(-6)">VERTIGO</text></svg>,
    <svg key="kodansha"  viewBox="0 0 84 28"  width="84"  height="28"><text x="42" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.5)" letterSpacing="1.5">KODANSHA</text></svg>,
    <svg key="shueisha"  viewBox="0 0 80 28"  width="80"  height="28"><text x="40" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.5)" letterSpacing="1.5">SHUEISHA</text></svg>,
    <svg key="yenpress"  viewBox="0 0 84 28"  width="84"  height="28"><text x="42" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.5)" letterSpacing="1.5">YEN PRESS</text></svg>,
    <svg key="valiant"   viewBox="0 0 68 28"  width="68"  height="28"><text x="34" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.5)" letterSpacing="2">VALIANT</text></svg>,
    <svg key="sevenseas" viewBox="0 0 90 28"  width="90"  height="28"><text x="45" y="19" textAnchor="middle" fontSize="8.5" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.45)" letterSpacing="1.5">SEVEN SEAS</text></svg>,
    <svg key="dynamite"  viewBox="0 0 80 28"  width="80"  height="28"><text x="40" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.45)" letterSpacing="1.5">DYNAMITE</text></svg>,
  ];

  const categories = [
    { label: 'Graphic Novels', icon: <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><rect x="2" y="5" width="9" height="14" rx="1.5" stroke="#E8272A" strokeWidth="1.5"/><rect x="7" y="3" width="9" height="14" rx="1.5" stroke="#E8272A" strokeWidth="1.5" fill="rgba(232,39,42,0.06)"/><rect x="12" y="6" width="9" height="14" rx="1.5" stroke="#E8272A" strokeWidth="1.5" fill="rgba(232,39,42,0.1)"/></svg> },
    { label: 'Manga', icon: <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><path d="M12 5 C9 4.5 5 5.5 3 7 L3 20 C5 18.5 9 19 12 20 C15 19 19 18.5 21 20 L21 7 C19 5.5 15 4.5 12 5Z" stroke="#E8272A" strokeWidth="1.5" fill="rgba(232,39,42,0.08)" strokeLinejoin="round"/><line x1="12" y1="5" x2="12" y2="20" stroke="#E8272A" strokeWidth="1.5" strokeLinecap="round"/></svg> },
    { label: 'Single Issues', icon: <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5"><rect x="4" y="2" width="16" height="20" rx="2" stroke="#E8272A" strokeWidth="1.5"/><rect x="4" y="2" width="16" height="6" rx="2" fill="rgba(232,39,42,0.15)" stroke="none"/><line x1="4" y1="8" x2="20" y2="8" stroke="#E8272A" strokeWidth="1.5"/><line x1="7" y1="12.5" x2="17" y2="12.5" stroke="#E8272A" strokeWidth="1.3" strokeLinecap="round"/><line x1="7" y1="16" x2="13" y2="16" stroke="#E8272A" strokeWidth="1.3" strokeLinecap="round"/></svg> },
  ];

  const trending = ['Batman', 'Spider-Man', 'One Piece', 'Saga', 'Watchmen', 'Naruto', 'X-Men', 'Invincible', 'Demon Slayer', 'Hellboy'];

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
            <circle key={`${row}-${col}`} cx={row % 2 === 0 ? 2 + col * 4 : 4 + col * 4} cy={2 + row * 3} r="0.9"/>
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
          display: flex; align-items: center; width: max-content;
          animation: scrollPublishers 60s linear infinite;
          will-change: transform;
        }
        .deal-card:hover .deal-overlay { opacity: 1 !important; }
      `}</style>

      {/* HEADER */}
      <header style={{ background: '#fff', borderBottom: '1px solid #F0F0F0', position: 'relative', zIndex: 10 }}>
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center justify-between">
          <a href="/"><img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" /></a>
          <div className="flex items-center gap-3">
            <button onClick={() => setRegion('uk')}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{ borderColor: region === 'uk' ? '#0A0A0A' : '#E5E7EB', background: region === 'uk' ? '#0A0A0A' : '#fff' }}>
              <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0" style={{ width: '32px', height: '32px', background: '#f3f4f6' }}><UKFlag /></span>
              <span className="text-sm font-medium" style={{ color: region === 'uk' ? '#fff' : '#6B7280' }}>United Kingdom</span>
            </button>
            <button onClick={() => setRegion('us')}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{ borderColor: region === 'us' ? '#0A0A0A' : '#E5E7EB', background: region === 'us' ? '#0A0A0A' : '#fff' }}>
              <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0" style={{ width: '32px', height: '32px', background: '#f3f4f6' }}><USFlag /></span>
              <span className="text-sm font-medium" style={{ color: region === 'us' ? '#fff' : '#6B7280' }}>United States</span>
            </button>
          </div>
        </div>
      </header>

      {/* HERO CARD */}
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-4">
        <div style={{ background: '#111827', borderRadius: '28px', minHeight: '420px', overflow: 'visible', position: 'relative', display: 'flex', alignItems: 'stretch' }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div style={{ position: 'absolute', top: '-80px', right: '-80px', width: '420px', height: '420px', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(232,39,42,0.14) 0%, transparent 65%)' }} />

          {/* LEFT */}
          <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '48px', width: '50%', flexShrink: 0 }}>
            <p style={{ color: '#E8272A', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '20px' }}>
              The world's only comic price comparison
            </p>
            <h1 style={{ color: '#fff', fontSize: 'clamp(2rem,3.5vw,3rem)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '14px' }}>
              Search, compare,<br />save on comics
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.42)', fontSize: '14px', lineHeight: 1.6, marginBottom: '32px', maxWidth: '320px' }}>
              Every comic, graphic novel and manga — compared across the web in seconds.
            </p>
            <div style={{ maxWidth: '420px' }}>
              <SearchBar region={region} variant="hero" />
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ position: 'relative', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: '0 28px 28px 0' }}>
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '48px', zIndex: 20, pointerEvents: 'none', background: 'linear-gradient(to left, #111827 0%, transparent 100%)' }} />
            <div style={{ position: 'relative', height: '220px', marginTop: '0' }}>
              {covers.map((cover, i) => (
                <div key={i} style={{ position: 'absolute', left: cover.left, top: cover.top, width: cover.width, height: cover.height, borderRadius: '8px', overflow: 'hidden', transform: `rotate(${cover.rotate})`, boxShadow: '0 20px 50px rgba(0,0,0,0.6)', zIndex: cover.zIndex, background: '#1a1a2e' }}>
                  <img src={cover.src} alt={cover.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }} />
                </div>
              ))}
            </div>
            <div style={{ position: 'relative', marginTop: '8px', marginLeft: '30px', width: '460px', overflow: 'hidden', height: '36px' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '32px', zIndex: 2, pointerEvents: 'none', background: 'linear-gradient(to right, #111827 0%, transparent 100%)' }} />
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '32px', zIndex: 2, pointerEvents: 'none', background: 'linear-gradient(to left, #111827 0%, transparent 100%)' }} />
              <div className="pub-track">
                {[...publisherLogos, ...publisherLogos].map((logo, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '0 20px', flexShrink: 0, opacity: 0.65 }}>{logo}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CATEGORIES */}
      <div className="max-w-6xl mx-auto px-6 pt-5 pb-2">
        <div className="flex gap-3">
          {categories.map((cat) => (
            <div key={cat.label} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 20px', background: '#fff', borderRadius: '14px', border: '1px solid #EBEBEB', cursor: 'default', userSelect: 'none' }}>
              {cat.icon}
              <span style={{ fontSize: '13px', color: '#374151', fontWeight: 500, whiteSpace: 'nowrap' }}>{cat.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* TOP DEALS */}
      <div className="max-w-6xl mx-auto px-6 pt-6 pb-2">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111' }}>Top deals today</h2>
          <button style={{ fontSize: '12px', color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer' }}>See all →</button>
        </div>

        <div ref={carouselRef}
          style={{ overflow: 'hidden', position: 'relative', cursor: hoverZone ? 'ew-resize' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { hoverZoneRef.current = null; setHoverZone(null); }}>

          {hoverZone === 'left'  && <div style={{ position: 'absolute', left: 0,  top: 0, bottom: 0, width: '20%', zIndex: 3, background: 'linear-gradient(to right, rgba(232,39,42,0.04), transparent)', pointerEvents: 'none' }} />}
          {hoverZone === 'right' && <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '20%', zIndex: 3, background: 'linear-gradient(to left,  rgba(232,39,42,0.04), transparent)', pointerEvents: 'none' }} />}
          <div style={{ position: 'absolute', left: 0,  top: 0, bottom: 0, width: '40px', zIndex: 2, background: 'linear-gradient(to right, #F8F8F6, transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40px', zIndex: 2, background: 'linear-gradient(to left,  #F8F8F6, transparent)', pointerEvents: 'none' }} />

          {/* 3 copies for seamless infinite loop */}
          <div style={{ display: 'flex', gap: '12px', transform: `translateX(-${carouselOffset}px)`, willChange: 'transform' }}>
            {[...TOP_DEALS, ...TOP_DEALS, ...TOP_DEALS].map((deal, i) => (
              <button key={i} className="deal-card"
                onClick={() => router.push(`/comic/${deal.id}?region=${region}`)}
                style={{ flexShrink: 0, width: '136px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <div style={{ width: '136px', height: '194px', borderRadius: '10px', overflow: 'hidden', background: '#1a1a2e', position: 'relative', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginBottom: '8px' }}>
                  {dealCovers[deal.id] && (
                    <img src={dealCovers[deal.id]} alt={deal.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  <div style={{ position: 'absolute', top: '8px', left: '8px', background: '#E8272A', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '5px' }}>{deal.discount}</div>
                  <div className="deal-overlay" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', padding: '6px 8px', opacity: 0, transition: 'opacity 0.2s', textAlign: 'center' }}>
                    <span style={{ fontSize: '10px', color: '#fff', fontWeight: 600 }}>Compare prices</span>
                  </div>
                </div>
                <div style={{ fontSize: '12px', fontWeight: 500, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{deal.title}</div>
                <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>{deal.publisher}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* TRENDING */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <p style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#C9CDD4', marginBottom: '12px' }}>Popular right now</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {trending.map((term) => (
            <button key={term}
              onClick={() => router.push(`/search?q=${encodeURIComponent(term)}&region=${region}`)}
              style={{ padding: '6px 16px', fontSize: '13px', border: '1px solid #E5E7EB', borderRadius: '999px', color: '#6B7280', background: '#fff', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8272A'; e.currentTarget.style.color = '#E8272A'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.color = '#6B7280'; }}
            >{term}</button>
          ))}
        </div>
      </div>
    </main>
  );
}