'use client';

import { motion } from 'framer-motion';
import { Sidebar } from './sidebar';
import { Topbar, type TopbarProps } from './topbar';

export interface AppShellProps extends TopbarProps {
  children: React.ReactNode;
}

export function AppShell({ children, breadcrumb, title }: AppShellProps) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F7F7F5' }}>

      <Sidebar />

      <Topbar breadcrumb={breadcrumb} title={title} />

      <main
        className="min-h-screen"
        style={{ marginLeft: '280px', paddingTop: '72px' }}
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
