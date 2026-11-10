"use client";

import { SiteHeader } from "./SiteHeader";

const BASE = process.env.NEXT_PUBLIC_CUSTOM_BASE_PATH || '';

// The shared Pulsar header (SiteHeader.tsx is identical on every site).
export const Header = () => (
  <SiteHeader current="docs" logoSrc={`${BASE}/assets/pulsar.png`} solid />
);

export default Header;
