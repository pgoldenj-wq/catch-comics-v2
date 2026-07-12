import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import SiteFooter  from "@/components/SiteFooter";
import CookieNotice from "@/components/CookieNotice";
import { Analytics } from "@vercel/analytics/next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '');

export const metadata: Metadata = {
  title: {
    default:  'Catch Comics — Compare UK Comic Prices',
    template: '%s — Catch Comics',
  },
  description:
    'Compare prices for comics, graphic novels and manga across UK retailers. Find the best live price in seconds.',
  metadataBase: new URL(BASE_URL),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type:        'website',
    siteName:    'Catch Comics',
    title:       'Catch Comics — Compare UK Comic Prices',
    description: 'Compare prices for comics, graphic novels and manga across UK retailers. Find the cheapest deal instantly.',
    url:         BASE_URL,
    images: [
      {
        url:    '/og-image.png',
        width:  1200,
        height: 630,
        alt:    'Catch Comics — UK comic price comparison',
      },
    ],
  },
  twitter: {
    card:        'summary_large_image',
    title:       'Catch Comics — Compare UK Comic Prices',
    description: 'Compare prices for comics, graphic novels and manga across UK retailers.',
    images:      ['/og-image.png'],
  },
  robots: {
    index:  true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
        <CookieNotice />
        <Analytics />
      </body>
    </html>
  );
}
