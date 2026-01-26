'use client';

import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './ZoomableMermaid.module.css';

export default function ZoomableMermaid({ content }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;
  const ZOOM_STEP = 0.2;

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + ZOOM_STEP, MAX_SCALE));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - ZOOM_STEP, MIN_SCALE));
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleFullscreen = () => {
    setIsFullscreen(true);
  };

  const handleCloseFullscreen = () => {
    setIsFullscreen(false);
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - position.x,
        y: e.clientY - position.y
      });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale(prev => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)));
    }
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        handleCloseFullscreen();
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = '';
      };
    }
  }, [isFullscreen]);

  useEffect(() => {
    const renderMermaid = async () => {
      const mermaid = (await import('mermaid')).default;
      requestAnimationFrame(() => {
        const nodes = document.querySelectorAll('div.mermaid:not(:has(svg))');
        if (nodes.length > 0) {
          mermaid.run({ querySelector: 'div.mermaid:not(:has(svg))' });
        }
      });
    };

    renderMermaid();
    const timer = setTimeout(renderMermaid, 100);
    return () => clearTimeout(timer);
  }, [content, isFullscreen]);

  return (
    <>
      <div className={styles.wrapper}>
        <div className={styles.controls}>
          <button
            onClick={handleZoomOut}
            disabled={scale <= MIN_SCALE}
            className={styles.btn}
            title="Zoom Out (Ctrl+Scroll)"
          >
            −
          </button>
          <button
            onClick={handleReset}
            className={styles.btn}
            title="Reset Zoom"
          >
            ⟲
          </button>
          <button
            onClick={handleZoomIn}
            disabled={scale >= MAX_SCALE}
            className={styles.btn}
            title="Zoom In (Ctrl+Scroll)"
          >
            +
          </button>
          <button
            onClick={handleFullscreen}
            className={styles.btn}
            title="Fullscreen"
          >
            ⛶
          </button>
          <span className={styles.zoomLevel}>{Math.round(scale * 100)}%</span>
        </div>
        
        <div
          ref={containerRef}
          className={styles.viewport}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
        >
          <div
            ref={contentRef}
            className={styles.content}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transformOrigin: 'center center'
            }}
          >
            <div className="mermaid">{content}</div>
          </div>
        </div>
      </div>

      {mounted && isFullscreen && createPortal(
        <div className={styles.modalOverlay} onClick={handleCloseFullscreen}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalControls}>
              <button
                onClick={handleZoomOut}
                disabled={scale <= MIN_SCALE}
                className={styles.btn}
                title="Zoom Out (Ctrl+Scroll)"
              >
                −
              </button>
              <button
                onClick={handleReset}
                className={styles.btn}
                title="Reset Zoom"
              >
                ⟲
              </button>
              <button
                onClick={handleZoomIn}
                disabled={scale >= MAX_SCALE}
                className={styles.btn}
                title="Zoom In (Ctrl+Scroll)"
              >
                +
              </button>
              <button
                onClick={handleCloseFullscreen}
                className={`${styles.btn} ${styles.closeBtn}`}
                title="Close (Esc)"
              >
                ✕
              </button>
              <span className={styles.zoomLevel}>{Math.round(scale * 100)}%</span>
            </div>
            
            <div
              className={styles.modalViewport}
              onMouseDown={handleMouseDown}
              onWheel={handleWheel}
              style={{ cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
            >
              <div
                className={styles.content}
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: 'center center'
                }}
              >
                <div className="mermaid">{content}</div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
