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
        {/* ── Demo mode banner ──────────────────────────────────────────── */}
        <div
          style={{
            position:        'fixed',
            bottom:          0,
            left:            0,
            right:           0,
            zIndex:          9999,
            backgroundColor: 'rgba(11,11,12,0.88)',
            backdropFilter:  'blur(6px)',
            borderTop:       '1px solid rgba(255,255,255,0.06)',
            padding:         '6px 16px',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             '8px',
          }}
        >
          <span style={{ fontSize: '11px', color: '#6B7280', letterSpacing: '0.02em' }}>
            Demonstration environment using precomputed model outputs.
          </span>
        </div>
      </body>
    </html>
  );
}
