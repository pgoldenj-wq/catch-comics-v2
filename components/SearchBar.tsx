'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

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

// Type badge colours
const TYPE_BADGE: Record<string, { bg: string; color: string }> = {
  'Manga':  { bg: '#FEF3C7', color: '#92400E' },
  'Series': { bg: '#DBEAFE', color: '#1E40AF' },
}

export default function SearchBar({ initialQuery = '', region, variant = 'hero' }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SuggestionTerm[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef    = useRef<AbortController | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const userTypedRef = useRef(false);
  const router = useRouter();

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

  const doSearch = (term: string, newTab = false) => {
    const url = `/search?q=${encodeURIComponent(term)}&region=${region}`;
    if (newTab) window.open(url, '_blank');
    else router.push(url);
    setShowSuggestions(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) doSearch(query.trim());
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    if (query.trim()) doSearch(query.trim(), e.ctrlKey || e.metaKey);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim()) doSearch(query.trim(), e.ctrlKey || e.metaKey);
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
          borderRadius: showSuggestions && suggestions.length > 0 ? '18px 18px 0 0' : '999px',
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
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            placeholder="Search any title, character or ISBN..."
            style={{
              flex: 1,
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
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" style={{ color: '#fff' }}>
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>

      {showSuggestions && suggestions.length > 0 && (
        <div style={{
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
              <div key={i}
                onClick={() => { setQuery(s.term); doSearch(s.term); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '11px 18px', cursor: 'pointer',
                  borderBottom: i < suggestions.length - 1 ? '1px solid #F9F9F9' : 'none',
                  background: '#fff',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#F3F4F6')}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" style={{ color: '#D1D5DB', flexShrink: 0 }}>
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
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" style={{ color: '#D1D5DB', flexShrink: 0 }}>
                  <path d="M7 17L17 7M17 7H7M17 7v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </div>
            )
          })}
        </div>
      )}
    </div>
  );
}
