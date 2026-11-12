"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Dark is the product default; the toggle in the topbar lets staff switch to
 * the light theme. `disableTransitionOnChange` avoids a full-page colour
 * smear when the class flips.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
