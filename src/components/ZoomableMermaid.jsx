'use client';

import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './ZoomableMermaid.module.css';

export default function ZoomableMermaid({ content }) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const modalContainerRef = useRef(null);
  const modalContentRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const diagramId = useRef(`mermaid-${Math.random().toString(36).substr(2, 9)}`);
  const modalDiagramId = useRef(`mermaid-modal-${Math.random().toString(36).substr(2, 9)}`);
  
  // Create a stable hash of the content for this specific diagram
  const contentHash = useRef(content.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0).toString(36));

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10;
  const ZOOM_STEP = 0.25;

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

  const autoFitToModal = () => {
    if (!modalContentRef.current) return;
    
    const diagram = modalContentRef.current.querySelector('.mermaid svg');
    if (!diagram) return;
    
    // Get the actual rendered SVG dimensions
    const svgRect = diagram.getBoundingClientRect();
    
    // Get the modal viewport dimensions
    const modalWidth = window.innerWidth * 0.95 - 160; // 95vw - padding on both sides
    const modalHeight = window.innerHeight * 0.95 - 160; // 95vh - padding
    
    // Calculate scale to fit (with some breathing room)
    const scaleX = modalWidth / svgRect.width;
    const scaleY = modalHeight / svgRect.height;
    const optimalScale = Math.min(scaleX, scaleY) * 0.85; // 85% to give breathing room
    
    console.log('Auto-fitting:', { 
      modalWidth, 
      modalHeight, 
      svgWidth: svgRect.width, 
      svgHeight: svgRect.height, 
      optimalScale 
    });
    
    setScale(optimalScale);
    setPosition({ x: 0, y: 0 });
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
    if (!mounted) return;
    
    const renderMermaid = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        
        // Render only this component's regular diagram
        if (contentRef.current) {
          const node = contentRef.current.querySelector(`#${diagramId.current}`);
          if (node && !node.querySelector('svg')) {
            // Remove any existing content first
            node.innerHTML = content;
            
            console.log('Rendering diagram:', diagramId.current, 'with content length:', content.length);
            
            try {
              await mermaid.run({ nodes: [node] });
              console.log('Successfully rendered:', diagramId.current);
            } catch (err) {
              console.error('Mermaid render error for', diagramId.current, err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load mermaid:', err);
      }
    };

    const timer = setTimeout(renderMermaid, 100);
    return () => clearTimeout(timer);
  }, [content, mounted]);

  // Separate effect for modal rendering
  useEffect(() => {
    if (!isFullscreen || !mounted) return;
    
    const renderModalMermaid = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        
        // Modal diagram (if open)
        if (modalContentRef.current) {
          const modalNode = modalContentRef.current.querySelector(`#${modalDiagramId.current}`);
          if (modalNode && !modalNode.querySelector('svg')) {
            // Remove any existing content first
            modalNode.innerHTML = content;
            
            console.log('Rendering modal diagram:', modalDiagramId.current);
            
            try {
              await mermaid.run({ nodes: [modalNode] });
              console.log('Successfully rendered modal:', modalDiagramId.current);
            } catch (err) {
              console.error('Mermaid modal render error for', modalDiagramId.current, err);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load mermaid for modal:', err);
      }
    };

    const timer = setTimeout(renderModalMermaid, 100);
    return () => clearTimeout(timer);
  }, [content, isFullscreen, mounted]);

  // Auto-fit when modal opens and diagram is rendered
  useEffect(() => {
    if (isFullscreen) {
      let attempts = 0;
      const maxAttempts = 20;
      
      const checkAndFit = setInterval(() => {
        attempts++;
        const svg = modalContentRef.current?.querySelector('.mermaid svg');
        
        if (svg) {
          console.log('SVG found in modal, auto-fitting...');
          // Wait a bit more to ensure SVG is fully rendered
          setTimeout(() => {
            autoFitToModal();
          }, 150);
          clearInterval(checkAndFit);
        } else if (attempts >= maxAttempts) {
          console.log('Failed to find SVG after', maxAttempts, 'attempts');
          clearInterval(checkAndFit);
        }
      }, 100);
      
      return () => clearInterval(checkAndFit);
    }
  }, [isFullscreen]);

  return (
    <>
      <div className={styles.wrapper}>
        <div className={styles.controls}>
          <button
            onClick={handleZoomOut}
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
            <div id={diagramId.current} data-content-hash={contentHash.current} className="mermaid">{content}</div>
          </div>
        </div>
      </div>

      {mounted && isFullscreen && createPortal(
        <div className={styles.modalOverlay} onClick={handleCloseFullscreen}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalControls}>
              <button
                onClick={handleZoomOut}
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
                ref={modalContentRef}
                className={styles.content}
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
                  transformOrigin: 'center center'
                }}
              >
                <div id={modalDiagramId.current} data-content-hash={contentHash.current} className="mermaid">{content}</div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
