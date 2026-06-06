'use client';

import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { usePathname } from 'next/navigation';

interface BreadcrumbsProps {
  customItems?: Array<{ label: string; href: string }>;
}

export default function Breadcrumbs({ customItems }: BreadcrumbsProps) {
  const pathname = usePathname();

  // Generate breadcrumb items from pathname if not provided
  const items = customItems || generateBreadcrumbsFromPath(pathname);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6" aria-label="Breadcrumb">
      <Link
        href="/"
        className="flex items-center gap-1 hover:text-blue-400 transition-colors"
      >
        <Home className="w-4 h-4" />
        <span>Docs</span>
      </Link>

      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <div key={item.href} className="flex items-center gap-2">
            <ChevronRight className="w-4 h-4 text-gray-400" />
            {isLast ? (
              <span className="font-medium text-gray-100">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-blue-400 transition-colors"
              >
                {item.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function generateBreadcrumbsFromPath(pathname: string): Array<{ label: string; href: string }> {
  // Strip any /docs prefix (handles both old and new route structures).
  // Hrefs are built for next/link — basePath is prepended automatically.
  const path = pathname.replace(/^\/docs\/?/, '');
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) return [];

  const breadcrumbs = [];
  let currentPath = '';

  for (const segment of segments) {
    if (segment === 'index') continue;
    currentPath += `/${segment}`;
    const label = segment
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    breadcrumbs.push({ label, href: currentPath });
  }

  return breadcrumbs;
}
