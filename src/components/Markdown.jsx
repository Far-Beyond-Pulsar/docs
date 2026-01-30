'use client';

import React, { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkGithubBlockquoteAlert from 'remark-github-blockquote-alert';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { github as githubDark } from 'react-syntax-highlighter/dist/cjs/styles/hljs';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import 'katex/dist/katex.min.css';
import { defaultSchema } from 'hast-util-sanitize';
import slugify from 'slugify';
import ZoomableMermaid from './ZoomableMermaid';
import CodeBlock from './CodeBlock';
import DirTree from './DirTree';

// Global queue for sequential mermaid rendering
let renderQueue = [];
let isRendering = false;

async function processRenderQueue() {
  if (isRendering || renderQueue.length === 0) return;
  
  isRendering = true;
  const { id, callback } = renderQueue.shift();
  
  console.log('Processing diagram from queue:', id);
  await callback();
  
  isRendering = false;
  
  // Process next in queue
  if (renderQueue.length > 0) {
    setTimeout(processRenderQueue, 50);
  }
}

export function queueMermaidRender(id, callback) {
  renderQueue.push({ id, callback });
  processRenderQueue();
}

const customSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div || []),
      'className',
      'dir',
    ],
    blockquote: [
      ...(defaultSchema.attributes?.blockquote || []),
      'className',
      'dir',
    ],
    p: [
      ...(defaultSchema.attributes?.p || []),
      'className',
      'dir',
    ],
    svg: [
      'className',
      'viewBox',
      'width',
      'height',
      'ariaHidden',
      ['aria-hidden', 'true'],
    ],
    path: ['d'],
    h1: [...(defaultSchema.attributes?.h1 || []), 'id'],
    h2: [...(defaultSchema.attributes?.h2 || []), 'id'],
    h3: [...(defaultSchema.attributes?.h3 || []), 'id'],
    h4: [...(defaultSchema.attributes?.h4 || []), 'id'],
    h5: [...(defaultSchema.attributes?.h5 || []), 'id'],
    h6: [...(defaultSchema.attributes?.h6 || []), 'id'],
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'svg',
    'path',
  ],
};

// Generate slug from heading text - same algorithm as extract-headings.js
function generateSlug(text) {
  return slugify(String(text), {
    lower: true,
    strict: true,
    remove: /[*+~.()'"!:@]/g
  });
}

// Extract text from React children (handles nested elements)
function extractTextFromChildren(children) {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(extractTextFromChildren).join('');
  }
  if (children && typeof children === 'object' && children.props) {
    return extractTextFromChildren(children.props.children);
  }
  return String(children || '');
}

