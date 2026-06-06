import React from "react";
import { Github } from "lucide-react";

const SECTIONS = [
  {
    title: "Learn",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Getting Started", href: "/docs/getting-started/installation/windows" },
      { label: "API Reference", href: "/docs" },
      { label: "Examples", href: "https://github.com/Far-Beyond-Pulsar/Pulsar-Native/tree/main/examples" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub Discussions", href: "https://github.com/orgs/Far-Beyond-Pulsar/discussions" },
      { label: "Contribute", href: "https://github.com/Far-Beyond-Pulsar/Pulsar-Native/blob/main/CONTRIBUTING.md" },
      { label: "Roadmap", href: "https://github.com/orgs/Far-Beyond-Pulsar/projects" },
      { label: "Releases", href: "https://github.com/Far-Beyond-Pulsar/Pulsar-Native/releases" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: "https://github.com/Far-Beyond-Pulsar" },
      { label: "Issues", href: "https://github.com/Far-Beyond-Pulsar/Pulsar-Native/issues" },
      { label: "Security", href: "https://github.com/Far-Beyond-Pulsar/Pulsar-Native/security" },
      { label: "License", href: "https://github.com/Far-Beyond-Pulsar/Pulsar-Native/blob/main/LICENSE" },
    ],
  },
];

function PulsarMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="10" stroke="#0ea5e9" strokeWidth="1.5" opacity="0.3" />
      <circle cx="11" cy="11" r="5" fill="#0ea5e9" opacity="0.9" />
      <circle cx="11" cy="11" r="2.5" fill="white" />
    </svg>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  const isExternal = (href: string) => href.startsWith("http");
  return (
    <div>
      <p className="text-xs font-semibold tracking-widest uppercase text-white/25 mb-4">{title}</p>
      <ul className="space-y-2.5">
        {links.map(({ label, href }) => (
          <li key={label}>
            <a
              href={href}
              {...(isExternal(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-sm text-white/45 hover:text-white/80 transition-colors"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const Footer = () => {
  return (
    <footer className="border-t border-white/[0.07] bg-black">
      <div className="max-w-7xl mx-auto px-5 pt-16 pb-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <a href="/" className="flex items-center gap-2 mb-4">
              <PulsarMark />
              <span className="text-sm font-semibold text-white">Pulsar</span>
            </a>
            <p className="text-sm text-white/40 leading-relaxed max-w-[220px]">
              A high-performance game engine built entirely in Rust — custom GPU-driven renderer, ECS core, visual scripting. Open source.
            </p>
            <div className="flex items-center gap-3 mt-5">
              <a
                href="https://github.com/Far-Beyond-Pulsar"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/35 hover:text-white/70 transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-4 h-4" />
              </a>
            </div>
          </div>

          {SECTIONS.map((s) => (
            <FooterCol key={s.title} title={s.title} links={s.links} />
          ))}
        </div>

        {/* Divider */}
        <div
          className="mb-8"
          style={{
            height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(14,165,233,0.2) 30%, rgba(14,165,233,0.2) 70%, transparent 100%)",
          }}
        />

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <p className="text-xs text-white/25">
            © {new Date().getFullYear()} Far Beyond Dev. Open source under MIT.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="https://www.githubstatus.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/25 hover:text-white/50 transition-colors"
            >
              Status
            </a>
            <a
              href="https://github.com/Far-Beyond-Pulsar/Pulsar-Native/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-white/25 hover:text-white/50 transition-colors"
            >
              Support
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
