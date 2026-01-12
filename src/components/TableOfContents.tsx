'use client';

import { useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';

interface Heading {
  level: number;
  text: string;
  slug: string;
}

interface TableOfContentsProps {
  headings: Heading[];
}

export default function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    // Set up IntersectionObserver for scroll spy
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        rootMargin: '0px 0px -80% 0px',
        threshold: 1.0
      }
    );

    // Observe all heading elements
    const headingElements = headings.map(({ slug }) => document.getElementById(slug)).filter(Boolean);

    headingElements.forEach((element) => {
      if (element) observer.observe(element);
    });

    return () => {
      headingElements.forEach((element) => {
        if (element) observer.unobserve(element);
      });
    };
  }, [headings]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, slug: string) => {
    e.preventDefault();
    const element = document.getElementById(slug);
    if (element) {
      // Get the element's position relative to the viewport
      const elementRect = element.getBoundingClientRect();
      const absoluteElementTop = elementRect.top + window.pageYOffset;
      const offset = 100; // Offset for fixed headers/spacing

      window.scrollTo({
        top: absoluteElementTop - offset,
        behavior: 'smooth'
      });

      // Update URL
      window.history.pushState(null, '', `#${slug}`);
      setActiveId(slug);
    }
  };

  if (!headings || headings.length === 0) {
    return null;
  }

  // Filter headings to only show H2 and H3
  const filteredHeadings = headings.filter(h => h.level >= 2 && h.level <= 3);

  if (filteredHeadings.length === 0) {
    return null;
  }

  return (
    <aside className="hidden xl:block w-64 flex-shrink-0 sticky top-0 self-start h-screen overflow-y-auto">
      <nav className="toc p-6 pt-8">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4 uppercase tracking-wider flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
          </svg>
          On This Page
        </h3>
        <ul className="space-y-2">
          {filteredHeadings.map((heading) => {
            const isActive = activeId === heading.slug;
            const indent = heading.level === 3 ? 'ml-4' : '';

            return (
              <li key={heading.slug} className={indent}>
                <a
                  href={`#${heading.slug}`}
                  onClick={(e) => handleClick(e, heading.slug)}
                  className={`block text-sm py-1 border-l-2 pl-3 transition-colors ${
                    isActive
                      ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  {heading.text}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
