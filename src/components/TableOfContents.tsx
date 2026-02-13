'use client';

import React, { useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';

interface Heading {
  level: number;
  text: string;
  slug: string;
  callouts?: string[];
}

interface TableOfContentsProps {
  headings: Heading[];
}

// SVG path data for callout icons (from remark-github-blockquote-alert)
const CALLOUT_PATHS = {
  note: 'M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
  tip: 'M8 1.5c-2.363 0-4 1.69-4 3.75 0 .984.424 1.625.984 2.304l.214.253c.223.264.47.556.673.848.284.411.537.896.621 1.49a.75.75 0 0 1-1.484.211c-.04-.282-.163-.547-.37-.847a8.456 8.456 0 0 0-.542-.68c-.084-.1-.173-.205-.268-.32C3.201 7.75 2.5 6.766 2.5 5.25 2.5 2.31 4.863 0 8 0s5.5 2.31 5.5 5.25c0 1.516-.701 2.5-1.328 3.259-.095.115-.184.22-.268.319-.207.245-.383.453-.541.681-.208.3-.33.565-.37.847a.751.751 0 0 1-1.485-.212c.084-.593.337-1.078.621-1.489.203-.292.45-.584.673-.848.075-.088.147-.173.213-.253.561-.679.985-1.32.985-2.304 0-2.06-1.637-3.75-4-3.75ZM5.75 12h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM6 15.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z',
  important: 'M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  warning: 'M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
  caution: 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z',
};

// Colors for each callout type (matching the markdown-alert styles)
const CALLOUT_COLORS = {
  note: '#3b82f6',     // blue
  tip: '#10b981',      // green
  important: '#a855f7', // purple
  warning: '#f59e0b',   // yellow/orange
  caution: '#ef4444',   // red
};

// Component to render a single callout icon
function CalloutIcon({ type }: { type: string }) {
  const path = CALLOUT_PATHS[type as keyof typeof CALLOUT_PATHS];
  const color = CALLOUT_COLORS[type as keyof typeof CALLOUT_COLORS];

  if (!path) return null;

  return (
    <svg
      className="w-3 h-3 flex-shrink-0"
      viewBox="0 0 16 16"
      fill={color}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export default function TableOfContents({ headings }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');
  const activeItemRef = React.useRef<HTMLLIElement>(null);

  // Auto-scroll to active item with extra space below
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeId]);

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
      <h3 className="text-sm font-semibold text-gray-100 mb-4 uppercase tracking-wider flex items-center gap-2">
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
            <li
              key={heading.slug}
              className={indent}
              ref={isActive ? activeItemRef : null}
            >
              <a
                href={`#${heading.slug}`}
                onClick={(e) => handleClick(e, heading.slug)}
                className={`flex items-center gap-1.5 text-sm py-1 border-l-2 pl-3 transition-colors ${
                  isActive
                    ? 'border-blue-500 text-blue-400 font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }`}
              >
                <span className="flex-1">{heading.text}</span>
                {heading.callouts && heading.callouts.length > 0 && (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {heading.callouts.map((callout) => (
                      <CalloutIcon key={callout} type={callout} />
                    ))}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
