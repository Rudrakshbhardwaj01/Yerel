import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Yerel — Your localhost. Out in the world.',
  description: 'Share a live link to the app running on your machine. No deployment. No setup. Just a link.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/icons/favicon-16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
