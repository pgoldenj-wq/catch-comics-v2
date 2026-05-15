export const metadata = {
  title: 'Privacy Policy — Catch Comics',
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
          Last updated: 15 May 2026
        </p>

        <Section title="Who we are">
          <p>
            Catch Comics (<strong>we</strong>, <strong>us</strong>, <strong>our</strong>) is a price-comparison
            service for comics, graphic novels, and manga. We are based in the United Kingdom and this policy
            applies to all visitors to <strong>catchcomics.co.uk</strong>.
          </p>
          <p style={{ marginTop: '12px' }}>
            For data-protection enquiries, email us at{' '}
            <a href="mailto:pgoldenj@gmail.com" style={{ color: '#E8272A' }}>pgoldenj@gmail.com</a>.
          </p>
        </Section>

        <Section title="What data we collect">
          <h3 style={h3}>Session cookie — <code style={code}>__cc_session</code></h3>
          <p>
            When you click an affiliate link on Catch Comics we set a cookie named{' '}
            <code style={code}>__cc_session</code>. This is a randomly generated UUID (e.g.{' '}
            <code style={code}>f47ac10b-58cc-4372-a567-0e02b2c3d479</code>). It contains no personal
            information and is not linked to your name, email address, or any other identifying detail.
          </p>
          <ul style={list}>
            <li><strong>Purpose:</strong> to count affiliate clicks and attribute them to an anonymous browsing session so we can measure which retailers are popular and detect duplicate clicks.</li>
            <li><strong>Stored for:</strong> 1 year from the date of issue.</li>
            <li><strong>Type:</strong> HttpOnly, SameSite=Lax — the cookie is not accessible to third-party scripts.</li>
          </ul>

          <h3 style={{ ...h3, marginTop: '24px' }}>Click-event log</h3>
          <p>
            Each time you click a retailer link we record the anonymous session token (above), the listing
            ID of the product you clicked, the referring page URL, and your browser&apos;s user-agent string.
            We do <strong>not</strong> record your IP address.
          </p>
          <ul style={list}>
            <li><strong>Purpose:</strong> affiliate commission tracking and traffic analytics.</li>
            <li><strong>Retained for:</strong> 13 months, then deleted.</li>
          </ul>
        </Section>

        <Section title="What we do not collect">
          <p>We do not ask for or store:</p>
          <ul style={list}>
            <li>Your name, email address, or any account credentials (there are no accounts on Catch Comics).</li>
            <li>Payment information of any kind.</li>
            <li>Your IP address.</li>
            <li>Location data beyond what is inferred from your choice of UK or US region on-site.</li>
          </ul>
        </Section>

        <Section title="Cookies and your consent (PECR)">
          <p>
            The <code style={code}>__cc_session</code> cookie is set only when you actively click an
            affiliate link — it is not placed on page load. Under PECR, cookies that are strictly necessary
            for the transmission of a communication over a network (here, correctly attributing your affiliate
            click) may be placed without prior consent. We consider this cookie to fall within that exemption;
            however, you can block all cookies in your browser settings and the site will continue to work
            normally — you simply will not receive a session cookie.
          </p>
        </Section>

        <Section title="Third-party retailers">
          <p>
            When you click through to a retailer (e.g. Amazon, Forbidden Planet, Book Depository), you leave
            Catch Comics and are subject to that retailer&apos;s own privacy policy. We are not responsible
            for data collected by third parties.
          </p>
        </Section>

        <Section title="Legal basis for processing (UK GDPR)">
          <ul style={list}>
            <li>
              <strong>Legitimate interests (Article 6(1)(f)):</strong> We have a legitimate interest in
              understanding how our affiliate links perform so we can operate and improve the service.
              This interest is not overridden by your interests or fundamental rights because the data is
              fully anonymous and you can opt out at any time by blocking cookies.
            </li>
          </ul>
        </Section>

        <Section title="Your rights">
          <p>Under UK GDPR you have the right to:</p>
          <ul style={list}>
            <li><strong>Access</strong> — request a copy of data we hold about you.</li>
            <li><strong>Erasure</strong> — ask us to delete data associated with your session token.</li>
            <li><strong>Restriction</strong> — ask us to stop processing your data.</li>
            <li><strong>Object</strong> — object to processing based on legitimate interests.</li>
          </ul>
          <p style={{ marginTop: '12px' }}>
            Because we only hold an anonymous UUID, exercising most rights requires you to provide your
            cookie value so we can locate the relevant records. To exercise any right, email{' '}
            <a href="mailto:pgoldenj@gmail.com" style={{ color: '#E8272A' }}>pgoldenj@gmail.com</a>.
          </p>
          <p style={{ marginTop: '12px' }}>
            You also have the right to lodge a complaint with the Information Commissioner&apos;s Office
            (ICO): <a href="https://ico.org.uk" style={{ color: '#E8272A' }}>ico.org.uk</a>.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The &ldquo;Last updated&rdquo; date at the top
            will reflect any changes. Continued use of the site after an update constitutes acceptance of
            the revised policy.
          </p>
        </Section>

      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '40px' }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#E8272A', marginBottom: '14px', letterSpacing: '-0.01em' }}>
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
