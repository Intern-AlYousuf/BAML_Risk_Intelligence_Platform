import { useEffect, useState } from 'react';

/**
 * Returns `true` once the component has mounted in the browser.
 *
 * Use this to gate any code that relies on browser-only APIs (DOM
 * measurement, ResizeObserver, window, etc.) so it never runs during
 * Next.js server-side pre-rendering.
 *
 * Pattern:
 *   const mounted = useMounted();
 *   if (!mounted) return <div style={{ height }} />;   // SSR placeholder
 *   return <ResponsiveContainer ...>;                   // client render
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}
