"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import "./globals.css";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { Inter } from "next/font/google";
import { usePathname } from "next/navigation";
import mermaid from "mermaid";

const inter = Inter({ subsets: ["latin"] });

const metadata = {
  title: "Pulsar Docs",
  description:
    "A blog about game and web development, backend programming, hardware, security, privacy, and technology.",
};

// -----------------------------------------------------------------------------
// hooks & helper components
// -----------------------------------------------------------------------------

/**
 * Tracks whether the warning banner is still visible. It becomes false on the
 * first scroll event anywhere in the document (captured during capture phase).
 */
function useBannerVisibility() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!visible) return;
    const handler = () => setVisible(false);
    document.addEventListener("scroll", handler, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", handler, { capture: true });
  }, [visible]);

  return visible;
}

/**
 * Returns the current height of the fixed header element.
 */
function useHeaderHeight() {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = document.querySelector("header");
    const update = () => setHeight(el ? (el as HTMLElement).offsetHeight : 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return height;
}

/**
 * Returns the total vertical offset occupied by the fixed header and (optionally)
 * the banner. Recalculates on resize and whenever the banner visibility changes.
 */
function useHeaderOffset(bannerVisible: boolean) {
  const [offset, setOffset] = useState(0);

  useLayoutEffect(() => {
    const headerEl = document.querySelector("header");
    const bannerEl = document.querySelector("[data-notice-banner]");

    const update = () => {
      const h = headerEl ? (headerEl as HTMLElement).offsetHeight : 0;
      const b = bannerVisible && bannerEl ? (bannerEl as HTMLElement).offsetHeight : 0;
      setOffset(h + b);
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [bannerVisible]);

  return offset;
}

/**
 * The yellow notice banner shown at the top of the site.
 */
function NoticeBanner({ visible, headerHeight }: { visible?: boolean; headerHeight: number }) {
  return (
    <div
      data-notice-banner
      className="fixed w-full z-40 bg-yellow-500/10 border-b border-yellow-500/20"
      style={{
        top: `${headerHeight}px`,
        transform: visible
          ? 'translateY(0)'
          : `translateY(calc(-100% - ${headerHeight}px))`,
        transition: 'transform 300ms ease-out',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 py-3">
        <div className="flex items-start gap-3">
          <svg
            className="w-5 h-5 text-yellow-500 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div className="flex-1">
            <p className="text-sm text-yellow-200">
              <strong className="font-semibold">
                Documentation Under Active Development:
              </strong>{" "}
              Many sections of this documentation are being updated to
              reflect the current state of Pulsar Engine. Information may be
              incomplete or not yet accurate. Thank you for your patience as we
              improve the docs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Root layout component
// -----------------------------------------------------------------------------

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDocsPage = pathname?.startsWith("/docs") && pathname !== "/docs";

  const bannerVisible = useBannerVisibility();
  const headerHeight = useHeaderHeight();
  const offsetTop = useHeaderOffset(bannerVisible);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={metadata.description} />
        <title>{metadata.title}</title>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>

      <body className={`${inter.className} bg-black text-gray-100`}>
        <Header />
        <NoticeBanner visible={bannerVisible} headerHeight={headerHeight} />

        {isDocsPage ? (
          <div
            style={{ paddingTop: `${offsetTop}px` }}
            className="transition-all duration-300 ease-out"
          >
            {children}
          </div>
        ) : (
          <div
            style={{ paddingTop: `${offsetTop}px` }}
            className="transition-all duration-300 ease-out"
          >
            <main className="grow container mx-auto px-4 py-8">
              {children}
            </main>
            <Footer />
          </div>
        )}
      </body>
    </html>
  );
}
