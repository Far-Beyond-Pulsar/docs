'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Folder, 
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  File,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import {
  IconBrandJavascript,
  IconBrandTypescript,
  IconBrandPython,
  IconBrandCpp,
  IconBrandHtml5,
  IconBrandCss3,
  IconBrandRust,
  IconBrandGolang,
  IconBrandSwift,
  IconBrandPhp,
  IconBrandReact,
  IconBrandVue,
  IconBrandAngular,
  IconBrandNodejs,
  IconSql,
  IconMarkdown,
  IconBrandDocker,
  IconBrandGit,
  IconCode,
} from '@tabler/icons-react';
import FilePreviewModal from './FilePreviewModal';

const getFileIcon = (name) => {
  const ext = name.split('.').pop()?.toLowerCase();
  const size = 16;
  
  const icons = {
    // JavaScript/TypeScript
    js: <IconBrandJavascript size={size} style={{ color: '#F7DF1E' }} />,
    mjs: <IconBrandJavascript size={size} style={{ color: '#F7DF1E' }} />,
    cjs: <IconBrandJavascript size={size} style={{ color: '#F7DF1E' }} />,
    jsx: <IconBrandReact size={size} style={{ color: '#61DAFB' }} />,
    ts: <IconBrandTypescript size={size} style={{ color: '#3178C6' }} />,
    tsx: <IconBrandReact size={size} style={{ color: '#61DAFB' }} />,
    
    // Python
    py: <IconBrandPython size={size} style={{ color: '#FFD43B' }} />,
    pyc: <IconBrandPython size={size} style={{ color: '#FFD43B' }} />,
    pyd: <IconBrandPython size={size} style={{ color: '#FFD43B' }} />,
    pyw: <IconBrandPython size={size} style={{ color: '#FFD43B' }} />,
    
    // Rust
    rs: <IconBrandRust size={size} style={{ color: '#CE422B' }} />,
    
    // Go
    go: <IconBrandGolang size={size} style={{ color: '#00ADD8' }} />,
    
    // C/C++
    c: <IconBrandCpp size={size} style={{ color: '#A8B9CC' }} />,
    cpp: <IconBrandCpp size={size} style={{ color: '#659AD2' }} />,
    cxx: <IconBrandCpp size={size} style={{ color: '#659AD2' }} />,
    cc: <IconBrandCpp size={size} style={{ color: '#659AD2' }} />,
    h: <IconBrandCpp size={size} style={{ color: '#A8B9CC' }} />,
    hpp: <IconBrandCpp size={size} style={{ color: '#659AD2' }} />,
    
    // Web
    html: <IconBrandHtml5 size={size} style={{ color: '#E34F26' }} />,
    htm: <IconBrandHtml5 size={size} style={{ color: '#E34F26' }} />,
    css: <IconBrandCss3 size={size} style={{ color: '#1572B6' }} />,
    scss: <IconBrandCss3 size={size} style={{ color: '#CF649A' }} />,
    sass: <IconBrandCss3 size={size} style={{ color: '#CF649A' }} />,
    
    // Frameworks
    vue: <IconBrandVue size={size} style={{ color: '#4FC08D' }} />,
    
    // Other languages
    php: <IconBrandPhp size={size} style={{ color: '#8892BF' }} />,
    rb: <IconCode size={size} style={{ color: '#FF6B6B' }} />,
    java: <IconCode size={size} style={{ color: '#FF8C00' }} />,
    kt: <IconCode size={size} style={{ color: '#A97BFF' }} />,
    swift: <IconBrandSwift size={size} style={{ color: '#FA7343' }} />,
    cs: <IconCode size={size} style={{ color: '#68217A' }} />,
    lua: <IconCode size={size} style={{ color: '#51A0CF' }} />,
    
    // Data formats
    json: <FileJson size={size} style={{ color: '#FFA500' }} />,
    yaml: <FileText size={size} style={{ color: '#FF6B6B' }} />,
    yml: <FileText size={size} style={{ color: '#FF6B6B' }} />,
    toml: <FileText size={size} style={{ color: '#9C4221' }} />,
    xml: <FileCode size={size} style={{ color: '#FF6600' }} />,
    
    // Markdown/Docs
    md: <IconMarkdown size={size} style={{ color: '#A3A3A3' }} />,
    mdx: <IconMarkdown size={size} style={{ color: '#A3A3A3' }} />,
    txt: <FileText size={size} style={{ color: '#9CA3AF' }} />,
    
    // Database
    sql: <IconSql size={size} style={{ color: '#4285F4' }} />,
    
    // Shell scripts
    sh: <IconCode size={size} style={{ color: '#4EAA25' }} />,
    bash: <IconCode size={size} style={{ color: '#4EAA25' }} />,
    ps1: <IconCode size={size} style={{ color: '#5391FE' }} />,
    bat: <IconCode size={size} style={{ color: '#5391FE' }} />,
    
    // Docker/Git
    dockerfile: <IconBrandDocker size={size} style={{ color: '#2496ED' }} />,
    
    // Shaders
    wgsl: <FileCode size={size} style={{ color: '#FF69B4' }} />,
    glsl: <FileCode size={size} style={{ color: '#FF69B4' }} />,
    hlsl: <FileCode size={size} style={{ color: '#FF69B4' }} />,
  };
  
  // Special case for gitignore and other dot files
  if (name.startsWith('.git')) {
    return <IconBrandGit size={size} style={{ color: '#F05032' }} />;
  }
  
  return icons[ext] || <File size={size} style={{ color: '#9CA3AF' }} />;
};

