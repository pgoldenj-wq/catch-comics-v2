'use client'

/**
 * CookieNotice — minimal honest cookie disclosure banner.
 *
 * What this IS:
 *   - A transparent notice that the site uses one cookie for affiliate tracking.
 *   - Dismissible once per browser session (stored in sessionStorage).
 *   - Links to the Privacy Policy for full details.
 *
 * What this is NOT:
 *   - A consent management platform (CMP).
 *   - A fake "Accept / Reject" banner that doesn't actually do anything.
 *   - A claim of full PECR/UK GDPR compliance.
 *
 * Cookie context: The only cookie Catch Comics sets is __cc_session, an
 * anonymous UUID placed only when you actively click an affiliate link —
 * not on page load. No analytics cookies, no advertising pixels, no
 * third-party tracking on page load.
 *
 * If you need a full consent management implementation, this component
 * should be replaced with a real CMP (e.g., Cookiebot, Usercentrics).
 */

import { useEffect, useState } from 'react'
import Link                    from 'next/link'

const STORAGE_KEY = 'cc_cookie_notice_dismissed'

export default function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem(STORAGE_KEY)
      if (!dismissed) setVisible(true)
    } catch {
      // sessionStorage blocked (private browsing restriction) — don't show
    }
  }, [])

  function dismiss() {
    try {
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      style={{
        position:       'fixed',
        bottom:          0,
        left:            0,
        right:           0,
        zIndex:          50,
        background:     '#111827',
        borderTop:      '1px solid rgba(255,255,255,0.1)',
        padding:        '12px 20px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            '16px',
        flexWrap:       'wrap',
      }}
    >
      <p
        style={{
          fontSize:  '12px',
          color:     'rgba(255,255,255,0.55)',
          lineHeight: 1.6,
          margin:     0,
          maxWidth:  '600px',
        }}
      >
        We use one cookie (<code style={code}>__cc_session</code>) for affiliate link tracking —
        set only when you click a retailer link, not on page load. No analytics or advertising
        cookies.{' '}
        <Link href="/privacy" style={{ color: '#E8272A', textDecoration: 'underline' }}>
          Privacy Policy
        </Link>
        {' '}·{' '}
        <Link href="/affiliate-disclosure" style={{ color: '#E8272A', textDecoration: 'underline' }}>
          Affiliate Disclosure
        </Link>
      </p>

      <button
        onClick={dismiss}
        aria-label="Dismiss cookie notice"
        style={{
          background:   'transparent',
          border:       '1px solid rgba(255,255,255,0.2)',
          borderRadius: '4px',
          color:        'rgba(255,255,255,0.55)',
          cursor:       'pointer',
          fontSize:     '11px',
          padding:      '5px 12px',
          flexShrink:    0,
          whiteSpace:   'nowrap',
        }}
      >
        Got it
      </button>
    </div>
  )
}

const code: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize:   '11px',
  background: 'rgba(255,255,255,0.08)',
  padding:    '1px 4px',
  borderRadius: '3px',
}
