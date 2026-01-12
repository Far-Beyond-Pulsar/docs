'use client';

import Link from 'next/link';
import { formatDate } from '@/utils/date-formatter';
import * as LucideIcons from 'lucide-react';

interface DocCardProps {
  doc: {
    title: string;
    description: string;
    slug?: string;
    path?: string;
    url?: string;
    tags?: string[];
    readingTime?: number;
    lastUpdated?: string;
    icon?: string;
    order?: number;
  };
}

export default function DocCard({ doc }: DocCardProps) {
  // Get the icon component
  const IconComponent = doc.icon && (LucideIcons as any)[doc.icon]
    ? (LucideIcons as any)[doc.icon]
    : LucideIcons.FileText;

  // Determine the link href
  const href = doc.path || doc.url || `/docs/${doc.slug}`;

  return (
    <Link
      href={href}
      className="doc-card group block p-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-lg transition-all duration-300"
    >
      {/* Icon */}
      <div className="flex items-start gap-4 mb-4">
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
          <IconComponent className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold mb-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {doc.title}
          </h3>
        </div>
      </div>

      {/* Description */}
      <p className="text-gray-600 dark:text-gray-400 mb-4 line-clamp-2">
        {doc.description}
      </p>

      {/* Tags */}
      {doc.tags && doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {doc.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className="px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-700 dark:text-gray-300"
            >
              {tag}
            </span>
          ))}
          {doc.tags.length > 3 && (
            <span className="px-2 py-1 text-xs text-gray-500">
              +{doc.tags.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
        {doc.readingTime && (
          <>
            <span>{doc.readingTime} min read</span>
            <span>•</span>
          </>
        )}
        {doc.lastUpdated && (
          <span>Updated {formatDate(doc.lastUpdated)}</span>
        )}
      </div>

      {/* Arrow indicator */}
      <div className="mt-4 flex items-center text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-sm font-medium mr-2">Read more</span>
        <LucideIcons.ArrowRight className="w-4 h-4" />
      </div>
    </Link>
  );
}
