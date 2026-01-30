'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Rnd } from 'react-rnd';

// CSS to isolate Monaco editor from global styles
const monacoStyles = `
  .monaco-editor-container .monaco-editor .line-numbers {
    all: unset !important;
    color: #858585 !important;
    font-family: 'Consolas', 'Courier New', monospace !important;
    font-size: 14px !important;
    line-height: 19px !important;
    text-align: right !important;
    padding-right: 10px !important;
    display: block !important;
  }
`;

const FilePreviewModal = React.memo(function FilePreviewModal({ fileUrl, fileName, onClose, zIndex, onBringToFront, initialPosition }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(initialPosition);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    // Prepend basePath if it exists
    const basePath = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';
    const fullUrl = basePath + fileUrl;
    
    // Fetch file content
    console.log('Fetching file from URL:', fullUrl);
    fetch(fullUrl)
      .then(res => {
        console.log('Fetch response:', res.status, res.statusText);
        if (!res.ok) throw new Error(`Failed to load file: ${res.status}`);
        return res.text();
      })
      .then(text => {
        console.log('File loaded successfully, length:', text.length);
        setContent(text);
        setLoading(false);
      })
      .catch(err => {
        console.error('Fetch error:', err);
        setError(err.message);
        setLoading(false);
      });
  }, [fileUrl]);

  // Detect language from file extension
  const getLanguage = (filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      xml: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      toml: 'toml',
      lua: 'lua',
    };
    return langMap[ext] || 'plaintext';
  };

  return (
    <>
      <style>{monacoStyles}</style>
      <Rnd
        position={position}
        size={size}
        onDragStop={(e, d) => {
          setPosition({ x: d.x, y: d.y });
        }}
        onResizeStop={(e, direction, ref, delta, newPosition) => {
          setSize({
            width: ref.offsetWidth,
            height: ref.offsetHeight,
          });
          setPosition(newPosition);
        }}
      minWidth={400}
      minHeight={300}
      dragHandleClassName="modal-header"
      style={{
        zIndex: zIndex,
        position: 'fixed',
      }}
      onMouseDown={onBringToFront}
      enableResizing={{
        top: false,
        right: true,
        bottom: true,
        left: false,
        topRight: false,
        bottomRight: true,
        bottomLeft: false,
        topLeft: false,
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1e1e1e',
          border: '1px solid #3c3c3c',
          borderRadius: '8px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div 
          className="modal-header"
          style={{
            padding: '12px 16px',
            backgroundColor: '#252526',
            borderBottom: '1px solid #3c3c3c',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move',
            userSelect: 'none',
          }}
        >
          <span style={{ color: '#cccccc', fontSize: '14px', fontWeight: '500' }}>
            {fileName}
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#cccccc',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#3c3c3c'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ 
          flex: 1, 
          overflow: 'hidden',
          position: 'relative',
        }}
        className="monaco-editor-container"
        >
          {loading && (
            <div style={{ 
              padding: '20px', 
              color: '#cccccc',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}>
              Loading...
            </div>
          )}
          {error && (
            <div style={{ 
              padding: '20px', 
              color: '#f48771',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}>
              Error: {error}
            </div>
          )}
          {!loading && !error && (
            <Editor
              height="100%"
              width="100%"
              language={getLanguage(fileName)}
              value={content}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                fontSize: 14,
                lineNumbers: 'on',
                renderWhitespace: 'selection',
                automaticLayout: true,
                wordWrap: 'off',
                folding: true,
                matchBrackets: 'always',
                bracketPairColorization: {
                  enabled: true,
                },
                semanticHighlighting: {
                  enabled: true,
                },
                glyphMargin: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 4,
                renderLineHighlight: 'all',
                scrollbar: {
                  vertical: 'visible',
                  horizontal: 'visible',
                },
                fixedOverflowWidgets: true,
              }}
              onMount={(editor) => {
                // Force layout after mount
                setTimeout(() => {
                  editor.layout();
                }, 100);
              }}
            />
          )}
        </div>
      </div>
    </Rnd>
    </>
  );
});

export default FilePreviewModal;