export default function MarkdownRenderer({ 
  content, 
  darkMode = true
}) {
  const [copied, setCopied] = useState({});
  const [isMounted, setIsMounted] = useState(false);
  
  // Set isMounted to true when component is mounted on client
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  // Handle copying code to clipboard
  const handleCopyCode = useCallback((code, id) => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(code).then(() => {
        // Use a more targeted state update to avoid re-rendering Mermaid diagrams
        setCopied(prev => {
          const newState = { ...prev };
          newState[id] = true;
          return newState;
        });
        
        setTimeout(() => {
          // Use a more targeted state update to avoid re-rendering Mermaid diagrams
          setCopied(prev => {
            const newState = { ...prev };
            newState[id] = false;
            return newState;
          });
        }, 2000);
      });
    }
  }, []);

  // Initialize mermaid once globally when component mounts
  useEffect(() => {
    if (!isMounted) return;

    import('mermaid').then(({ default: mermaid }) => {
      // Initialize once with proper config
      mermaid.initialize({
        startOnLoad: false,
        theme: darkMode ? 'dark' : 'default',
        securityLevel: 'loose',
        deterministicIds: true,
        deterministicIDSeed: 'pulsar-docs',
      });
      console.log('Mermaid initialized globally');
    });
  }, [isMounted, darkMode]);


  // Process custom containers after ReactMarkdown has rendered
  useEffect(() => {
    if (!isMounted) return;
    
    // Create a function that's safe to call multiple times
    const processCustomContainers = () => {
      return (
        <SyntaxHighlighter
          language={language}
          style={atomOneDark}
          PreTag="div"
          customStyle={{
            fontSize: '1em',
            borderRadius: '8px',
            margin: '0.5em 0',
            padding: '1em',
            overflowX: 'auto',
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      );
        containerStarts.forEach(startP => {
          const match = startP.textContent.trim().match(/^:::(\s+)?([a-zA-Z0-9_-]+)/);
          if (!match) return;
          
          const type = match[2];
          let currentNode = startP.nextSibling;
          const nodesToWrap = [];
          let endNodeFound = false;
          
          // Collect all nodes until we find the closing marker
          while (currentNode) {
            if (currentNode.nodeType === 1 && 
                currentNode.tagName === 'P' && 
                currentNode.textContent.trim() === ':::') {
              // Found the closing marker
              endNodeFound = true;
              const endNode = currentNode;
              
              // Clone the nodes to wrap to prevent issues with removing them from the DOM
              const clonedNodes = nodesToWrap.map(node => node.cloneNode(true));
              
              // Create container
              const container = document.createElement('div');
              container.className = `custom-block custom-block-${type}`;
              
              // Add title
              const title = document.createElement('div');
              title.className = 'custom-block-title';
              title.textContent = type.charAt(0).toUpperCase() + type.slice(1);
              container.appendChild(title);
              
              // Add content
              const content = document.createElement('div');
              content.className = 'custom-block-content';
              clonedNodes.forEach(node => content.appendChild(node));
              container.appendChild(content);
              
              // Insert container before the end marker
              endNode.parentNode.insertBefore(container, endNode);
              
              // Remove the original nodes now that they've been cloned and added to the container
              nodesToWrap.forEach(node => {
                if (node.parentNode) {
                  node.parentNode.removeChild(node);
                }
              });
              
              // Remove start and end markers
              if (startP.parentNode) startP.parentNode.removeChild(startP);
              if (endNode.parentNode) endNode.parentNode.removeChild(endNode);
              
              changesMade = true;
              break;
            } else {
              // Add this node to the list to wrap
              const nextNode = currentNode.nextSibling;
              nodesToWrap.push(currentNode);
              currentNode = nextNode;
            }
          }
          
          // If we didn't find an end node, clean up any temporary state
          if (!endNodeFound) {
            console.warn('No closing ::: found for container', type);
          }
        });
        
        // If we made changes, trigger Mermaid to re-render the diagrams
        // but don't do this by re-calling the function directly to avoid infinite loops
        if (changesMade) {
          console.log('Custom containers processed, triggering Mermaid rendering');
          
          // Dispatch a custom event that our Mermaid observer can listen for
          const event = new CustomEvent('custom-containers-processed');
          document.dispatchEvent(event);
        }

    };
    
    // Run initially after a small delay to ensure ReactMarkdown has rendered
    const initialTimer = setTimeout(processCustomContainers, 100);
    
    // Set up a MutationObserver to detect content changes
    const observer = new MutationObserver((mutations) => {
      // Only process if there might be custom containers to handle
      const hasRelevantChanges = mutations.some(mutation => 
        [...(mutation.addedNodes || [])].some(node => 
          node.nodeType === 1 && 
          (node.tagName === 'P' || node.querySelector?.('p'))
        )
      );
      
      if (hasRelevantChanges) {
        // Debounce the processing to avoid multiple rapid updates
        clearTimeout(processTimer);
        processTimer = setTimeout(processCustomContainers, 50);
      }
    });
    
    let processTimer;
    
    // Start observing the document
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Cleanup
    return () => {
      clearTimeout(initialTimer);
      clearTimeout(processTimer);
      observer.disconnect();
    };
  }, [isMounted]); // Remove content dependency to avoid reprocessing on every content change

  if (!content) return null;

  // Use GitHub Dark theme for code blocks
  const codeStyle = {
    ...githubDark,
    'pre[class*="language-"]': {
      ...githubDark['pre[class*="language-"]'],
      margin: 0,
    },
  };

  // Only render ReactMarkdown on the client side
  return (
    <div className={`markdown-content ${darkMode ? 'dark-theme' : 'light-theme'}`}>
      {isMounted ? (
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            [remarkMath, { singleDollarTextMath: false }],
            remarkGithubBlockquoteAlert,
          ]}
          rehypePlugins={[
            rehypeRaw,
            [rehypeSanitize, customSchema],
            rehypeKatex,
          ]}
          components={{
            // Handle headings with proper IDs for scroll anchors
            h1({ node, children, ...props }) {
              const text = extractTextFromChildren(children);
              const id = generateSlug(text);
              return <h1 id={id} {...props}>{children}</h1>;
            },
            h2({ node, children, ...props }) {
              const text = extractTextFromChildren(children);
              const id = generateSlug(text);
              return <h2 id={id} {...props}>{children}</h2>;
            },
            h3({ node, children, ...props }) {
              const text = extractTextFromChildren(children);
              const id = generateSlug(text);
              return <h3 id={id} {...props}>{children}</h3>;
            },
            h4({ node, children, ...props }) {
              const text = extractTextFromChildren(children);
              const id = generateSlug(text);
              return <h4 id={id} {...props}>{children}</h4>;
            },
            h5({ node, children, ...props }) {
              const text = extractTextFromChildren(children);
              const id = generateSlug(text);
              return <h5 id={id} {...props}>{children}</h5>;
            },
            h6({ node, children, ...props }) {
              const text = extractTextFromChildren(children);
              const id = generateSlug(text);
              return <h6 id={id} {...props}>{children}</h6>;
            },
            // Handle code blocks with syntax highlighting and Mermaid diagrams
            code({ node, inline, className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const language = match ? match[1] : null;
              const codeContent = String(children).replace(/\n$/, '');
              const codeId = `code-${Math.random().toString(36).substring(2, 9)}`;
              
              // Handle Mermaid diagrams
              if (language === 'mermaid') {
                // Create a unique key based on content hash and position
                const contentKey = codeContent.split('').reduce((a, b) => {
                  a = ((a << 5) - a) + b.charCodeAt(0);
                  return a & a;
                }, 0);
                const uniqueKey = `mermaid-${contentKey}-${Math.random().toString(36).substr(2, 5)}`;
                return <ZoomableMermaid key={uniqueKey} diagramKey={uniqueKey} content={codeContent} />;
              }
              
              // Handle DirTree (file tree visualization)
              if (language === 'dirtree') {
                return <DirTree content={codeContent} />;
              }
              
              // Handle regular code blocks
              if (!inline && language) {
                return (
                  <CodeBlock 
                    language={language} 
                    code={codeContent}
                    showLineNumbers={language !== 'markdown'}
                  />
                );
              }
              
              // Inline code
              return (
                <code className={`${className || ''} inline-code`} {...props}>
                  {children}
                </code>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      ) : (
        <div className="space-y-6">
          {/* Loading skeleton for markdown content */}
          <div className="space-y-4">
            {/* Title skeleton */}
            <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-3/4 animate-pulse"></div>
            
            {/* Paragraph skeletons */}
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-2/3 animate-pulse"></div>
            </div>
            
            {/* Heading skeleton */}
            <div className="h-6 bg-gray-200 dark:bg-gray-800 rounded w-1/2 animate-pulse mt-8"></div>
            
            {/* More paragraphs */}
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-5/6 animate-pulse"></div>
            </div>
            
            {/* Code block skeleton */}
            <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded animate-pulse mt-4"></div>
            
            {/* More content */}
            <div className="space-y-2 mt-8">
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-full animate-pulse"></div>
              <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-4/5 animate-pulse"></div>
            </div>
          </div>
        </div>
      )}
      
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        /* Math styling */
        .katex {
          font-size: 1.1em !important;
          font-family: 'KaTeX_Main', serif;
        }
        
        .katex-display {
          overflow-x: auto;
          overflow-y: hidden;
          padding: 1em 0;
          margin: 1.2em 0 !important;
        }
        
        .dark-theme .katex {
          color: #e4e4e7;
        }
        
        /* Custom dark theme for code blocks */
        .code-block-container {
          margin: 2em 0;
          border-radius: 8px;
          overflow: auto;
          border: 1px solid #23272e;
          background: #181a20;
          box-shadow: 0 2px 8px 0 rgba(0,0,0,0.08);
          font-size: 0.9em;
          position: relative;
        }
        .code-block-container,
        .code-block-container pre,
        .code-block-container code,
        .code-block-container div,
        .code-block-container .code-header {
          background: rgb(13, 17, 23) !important;
        }
        .code-block-container {
          margin: 2em 0;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #30363d;
          background: rgb(13, 17, 23);
          box-shadow: 0 2px 8px 0 rgba(0,0,0,0.08);
          font-size: 0.9em;
        }
        .code-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5em 1em;
          background: #161b22;
          border-bottom: 1px solid #30363d;
        }
        .language-badge {
          font-size: 0.8em;
          color: #8b949e;
        }
        .copy-button {
          font-size: 0.8em;
          padding: 0.25em 0.5em;
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 4px;
          color: #c9d1d9;
          cursor: pointer;
        }
        .copy-button:hover {
          background: #30363d;
        }
        .code-content {
          display: flex;
          font-family: 'JetBrains Mono', monospace;
          font-size: 0.9em;
          line-height: 1.2;
        }
        .line-numbers {
          background: #161b22;
          color: #6e7681;
          padding: 0.8em;
          text-align: right;
          user-select: none;
          flex-shrink: 0;
        }
        .line-number {
          height: 1.2em;
        }
        .code-separator {
          width: 1px;
          background: #30363d;
          flex-shrink: 0;
        }
        .code-lines {
          flex: 1;
          overflow: auto;
        }
        .code-lines pre {
          margin: 0;
          padding: 0.8em;
          background: rgb(13, 17, 23);
          color: #c9d1d9;
          font-family: inherit;
          font-size: inherit;
          line-height: inherit;
        }
        .code-lines code {
          background: transparent;
          padding: 0;
          font-family: inherit;
        }
        .code-line {
          height: 1.2em;
        }
          color: #d4d4d4 !important;
        }
        .code-block-container .token.property,
        .code-block-container .token.tag,
        .code-block-container .token.constant,
        .code-block-container .token.symbol {
          color: #569cd6 !important;
        }
        .code-block-container .token.selector,
        .code-block-container .token.attr-name,
        .code-block-container .token.string,
        .code-block-container .token.char,
        .code-block-container .token.builtin,
        .code-block-container .token.inserted {
          color: #ce9178 !important;
        }
        .code-block-container .token.operator,
        .code-block-container .token.entity,
        .code-block-container .token.url,
        .code-block-container .token.variable {
          color: #dcdcaa !important;
        }
        .code-block-container .token.atrule,
        .code-block-container .token.attr-value,
        .code-block-container .token.keyword {
          color: #c586c0 !important;
        }
        .code-block-container .token.function,
        .code-block-container .token.class-name {
          color: #d7ba7d !important;
        }
        .code-block-container .token.regex,
        .code-block-container .token.important {
          color: #d16969 !important;
        }
        .code-block-container .token.deleted {
          color: #d16969 !important;
        }
        .code-block-container::-webkit-scrollbar {
          height: 10px;
          background: ${darkMode ? '#23272e' : '#e2e8f0'};
        }
        .code-block-container::-webkit-scrollbar-thumb {
          background: ${darkMode ? '#444' : '#bdbdbd'};
          border-radius: 6px;
        }
        .code-block-container pre,
        .code-block-container code {
          font-family: 'JetBrains Mono', Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box;
          background: #0d1117 !important;
          color: #c9d1d9 !important;
          font-size: 0.92em !important;
          line-height: 1 !important;
          min-height: 0 !important;
        }
        .code-block-container pre {
          padding: 0.5em 0.7em !important;
          margin: 0 !important;
          border-radius: 0.7em !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        /* Highlighted lines (Monaco style) */
        .code-block-container .react-syntax-highlighter-line-highlighted {
          background: rgba(0, 122, 204, 0.18) !important;
          border-radius: 0.35em !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: 0 1px 4px 0 rgba(0,0,0,0.04);
          line-height: 1 !important;
          min-height: 0 !important;
        }
        /* Monaco-style line numbers */
        .code-block-container .react-syntax-highlighter-line-number {
          color: #8b949e;
          opacity: 0.8;
          font-size: 0.88em !important;
          padding-right: 0.8em !important;
          margin-right: 0.8em !important;
          line-height: 1 !important;
          min-height: 0 !important;
          border-right: none !important;
        }
        /* Monaco-style selection */
        .code-block-container ::selection {
          background: ${darkMode ? 'rgba(0,122,204,0.25)' : 'rgba(0,122,204,0.18)'};
        }
        
        .code-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5em 1em;
          background-color: ${darkMode ? '#343434' : '#f3f3f3'};
          border-bottom: 1px solid ${darkMode ? '#444' : '#ddd'};
        }
        
        .language-badge {
          font-size: 0.8em;
          color: ${darkMode ? '#bbb' : '#555'};
        }
        
        .copy-button {
          font-size: 0.8em;
          padding: 0.25em 0.5em;
          background-color: ${darkMode ? '#555' : '#ddd'};
          border: none;
          border-radius: 0.25em;
          color: ${darkMode ? '#eee' : '#333'};
          cursor: pointer;
        }
        
        .copy-button:hover {
          background-color: ${darkMode ? '#666' : '#ccc'};
        }
        
        /* Inline code */
        .inline-code {
          background-color: ${darkMode ? '#2d2d2d' : '#f1f1f1'};
          border-radius: 0.25em;
          padding: 0.2em 0.4em;
          font-family: 'JetBrains Mono', Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        
        /* Mermaid styling */
        .mermaid-diagram-container {
          margin: 1.5em 0;
          text-align: center;
          background-color: ${darkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)'};
          padding: 1em;
          border-radius: 0.5em;
        }
        
        /* Custom containers */
        .custom-block {
          margin: 1.5em 0;
          padding: 1em;
          border-left: 4px solid;
          border-radius: 0.25em;
        }
        
        .custom-block-title {
          font-weight: bold;
          margin-bottom: 0.5em;
        }
        
        .custom-block.custom-block-info { 
          border-color: #3498db; 
          background-color: ${darkMode ? 'rgba(52, 152, 219, 0.2)' : 'rgba(52, 152, 219, 0.1)'}; 
        }
        .custom-block.custom-block-warning { 
          border-color: #f39c12; 
          background-color: ${darkMode ? 'rgba(243, 156, 18, 0.2)' : 'rgba(243, 156, 18, 0.1)'}; 
        }
        .custom-block.custom-block-danger { 
          border-color: #e74c3c; 
          background-color: ${darkMode ? 'rgba(231, 76, 60, 0.2)' : 'rgba(231, 76, 60, 0.1)'}; 
        }
        .custom-block.custom-block-tip { 
          border-color: #2ecc71; 
          background-color: ${darkMode ? 'rgba(46, 204, 113, 0.2)' : 'rgba(46, 204, 113, 0.1)'}; 
        }
        .custom-block.custom-block-success { 
          border-color: #2ecc71; 
          background-color: ${darkMode ? 'rgba(46, 204, 113, 0.2)' : 'rgba(46, 204, 113, 0.1)'}; 
        }
        .markdown-content p {
          margin-top: 1.5rem;
          margin-bottom: 1.5rem;
        }

        /* GitHub Alert/Callout Styles */
        .markdown-alert {
          padding: 1rem 1rem 1rem 1.5rem;
          margin: 1.5rem 0;
          border-left: 4px solid;
          border-radius: 0.375rem;
        }

        .markdown-alert > :first-child {
          margin-top: 0;
        }

        .markdown-alert > :last-child {
          margin-bottom: 0;
        }

        .markdown-alert-title {
          display: flex;
          align-items: center;
          font-weight: 600;
          margin-bottom: 0.5rem;
          font-size: 0.95rem;
        }

        .markdown-alert-title svg {
          margin-right: 0.5rem;
          flex-shrink: 0;
        }

        /* NOTE (blue) */
        .markdown-alert.markdown-alert-note {
          border-color: #3b82f6;
          background-color: ${darkMode ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)'};
        }
        .markdown-alert.markdown-alert-note .markdown-alert-title {
          color: #3b82f6;
        }
        .markdown-alert.markdown-alert-note svg {
          fill: #3b82f6;
        }

        /* TIP (green) */
        .markdown-alert.markdown-alert-tip {
          border-color: #10b981;
          background-color: ${darkMode ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.05)'};
        }
        .markdown-alert.markdown-alert-tip .markdown-alert-title {
          color: #10b981;
        }
        .markdown-alert.markdown-alert-tip svg {
          fill: #10b981;
        }

        /* IMPORTANT (purple) */
        .markdown-alert.markdown-alert-important {
          border-color: #a855f7;
          background-color: ${darkMode ? 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.05)'};
        }
        .markdown-alert.markdown-alert-important .markdown-alert-title {
          color: #a855f7;
        }
        .markdown-alert.markdown-alert-important svg {
          fill: #a855f7;
        }

        /* WARNING (yellow/orange) */
        .markdown-alert.markdown-alert-warning {
          border-color: #f59e0b;
          background-color: ${darkMode ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.05)'};
        }
        .markdown-alert.markdown-alert-warning .markdown-alert-title {
          color: #f59e0b;
        }
        .markdown-alert.markdown-alert-warning svg {
          fill: #f59e0b;
        }

        /* CAUTION (red) */
        .markdown-alert.markdown-alert-caution {
          border-color: #ef4444;
          background-color: ${darkMode ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)'};
        }
        .markdown-alert.markdown-alert-caution .markdown-alert-title {
          color: #ef4444;
        }
        .markdown-alert.markdown-alert-caution svg {
          fill: #ef4444;
        }
      `}</style>
    </div>
  );
}