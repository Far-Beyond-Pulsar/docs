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
  indexPage?: {
    title: string;
    slug: string;
    path: string;
    icon?: string;
  };
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

  // Auto-expand section and nested items containing current page
  useEffect(() => {
    const expandPath = (items: NavItem[], currentPath: string): string[] => {
      const toExpand: string[] = [];
      
      for (const item of items) {
        if (item.path === currentPath || currentPath.startsWith(`${item.path}/`)) {
          toExpand.push(item.slug);
        }
        if (item.children) {
          const childExpansions = expandPath(item.children, currentPath);
          if (childExpansions.length > 0) {
            toExpand.push(item.slug, ...childExpansions);
          }
        }
      }
      
      return toExpand;
    };

    for (const section of navigation) {
      if (hasActivePage(section, pathname)) {
        const itemsToExpand = [section.slug];
        if (section.children) {
          itemsToExpand.push(...expandPath(section.children, pathname));
        }
        setExpandedSections(prev => {
          const next = new Set(prev);
          itemsToExpand.forEach(slug => next.add(slug));
          return next;
        });
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
            {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
            <span className="text-sm">{item.title}</span>
          </Link>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-1">
            {item.children!
              .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
              .map(child => renderNavItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const sidebarContent = (
    <nav className="h-full overflow-y-auto bg-black px-6 pt-8 pb-6">
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

              const sectionPath = section.indexPage?.path || `/docs/${section.slug}`;
              const isSectionActive = pathname === sectionPath || pathname.startsWith(`${sectionPath}/`);

              return (
                <div key={section.slug}>
                  {/* Section header */}
                  <div className="flex items-center">
                    <button
                      onClick={() => toggleSection(section.slug)}
                      className="p-1 hover:bg-gray-900 rounded mr-1 flex-shrink-0"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </button>

                    <Link
                      href={sectionPath}
                      className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg transition-colors ${
                        isSectionActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-200 hover:bg-gray-900 hover:text-white'
                      }`}
                      onClick={() => setIsMobileOpen(false)}
                    >
                      <SectionIcon className="w-4 h-4 flex-shrink-0" />
                      <span>{section.title}</span>
                    </Link>
                  </div>

                  {/* Section items */}
                  {isExpanded && section.children && (
                    <div className="mt-2 space-y-1">
                      {section.children
                        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
                        .map(item => renderNavItem(item, 0))}
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

      {/* Desktop sidebar - just return the content directly */}
      {sidebarContent}
    </>
  );
}
