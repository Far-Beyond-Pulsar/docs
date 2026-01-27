'use client';

import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { github as githubDark } from 'react-syntax-highlighter/dist/cjs/styles/hljs';
import { 
  FileText, 
  Code, 
  Database, 
  Settings,
  FileCode,
  FileJson,
  FileImage,
  Globe
} from 'lucide-react';
import {
  IconBrandJavascript,
  IconBrandTypescript,
  IconBrandPython,
  IconBrandCpp,
  IconBrandHtml5,
  IconBrandCss3,
  IconBrandReact,
  IconBrandNodejs,
  IconBrandVue,
  IconBrandAngular,
  IconBrandPhp,
  IconBrandRust,
  IconBrandGolang,
  IconBrandSwift,
  IconSql,
  IconFileTypeDocx,
  IconCode,
  IconBrandGit
} from '@tabler/icons-react';

const getLanguageIcon = (language) => {
  const iconProps = { size: 16, className: "language-icon" };
  
  const icons = {
    javascript: <IconBrandJavascript {...iconProps} style={{ color: '#F7DF1E' }} />,
    js: <IconBrandJavascript {...iconProps} style={{ color: '#F7DF1E' }} />,
    typescript: <IconBrandTypescript {...iconProps} style={{ color: '#61DAFB' }} />,
    ts: <IconBrandTypescript {...iconProps} style={{ color: '#61DAFB' }} />,
    python: <IconBrandPython {...iconProps} style={{ color: '#FFD43B' }} />,
    py: <IconBrandPython {...iconProps} style={{ color: '#FFD43B' }} />,
    java: <IconCode {...iconProps} style={{ color: '#FF8C00' }} />,
    rust: <IconBrandRust {...iconProps} style={{ color: '#CE422B' }} />,
    rs: <IconBrandRust {...iconProps} style={{ color: '#CE422B' }} />,
    go: <IconBrandGolang {...iconProps} style={{ color: '#00ADD8' }} />,
    cpp: <IconBrandCpp {...iconProps} style={{ color: '#659AD2' }} />,
    c: <IconBrandCpp {...iconProps} style={{ color: '#A8B9CC' }} />,
    csharp: <IconCode {...iconProps} style={{ color: '#68217A' }} />,
    cs: <IconCode {...iconProps} style={{ color: '#68217A' }} />,
    php: <IconBrandPhp {...iconProps} style={{ color: '#8892BF' }} />,
    ruby: <IconCode {...iconProps} style={{ color: '#FF6B6B' }} />,
    rb: <IconCode {...iconProps} style={{ color: '#FF6B6B' }} />,
    swift: <IconBrandSwift {...iconProps} style={{ color: '#FA7343' }} />,
    kotlin: <IconCode {...iconProps} style={{ color: '#A97BFF' }} />,
    kt: <IconCode {...iconProps} style={{ color: '#A97BFF' }} />,
    html: <IconBrandHtml5 {...iconProps} style={{ color: '#E34F26' }} />,
    css: <IconBrandCss3 {...iconProps} style={{ color: '#1572B6' }} />,
    scss: <IconBrandCss3 {...iconProps} style={{ color: '#CF649A' }} />,
    sass: <IconBrandCss3 {...iconProps} style={{ color: '#CF649A' }} />,
    json: <FileJson {...iconProps} style={{ color: '#FFA500' }} />,
    xml: <FileCode {...iconProps} style={{ color: '#FF6600' }} />,
    yaml: <FileText {...iconProps} style={{ color: '#FF6B6B' }} />,
    yml: <FileText {...iconProps} style={{ color: '#FF6B6B' }} />,
    markdown: <FileText {...iconProps} style={{ color: '#A3A3A3' }} />,
    md: <FileText {...iconProps} style={{ color: '#A3A3A3' }} />,
    bash: <Code {...iconProps} style={{ color: '#4EAA25' }} />,
    sh: <Code {...iconProps} style={{ color: '#4EAA25' }} />,
    shell: <Code {...iconProps} style={{ color: '#4EAA25' }} />,
    powershell: <Code {...iconProps} style={{ color: '#5391FE' }} />,
    ps1: <Code {...iconProps} style={{ color: '#5391FE' }} />,
    sql: <IconSql {...iconProps} style={{ color: '#4285F4' }} />,
    react: <IconBrandReact {...iconProps} style={{ color: '#61DAFB' }} />,
    jsx: <IconBrandReact {...iconProps} style={{ color: '#61DAFB' }} />,
    tsx: <IconBrandReact {...iconProps} style={{ color: '#61DAFB' }} />,
    vue: <IconBrandVue {...iconProps} style={{ color: '#4FC08D' }} />,
    angular: <IconBrandAngular {...iconProps} style={{ color: '#DD0031' }} />,
    nodejs: <IconBrandNodejs {...iconProps} style={{ color: '#68A063' }} />,
    node: <IconBrandNodejs {...iconProps} style={{ color: '#68A063' }} />,
    git: <IconBrandGit {...iconProps} style={{ color: '#F05032' }} />,
    dockerfile: <Settings {...iconProps} style={{ color: '#2496ED' }} />,
    docker: <Settings {...iconProps} style={{ color: '#2496ED' }} />,
    nginx: <Settings {...iconProps} style={{ color: '#009639' }} />,
    apache: <Settings {...iconProps} style={{ color: '#D22128' }} />,
    vim: <FileCode {...iconProps} style={{ color: '#019733' }} />,
    lua: <Code {...iconProps} style={{ color: '#51A0CF' }} />,
    perl: <Code {...iconProps} style={{ color: '#0298C3' }} />,
    r: <Database {...iconProps} style={{ color: '#276DC3' }} />,
    matlab: <Database {...iconProps} style={{ color: '#0076A8' }} />,
    latex: <FileText {...iconProps} style={{ color: '#008080' }} />,
    toml: <FileText {...iconProps} style={{ color: '#9C4221' }} />,
    ini: <FileText {...iconProps} style={{ color: '#A3A3A3' }} />,
    conf: <Settings {...iconProps} style={{ color: '#A3A3A3' }} />,
    config: <Settings {...iconProps} style={{ color: '#A3A3A3' }} />
  };

  return icons[language?.toLowerCase()] || <FileCode {...iconProps} style={{ color: '#9CA3AF' }} />;
};

