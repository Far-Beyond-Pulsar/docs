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
    <nav className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-6" aria-label="Breadcrumb">
      <Link
        href="/docs"
        className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
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
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
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
  // Remove /docs prefix and split by /
  const path = pathname.replace(/^\/docs\/?/, '');

  if (!path) {
    return [];
  }

  const segments = path.split('/').filter(Boolean);
  const breadcrumbs = [];
  let currentPath = '/docs';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Skip 'index' segments
    if (segment === 'index') {
      continue;
    }

    currentPath += `/${segment}`;

    // Format label: kebab-case to Title Case
    const label = segment
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    breadcrumbs.push({
      label,
      href: currentPath
    });
  }

  return breadcrumbs;
}
