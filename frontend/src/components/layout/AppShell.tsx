'use client';

import { motion } from 'framer-motion';
import { Sidebar } from './sidebar';
import { Topbar, type TopbarProps } from './topbar';

/* ---------------------------------------------------------------------------
   Props
   --------------------------------------------------------------------------- */

export interface AppShellProps extends TopbarProps {
  children: React.ReactNode;
}

/* ---------------------------------------------------------------------------
   AppShell
   Positions the 260px sidebar + 64px topbar + scrollable content area.
   Children can be server or client components — they are passed as props,
   not imported, so they retain their own rendering mode.
   --------------------------------------------------------------------------- */

export function AppShell({ children, breadcrumb, title }: AppShellProps) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0B0B0C' }}>

      {/* Fixed sidebar */}
      <Sidebar />

      {/* Fixed topbar — inset-left tracks sidebar width */}
      <Topbar breadcrumb={breadcrumb} title={title} />

      {/* Scrollable content — offsets match sidebar (260px) + topbar (64px) */}
      <main
        className="min-h-screen"
        style={{ marginLeft: '260px', paddingTop: '64px' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          className="h-full"
        >
          {children}
        </motion.div>
      </main>

    </div>
  );
}
