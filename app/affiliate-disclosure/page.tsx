import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Affiliate Disclosure',
  description: 'How Catch Comics earns commission, which affiliate programmes we use, and what that means for you.',
}

export default function AffiliateDisclosurePage() {
  return (
    <main style={{ background: '#111827', minHeight: '100vh', color: '#F8F8F6', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '64px 24px' }}>

        <a href="/" style={{ color: '#E8272A', fontSize: '13px', textDecoration: 'none', display: 'inline-block', marginBottom: '40px' }}>
          ← Back to Catch Comics
        </a>

        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '8px' }}>
          Affiliate Disclosure
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px', marginBottom: '48px' }}>
          Last updated: 7 June 2026
        </p>

        <Section title="The short version">
          <p>
            Catch Comics is a free price-comparison service for comics, graphic novels, and manga. To cover
            running costs, some retailer links are <strong>affiliate links</strong>. If you click one and
            complete a purchase, we may receive a small commission from the retailer.{' '}
            <strong>This does not affect the price you pay.</strong>
          </p>
          <p style={{ marginTop: '12px' }}>
            Prices and rankings are <strong>never</strong> influenced by affiliate relationships.
            Results are always sorted by price — lowest first — regardless of which retailers pay
            commissions or how much those commissions are.
          </p>
        </Section>

        <Section title="Affiliate programmes we use">

          <h3 style={h3}>AWIN (Affiliate Window)</h3>
          <p>
            Several UK retailers on Catch Comics are members of the AWIN affiliate network, including
            Bookshop.org UK, Forbidden Planet, and others. When you click an AWIN-affiliated retailer
            link, your click is tracked by AWIN using their standard tracking technology. If you make a
            qualifying purchase, Catch Comics receives a commission from the retailer via AWIN.
          </p>
          <p style={{ marginTop: '8px' }}>
            AWIN may set cookies in your browser when you arrive at a retailer&apos;s site. These are
            AWIN&apos;s cookies, not Catch Comics&apos; — you leave our site when you click through. See
            AWIN&apos;s privacy policy at{' '}
            <a href="https://www.awin.com/gb/legal/privacy-policy" target="_blank" rel="noopener noreferrer"
              style={{ color: '#E8272A' }}>awin.com</a>{' '}
            for details.
          </p>

          <h3 style={{ ...h3, marginTop: '24px' }}>Amazon Associates</h3>
          <p>
            Catch Comics participates in the Amazon Associates Programme, an affiliate advertising programme
            designed to provide a means for sites to earn advertising fees by advertising and linking to
            Amazon. If a product links to Amazon and you make a qualifying purchase within the applicable
            session window, we may earn a commission.
          </p>
          <p style={{ marginTop: '8px' }}>
            Amazon is an independent retailer. Their prices, availability, and delivery terms are set
            entirely by Amazon. See Amazon&apos;s{' '}
            <a href="https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=201909010"
              target="_blank" rel="noopener noreferrer" style={{ color: '#E8272A' }}>
              privacy notice
            </a>{' '}
            for details of how they handle your data.
          </p>

          <h3 style={{ ...h3, marginTop: '24px' }}>eBay</h3>
          <p>
            Catch Comics may display listings sourced from eBay. eBay listings link directly to eBay
            product pages. We do not currently participate in the eBay Partner Network (eBay&apos;s
            affiliate programme), so eBay links are not monetised. eBay sellers set their own prices;
            Catch Comics has no commercial relationship with individual eBay sellers.
          </p>

          <h3 style={{ ...h3, marginTop: '24px' }}>Other retailers</h3>
          <p>
            Not every retailer on Catch Comics is affiliated. Some links are straightforward referrals
            with no commission arrangement. We do not mark individual links as affiliated or
            non-affiliated, but this disclosure applies to the site as a whole: any link to a retailer
            may, at present or in the future, be an affiliate link.
          </p>
        </Section>

        <Section title="How prices and rankings work">
          <p>
            Catch Comics does not accept payment for placement. We do not allow retailers to pay for
            higher rankings, featured positions, or any form of preferential display. Our sort order is
            price only — the cheapest listing appears first.
          </p>
          <p style={{ marginTop: '12px' }}>
            We include all retailers for whom we have current price data, regardless of whether an
            affiliate arrangement exists. The presence or absence of a commission agreement does not
            determine whether a retailer appears on this site.
          </p>
        </Section>

        <Section title="Price accuracy and availability">
          <p>
            Prices displayed on Catch Comics are sourced automatically from retailer websites and
            databases. They are provided <strong>for informational purposes only</strong> and may be
            out of date by the time you view them. Retailers can change prices, apply promotions, or
            remove products at any time without notice to us.
          </p>
          <p style={{ marginTop: '12px' }}>
            <strong>Always verify the final price and availability on the retailer&apos;s own website
            before completing a purchase.</strong> The price you see on Catch Comics is not a guarantee
            of the price you will be charged. Catch Comics is not a retailer — we do not process
            payments, hold stock, or fulfil orders.
          </p>
          <p style={{ marginTop: '12px' }}>
            A &ldquo;last seen&rdquo; timestamp is shown on most listings to indicate how recently
            we confirmed that price. Older timestamps mean higher uncertainty.
          </p>
        </Section>

        <Section title="You buy from the retailer, not from us">
          <p>
            When you click a retailer link on Catch Comics, you leave our site and enter the retailer&apos;s
            own checkout flow. Your purchase contract is with the retailer, not with Catch Comics.
            The retailer&apos;s own terms, returns policy, and customer service apply. Catch Comics has
            no involvement in, and accepts no liability for, transactions conducted on third-party
            retailer websites.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            If you have any questions about our affiliate relationships or how this site works, email us
            at{' '}
            <a href="mailto:hello@catchcomics.com" style={{ color: '#E8272A' }}>hello@catchcomics.com</a>.
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
