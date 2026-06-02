export const metadata = {
  title: 'About',
  description: 'What Catch Comics is and how it works.',
}

export default function AboutPage() {
  return (
    <main style={{ background: '#111827', minHeight: '100vh', color: '#F8F8F6', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '64px 24px' }}>

        <a href="/" style={{ color: '#E8272A', fontSize: '13px', textDecoration: 'none', display: 'inline-block', marginBottom: '40px' }}>
          ← Back to Catch Comics
        </a>

        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '8px' }}>
          About Catch Comics
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px', marginBottom: '48px' }}>
          The world&apos;s only comic price-comparison service
        </p>

        <Section title="What is Catch Comics?">
          <p>
            Catch Comics helps you find the cheapest price for any comic, graphic novel, or manga across
            UK and US online retailers. Instead of visiting half a dozen shops one by one, you search once
            and we show you every available price side by side — so you can buy from whoever is cheapest.
          </p>
        </Section>

        <Section title="How does it work?">
          <p>
            We regularly scan the catalogues of major comic retailers and store the prices in our database.
            When you search for a title, we look up every listing we have for that product and show them
            ranked from cheapest to most expensive. Because prices change frequently, we include a
            &ldquo;last seen&rdquo; timestamp on each listing — always click through to confirm the current
            price before you buy.
          </p>
          <p style={{ marginTop: '12px' }}>
            We cover:
          </p>
          <ul style={list}>
            <li>Graphic novels and collected editions</li>
            <li>Manga volumes (UK and US editions)</li>
            <li>Single-issue comics</li>
            <li>Omnibus and absolute editions</li>
          </ul>
        </Section>

        <Section title="Affiliate disclosure">
          <p>
            Catch Comics is free to use and free from subscription fees. To keep the lights on, some of
            the links to retailers are <strong>affiliate links</strong>. If you click through and make a
            purchase, we receive a small commission from the retailer — at <strong>no extra cost to you</strong>.
          </p>
          <p style={{ marginTop: '12px' }}>
            We never let affiliate relationships influence the ranking of results. Prices are always
            sorted lowest to highest, regardless of which retailers pay commissions or how large those
            commissions are.
          </p>
        </Section>

        <Section title="Who built it?">
          <p>
            Catch Comics is an independent, one-person project built by a comic reader tired of
            paying too much for books. If you have suggestions, found a bug, or want to get in touch,
            email{' '}
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