export default function CodeBlock({ language, code, showLineNumbers = true }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const lines = code.split('\n');
  const lineCount = lines.length;
  const lineNumberWidth = Math.max(2, String(lineCount).length);

  // Custom syntax highlighting colors for dark theme
  const customSyntaxStyle = {
    'code[class*="language-"]': {
      color: '#e6edf3',
      background: 'none',
    },
    'pre[class*="language-"]': {
      color: '#e6edf3',
      background: 'transparent',
      margin: 0,
      padding: 0,
    },
    comment: { color: '#8b949e', fontStyle: 'italic' },
    prolog: { color: '#8b949e' },
    doctype: { color: '#8b949e' },
    cdata: { color: '#8b949e' },
    punctuation: { color: '#e6edf3' },
    property: { color: '#79c0ff' },
    tag: { color: '#7ee787' },
    boolean: { color: '#79c0ff' },
    number: { color: '#79c0ff' },
    constant: { color: '#79c0ff' },
    symbol: { color: '#79c0ff' },
    deleted: { color: '#ffa198' },
    selector: { color: '#7ee787' },
    'attr-name': { color: '#7ee787' },
    string: { color: '#a5d6ff' },
    char: { color: '#a5d6ff' },
    builtin: { color: '#ffa657' },
    inserted: { color: '#7ee787' },
    operator: { color: '#ff7b72' },
    entity: { color: '#e6edf3' },
    url: { color: '#79c0ff' },
    variable: { color: '#e6edf3' },
    function: { color: '#d2a8ff' },
    regex: { color: '#7ee787' },
    important: { color: '#f85149', fontWeight: 'bold' },
    bold: { fontWeight: 'bold' },
    italic: { fontStyle: 'italic' },
    keyword: { color: '#ff7b72' },
    'class-name': { color: '#ffa657' },
    namespace: { color: '#ffa657' },
    identifier: { color: '#e6edf3' },
    'maybe-class-name': { color: '#e6edf3' },
    'property-access': { color: '#e6edf3' },
    token: { color: '#e6edf3' },
  };

  const containerStyle = {
    margin: '1.5em 0',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid #30363d',
    background: '#0d1117',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
    fontSize: '0.9em',
  };

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 1rem',
    background: 'linear-gradient(90deg, #161b22 0%, #1c2128 100%)',
    borderBottom: '1px solid #30363d',
  };

  const languageStyle = {
    fontSize: '0.8em',
    color: '#7c3aed',
    fontWeight: '600',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  };

  const copyBtnStyle = {
    fontSize: '0.75em',
    padding: '0.3rem 0.6rem',
    background: copied ? '#238636' : 'rgba(33, 38, 45, 0.8)',
    border: '1px solid rgba(48, 54, 61, 0.8)',
    borderRadius: '8px',
    color: copied ? '#ffffff' : '#c9d1d9',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backdropFilter: 'blur(8px)',
    fontWeight: '500',
  };

  const contentStyle = {
    display: 'flex',
    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.85em',
    lineHeight: '1.6',
    background: '#0d1117',
  };

  const lineNumbersStyle = {
    background: 'linear-gradient(180deg, #161b22 0%, #0f1419 100%)',
    color: '#6e7681',
    padding: '0.8rem 0.6rem',
    textAlign: 'right',
    userSelect: 'none',
    flexShrink: 0,
    minWidth: `${lineNumberWidth + 1}ch`,
    fontWeight: '400',
  };

  const separatorStyle = {
    width: '2px',
    background: 'linear-gradient(180deg, #30363d 0%, #21262d 100%)',
    flexShrink: 0,
  };

  const codeStyle = {
    flex: 1,
    overflow: 'auto',
    padding: '0.8rem 1rem',
    background: '#0d1117',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={languageStyle}>
          {getLanguageIcon(language)}
        </span>
        <button onClick={handleCopy} style={copyBtnStyle}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      
      <div style={contentStyle}>
        {showLineNumbers && (
          <>
            <div style={lineNumbersStyle}>
              {lines.map((_, index) => (
                <div key={index} style={{ 
                  height: '1.6em', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'flex-end',
                  opacity: 0.7,
                  transition: 'opacity 0.2s ease',
                }}>
                  {index + 1}
                </div>
              ))}
            </div>
            <div style={separatorStyle} />
          </>
        )}
        
        <div style={codeStyle}>
          <SyntaxHighlighter
            language={language}
            style={customSyntaxStyle}
            customStyle={{
              margin: 0,
              padding: 0,
              background: 'transparent',
              fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 'inherit',
              lineHeight: 'inherit',
            }}
            codeTagProps={{
              style: {
                fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 'inherit',
                lineHeight: 'inherit',
              }
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
}