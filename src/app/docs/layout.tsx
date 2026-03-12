'use client';

import { useEffect, useRef, useState, useLayoutEffect } from 'react';
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

// banner hooks copied from root layout
function useBannerVisibility() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!visible) return;
    const handler = () => setVisible(false);
    document.addEventListener('scroll', handler, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', handler, { capture: true });
  }, [visible]);
  return visible;
}
function useHeaderOffset(bannerVisible: boolean) {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const headerEl = document.querySelector('header');
    const bannerEl = document.querySelector('[data-notice-banner]');
    const update = () => {
      const h = headerEl?.offsetHeight || 0;
      const b = bannerVisible && bannerEl ? (bannerEl as HTMLElement).offsetHeight : 0;
      setOffset(h + b);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
    };
  }, [bannerVisible]);
  return offset;
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bannerVisible = useBannerVisibility();
  const topOffset = useHeaderOffset(bannerVisible);
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

  // Prevent the <body> from scrolling; only scrollable regions within the layout
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // DEBUG: watch for unexpected scroll on body or main
  useEffect(() => {
    const main = document.querySelector('main');
    let lastBody = document.body.scrollTop || document.documentElement.scrollTop;
    let lastMain = main ? main.scrollTop : 0;

    const check = () => {
      const curBody = document.body.scrollTop || document.documentElement.scrollTop;
      if (curBody !== lastBody) {
        console.warn('BODY scroll changed', lastBody, '->', curBody);
        lastBody = curBody;
      }
      const curMain = main ? main.scrollTop : 0;
      if (curMain !== lastMain) {
        console.log('MAIN scroll', lastMain, '->', curMain);
        lastMain = curMain;
      }
    };

    const interval = setInterval(check, 100);
    return () => clearInterval(interval);
  }, []);

  // Check if this is the docs home page
  const isDocsHome = pathname === '/docs';

  if (isDocsHome) {
    return (
      <div className="min-h-screen" style={{ paddingTop: `${topOffset}px` }}>
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
        className="lg:hidden fixed z-50 p-2 bg-gray-900 border border-gray-800 rounded-lg hover:bg-gray-800 transition-colors"
        style={{ top: `${topOffset - 48}px`, left: '1rem' }}
        // 48 = header height (approx) so button sits just below header
        aria-label="Toggle menu"
      >
        {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
      </button>

      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <>
          <div 
            className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            style={{ top: `${topOffset}px` }}
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="lg:hidden fixed left-0 bottom-0 w-80 max-w-[85vw] border-r border-gray-800 bg-black z-50 overflow-y-scroll"
                 style={{ top: `${topOffset}px` }}>
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
        className="hidden lg:grid fixed inset-0 overflow-hidden overflow-x-hidden select-none overscroll-none min-w-0"
        style={{
          top: `${topOffset}px`,
          gridTemplateColumns: headings.length > 0
            ? `${leftWidth}px 8px 1fr 8px ${rightWidth}px`
            : `${leftWidth}px 8px 1fr`,
        }}
      >
        {/* Left Sidebar Column - Navigation */}
        <aside className="border-r border-gray-800 bg-black h-full overflow-y-scroll overflow-x-hidden overscroll-contain">
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
        <main className="h-full overflow-y-scroll overflow-x-hidden overscroll-contain min-w-0">
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
          <aside className="border-l border-gray-800 h-full overflow-y-scroll overflow-x-hidden overscroll-contain">
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
      <div className="lg:hidden fixed inset-0 overflow-hidden overflow-x-hidden min-w-0" style={{ top: `${topOffset}px` }}>
        <main className="h-full overflow-y-scroll overflow-x-hidden overscroll-contain min-w-0">
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
