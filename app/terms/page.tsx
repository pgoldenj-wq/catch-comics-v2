export const metadata = {
  title: 'Terms of Use',
  description: 'Terms and conditions for using Catch Comics.',
}

export default function TermsPage() {
  return (
    <main style={{ background: '#111827', minHeight: '100vh', color: '#F8F8F6', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '64px 24px' }}>

        <a href="/" style={{ color: '#E8272A', fontSize: '13px', textDecoration: 'none', display: 'inline-block', marginBottom: '40px' }}>
          ← Back to Catch Comics
        </a>

        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '8px' }}>
          Terms of Use
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px', marginBottom: '48px' }}>
          Last updated: 15 May 2026
        </p>

        <Section title="Nature of the service">
          <p>
            Catch Comics is a <strong>price-comparison service</strong>. We display prices sourced from
            third-party retailers so you can find the best deal on comics, graphic novels, and manga.
            We are not a retailer ourselves — we do not sell products, hold stock, or process payments.
          </p>
        </Section>

        <Section title="Price accuracy">
          <p>
            Prices shown on Catch Comics are sourced automatically from retailer websites. They are
            provided <strong>for informational purposes only</strong> and may be out of date by the time
            you view them. Retailers may change prices, apply promotions, or remove products at any time
            without notice to us.
          </p>
          <p style={{ marginTop: '12px' }}>
            <strong>Always verify the final price on the retailer&apos;s own website before completing a
            purchase.</strong> Catch Comics accepts no liability for any discrepancy between the price
            shown on this site and the price charged by a retailer.
          </p>
        </Section>

        <Section title="Affiliate relationships">
          <p>
            Some links on Catch Comics are affiliate links. If you click one and make a purchase, we may
            receive a small commission from the retailer at <strong>no extra cost to you</strong>. This
            commission helps fund the running costs of the site.
          </p>
          <p style={{ marginTop: '12px' }}>
            Affiliate relationships do not influence how we rank or display prices. Results are ordered
            by price only; we do not give preferential placement to retailers who pay higher commissions.
          </p>
        </Section>

        <Section title="No warranty">
          <p>
            This service is provided <strong>&ldquo;as is&rdquo;</strong> without warranty of any kind,
            express or implied. We do not warrant that:
          </p>
          <ul style={list}>
            <li>Prices displayed are accurate, complete, or current.</li>
            <li>The service will be available at all times or free from errors.</li>
            <li>Any particular product is available for sale at any retailer.</li>
          </ul>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the fullest extent permitted by law, Catch Comics shall not be liable for any direct,
            indirect, incidental, or consequential loss arising from your use of the site or your reliance
            on prices displayed. This includes, without limitation, loss arising from purchasing a product
            at a price different from that shown on Catch Comics.
          </p>
        </Section>

        <Section title="Intellectual property">
          <p>
            Comic cover images displayed on Catch Comics are the property of their respective publishers
            and are used for the purpose of identifying products. Product titles, publisher names, and
            related trademarks belong to their respective owners.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>You agree not to:</p>
          <ul style={list}>
            <li>Scrape or systematically download data from Catch Comics without permission.</li>
            <li>Use the site in any way that could damage, overload, or impair it.</li>
            <li>Attempt to gain unauthorised access to any part of the site or its infrastructure.</li>
          </ul>
        </Section>

        <Section title="Governing law">
          <p>
            These terms are governed by the laws of England and Wales. Any disputes shall be subject to
            the exclusive jurisdiction of the courts of England and Wales.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We may update these terms from time to time. The &ldquo;Last updated&rdquo; date at the top
            will reflect any changes. Continued use of the site after an update constitutes acceptance of
            the revised terms.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms? Email{' '}
            <a href="mailto:pgoldenj@gmail.com" style={{ color: '#E8272A' }}>pgoldenj@gmail.com</a>.
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

const list: React.CSSProperties = {
  paddingLeft: '20px',
  marginTop: '8px',
  lineHeight: 1.9,
}
