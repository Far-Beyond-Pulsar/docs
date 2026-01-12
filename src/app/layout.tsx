'use client';

import './globals.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Inter } from 'next/font/google';
import { useEffect, useState } from 'react';
import mermaid from 'mermaid';

const inter = Inter({ subsets: ['latin'] });

if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    const target = e.target as HTMLElement | null;

    if (
      target?.tagName === 'SCRIPT' &&
      (target as HTMLScriptElement).src?.includes('/_next/static/chunks')
    ) {
      console.warn('[ChunkLoadError] Reloading due to missing chunk:', (target as HTMLScriptElement).src);
      window.location.reload();
    }
  });
}



const metadata = {
  title: 'Pulsar Docs',
  description: 'A blog about game and web development, backend programming, hardware, security, privacy, and technology.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    // Detect user/system theme
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDarkMode(isDark);

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
    });
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={metadata.description} />
        <title>{metadata.title}</title>
      </head>

      <body
        className={`${inter.className} min-h-screen flex flex-col bg-gray-100 dark:bg-black text-gray-900 dark:text-gray-100`}
      >
        <Header />
        
        {/* Documentation Notice Banner - positioned below fixed header */}
        <div className="pt-[60px] bg-yellow-500/10 border-b border-yellow-500/20">
          <div className="max-w-7xl mx-auto px-6 py-3">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm text-yellow-200">
                  <strong className="font-semibold">Documentation Under Active Development:</strong> Many sections of this documentation are being updated to reflect the current state of Pulsar Engine. Information may be incomplete or not yet accurate. Thank you for your patience as we improve the docs.
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <main className="flex-grow container mx-auto px-4 py-8">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
