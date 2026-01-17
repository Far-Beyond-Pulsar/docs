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
    // Find the scrollable main content container
    const mainContent = document.querySelector('main[class*="overflow-y-auto"]');
    
    if (!mainContent) return;

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
        root: mainContent, // Use the scrollable container as root
        rootMargin: '0px 0px -80% 0px',
        threshold: 0.5
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
      // Find the scrollable main content container
      const mainContent = document.querySelector('main[class*="overflow-y-auto"]');
      
      if (mainContent) {
        // Get element position relative to the scrollable container
        const containerRect = mainContent.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const scrollTop = mainContent.scrollTop;
        const elementTop = elementRect.top - containerRect.top + scrollTop;
        const offset = 20; // Offset for spacing
        
        mainContent.scrollTo({
          top: elementTop - offset,
          behavior: 'smooth'
        });
      }

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
    <div className="h-full overflow-y-auto p-6 pt-8">
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
    </div>
  );
}
