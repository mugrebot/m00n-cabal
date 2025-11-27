import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
});

export const metadata: Metadata = {
  title: 'm00n Cabal Check',
  description: 'Scan your Farcaster FID to see if you made the m00n airdrop cabal.',
  openGraph: {
    title: 'm00n Cabal Check',
    description: 'Scan your Farcaster FID to see if you made the m00n airdrop cabal.',
    url: 'https://m00nad.vercel.app/miniapp',
    images: [
      {
        url: 'https://m00nad.vercel.app/brand/banner.png',
        width: 1200,
        height: 630,
        alt: 'm00n cabal banner'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'm00n Cabal Check',
    description: 'Scan your Farcaster FID to see if you made the m00n airdrop cabal.',
    images: ['https://m00nad.vercel.app/brand/banner.png']
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
