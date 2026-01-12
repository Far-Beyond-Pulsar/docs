'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import DocsSidebar from '@/components/DocsSidebar';
import TableOfContents from '@/components/TableOfContents';
import Breadcrumbs from '@/components/Breadcrumbs';
import BackToTop from '@/components/BackToTop';
import { Loader2 } from 'lucide-react';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navigation, setNavigation] = useState<any[]>([]);
  const [headings, setHeadings] = useState<any[]>([]);
  const [isNavigationLoading, setIsNavigationLoading] = useState(true);
  const [isHeadingsLoading, setIsHeadingsLoading] = useState(true);

  // Load navigation structure
  useEffect(() => {
    setIsNavigationLoading(true);
    const basePath = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';
    fetch(`${basePath}/docs-structure.json`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load navigation');
        return res.json();
      })
      .then(data => {
        console.log('Navigation loaded:', data.navigation);
        setNavigation(data.navigation || []);
        setIsNavigationLoading(false);
      })
      .catch(error => {
        console.error('Error loading navigation:', error);
        setIsNavigationLoading(false);
      });
  }, []);

  // Extract headings from the page for TOC
  useEffect(() => {
    setIsHeadingsLoading(true);
    const timer = setTimeout(() => {
      const tocDataElement = document.getElementById('toc-data');
      if (tocDataElement) {
        const headingsData = tocDataElement.getAttribute('data-headings');
        if (headingsData) {
          try {
            setHeadings(JSON.parse(headingsData));
          } catch (error) {
            console.error('Error parsing headings data:', error);
          }
        }
      } else {
        setHeadings([]);
      }
      setIsHeadingsLoading(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [pathname, children]);

  // Check if this is the docs home page
  const isDocsHome = pathname === '/docs';

  if (isDocsHome) {
    return (
      <>
        {children}
        <BackToTop />
      </>
    );
  }

  return (
    <div className="docs-layout flex flex-col min-h-screen">
      {/* Documentation Notice Banner */}
      <div className="bg-yellow-500/10 border-b border-yellow-500/20 backdrop-blur-sm">
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

      <div className="flex flex-1">
      {/* Left Sidebar - Navigation */}
      {isNavigationLoading ? (
        <aside className="hidden lg:block w-80 flex-shrink-0 border-r border-gray-800 bg-black sticky top-0 h-screen overflow-hidden">
          <div className="p-6 pt-8 space-y-6">
            {/* Logo skeleton */}
            <div className="flex items-center gap-2 mb-8">
              <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
              <div className="w-32 h-4 bg-gray-800 rounded animate-pulse"></div>
            </div>
            
            {/* Navigation skeleton */}
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="space-y-2">
                {/* Section header */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <div className="w-5 h-5 bg-gray-800 rounded animate-pulse"></div>
                  <div className="flex-1 h-4 bg-gray-800 rounded animate-pulse"></div>
                  <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
                </div>
                {/* Section items */}
                <div className="ml-4 space-y-1">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="h-9 bg-gray-900 rounded animate-pulse"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      ) : (
        <DocsSidebar navigation={navigation} />
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        <div className="flex">
          {/* Content */}
          <div className="flex-1 min-w-0 px-8 py-8 max-w-4xl mx-auto">
            <Breadcrumbs />
            {children}
          </div>

          {/* Right Sidebar - Table of Contents */}
          {isHeadingsLoading ? (
            <aside className="hidden xl:block w-64 flex-shrink-0 sticky top-0 self-start h-screen">
              <div className="p-6 pt-8 space-y-4">
                {/* TOC header */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-4 h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse"></div>
                  <div className="w-24 h-4 bg-gray-200 dark:bg-gray-800 rounded animate-pulse"></div>
                </div>
                {/* TOC items */}
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" style={{ width: `${60 + (i * 5)}%` }}></div>
                  </div>
                ))}
              </div>
            </aside>
          ) : headings.length > 0 ? (
            <TableOfContents headings={headings} />
          ) : (
            <aside className="hidden xl:block w-64 flex-shrink-0"></aside>
          )}
        </div>
      </main>
      </div>

      <BackToTop />
    </div>
  );
}
