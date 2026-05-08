'use client';
// ⚠ DESIGN FREEZE — do not change layout, spacing, colours, or typography without explicit instruction

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SearchBar from '../components/SearchBar';

type HoverZone = 'left' | 'right' | null;

// ─── Top Deals ────────────────────────────────────────────────────────────────
// Curated list of popular titles with approximate Amazon retail prices (early 2025).
// priceUK/priceUS = typical sale price  |  rrpUK/rrpUS = publisher RRP
// Replace with live pricing API when eBay/Amazon Browse API is wired in.

interface DealItem {
  id: number;
  title: string;
  publisher: string;
  format: string;
  priceUK: number;
  priceUS: number;
  rrpUK: number;
  rrpUS: number;
  searchQuery: string; // Used to construct Amazon search link
}

const TOP_DEALS: DealItem[] = [
  { id: 796,    title: 'Absolute Batman Vol. 1',     publisher: 'DC Comics',    format: 'Hardcover',     priceUK: 29.99, priceUS: 39.99, rrpUK: 37.99, rrpUS: 49.99, searchQuery: 'Absolute Batman Vol 1 Hardcover' },
  { id: 2127,   title: 'Amazing Spider-Man Vol. 1',  publisher: 'Marvel',       format: 'Graphic Novel', priceUK: 13.99, priceUS: 17.99, rrpUK: 17.99, rrpUS: 22.99, searchQuery: 'Amazing Spider-Man Wells Romita Vol 1' },
  { id: 31022,  title: 'One Piece Vol. 1',           publisher: 'Viz Media',    format: 'Manga',         priceUK: 6.99,  priceUS: 9.99,  rrpUK: 9.99,  rrpUS: 12.99, searchQuery: 'One Piece Vol 1 Manga Viz Media' },
  { id: 46568,  title: 'Saga Vol. 1',                publisher: 'Image Comics', format: 'Graphic Novel', priceUK: 9.99,  priceUS: 12.99, rrpUK: 13.99, rrpUS: 16.99, searchQuery: 'Saga Vol 1 Brian K Vaughan Image Comics' },
  { id: 111792, title: 'Jujutsu Kaisen Vol. 1',      publisher: 'Viz Media',    format: 'Manga',         priceUK: 6.99,  priceUS: 9.99,  rrpUK: 9.99,  rrpUS: 12.99, searchQuery: 'Jujutsu Kaisen Vol 1 Manga Viz' },
  { id: 2133,   title: 'X-Men: Days of Future Past', publisher: 'Marvel',       format: 'Graphic Novel', priceUK: 12.99, priceUS: 15.99, rrpUK: 16.99, rrpUS: 19.99, searchQuery: 'X-Men Days of Future Past Graphic Novel Marvel' },
  { id: 18166,  title: 'The Walking Dead Vol. 1',    publisher: 'Image Comics', format: 'Graphic Novel', priceUK: 8.99,  priceUS: 11.99, rrpUK: 12.99, rrpUS: 14.99, searchQuery: 'Walking Dead Vol 1 Image Comics Kirkman' },
  { id: 17993,  title: 'Invincible Vol. 1',          publisher: 'Image Comics', format: 'Graphic Novel', priceUK: 10.99, priceUS: 13.99, rrpUK: 13.99, rrpUS: 16.99, searchQuery: 'Invincible Vol 1 Robert Kirkman Image' },
  { id: 18836,  title: 'Naruto Vol. 1',              publisher: 'Viz Media',    format: 'Manga',         priceUK: 6.99,  priceUS: 9.99,  rrpUK: 9.99,  rrpUS: 12.99, searchQuery: 'Naruto Vol 1 Manga Viz Media Kishimoto' },
  { id: 72157,  title: 'Hellboy Omnibus Vol. 1',     publisher: 'Dark Horse',   format: 'Omnibus',       priceUK: 19.99, priceUS: 24.99, rrpUK: 24.99, rrpUS: 29.99, searchQuery: 'Hellboy Omnibus Vol 1 Dark Horse Mignola' },
];

