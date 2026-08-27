'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

interface SuggestionTerm {
  term: string;
  type?: string;   // "Manga" | "Series" | undefined
  count: number;
}

interface SearchBarProps {
  initialQuery?: string;
  region: 'uk' | 'us';
  variant?: 'hero' | 'header';
}

// Shown on the homepage when the search bar is focused and the query is empty.
// Only displayed for the hero variant.
const POPULAR_SEARCHES = [
  'Absolute Batman',
  'Ultimate Spider-Man',
  'Batman: Dark Patterns',
  'X-Men',
  'Void Rivals',
  'Transformers',
  'Invincible',
]

// Type badge colours
const TYPE_BADGE: Record<string, { bg: string; color: string }> = {
  'Manga':  { bg: '#FEF3C7', color: '#92400E' },
  'Series': { bg: '#DBEAFE', color: '#1E40AF' },
  'Volume': { bg: '#DCFCE7', color: '#166534' },  // local-catalogue volume rows (CC-013)
}

export default function SearchBar({ initialQuery = '', region, variant = 'hero' }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SuggestionTerm[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isFocused, setIsFocused]             = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const abortRef    = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const userTypedRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  // Show the popular-searches panel when: hero variant, focused, nothing typed yet
  const showPopular = variant === 'hero' && isFocused && query.trim() === '' && suggestions.length === 0;

  useEffect(() => {
    userTypedRef.current = false;
    setQuery(initialQuery);
    setSuggestions([]);
    setShowSuggestions(false);
  }, [initialQuery]);

  useEffect(() => {
    if (!userTypedRef.current) return;
    if (query.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    clearTimeout(debounceRef.current);
    // Cancel any in-flight request so stale responses never overwrite fresh ones
    abortRef.current?.abort();

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res  = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted) return;   // response arrived after a newer request started
        const seen = new Set<string>();
        const terms: SuggestionTerm[] = [];
        for (const r of (data.results || [])) {
          const term = r.name.trim();
          if (!seen.has(term.toLowerCase())) {
            seen.add(term.toLowerCase());
            terms.push({ term, type: r.type, count: r.count || 1 });
          }
          if (terms.length >= 8) break;
        }
        setSuggestions(terms);
        setShowSuggestions(terms.length > 0);
      } catch (err) {
        // AbortError = a newer request superseded this one; don't touch state
        if (err instanceof Error && err.name === 'AbortError') return;
        setSuggestions([]);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reset suggestion dropdown on any navigation.
  useEffect(() => {
    setSuggestions([]);
    setShowSuggestions(false);
    setIsFocused(false);
    userTypedRef.current = false;
    abortRef.current?.abort();
  }, [pathname]);

  const searchUrl = (term: string) =>
    `/search?q=${encodeURIComponent(term)}&region=${region}`;

  /** Collapse the dropdown and cancel in-flight suggestion work. Called both
   *  before a programmatic navigation (the typed-query path) and on a
   *  suggestion link's click, so a stale dropdown never flashes against the
   *  new page. */
  const closeDropdown = () => {
    setShowSuggestions(false);
    setSuggestions([]);
    setIsFocused(false);
    userTypedRef.current = false;
    abortRef.current?.abort();
    clearTimeout(debounceRef.current);
  };

  /**
   * A dropdown row's click handler must NOT tear the dropdown down when the
   * gesture is a new-tab gesture.
   *
   * PROVEN 2026-08-27 (Playwright, reduced-motion, local): with an
   * unconditional `closeDropdown()` here, Ctrl+click on a suggestion opened no
   * tab AND did not navigate — nothing happened at all. React flushes a
   * discrete-event state update synchronously at the end of event dispatch,
   * so the <a> was unmounted before the browser ran the link's default
   * action, and Chromium cancels navigation for a detached anchor. A plain
   * click survives it only because the router.push-free same-document path
   * had already been handed to Next's Link.
   *
   * So: leave modified and non-primary clicks completely alone. The browser
   * owns them. Only a plain primary click — the one that really does leave
   * this page — closes the dropdown and syncs the input text.
   */
  const isNewTabGesture = (e: React.MouseEvent) =>
    e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0

  /** Typed-query submit only. Suggestion rows are real <Link>s — they never
   *  come through here, so there is no `newTab` flag to emulate: the browser
   *  handles Ctrl/⌘+click and middle-click on those natively. */
  const doSearch = (term: string) => {
    closeDropdown();
    router.push(searchUrl(term));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) doSearch(query.trim());
  };

  const handleButtonClick = () => {
    if (query.trim()) doSearch(query.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim()) doSearch(query.trim());
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const isHero = variant === 'hero';

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <form onSubmit={handleSubmit} style={{
          display: 'flex',
          alignItems: 'center',
          background: '#fff',
          borderRadius: (showSuggestions && suggestions.length > 0) || showPopular ? '18px 18px 0 0' : '999px',
          padding: isHero ? '6px 6px 6px 20px' : '4px 4px 4px 16px',
          boxShadow: isHero ? '0 8px 32px rgba(0,0,0,0.28)' : '0 1px 4px rgba(0,0,0,0.06)',
          border: isHero ? 'none' : '1px solid #E5E7EB',
          transition: 'border-radius 0.12s',
        }}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" style={{ color: '#9CA3AF', flexShrink: 0, marginRight: '10px' }}>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => { userTypedRef.current = true; setQuery(e.target.value); }}
            onKeyDown={handleKeyDown}
            onFocus={() => { setIsFocused(true); if (suggestions.length > 0) setShowSuggestions(true); }}
            // Focus moving to a row INSIDE this widget is not "leaving the
            // search box". PROVEN 2026-08-27: the unconditional version closed
            // the popular panel the instant a row took focus, which unmounted
            // the <a> before the browser ran its default action — Ctrl+click
            // and middle-click on a popular search opened nothing, 6 times out
            // of 6. relatedTarget is the correct test, and it removes the need
            // for the mousedown preventDefault hack that used to paper over it
            // (and which broke middle-click in its own right).
            onBlur={e => {
              if (wrapperRef.current?.contains(e.relatedTarget as Node | null)) return
              setIsFocused(false)
            }}
            placeholder="Search any title, character or ISBN..."
            aria-label="Search comics, characters, or ISBN"
            // No role="combobox"/aria-expanded here any more. This component
            // never implemented the ARIA combobox keyboard model (no
            // aria-controls, no aria-activedescendant, no arrow-key
            // traversal), and the matching role="option" rows below it
            // suppressed Chromium's middle-click-opens-link — see the
            // dropdown comment. A plain text input above a list of real links
            // is what this actually is, and it behaves natively.
            style={{
              flex: 1,
              // minWidth:0 is load-bearing. A flex item defaults to
              // min-width:auto, and an <input> carries an intrinsic width of
              // ~177px (its default size=20). Without this the input refuses
              // to shrink inside a narrow header, pushing the submit button
              // past the right edge of the viewport — which made the whole
              // /search page scroll sideways on a 412px phone.
              // Found by Browser Trust (tests/e2e/mobile.spec.ts).
              minWidth: 0,
              background: 'transparent',
              fontSize: '14px',
              color: '#0A0A0A',
              outline: 'none',
              padding: isHero ? '6px 0' : '4px 0',
              border: 'none',
            }}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={handleButtonClick}
            aria-label="Search"
            style={{
              width: isHero ? '42px' : '36px',
              height: isHero ? '42px' : '36px',
              borderRadius: '999px',
              background: '#E8272A',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#c41f22')}
            onMouseLeave={e => (e.currentTarget.style.background = '#E8272A')}
          >
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" style={{ color: '#fff' }} aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>

      {/* Popular searches — hero variant, empty query, focused.
          <nav> of real links, NOT role="listbox"/role="option". PROVEN
          2026-08-27 by DOM A/B in Chromium: with role="option" on the anchor
          (inside role="listbox") a middle-click opened nothing; removing
          either role restored the native new-tab open, with every other
          attribute, handler and style identical. The ARIA pattern was never
          backed by a real listbox keyboard model anyway, so honest link
          markup costs nothing and is what the browser can act on. */}
      {showPopular && (
        <nav aria-label="Popular searches" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 9999,
          background: '#fff',
          borderRadius: '0 0 18px 18px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          borderTop: '1px solid #F3F4F6',
        }}>
          <div style={{ padding: '10px 18px 6px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9CA3AF' }}>
            Popular searches
          </div>
          {POPULAR_SEARCHES.map((term, i) => (
            <Link key={term}
              href={searchUrl(term)}
              // Dropdown rows are transient and mostly not taken; prefetching
              // 7 search routes on every focus would run 7 catalogue queries.
              prefetch={false}
              onClick={e => { if (isNewTabGesture(e)) return; setQuery(term); closeDropdown() }}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 18px', cursor: 'pointer',
                borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                borderBottom: i < POPULAR_SEARCHES.length - 1 ? '1px solid #F9F9F9' : 'none',
                background: '#fff', width: '100%',
                textAlign: 'left', font: 'inherit', color: 'inherit',
                textDecoration: 'none',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F3F4F6')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" style={{ color: '#E8272A', flexShrink: 0 }} aria-hidden="true">
                <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" stroke="currentColor" strokeWidth="2"/>
                <path d="M15 11a4 4 0 11-8 0 4 4 0 018 0z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="2"/>
              </svg>
              <span style={{ flex: 1, fontSize: '13px', color: '#0A0A0A' }}>{term}</span>
              <svg width="13" height="13" fill="none" viewBox="0 0 24 24" style={{ color: '#D1D5DB', flexShrink: 0 }} aria-hidden="true">
                <path d="M7 17L17 7M17 7H7M17 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </Link>
          ))}
        </nav>
      )}

      {showSuggestions && suggestions.length > 0 && (
        <nav aria-label="Search suggestions" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 9999,
          background: '#fff',
          borderRadius: '0 0 18px 18px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          borderTop: '1px solid #F3F4F6',
        }}>
          {suggestions.map((s, i) => {
            const badge = s.type ? TYPE_BADGE[s.type] : undefined
            return (
              <Link key={i}
                href={searchUrl(s.term)}
                prefetch={false}
                onClick={e => { if (isNewTabGesture(e)) return; setQuery(s.term); closeDropdown() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '11px 18px', cursor: 'pointer',
                  borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                  borderBottom: i < suggestions.length - 1 ? '1px solid #F9F9F9' : 'none',
                  background: '#fff',
                  width: '100%',
                  textAlign: 'left',
                  font: 'inherit',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F3F4F6')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" style={{ color: '#D1D5DB', flexShrink: 0 }} aria-hidden="true">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
                  <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span style={{ flex: 1, fontSize: '13px', color: '#0A0A0A' }}>{s.term}</span>
                {badge && s.type && (
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 7px',
                    borderRadius: '999px', background: badge.bg, color: badge.color,
                    flexShrink: 0,
                  }}>
                    {s.type}
                  </span>
                )}
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" style={{ color: '#D1D5DB', flexShrink: 0 }} aria-hidden="true">
                  <path d="M7 17L17 7M17 7H7M17 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </Link>
            )
          })}
        </nav>
      )}
    </div>
  );
}