// Parse the dirtree syntax
function parseDirTree(content) {
  const lines = content.trim().split('\n');
  const root = { name: '', children: [], isFolder: true };
  const stack = [{ node: root, depth: -1 }];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Count leading spaces or indentation
    const trimmed = line.trimStart();
    const leadingSpaces = line.length - trimmed.length;
    const depth = Math.floor(leadingSpaces / 2); // 2 spaces per level
    
    // Extract the name (remove leading bullet, dash, or asterisk)
    let name = trimmed.replace(/^[-*•]\s*/, '');
    
    // Check for collapsed flag (-!)
    let defaultCollapsed = false;
    if (name.startsWith('!')) {
      defaultCollapsed = true;
      name = name.substring(1).trim();
    }
    
    // Check if it's a folder (ends with /)
    let isFolder = name.endsWith('/');
    if (isFolder) {
      name = name.slice(0, -1);
    }
    
    // Check for file link (only for non-folders)
    let fileLink = null;
    if (!isFolder && name.includes(' -> ')) {
      const parts = name.split(' -> ');
      name = parts[0].trim();
      fileLink = parts[1].trim();
    }
    
    if (!name) continue;
    
    const node = { name, children: [], isFolder, defaultCollapsed, fileLink };
    
    // Pop stack until we find the parent
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    
    // Add to parent
    if (stack.length > 0) {
      const parent = stack[stack.length - 1].node;
      parent.children.push(node);
    }
    
    // Push current node if it could have children
    stack.push({ node, depth });
  }
  
  return root.children;
}

