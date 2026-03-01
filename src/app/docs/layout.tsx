'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import DocsSidebar from '@/components/DocsSidebar';
import TableOfContents from '@/components/TableOfContents';
import Breadcrumbs from '@/components/Breadcrumbs';
import BackToTop from '@/components/BackToTop';
import AccessibilityPanel from '@/components/AccessibilityPanel';
import { Menu, X } from 'lucide-react';

const LEFT_SIDEBAR_MIN = 180;
const LEFT_SIDEBAR_MAX = 600;
const RIGHT_SIDEBAR_MIN = 150;
const RIGHT_SIDEBAR_MAX = 500;
const LEFT_SIDEBAR_DEFAULT = 320;
const RIGHT_SIDEBAR_DEFAULT = 256;

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navigation, setNavigation] = useState<any[]>([]);
  const [headings, setHeadings] = useState<any[]>([]);
  const [isNavigationLoading, setIsNavigationLoading] = useState(true);
  const [isHeadingsLoading, setIsHeadingsLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(LEFT_SIDEBAR_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_SIDEBAR_DEFAULT);
  const currentLeftWidth = useRef(LEFT_SIDEBAR_DEFAULT);
  const currentRightWidth = useRef(RIGHT_SIDEBAR_DEFAULT);

  // Keep refs in sync with state for use in pointer event closures
  useEffect(() => { currentLeftWidth.current = leftWidth; }, [leftWidth]);
  useEffect(() => { currentRightWidth.current = rightWidth; }, [rightWidth]);

  // Load persisted sidebar widths
  useEffect(() => {
    try {
      const savedLeft = localStorage.getItem('docs-sidebar-left-width');
      const savedRight = localStorage.getItem('docs-sidebar-right-width');
      if (savedLeft) {
        const w = Number(savedLeft);
        setLeftWidth(w);
        currentLeftWidth.current = w;
      }
      if (savedRight) {
        const w = Number(savedRight);
        setRightWidth(w);
        currentRightWidth.current = w;
      }
    } catch { /* ignore */ }
  }, []);

  const handleResizeStart = (e: React.PointerEvent, side: 'left' | 'right') => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = side === 'left' ? currentLeftWidth.current : currentRightWidth.current;

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      if (side === 'left') {
        const w = Math.max(LEFT_SIDEBAR_MIN, Math.min(LEFT_SIDEBAR_MAX, startWidth + delta));
        currentLeftWidth.current = w;
        setLeftWidth(w);
      } else {
        const w = Math.max(RIGHT_SIDEBAR_MIN, Math.min(RIGHT_SIDEBAR_MAX, startWidth - delta));
        currentRightWidth.current = w;
        setRightWidth(w);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem('docs-sidebar-left-width', String(currentLeftWidth.current));
        localStorage.setItem('docs-sidebar-right-width', String(currentRightWidth.current));
      } catch { /* ignore */ }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Check if this is the docs home page
  const isDocsHome = pathname === '/docs';

  if (isDocsHome) {
    return (
      <div className="min-h-screen">
        {children}
        <BackToTop />
      </div>
    );
  }

  return (
    <div className="docs-layout">
      {/* Mobile Menu Button - Fixed at top */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="lg:hidden fixed top-[72px] left-4 z-50 p-2 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors"
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <>
          <div 
            className="lg:hidden fixed inset-0 top-[120px] bg-black/50 backdrop-blur-sm z-40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="lg:hidden fixed left-0 top-[120px] bottom-0 w-80 max-w-[85vw] border-r border-gray-800 bg-black z-50 overflow-y-auto">
            {isNavigationLoading ? (
              <div className="p-6 pt-8 space-y-6">
                {/* Logo skeleton */}
                <div className="flex items-center gap-2 mb-8">
                  <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
                  <div className="w-32 h-4 bg-gray-800 rounded animate-pulse"></div>
                </div>
                
                {/* Navigation skeleton */}
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <div className="w-5 h-5 bg-gray-800 rounded animate-pulse"></div>
                      <div className="flex-1 h-4 bg-gray-800 rounded animate-pulse"></div>
                      <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
                    </div>
                    <div className="ml-4 space-y-1">
                      {[1, 2, 3].map((j) => (
                        <div key={j} className="h-9 bg-gray-900 rounded animate-pulse"></div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <DocsSidebar navigation={navigation} />
            )}
          </aside>
        </>
      )}

      {/* Desktop Layout */}
      <div
        className="hidden lg:grid fixed inset-0 top-[120px] overflow-hidden select-none"
        style={{
          gridTemplateColumns: headings.length > 0
            ? `${leftWidth}px 8px 1fr 8px ${rightWidth}px`
            : `${leftWidth}px 8px 1fr`,
        }}
      >
        {/* Left Sidebar Column - Navigation */}
        <aside className="border-r border-gray-800 bg-black h-full overflow-y-auto">
          {isNavigationLoading ? (
            <div className="p-6 pt-8 space-y-6">
              {/* Logo skeleton */}
              <div className="flex items-center gap-2 mb-8">
                <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
                <div className="w-32 h-4 bg-gray-800 rounded animate-pulse"></div>
              </div>
              
              {/* Navigation skeleton */}
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="w-5 h-5 bg-gray-800 rounded animate-pulse"></div>
                    <div className="flex-1 h-4 bg-gray-800 rounded animate-pulse"></div>
                    <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
                  </div>
                  <div className="ml-4 space-y-1">
                    {[1, 2, 3].map((j) => (
                      <div key={j} className="h-9 bg-gray-900 rounded animate-pulse"></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <DocsSidebar navigation={navigation} />
          )}
        </aside>

        {/* Left Resize Handle */}
        <div
          className="group relative flex items-center justify-center cursor-col-resize z-10 bg-transparent hover:bg-blue-500/10 transition-colors"
          onPointerDown={(e) => handleResizeStart(e, 'left')}
          aria-label="Resize left sidebar"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize navigation sidebar"
        >
          <div className="w-0.5 h-10 bg-gray-700 rounded group-hover:bg-blue-400 transition-colors" aria-hidden="true" />
        </div>

        {/* Middle Column - Main Content */}
        <main className="h-full overflow-y-auto">
          <div className="px-8 py-8 max-w-4xl mx-auto">
            <Breadcrumbs />
            {children}
          </div>
        </main>

        {/* Right Resize Handle */}
        {headings.length > 0 && (
          <div
            className="group relative flex items-center justify-center cursor-col-resize z-10 bg-transparent hover:bg-blue-500/10 transition-colors"
            onPointerDown={(e) => handleResizeStart(e, 'right')}
            aria-label="Resize table of contents sidebar"
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize table of contents"
          >
            <div className="w-0.5 h-10 bg-gray-700 rounded group-hover:bg-blue-400 transition-colors" aria-hidden="true" />
          </div>
        )}

        {/* Right Sidebar Column - Table of Contents */}
        {headings.length > 0 && (
          <aside className="border-l border-gray-800 h-full overflow-y-auto">
            {isHeadingsLoading ? (
              <div className="p-6 pt-8 space-y-4">
                {/* TOC header */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-4 h-4 bg-gray-800 rounded animate-pulse"></div>
                  <div className="w-24 h-4 bg-gray-800 rounded animate-pulse"></div>
                </div>
                {/* TOC items */}
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-3 bg-gray-800 rounded animate-pulse" style={{ width: `${60 + (i * 5)}%` }}></div>
                  </div>
                ))}
              </div>
            ) : (
              <TableOfContents headings={headings} />
            )}
          </aside>
        )}
      </div>

      {/* Mobile Layout - Single Column */}
      <div className="lg:hidden min-h-screen pt-[120px]">
        <main className="overflow-y-auto">
          <div className="px-4 py-6">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>

      <BackToTop />
      <AccessibilityPanel />
    </div>
  );
}
