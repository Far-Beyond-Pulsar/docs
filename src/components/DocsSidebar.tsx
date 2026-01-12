'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, ChevronDown } from 'lucide-react';
import * as LucideIcons from 'lucide-react';

interface NavItem {
  title: string;
  slug: string;
  path?: string;
  icon?: string;
  type?: 'page' | 'category';
  children?: NavItem[];
  order?: number;
}

interface NavSection {
  title: string;
  slug: string;
  icon?: string;
  description?: string;
  order?: number;
  collapsed?: boolean;
  children: NavItem[];
}

interface DocsSidebarProps {
  navigation: NavSection[];
}

export default function DocsSidebar({ navigation }: DocsSidebarProps) {
  const pathname = usePathname();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Load expanded sections from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('docs-sidebar-expanded');
      if (saved) {
        setExpandedSections(new Set(JSON.parse(saved)));
      } else {
        // Expand all sections by default
        const allSlugs = navigation.map(section => section.slug);
        setExpandedSections(new Set(allSlugs));
      }
    } catch (error) {
      console.error('Error loading sidebar state:', error);
    }
  }, [navigation]);

  // Save expanded sections to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('docs-sidebar-expanded', JSON.stringify(Array.from(expandedSections)));
    } catch (error) {
      console.error('Error saving sidebar state:', error);
    }
  }, [expandedSections]);

  // Auto-expand section containing current page
  useEffect(() => {
    for (const section of navigation) {
      if (hasActivePage(section, pathname)) {
        setExpandedSections(prev => new Set(prev).add(section.slug));
      }
    }
  }, [pathname, navigation]);

  const toggleSection = (slug: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const hasActivePage = (section: NavSection | NavItem, currentPath: string): boolean => {
    if ('path' in section && section.path && currentPath.startsWith(section.path)) {
      return true;
    }
    if (section.children) {
      return section.children.some(child => hasActivePage(child, currentPath));
    }
    return false;
  };

  const renderNavItem = (item: NavItem, depth: number = 0) => {
    const isActive = item.path === pathname || pathname.startsWith(`${item.path}/`);
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedSections.has(item.slug);

    const Icon = item.icon && (LucideIcons as any)[item.icon]
      ? (LucideIcons as any)[item.icon]
      : null;

    // Calculate indentation based on depth
    // depth 0: ml-2 (under main section)
    // depth 1: ml-6 (nested)
    // depth 2: ml-10 (double nested)
    // depth 3+: ml-14 (triple nested)
    const indentClass = depth === 0 ? 'ml-2' : depth === 1 ? 'ml-6' : depth === 2 ? 'ml-10' : 'ml-14';

    return (
      <div key={item.slug}>
        <div className={`flex items-center ${indentClass}`}>
          {hasChildren ? (
            <button
              onClick={() => toggleSection(item.slug)}
              className="p-1 hover:bg-gray-900 rounded mr-1 flex-shrink-0"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-400" />
              )}
            </button>
          ) : (
            <div className="w-6 flex-shrink-0" />
          )}

          <Link
            href={item.path || `/docs/${item.slug}`}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              isActive
                ? 'bg-blue-600 text-white font-medium'
                : 'hover:bg-gray-900 text-gray-300 hover:text-white'
            }`}
            onClick={() => setIsMobileOpen(false)}
          >
            {Icon && <Icon className="w-4 h-4" />}
            <span className="text-sm">{item.title}</span>
          </Link>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-1">
            {item.children!.map(child => renderNavItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <nav className="docs-sidebar h-full overflow-y-auto bg-black">
      <div className="p-6 pt-8">
        {/* Logo/Title */}
        <Link
          href="/docs"
          className="flex items-center gap-2 mb-4 text-sm font-semibold text-white hover:text-blue-400 transition-colors uppercase tracking-wider"
          onClick={() => setIsMobileOpen(false)}
        >
          <LucideIcons.BookOpen className="w-4 h-4" />
          <span>Documentation</span>
        </Link>

        {/* Navigation sections */}
        {navigation && navigation.length > 0 ? (
          <div className="space-y-6">
            {navigation.map(section => {
              const isExpanded = expandedSections.has(section.slug);
              const SectionIcon = section.icon && (LucideIcons as any)[section.icon]
                ? (LucideIcons as any)[section.icon]
                : LucideIcons.FileText;

              return (
                <div key={section.slug}>
                  {/* Section header */}
                  <button
                    onClick={() => toggleSection(section.slug)}
                    className="flex items-center justify-between w-full px-3 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-900 rounded-lg transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <SectionIcon className="w-5 h-5" />
                      <span>{section.title}</span>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  {/* Section items */}
                  {isExpanded && section.children && (
                    <div className="mt-2 space-y-1">
                      {section.children.map(item => renderNavItem(item, 0))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">
            <p>Loading navigation...</p>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile toggle button */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="lg:hidden fixed bottom-4 right-4 z-50 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700"
        aria-label="Toggle navigation"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile sidebar */}
      {isMobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setIsMobileOpen(false)}
          />
          <div className="lg:hidden fixed inset-y-0 left-0 w-80 bg-black z-50 shadow-xl">
            {sidebarContent}
          </div>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-80 flex-shrink-0 border-r border-gray-800 bg-black sticky top-0 h-screen overflow-hidden">
        {sidebarContent}
      </aside>
    </>
  );
}
