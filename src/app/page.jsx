import Image from "next/image";
import { Search, ArrowRight, Github, MessageSquare, ChevronRight } from "lucide-react";
import { getNavigationTree } from "@/utils/docs";

export const metadata = {
  title: "Pulsar Documentation",
  description: "Official documentation for the Pulsar game engine — architecture, renderer, editor, scripting, and more.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Deterministic accent color per category slug
const CATEGORY_COLORS = {
  "Helio":          "#0ea5e9",
  "Quark":          "#a78bfa",
  "visual-scripting": "#34d399",
  "getting-started": "#0ea5e9",
  "guides":         "#f59e0b",
};

function accentFor(slug = "") {
  const key = Object.keys(CATEGORY_COLORS).find(k => slug.includes(k));
  if (key) return CATEGORY_COLORS[key];
  // Cycle through a palette for any other slug
  const palette = ["#0ea5e9", "#a78bfa", "#34d399", "#f59e0b", "#f472b6", "#fb923c"];
  let hash = 0;
  for (const c of slug) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return palette[hash % palette.length];
}

/** Recursively collect all leaf pages from a nav node */
function collectPages(node) {
  const pages = [];
  if (node.type === "page" && node.path) {
    pages.push({ title: node.title, path: node.path, description: node.description });
  }
  if (node.children?.length) {
    for (const child of node.children) pages.push(...collectPages(child));
  }
  if (node.indexPage?.path && node.type !== "page") {
    // Put the index page first
    pages.unshift({ title: node.indexPage.title, path: node.indexPage.path, description: node.description });
  }
  return pages;
}

/** Return top-level display sections from a category's children */
function buildSections(category) {
  // Each direct child that is a sub-category becomes its own section
  // Direct page children are grouped into an "Other" bucket
  const sections = [];
  const loosePages = [];

  for (const child of (category.children ?? [])) {
    if (child.type === "page") {
      loosePages.push({ title: child.title, path: child.path, description: child.description });
    } else if (child.children?.length || child.indexPage) {
      // Sub-category: use its own children + index as pages
      const pages = [];
      if (child.indexPage?.path) {
        pages.push({ title: child.title, path: child.indexPage.path, description: child.description });
      }
      for (const grandchild of (child.children ?? [])) {
        if (grandchild.type === "page" && grandchild.path) {
          pages.push({ title: grandchild.title, path: grandchild.path });
        } else if (grandchild.children?.length || grandchild.indexPage) {
          // Nested sub-category — add its index
          if (grandchild.indexPage?.path) {
            pages.push({ title: grandchild.title, path: grandchild.indexPage.path, description: grandchild.description });
          }
        }
      }
      sections.push({ title: child.title, slug: child.slug ?? "", pages });
    }
  }

  if (loosePages.length) {
    sections.push({ title: category.title, slug: category.slug ?? "", pages: loosePages, isLoose: true });
  }

  return sections;
}

// ─── Components ───────────────────────────────────────────────────────────────

function StartCard({ title, desc, href, badge }) {
  return (
    <a
      href={href}
      className="group flex flex-col gap-2 bg-[#0c0c0c] border border-white/[0.07] rounded-xl p-5 hover:border-white/[0.16] hover:bg-[#111] transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-white/85 group-hover:text-white transition-colors leading-snug">
          {title}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {badge && (
            <span className="px-2 py-0.5 bg-[#0ea5e9]/15 border border-[#0ea5e9]/25 rounded text-[10px] text-[#0ea5e9] font-semibold tracking-wide">
              {badge}
            </span>
          )}
          <ArrowRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
        </div>
      </div>
      {desc && <p className="text-xs text-white/40 leading-relaxed line-clamp-2">{desc}</p>}
    </a>
  );
}

function PageRow({ title, path, description }) {
  return (
    <a
      href={path}
      className="group flex items-start justify-between gap-4 py-3 border-b border-white/[0.05] last:border-0 -mx-4 px-4 hover:bg-white/[0.025] rounded transition-colors"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/75 group-hover:text-white transition-colors mb-0.5 truncate">
          {title}
        </p>
        {description && (
          <p className="text-xs text-white/30 leading-relaxed line-clamp-1">{description}</p>
        )}
      </div>
      <ArrowRight className="w-3.5 h-3.5 text-white/15 group-hover:text-white/40 transition-colors mt-0.5 shrink-0" />
    </a>
  );
}

function SectionBlock({ section, color }) {
  if (!section.pages?.length) return null;
  return (
    <div>
      {!section.isLoose && (
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
          <h3 className="text-xs font-semibold tracking-[0.18em] uppercase" style={{ color }}>
            {section.title}
          </h3>
        </div>
      )}
      <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-4 divide-y divide-white/[0.04]">
        {section.pages.map((p) => (
          <PageRow key={p.path} {...p} />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DocsHome() {
  const structure = await getNavigationTree();
  const nav = structure.navigation ?? [];

  const gettingStarted = nav.find(c => c.slug === "getting-started");
  const coreConcepts   = nav.find(c => c.slug === "core-concepts");
  const guides         = nav.find(c => c.slug === "guides");

  // Getting started: installation children + top-level pages
  const startPages = [];
  for (const child of (gettingStarted?.children ?? [])) {
    if (child.type === "page" && child.path) {
      startPages.push({ title: child.title, href: child.path, desc: child.description });
    } else if (child.children?.length) {
      // Installation sub-category — add its children first
      for (const gc of child.children) {
        if (gc.type === "page" && gc.path) {
          startPages.push({ title: gc.title, href: gc.path, desc: gc.description });
        }
      }
    }
  }

  // Mark first page as "Start here"
  if (startPages.length) startPages[0].badge = "Start here";

  // Core concepts: build display sections from top-level children
  const coreSections = [];
  for (const child of (coreConcepts?.children ?? [])) {
    if (child.type === "page" && child.path) {
      // Loose page — add to a misc bucket at the end
      coreSections.push({
        title: child.title,
        slug: child.slug ?? child.path,
        pages: [{ title: child.title, path: child.path, description: child.description }],
        isLoose: true,
        single: true,
      });
    } else {
      const sections = buildSections(child);
      // Treat the sub-category itself as one section
      const pages = [];
      if (child.indexPage?.path) {
        pages.push({ title: child.title, path: child.indexPage.path, description: child.description });
      }
      for (const gc of (child.children ?? [])) {
        if (gc.type === "page" && gc.path) {
          pages.push({ title: gc.title, path: gc.path, description: gc.description });
        } else if (gc.indexPage?.path) {
          pages.push({ title: gc.title, path: gc.indexPage.path, description: gc.description });
        }
      }
      if (pages.length) {
        coreSections.push({ title: child.title, slug: child.slug ?? "", pages });
      }
    }
  }

  // Guides pages
  const guidePages = [];
  for (const child of (guides?.children ?? [])) {
    if (child.type === "page" && child.path) {
      guidePages.push({ title: child.title, path: child.path, description: child.description });
    } else if (child.indexPage?.path) {
      guidePages.push({ title: child.title, path: child.indexPage.path, description: child.description });
    }
  }

  const totalPages = structure.totalPages ?? (nav.reduce((s, c) => s + (c.children?.length ?? 0), 0));

  return (
    <div className="min-h-screen bg-black text-white">

      {/* ── Hero ── */}
      <div className="border-b border-white/[0.07] bg-[#030303]">
        <div className="max-w-5xl mx-auto px-5 pt-20 pb-16">
          <div className="flex flex-col items-start gap-5">
            <div className="flex items-center gap-2.5">
              <Image src="/assets/pulsar.png" alt="Pulsar" width={34} height={34} className="opacity-90" />
              <span className="text-white/35 text-sm font-medium">/&nbsp;docs</span>
            </div>

            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
              Pulsar Documentation
            </h1>
            <p className="text-white/45 text-base sm:text-lg leading-relaxed max-w-2xl">
              Reference documentation for the Pulsar game engine — the Helio renderer,
              editor systems, visual scripting, and every subsystem in between.
            </p>

            <div className="flex flex-wrap items-center gap-4 mt-1">
              <a
                href={startPages[0]?.href ?? "/docs/getting-started"}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0ea5e9] hover:bg-[#0284c7] text-white font-medium text-sm rounded-xl transition-colors"
              >
                Quick Start
                <ArrowRight className="w-4 h-4" />
              </a>
              <div className="flex items-center gap-2 text-white/30 text-sm">
                <Search className="w-4 h-4" />
                <span>
                  Press{" "}
                  <kbd className="px-1.5 py-0.5 bg-white/[0.08] border border-white/[0.1] rounded text-xs font-mono text-white/50">
                    /
                  </kbd>{" "}
                  to search
                </span>
              </div>
            </div>

            {structure.lastGenerated && (
              <p className="text-xs text-white/20">
                {nav.length} sections &nbsp;·&nbsp; Last built{" "}
                {new Date(structure.lastGenerated).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 py-14 space-y-16">

        {/* ── Getting Started ── */}
        {startPages.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-1 h-5 rounded-full bg-[#0ea5e9]" />
              <h2 className="text-base font-semibold text-white tracking-tight">Getting Started</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {startPages.map((p) => (
                <StartCard key={p.href} title={p.title} desc={p.desc} href={p.href} badge={p.badge} />
              ))}
            </div>
          </section>
        )}

        {/* Divider */}
        <div style={{ height: "1px", background: "linear-gradient(90deg,transparent,rgba(14,165,233,0.18) 40%,rgba(14,165,233,0.18) 60%,transparent)" }} />

        {/* ── Core Concepts ── */}
        {coreSections.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-1 h-5 rounded-full bg-white/20" />
              <h2 className="text-base font-semibold text-white tracking-tight">Reference</h2>
              <span className="text-xs text-white/25 ml-1">{coreSections.length} sections</span>
            </div>

            <div className="grid md:grid-cols-2 gap-x-10 gap-y-8">
              {coreSections.map((section) => {
                const color = accentFor(section.slug);
                return (
                  <div key={section.slug}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                      <h3 className="text-xs font-semibold tracking-[0.16em] uppercase" style={{ color }}>
                        {section.title}
                      </h3>
                    </div>
                    <div className="bg-[#0a0a0a] border border-white/[0.06] rounded-xl px-4 divide-y divide-white/[0.04]">
                      {section.pages.slice(0, 8).map((p) => (
                        <PageRow key={p.path} {...p} />
                      ))}
                      {section.pages.length > 8 && (
                        <a
                          href={section.pages[0].path}
                          className="flex items-center gap-1.5 py-3 text-xs text-white/25 hover:text-white/50 transition-colors"
                        >
                          <ChevronRight className="w-3 h-3" />
                          {section.pages.length - 8} more pages
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Guides ── */}
        {guidePages.length > 0 && (
          <>
            <div style={{ height: "1px", background: "linear-gradient(90deg,transparent,rgba(14,165,233,0.18) 40%,rgba(14,165,233,0.18) 60%,transparent)" }} />
            <section>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1 h-5 rounded-full bg-[#f59e0b]" />
                <h2 className="text-base font-semibold text-white tracking-tight">Guides</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {guidePages.map((p) => (
                  <StartCard key={p.path} title={p.title} desc={p.description} href={p.path} />
                ))}
              </div>
            </section>
          </>
        )}

        {/* Divider */}
        <div style={{ height: "1px", background: "linear-gradient(90deg,transparent,rgba(14,165,233,0.18) 40%,rgba(14,165,233,0.18) 60%,transparent)" }} />

        {/* ── External ── */}
        <section>
          <h2 className="text-base font-semibold text-white tracking-tight mb-5">Community &amp; Source</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <a
              href="https://github.com/Far-Beyond-Pulsar/Pulsar-Native"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-4 bg-[#0c0c0c] border border-white/[0.07] rounded-xl p-5 hover:border-white/[0.16] transition-all"
            >
              <Github className="w-5 h-5 text-white/30 group-hover:text-white/60 mt-0.5 shrink-0 transition-colors" />
              <div>
                <p className="text-sm font-semibold text-white/80 group-hover:text-white mb-1 transition-colors">
                  GitHub — Pulsar-Native
                </p>
                <p className="text-xs text-white/35 leading-relaxed">
                  Source code, open issues, pull requests, and release history.
                </p>
              </div>
            </a>
            <a
              href="https://github.com/orgs/Far-Beyond-Pulsar/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-4 bg-[#0c0c0c] border border-white/[0.07] rounded-xl p-5 hover:border-white/[0.16] transition-all"
            >
              <MessageSquare className="w-5 h-5 text-white/30 group-hover:text-white/60 mt-0.5 shrink-0 transition-colors" />
              <div>
                <p className="text-sm font-semibold text-white/80 group-hover:text-white mb-1 transition-colors">
                  GitHub Discussions
                </p>
                <p className="text-xs text-white/35 leading-relaxed">
                  Ask questions, share ideas, and connect with contributors.
                </p>
              </div>
            </a>
          </div>
        </section>

      </div>
    </div>
  );
}