function TreeNode({ node, level = 0, onFileClick }) {
  const [isOpen, setIsOpen] = useState(!node.defaultCollapsed);
  const hasChildren = node.children && node.children.length > 0;
  
  const itemStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.35rem 0.5rem',
    cursor: node.isFolder && hasChildren ? 'pointer' : (node.fileLink ? 'pointer' : 'default'),
    borderRadius: '6px',
    transition: 'background-color 0.15s ease',
    fontSize: '0.9em',
    fontFamily: 'JetBrains Mono, monospace',
    color: '#e6edf3',
    userSelect: 'none',
  };
  
  const handleClick = () => {
    console.log('TreeNode clicked:', node.name, 'isFolder:', node.isFolder, 'hasChildren:', hasChildren, 'fileLink:', node.fileLink);
    if (node.isFolder && hasChildren) {
      setIsOpen(!isOpen);
    } else if (!node.isFolder && node.fileLink) {
      console.log('Opening file:', node.fileLink, node.name);
      onFileClick(node.fileLink, node.name);
    }
  };
  
  return (
    <div>
      <div 
        style={itemStyle}
        onClick={handleClick}
        onMouseEnter={(e) => {
          if ((node.isFolder && hasChildren) || (!node.isFolder && node.fileLink)) {
            e.currentTarget.style.backgroundColor = 'rgba(177, 186, 196, 0.12)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {node.isFolder && hasChildren && (
          <span style={{ 
            display: 'flex', 
            alignItems: 'center', 
            color: '#8b949e',
            transition: 'transform 0.2s ease',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>
            <ChevronRight size={14} />
          </span>
        )}
        {node.isFolder && !hasChildren && (
          <span style={{ width: '14px', display: 'inline-block' }} />
        )}
        {!node.isFolder && (
          <span style={{ width: '14px', display: 'inline-block' }} />
        )}
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {node.isFolder ? (
            isOpen && hasChildren ? <FolderOpen size={16} color="#7c3aed" /> : <Folder size={16} color="#7c3aed" />
          ) : (
            getFileIcon(node.name)
          )}
        </span>
        <span style={{ 
          color: node.isFolder ? '#7c3aed' : (node.fileLink ? '#58a6ff' : '#e6edf3'),
          fontWeight: node.isFolder ? '500' : '400',
          textDecoration: node.fileLink ? 'underline' : 'none',
          textDecorationStyle: node.fileLink ? 'dotted' : 'none',
        }}>
          {node.name}
        </span>
      </div>
      
      {node.isFolder && hasChildren && isOpen && (
        <div style={{ marginLeft: '1.5rem' }}>
          {node.children.map((child, index) => (
            <TreeNode key={index} node={child} level={level + 1} onFileClick={onFileClick} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DirTree({ content }) {
  const tree = parseDirTree(content);
  const [previewFiles, setPreviewFiles] = useState([]);
  const [nextZIndex, setNextZIndex] = useState(10000);
  
  const handleFileClick = (fileUrl, fileName) => {
    const newFile = { 
      id: Date.now(), 
      url: fileUrl, 
      name: fileName,
      zIndex: nextZIndex,
      initialPosition: {
        x: typeof window !== 'undefined' ? (window.innerWidth / 2 - 400 + (nextZIndex - 10000) * 30) : 100,
        y: typeof window !== 'undefined' ? (window.innerHeight / 2 - 300 + (nextZIndex - 10000) * 30) : 100,
      }
    };
    setPreviewFiles(prev => [...prev, newFile]);
    setNextZIndex(prev => prev + 1);
  };
  
  const handleClosePreview = (fileId) => {
    setPreviewFiles(prev => prev.filter(f => f.id !== fileId));
  };
  
  const handleBringToFront = (fileId) => {
    setPreviewFiles(prev => prev.map(f => 
      f.id === fileId 
        ? { ...f, zIndex: nextZIndex }
        : f
    ));
    setNextZIndex(prev => prev + 1);
  };
  
  const containerStyle = {
    margin: '1.5em 0',
    padding: '1rem',
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: '12px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
  };
  
  return (
    <>
      <div style={containerStyle}>
        {tree.map((node, index) => (
          <TreeNode key={index} node={node} onFileClick={handleFileClick} />
        ))}
      </div>
      
      {typeof document !== 'undefined' && previewFiles.map(file => createPortal(
        <FilePreviewModal 
          key={file.id}
          fileUrl={file.url} 
          fileName={file.name}
          zIndex={file.zIndex}
          initialPosition={file.initialPosition}
          onClose={() => handleClosePreview(file.id)}
          onBringToFront={() => handleBringToFront(file.id)}
        />,
        document.body
      ))}
    </>
  );
}
