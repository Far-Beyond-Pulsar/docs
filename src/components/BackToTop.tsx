'use client';

import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

export default function BackToTop() {
  const [isVisible, setIsVisible] = useState(false);
  const isVisibleRef = React.useRef(isVisible);
  React.useEffect(() => { isVisibleRef.current = isVisible; }, [isVisible]);

  useEffect(() => {
    const container: HTMLElement | null = document.querySelector('main');
    const toggleVisibility = () => {
      const scrollTop = container ? container.scrollTop : window.pageYOffset;
      const visible = isVisibleRef.current;
      if (scrollTop > 300 && !visible) {
        setIsVisible(true);
      } else if (scrollTop <= 300 && visible) {
        setIsVisible(false);
      }
    };

    const target = container || window;
    target.addEventListener('scroll', toggleVisibility);

    return () => {
      target.removeEventListener('scroll', toggleVisibility);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  return (
    <>
      {isVisible && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 z-40 p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-all duration-300 hover:scale-110"
          aria-label="Back to top"
          title="Back to top"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </>
  );
}
