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

const MINIAPP_URL = 'https://m00nad.vercel.app/miniapp/';
const EMBED_IMAGE_URL = 'https://m00nad.vercel.app/api/embed-card';
const SPLASH_URL = 'https://m00nad.vercel.app/brand/splash.svg';
const embedConfig = {
  version: '1',
  imageUrl: EMBED_IMAGE_URL,
  button: {
    title: 'm00n cabal check',
    action: {
      type: 'launch_frame',
      name: 'm00n Cabal Check',
      url: MINIAPP_URL,
      splashImageUrl: SPLASH_URL,
      splashBackgroundColor: '#130B25'
    }
  }
};
const embedJson = JSON.stringify(embedConfig);

export const metadata: Metadata = {
  title: 'm00n Cabal Check',
  description: 'Scan your Farcaster FID to see if you made the m00n airdrop cabal.',
  openGraph: {
    title: 'm00n Cabal Check',
    description: 'Scan your Farcaster FID to see if you made the m00n airdrop cabal.',
    url: MINIAPP_URL,
    images: [
      {
        url: EMBED_IMAGE_URL,
        width: 1200,
        height: 800,
        alt: 'm00n cabal embed art'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'm00n Cabal Check',
    description: 'Scan your Farcaster FID to see if you made the m00n airdrop cabal.',
    images: [EMBED_IMAGE_URL]
  },
  other: {
    'fc:miniapp': embedJson,
    'fc:frame': embedJson
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