// Open Library cover fallbacks (ISBN-keyed) for when Comic Vine is slow/unavailable
const DEAL_FALLBACKS: Record<number, string> = {
  796:    'https://covers.openlibrary.org/b/isbn/1401232590-L.jpg',
  2127:   'https://covers.openlibrary.org/b/isbn/0785115609-L.jpg',
  31022:  'https://covers.openlibrary.org/b/isbn/1569319014-L.jpg',
  46568:  'https://covers.openlibrary.org/b/isbn/1607066017-L.jpg',
  111792: 'https://covers.openlibrary.org/b/isbn/1974717747-L.jpg',
  2133:   'https://covers.openlibrary.org/b/isbn/0785140425-L.jpg',
  18166:  'https://covers.openlibrary.org/b/isbn/1582406723-L.jpg',
  17993:  'https://covers.openlibrary.org/b/isbn/1582402869-L.jpg',
  18836:  'https://covers.openlibrary.org/b/isbn/1569319006-L.jpg',
  72157:  'https://covers.openlibrary.org/b/isbn/1593070942-L.jpg',
};

function discountPercent(deal: DealItem, region: 'uk' | 'us'): number {
  const price = region === 'uk' ? deal.priceUK : deal.priceUS;
  const rrp   = region === 'uk' ? deal.rrpUK   : deal.rrpUS;
  if (rrp <= price) return 0;
  return Math.round((1 - price / rrp) * 100);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const [region, setRegion]           = useState<'uk' | 'us'>('uk');
  const [dealCovers, setDealCovers]   = useState<Record<number, string>>({});
  const [carouselOffset, setCarouselOffset] = useState(0);
  const [hoverZone, setHoverZone]     = useState<HoverZone>(null);
  const carouselRef   = useRef<HTMLDivElement>(null);
  const offsetRef     = useRef(0);
  const hoverZoneRef  = useRef<HoverZone>(null);
  const router = useRouter();

  const CARD_W = 148; // card width (136px) + gap (12px)
  const SET_W  = TOP_DEALS.length * CARD_W;

  // Fetch deal covers from Comic Vine — staggered to stay under rate limit
  useEffect(() => {
    TOP_DEALS.forEach((deal, index) => {
      setTimeout(() => {
        fetch(`/api/comic/${deal.id}`)
          .then(r => r.json())
          .then(d => {
            const img = d.comic?.image?.medium_url || d.comic?.image?.original_url;
            if (img) setDealCovers(prev => ({ ...prev, [deal.id]: img }));
          })
          .catch(() => {});
      }, index * 400);
    });
  }, []);

  // Infinite carousel — default left-scroll, speed up/reverse on hover zones
  useEffect(() => {
    offsetRef.current = SET_W;
    setCarouselOffset(SET_W);
    const tick = () => {
      const zone  = hoverZoneRef.current;
      const speed = zone === 'right' ? 0.55 : zone === 'left' ? -0.55 : 0.1;
      offsetRef.current += speed;
      if (offsetRef.current >= SET_W * 2) offsetRef.current -= SET_W;
      if (offsetRef.current <  SET_W)     offsetRef.current += SET_W;
      setCarouselOffset(offsetRef.current);
    };
    const id = setInterval(tick, 16);
    return () => clearInterval(id);
  }, [SET_W]);

  // Manual arrow scroll — snaps by one card width and keeps offset in loop range
  const scrollCarousel = (direction: 'left' | 'right') => {
    const delta = direction === 'left' ? -CARD_W : CARD_W;
    let next = offsetRef.current + delta;
    if (next >= SET_W * 2) next -= SET_W;
    if (next < SET_W)      next += SET_W;
    offsetRef.current = next;
    setCarouselOffset(next);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect      = e.currentTarget.getBoundingClientRect();
    const x         = e.clientX - rect.left;
    const threshold = rect.width * 0.2;
    const zone: HoverZone = x < threshold ? 'left' : x > rect.width - threshold ? 'right' : null;
    hoverZoneRef.current = zone;
    setHoverZone(zone);
  };

  // Hero book covers — rotation lives in CSS class (not inline style) so animation works
  const covers = [
    { title: 'Absolute Batman',     searchQuery: 'absolute batman',     src: 'https://comicvine.gamespot.com/a/uploads/scale_large/14/149814/9881791-absbm_v1_zoo%28cover%29copy.jpg', left: '8px',   top: '22px', width: '170px', height: '248px', zIndex: 3, animClass: 'cover-sway-1' },
    { title: 'Ultimate Spider-Man', searchQuery: 'ultimate spider-man', src: 'https://comicvine.gamespot.com/a/uploads/scale_large/11/110017/9226620-wwww.jpg',                        left: '148px', top: '0px',  width: '184px', height: '267px', zIndex: 5, animClass: 'cover-sway-2' },
    { title: 'Jujutsu Kaisen',      searchQuery: 'jujutsu kaisen',      src: 'https://comicvine.gamespot.com/a/uploads/scale_large/6/67663/6491809-01.jpg',                            left: '300px', top: '30px', width: '165px', height: '238px', zIndex: 3, animClass: 'cover-sway-3' },
  ];

  // Publisher logo strip — fills normalised to rgba(255,255,255,0.7) so each logo
  // clears AA contrast (~6.9:1) on the dark hero (#111827). Marvel keeps its boxed
  // glyph for brand emphasis at full white. Parent opacity multiplier removed so
  // declared values render as-stated (was *0.65, dragging some logos to ~0.3 — barely
  // visible and well under contrast threshold; specifically failed for VALIANT,
  // SEVEN SEAS, DYNAMITE).
  const publisherLogos = [
    <svg key="marvel"    viewBox="0 0 58 28"  width="58"  height="28"><rect x="1" y="4" width="56" height="20" rx="2.5" fill="rgba(255,255,255,0.22)"/><text x="29" y="18.5" textAnchor="middle" fontSize="9.5" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="white" letterSpacing="0.8">MARVEL</text></svg>,
    <svg key="dc"        viewBox="0 0 40 28"  width="40"  height="28"><text x="20" y="20" textAnchor="middle" fontSize="16" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="rgba(255,255,255,0.78)" letterSpacing="1">DC</text></svg>,
    <svg key="image"     viewBox="0 0 72 28"  width="72"  height="28"><text x="36" y="19" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="2">IMAGE</text></svg>,
    <svg key="darkhorse" viewBox="0 0 96 28"  width="96"  height="28"><text x="48" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">DARK HORSE</text></svg>,
    <svg key="viz"       viewBox="0 0 52 28"  width="52"  height="28"><text x="26" y="21" textAnchor="middle" fontSize="15" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="rgba(255,255,255,0.78)" letterSpacing="1">VIZ</text></svg>,
    <svg key="idw"       viewBox="0 0 48 28"  width="48"  height="28"><text x="24" y="21" textAnchor="middle" fontSize="13" fontWeight="900" fontFamily="Arial Black,Impact,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1">IDW</text></svg>,
    <svg key="boom"      viewBox="0 0 110 28" width="110" height="28"><text x="55" y="19" textAnchor="middle" fontSize="9.5" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">BOOM! STUDIOS</text></svg>,
    <svg key="vertigo"   viewBox="0 0 72 28"  width="72"  height="28"><text x="36" y="19" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="2" transform="skewX(-6)">VERTIGO</text></svg>,
    <svg key="kodansha"  viewBox="0 0 84 28"  width="84"  height="28"><text x="42" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">KODANSHA</text></svg>,
    <svg key="shueisha"  viewBox="0 0 80 28"  width="80"  height="28"><text x="40" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">SHUEISHA</text></svg>,
    <svg key="yenpress"  viewBox="0 0 84 28"  width="84"  height="28"><text x="42" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">YEN PRESS</text></svg>,
    <svg key="valiant"   viewBox="0 0 68 28"  width="68"  height="28"><text x="34" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="2">VALIANT</text></svg>,
    <svg key="sevenseas" viewBox="0 0 90 28"  width="90"  height="28"><text x="45" y="19" textAnchor="middle" fontSize="8.5" fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">SEVEN SEAS</text></svg>,
    <svg key="dynamite"  viewBox="0 0 80 28"  width="80"  height="28"><text x="40" y="19" textAnchor="middle" fontSize="9"  fontWeight="700" fontFamily="Arial,sans-serif" fill="rgba(255,255,255,0.7)" letterSpacing="1.5">DYNAMITE</text></svg>,
  ];

  // Popular search terms — clicking always navigates to a fresh search page
  const trending = ['Batman', 'Spider-Man', 'One Piece', 'Saga', 'Watchmen', 'Naruto', 'X-Men', 'Invincible', 'Demon Slayer', 'Hellboy'];

  // viewBox adds vertical padding so flags have breathing room inside the circular button.
  // US flag uses xMinYMid to show the left (canton / stars) rather than the centre stripe area.
  // slice fills the circular container; xMid/xMin controls which part of the flag is shown.
  // UK: centre the Union Jack in the circle.
  // US: show the left side (canton / stars) rather than the centre stripe area.
  const UKFlag = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-label="UK flag">
      <path d="M0 0v30h60V0z" fill="#012169"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="4"/>
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10"/>
      <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6"/>
    </svg>
  );

  // 5-point star polygon — outer radius 1.2, inner 0.46, centred at origin.
  const STAR_5_POINTS = "0,-1.2 0.27,-0.37 1.14,-0.37 0.44,0.14 0.71,0.97 0,0.46 -0.71,0.97 -0.44,0.14 -1.14,-0.37 -0.27,-0.37"

  const USFlag = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMinYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-label="US flag">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">
        {[...Array(5)].map((_, row) =>
          [...Array(row % 2 === 0 ? 6 : 5)].map((_, col) => {
            const cx = row % 2 === 0 ? 2 + col * 4 : 4 + col * 4
            const cy = 2 + row * 3
            return <polygon key={`${row}-${col}`} points={STAR_5_POINTS} transform={`translate(${cx} ${cy})`} />
          })
        )}
      </g>
    </svg>
  );

  const currency = region === 'uk' ? '£' : '$';

  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>
      <style>{`
        @keyframes scrollPublishers {
          0%   { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
        .pub-track {
          display: flex; align-items: center; width: max-content;
          animation: scrollPublishers 60s linear infinite;
          will-change: transform;
        }
        /* ── Comic cover sway animations ───────────────────────────────────
           Base rotation lives here (not in inline style) so CSS animation
           can override it. Each cover has a unique rhythm and delay so they
           feel independent and natural rather than in sync.
        ─────────────────────────────────────────────────────────────────── */
        .cover-sway-1 {
          transform: rotate(-5deg);
          animation: sway1 6s ease-in-out infinite;
        }
        .cover-sway-2 {
          transform: rotate(2deg);
          animation: sway2 7.5s ease-in-out infinite 0.8s;
        }
        .cover-sway-3 {
          transform: rotate(-3deg);
          animation: sway3 8.5s ease-in-out infinite 1.5s;
        }
        @keyframes sway1 {
          0%, 100% { transform: rotate(-5deg)   translateY(0px); }
          50%       { transform: rotate(-6.8deg) translateY(-3px); }
        }
        @keyframes sway2 {
          0%, 100% { transform: rotate(2deg)   translateY(0px); }
          50%       { transform: rotate(3.8deg) translateY(-4px); }
        }
        @keyframes sway3 {
          0%, 100% { transform: rotate(-3deg)   translateY(0px); }
          50%       { transform: rotate(-1.5deg) translateY(-2px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .cover-sway-1 { animation: none; transform: rotate(-5deg); }
          .cover-sway-2 { animation: none; transform: rotate(2deg);  }
          .cover-sway-3 { animation: none; transform: rotate(-3deg); }
        }

        /* ── Mobile hero: hide covers, full-width copy + search ─────────── */
        @media (max-width: 768px) {
          .hero-right { display: none !important; }
          .hero-left  { width: 100% !important; padding: 36px 28px !important; }
        }
      `}</style>

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
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

      {/* ── HERO CARD ───────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-4">
        <div style={{ background: '#111827', borderRadius: '28px', minHeight: '420px', overflow: 'visible', position: 'relative', display: 'flex', alignItems: 'stretch' }}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
          <div style={{ position: 'absolute', top: '-80px', right: '-80px', width: '420px', height: '420px', pointerEvents: 'none', background: 'radial-gradient(circle, rgba(232,39,42,0.14) 0%, transparent 65%)' }} />

          {/* LEFT — copy + search + category hints */}
          <div className="hero-left" style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '48px', width: '50%', flexShrink: 0 }}>
            <p style={{ color: '#E8272A', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '20px' }}>
              The world's only comic price comparison
            </p>
            <h1 style={{ color: '#fff', fontSize: 'clamp(2rem,3.5vw,3rem)', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: '14px' }}>
              Search, compare,<br />save on comics
            </h1>
            <p style={{ color: '#fff', fontSize: '14px', lineHeight: 1.6, marginBottom: '28px', maxWidth: '320px' }}>
              Every comic, graphic novel and manga — compared across the web in seconds.
            </p>

            {/* Search bar */}
            <div style={{ maxWidth: '420px' }}>
              <SearchBar region={region} variant="hero" />
            </div>

            {/* Category hint pills — directly under search bar, non-interactive */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
              {['Graphic Novels', 'Manga', 'Single Issues'].map(cat => (
                /* Text bumped to 0.7 opacity (≈6.9:1 on the dark hero) so the chips
                   actually pass AA without becoming visually loud. Border lifted to
                   0.18 for a subtle but readable edge. Background stays at 0.07 — it's
                   pure decoration and not subject to text-contrast rules. */
                <span key={cat} style={{
                  fontSize: '11px', padding: '4px 12px', borderRadius: '999px',
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: 'rgba(255,255,255,0.7)',
                  userSelect: 'none',
                }}>
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {/* RIGHT — book covers + publisher strip.
              overflow:visible so covers can scale beyond container bounds on hover. */}
          <div className="hero-right" style={{ position: 'relative', flex: 1, overflow: 'visible', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: '0 28px 28px 0' }}>
            {/* Right-edge fade so covers dissolve naturally into the card border */}
            <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '56px', zIndex: 20, pointerEvents: 'none', background: 'linear-gradient(to left, #111827 0%, transparent 100%)' }} />

            {/* Cover stack — height is a flex spacer; covers are absolutely positioned.
                Each cover has a wrapper div that handles hover-scale so the whole frame
                (including border-radius) enlarges by 15%. The inner button retains its
                CSS sway animation independently — scale on the wrapper does not conflict. */}
            <div style={{ position: 'relative', height: '280px' }}>
              {covers.map((cover, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: cover.left,
                    top: cover.top,
                    width: cover.width,
                    height: cover.height,
                    zIndex: cover.zIndex,
                    transformOrigin: 'center center',
                    transition: 'transform 0.25s ease-out, z-index 0s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'scale(1.15)'
                    e.currentTarget.style.zIndex = '20'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.zIndex = String(cover.zIndex)
                  }}
                >
                  <button
                    className={cover.animClass}
                    onClick={() => router.push(`/search?q=${encodeURIComponent(cover.searchQuery)}&region=${region}`)}
                    aria-label={`Search for ${cover.title}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      boxShadow: '0 24px 56px rgba(0,0,0,0.65)',
                      background: '#1a1a2e',
                      cursor: 'pointer',
                      padding: 0,
                      border: 'none',
                      display: 'block',
                    }}>
                    <img
                      src={cover.src}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }}
                    />
                  </button>
                </div>
              ))}
            </div>

            {/* Publisher logo strip — wrapped in its own overflow:hidden so the
                strip scrolls cleanly after hero-right was changed to overflow:visible. */}
            <div aria-hidden="true" style={{ position: 'relative', marginTop: '14px', height: '36px', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', left: 0,  top: 0, bottom: 0, width: '32px', zIndex: 2, pointerEvents: 'none', background: 'linear-gradient(to right, #111827 0%, transparent 100%)' }} />
              <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '32px', zIndex: 2, pointerEvents: 'none', background: 'linear-gradient(to left,  #111827 0%, transparent 100%)' }} />
              <div className="pub-track">
                {[...publisherLogos, ...publisherLogos].map((logo, i) => (
                  /* No parent opacity — each logo SVG already encodes its target alpha
                     so contrast survives. Was *0.65, which dragged faint logos to ~0.3 alpha. */
                  <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '0 20px', flexShrink: 0 }}>{logo}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── TOP DEALS ───────────────────────────────────────────────────────── */}
      {/* Immediately below hero — tight spacing so deals are visible on load */}
      <div className="max-w-6xl mx-auto px-6 pt-4 pb-2">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '16px', flexWrap: 'wrap' }}>
          {/* Left — section title */}
          <div style={{ flexShrink: 0 }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#111', margin: 0 }}>Top deals today</h2>
            <p style={{ fontSize: '11px', color: '#6B7280', margin: '2px 0 0' }}>
              Prices updated daily
            </p>
          </div>
          {/* Right — popular search tags, low visual weight */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7280', flexShrink: 0 }}>Popular:</span>
            {trending.map((term) => (
              <button key={term}
                onClick={() => router.push(`/search?q=${encodeURIComponent(term)}&region=${region}`)}
                style={{ padding: '3px 11px', fontSize: '11px', border: '1px solid #EAECEF', borderRadius: '999px', color: '#6B7280', background: '#fff', cursor: 'pointer', transition: 'border-color 0.15s, color 0.15s', fontFamily: 'inherit', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#E8272A'; e.currentTarget.style.color = '#E8272A'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#EAECEF'; e.currentTarget.style.color = '#6B7280'; }}>
                {term}
              </button>
            ))}
          </div>
        </div>

        <div
          ref={carouselRef}
          style={{ overflow: 'hidden', position: 'relative', cursor: hoverZone ? 'ew-resize' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { hoverZoneRef.current = null; setHoverZone(null); }}>

          {hoverZone === 'left'  && <div style={{ position: 'absolute', left:  0, top: 0, bottom: 0, width: '20%', zIndex: 3, background: 'linear-gradient(to right, rgba(232,39,42,0.04), transparent)', pointerEvents: 'none' }} />}
          {hoverZone === 'right' && <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '20%', zIndex: 3, background: 'linear-gradient(to left,  rgba(232,39,42,0.04), transparent)', pointerEvents: 'none' }} />}
          <div style={{ position: 'absolute', left:  0, top: 0, bottom: 0, width: '40px', zIndex: 2, background: 'linear-gradient(to right, #F8F8F6, transparent)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40px', zIndex: 2, background: 'linear-gradient(to left,  #F8F8F6, transparent)', pointerEvents: 'none' }} />

          {/* ── Manual arrow buttons — sit above gradients (z-index 4) ── */}
          <button
            onClick={() => scrollCarousel('left')}
            aria-label="Scroll left"
            style={{
              position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)',
              zIndex: 4, width: '28px', height: '28px', borderRadius: '50%',
              background: '#fff', border: '1px solid #E5E7EB',
              boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 6px rgba(0,0,0,0.10)'; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" stroke="#374151" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            onClick={() => scrollCarousel('right')}
            aria-label="Scroll right"
            style={{
              position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
              zIndex: 4, width: '28px', height: '28px', borderRadius: '50%',
              background: '#fff', border: '1px solid #E5E7EB',
              boxShadow: '0 1px 6px rgba(0,0,0,0.10)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'box-shadow 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 6px rgba(0,0,0,0.10)'; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 18l6-6-6-6" stroke="#374151" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* 3 copies for seamless infinite loop */}
          <div style={{ display: 'flex', gap: '12px', transform: `translateX(-${carouselOffset}px)`, willChange: 'transform' }}>
            {[...TOP_DEALS, ...TOP_DEALS, ...TOP_DEALS].map((deal, i) => {
              const price   = region === 'uk' ? deal.priceUK : deal.priceUS;
              const rrp     = region === 'uk' ? deal.rrpUK   : deal.rrpUS;
              const pct     = discountPercent(deal, region);
              const hasSale = pct > 0;

              return (
                <button key={i} className="deal-card"
                  onClick={() => router.push(`/comic/${deal.id}?region=${region}`)}
                  style={{ flexShrink: 0, width: '136px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>

                  {/* Cover */}
                  <div style={{ width: '136px', height: '185px', borderRadius: '10px', overflow: 'hidden', background: '#1a1a2e', position: 'relative', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginBottom: '8px' }}>
                    <img
                      src={dealCovers[deal.id] || DEAL_FALLBACKS[deal.id] || ''}
                      alt={deal.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        const fb  = DEAL_FALLBACKS[deal.id];
                        if (fb && img.src !== fb) img.src = fb;
                        else img.style.display = 'none';
                      }}
                    />

                    {/* Discount badge — uses the slightly darker brand red (#C41F22, also used
                        as the search button hover) so 10px white text clears AA's 4.5:1
                        threshold. The primary brand red (#E8272A) is unchanged elsewhere. */}
                    {hasSale && (
                      <div style={{ position: 'absolute', top: '8px', left: '8px', background: '#C41F22', color: '#fff', fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '5px' }}>
                        -{pct}%
                      </div>
                    )}
                  </div>

                  {/* Title */}
                  <div style={{ fontSize: '12px', fontWeight: 500, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {deal.title}
                  </div>

                  {/* Publisher */}
                  <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>
                    {deal.publisher}
                  </div>

                  {/* Price row */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px', marginTop: '5px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 700, color: '#C41F22' }}>
                      {currency}{price.toFixed(2)}
                    </span>
                    {hasSale && (
                      <span style={{ fontSize: '10px', color: '#6B7280', textDecoration: 'line-through' }}>
                        {currency}{rrp.toFixed(2)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

    </main>
  );
}
