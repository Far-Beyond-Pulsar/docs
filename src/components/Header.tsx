"use client"

import React from 'react';
import { Github, Book, Users, FileQuestionIcon, HomeIcon } from 'lucide-react';

const MobileNavLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    className="block px-3 py-2 text-base font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
  >
    {children}
  </a>
);

export const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="bg-transparent">
      {/* Header */}
      <header className="fixed w-full top-0 z-50 border-b border-gray-800 bg-black/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="text-blue-500 font-bold text-xl">◆ PULSAR ENGINE</div>
          </div>
          <nav className="hidden md:flex space-x-6">
            <a href='/' className="text-gray-400 hover:text-blue-500 transition-colors flex items-center gap-2">
              <HomeIcon className="w-4 h-4" /> Home
            </a>
            <a href="/why" className="text-gray-400 hover:text-blue-500 transition-colors flex items-center gap-2">
              <FileQuestionIcon className="w-4 h-4" /> Why
            </a>
            <a href="/docs" className="text-gray-400 hover:text-blue-500 transition-colors flex items-center gap-2">
              <Book className="w-4 h-4" /> Docs
            </a>
            <a href="#" className="text-gray-400 hover:text-blue-500 transition-colors flex items-center gap-2">
              <Users className="w-4 h-4" /> Community
            </a>
            <a href="https://github.com/Far-Beyond-Pulsar/Pulsar-Engine" target='_blank' className="text-gray-400 hover:text-blue-500 transition-colors flex items-center gap-2">
              <Github className="w-4 h-4" /> GitHub
            </a>
          </nav>
        </div>
      </header>
    </div>
  );
};

export default Header;