import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Catch Comics collects, uses, and protects your data.',
}

export default function PrivacyPage() {
  return (
    <main style={{ background: '#111827', minHeight: '100vh', color: '#F8F8F6', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '64px 24px' }}>

        <a href="/" style={{ color: '#E8272A', fontSize: '13px', textDecoration: 'none', display: 'inline-block', marginBottom: '40px' }}>
          ← Back to Catch Comics
        </a>

        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '8px' }}>
          Privacy Policy
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px', marginBottom: '48px' }}>
          Last updated: 8 June 2026
        </p>

        <Section title="Who we are">
          <p>
            Catch Comics (<strong>we</strong>, <strong>us</strong>, <strong>our</strong>) is a
            price-comparison service for comics, graphic novels, and manga, operated as an independent
            project based in the United Kingdom. This policy applies to all visitors to{' '}
            <strong>catchcomics.com</strong> and any associated subdomains.
          </p>
          <p style={{ marginTop: '12px' }}>
            We are not registered with the Information Commissioner&apos;s Office (ICO) as a data
            controller at this time, as we do not hold personal data that requires registration.
            We intend to register if our data-processing activities change.
          </p>
          <p style={{ marginTop: '12px' }}>
            For data-protection enquiries, contact us at{' '}
            <a href="mailto:hello@catchcomics.com" style={{ color: '#E8272A' }}>hello@catchcomics.com</a>.
          </p>
        </Section>

        <Section title="What data we collect">

          <h3 style={h3}>1. Session cookie — <code style={code}>__cc_session</code></h3>
          <p>
            When you click an affiliate link on Catch Comics, we set a cookie named{' '}
            <code style={code}>__cc_session</code>. This is a randomly generated UUID (for example,{' '}
            <code style={code}>f47ac10b-58cc-4372-a567-0e02b2c3d479</code>). It contains no personal
            information and is not linked to your name, email address, or any other identifying detail.
          </p>
          <ul style={list}>
            <li><strong>Purpose:</strong> to count affiliate clicks and attribute them to an anonymous browsing session so we can measure which retailers are popular and detect duplicate clicks.</li>
            <li><strong>Stored for:</strong> 1 year from the date of issue.</li>
            <li><strong>Type:</strong> HttpOnly, SameSite=Lax — not accessible to third-party scripts on our site.</li>
            <li><strong>When set:</strong> only when you actively click a retailer link — not on page load or passive browsing.</li>
          </ul>

          <h3 style={{ ...h3, marginTop: '24px' }}>2. Click-event log</h3>
          <p>
            Each time you click a retailer link, we record:
          </p>
          <ul style={list}>
            <li>The anonymous session token (above)</li>
            <li>The listing ID of the product you clicked</li>
            <li>The referring page URL on our site</li>
            <li>Your browser&apos;s user-agent string (e.g., &ldquo;Chrome 124 on Windows&rdquo;)</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            We do <strong>not</strong> record your IP address in click-event logs.
          </p>
          <ul style={list}>
            <li><strong>Purpose:</strong> affiliate commission tracking and traffic analytics.</li>
            <li><strong>Retained for:</strong> 13 months, then deleted.</li>
          </ul>

          <h3 style={{ ...h3, marginTop: '24px' }}>3. Server and infrastructure logs</h3>
          <p>
            Catch Comics is hosted on Vercel. Vercel&apos;s infrastructure automatically records
            standard server log data for every request, including your IP address, the URL requested,
            HTTP status code, timestamp, and user-agent string. This logging is handled by Vercel, not
            by Catch Comics directly.
          </p>
          <ul style={list}>
            <li><strong>Purpose:</strong> infrastructure performance, error diagnosis, and DDoS protection.</li>
            <li><strong>Retention:</strong> governed by Vercel&apos;s data retention policy. See{' '}
              <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer"
                style={{ color: '#E8272A' }}>vercel.com/legal/privacy-policy</a>.</li>
          </ul>
          <p style={{ marginTop: '8px' }}>
            Catch Comics does not access or analyse Vercel&apos;s infrastructure logs in the course
            of normal operations. We may access them in the event of a security incident or to
            diagnose a site fault.
          </p>
        </Section>

        <Section title="What we do not collect">
          <p>We do not ask for or store:</p>
          <ul style={list}>
            <li>Your name, email address, or any account credentials (there are no user accounts on Catch Comics).</li>
            <li>Payment information of any kind.</li>
            <li>Your IP address in our own application logs.</li>
            <li>Location data (we do not geolocate visitors).</li>
            <li>Any data from social media integrations (there are none).</li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            We use <strong>Vercel Analytics</strong>, a privacy-friendly analytics service provided
            by Vercel (our hosting provider). It records anonymous pageview data — the URL visited,
            referrer, and approximate country — to help us understand how the site is used. It does
            not set cookies, does not fingerprint your device, and does not track you across sites.
            See <a href="https://vercel.com/docs/analytics/privacy-policy" target="_blank"
            rel="noopener noreferrer" style={{ color: '#E8272A' }}>Vercel Analytics privacy
            information</a>.
          </p>
          <p style={{ marginTop: '12px' }}>
            We do not use Google Analytics, Plausible, or any other third-party analytics service.
            We do not load advertising networks, remarketing pixels, or social media tracking scripts.
          </p>
        </Section>

        <Section title="Cookies and your consent (PECR)">
          <p>
            The <code style={code}>__cc_session</code> cookie is set only when you actively click an
            affiliate link — it is not placed on page load. We consider this cookie to be closely
            analogous to the &ldquo;strictly necessary for the transmission of a communication&rdquo;
            exemption under PECR, because it is triggered by your deliberate action and used solely to
            correctly attribute your affiliate click.
          </p>
          <p style={{ marginTop: '12px' }}>
            We acknowledge that the &ldquo;strictly necessary&rdquo; exemption under PECR is
            primarily intended for technical communications rather than commercial affiliate tracking.
            We make no claim of guaranteed legal compliance. If you have concerns, you can block all
            cookies via your browser settings — the site will continue to work normally without the
            session cookie.
          </p>
          <p style={{ marginTop: '12px' }}>
            No other cookies are set by Catch Comics on page load or during normal browsing.
          </p>
        </Section>

        <Section title="Third-party affiliate networks">
          <p>
            When you click a retailer link, you leave Catch Comics. Some links pass through affiliate
            network tracking before reaching the retailer. The following networks may set their own
            cookies or use tracking technology on their redirect pages:
          </p>
          <ul style={list}>
            <li>
              <strong>AWIN (Affiliate Window):</strong> Used for some UK retailers. AWIN&apos;s tracking
              operates on AWIN&apos;s own infrastructure after you leave Catch Comics. See{' '}
              <a href="https://www.awin.com/gb/legal/privacy-policy" target="_blank" rel="noopener noreferrer"
                style={{ color: '#E8272A' }}>AWIN&apos;s privacy policy</a>.
            </li>
            <li style={{ marginTop: '6px' }}>
              <strong>Amazon:</strong> Amazon has its own tracking and cookies when you arrive at
              amazon.co.uk. See{' '}
              <a href="https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=201909010"
                target="_blank" rel="noopener noreferrer" style={{ color: '#E8272A' }}>
                Amazon&apos;s privacy notice</a>.
            </li>
            <li style={{ marginTop: '6px' }}>
              <strong>Other retailers:</strong> Each retailer you visit has its own privacy policy and
              cookie use. Catch Comics is not responsible for data collected by any third-party site
              after you follow a link from our site.
            </li>
          </ul>
        </Section>

        <Section title="Third-party service providers">
          <p>
            Catch Comics uses the following third-party services to operate the site:
          </p>
          <ul style={list}>
            <li>
              <strong>Vercel</strong> — hosting and serverless infrastructure. Processes request
              data including IP addresses. Based in the United States; operates under the
              EU–US Data Privacy Framework where applicable.
            </li>
            <li style={{ marginTop: '6px' }}>
              <strong>Vercel Analytics</strong> — anonymous pageview analytics (no cookies, no
              cross-site tracking). Data is processed by Vercel under their privacy policy.
            </li>
            <li style={{ marginTop: '6px' }}>
              <strong>Neon (PostgreSQL)</strong> — our database provider. Stores our product catalogue,
              retailer listings, and click-event logs (anonymous). Data is encrypted at rest and in transit.
            </li>
            <li style={{ marginTop: '6px' }}>
              <strong>Cloudflare R2</strong> — used to store cover images. Does not process personal data.
            </li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            We do not sell or share your data with any third party beyond the service providers
            listed above, which are necessary to operate the site.
          </p>
        </Section>

        <Section title="Legal basis for processing (UK GDPR)">
          <ul style={list}>
            <li>
              <strong>Legitimate interests (Article 6(1)(f)):</strong> We have a legitimate interest in
              understanding how our affiliate links perform so we can operate and improve the service.
              The data we process for this purpose is fully anonymous (a UUID with no personal identifiers)
              and you can opt out at any time by blocking cookies in your browser.
            </li>
            <li style={{ marginTop: '8px' }}>
              <strong>Legal obligation:</strong> Server infrastructure logs (held by Vercel) may be
              retained for security and legal compliance purposes.
            </li>
          </ul>
        </Section>

        <Section title="Data retention">
          <ul style={list}>
            <li><strong>Session cookie (<code style={code}>__cc_session</code>):</strong> 1 year from issue date, or until cleared by your browser.</li>
            <li><strong>Click-event logs:</strong> 13 months from the click date, then deleted.</li>
            <li><strong>Vercel infrastructure logs:</strong> governed by Vercel&apos;s own retention policy.</li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            We do not retain any other personal data beyond the above. Because our session identifiers
            are anonymous UUIDs with no link to any personal identifier, we cannot retrieve data for
            a specific individual without their session token.
          </p>
        </Section>

        <Section title="Your rights under UK GDPR">
          <p>Under UK GDPR you have the right to:</p>
          <ul style={list}>
            <li><strong>Access</strong> — request a copy of data we hold associated with your session token.</li>
            <li><strong>Erasure</strong> — ask us to delete click-event records associated with your session token.</li>
            <li><strong>Restriction</strong> — ask us to stop processing data associated with your session token.</li>
            <li><strong>Object</strong> — object to processing based on legitimate interests.</li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            Because we only hold an anonymous UUID, exercising most rights requires you to provide the
            value of your <code style={code}>__cc_session</code> cookie so we can locate the relevant
            records. To exercise any right, email{' '}
            <a href="mailto:hello@catchcomics.com" style={{ color: '#E8272A' }}>hello@catchcomics.com</a>.
          </p>
          <p style={{ marginTop: '12px' }}>
            You also have the right to lodge a complaint with the Information Commissioner&apos;s Office
            (ICO):{' '}
            <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer"
              style={{ color: '#E8272A' }}>ico.org.uk</a>.
          </p>
        </Section>

        <Section title="International transfers">
          <p>
            Our infrastructure providers (Vercel, Neon) may process data in the United States or other
            countries outside the UK. Where this occurs, we rely on the providers&apos; own legal
            mechanisms (such as Standard Contractual Clauses or the UK-US Data Bridge) to ensure
            appropriate safeguards are in place.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Catch Comics is not directed at children under the age of 13. We do not knowingly collect
            any information from children. If you believe a child has provided data to us, please
            contact us and we will delete it promptly.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the
            top will reflect any changes. We will not retroactively change how we use data that has
            already been collected without providing clear notice.
          </p>
        </Section>

      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '40px' }}>
      <h2 style={{
        fontSize: '1.1rem', fontWeight: 600, color: '#E8272A',
        marginBottom: '14px', letterSpacing: '-0.01em',
      }}>
        {title}
      </h2>
      <div style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.75, fontSize: '15px' }}>
        {children}
      </div>
    </section>
  )
}

const h3: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'rgba(255,255,255,0.9)',
  marginBottom: '8px',
}

const code: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '13px',
  background: 'rgba(255,255,255,0.08)',
  padding: '1px 5px',
  borderRadius: '4px',
}

const list: React.CSSProperties = {
  paddingLeft: '20px',
  marginTop: '8px',
  lineHeight: 1.9,
}
