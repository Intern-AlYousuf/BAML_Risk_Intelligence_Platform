import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BAML Risk Intelligence Platform',
  description: 'Institutional finance risk analytics and scenario analysis',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      style={{ fontFamily: 'var(--font-inter, Inter, system-ui, sans-serif)' }}
    >
      <body
        className="min-h-full"
        style={{ backgroundColor: '#0B0B0C', color: '#F5F7FA' }}
      >
        {children}
      </body>
    </html>
  );
}
