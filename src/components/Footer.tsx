import React from 'react';
import SocialLinks from './SocialLinks';
import { Target } from 'lucide-react';

const FooterLink = ({ href, target, children }: { href: string; target:string; children: React.ReactNode }) => (
  <a href={href} target={target} className="text-neutral-400 hover:text-neutral-100 transition-colors">
    {children}
  </a>
);

const FooterSection = ({ 
  title, 
  links 
}: { 
  title: string; 
  links: Array<{ href: string; label: string; }> 
}) => (
  <div>
    <h3 className="text-neutral-100 font-semibold mb-4">{title}</h3>
    <ul className="space-y-3">
      {links.map(({ href, label }) => (
        <li key={href}>
          <FooterLink href={href} target={''}>{label}</FooterLink>
        </li>
      ))}
    </ul>
  </div>
);

export const Footer = () => {
  return (
    <footer className="relative">
      {/* Gradient overlay for smooth transition */}
      <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent -top-24 pointer-events-none" />
      
      <div className="relative border-t border-neutral-800 pt-16 pb-8">
        <div className="container mx-auto px-4">
          {/* Main Footer Content */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            {/* Brand Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg"></div>
                <span className="text-xl font-bold text-neutral-100">Pulsar</span>
              </div>
              <p className="text-sm text-neutral-400 pr-4">
                A next-generation game engine built with Rust, 
                designed for high performance and developer productivity.
              </p>
              <SocialLinks />
            </div>
        
            {/* Resources Section */}
            <FooterSection 
              title="Resources" 
              links={[
                { href: "/docs", label: "Documentation" },
                { href: "/learn", label: "Learn" },
                { href: "/examples", label: "Examples" },
                { href: "/showcase", label: "Showcase" },
                { href: "/blog", label: "Blog" }
              ]} 
            />
        
            {/* Community Section */}
            <FooterSection 
              title="Community" 
              links={[
                { href: "/discord", label: "Discord Server" },
                { href: "/github", label: "GitHub Discussions" },
                { href: "/contribute", label: "Contribute" },
                { href: "/roadmap", label: "Roadmap" },
                { href: "/releases", label: "Release Notes" }
              ]} 
            />
        
            {/* Company Section */}
            <FooterSection 
              title="Company" 
              links={[
                { href: "/about", label: "About" },
                { href: "/careers", label: "Careers" },
                { href: "/privacy", label: "Privacy Policy" },
                { href: "/terms", label: "Terms of Service" },
                { href: "/contact", label: "Contact" }
              ]} 
            />
          </div>
        
          {/* Bottom Bar */}
          <div className="pt-8 mt-8 border-t border-neutral-800">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="text-neutral-400 text-sm">
                © 2024 Pulsar Engine. All rights reserved.
              </div>
              <div className="flex gap-6 text-sm">
                <FooterLink target="_" href="https://www.githubstatus.com/">Status</FooterLink>
                <span className="text-neutral-700">•</span>
                <FooterLink target="_" href="https://github.com/Far-Beyond-Pulsar/Pulsar-Engine/issues">Support</FooterLink>
                <span className="text-neutral-700">•</span>
                <FooterLink target="_" href="https://github.com/Far-Beyond-Pulsar/Pulsar-Engine/security">Security</FooterLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;