// .mjs, not .js: apps/dcs runs strict lint (no rule downgrades — see
// eslint.config.mjs), which flags require()-style imports. Tailwind resolves
// tailwind.config.{js,cjs,mjs,ts} the same way, and postcss.config.mjs in
// this app already uses the ESM form, so this follows the same convention.
import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // DCS 1b.27: a field's own border, separate from --input (outline
        // buttons, Switch track, checkboxes) so those keep their look.
        'field-border': 'hsl(var(--field-border))',
        // DCS 1b.27 PR #104: a field's own fill, softer than --card.
        'field-bg': 'hsl(var(--field-bg))',
        // DCS 1a.24: brand signal + the two status tints the admin screens
        // use, so no screen hardcodes a raw Tailwind palette colour again.
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          strong: 'hsl(var(--brand-strong))'
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          bg: 'hsl(var(--success-bg))'
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          bg: 'hsl(var(--warning-bg))'
        }
      },
      keyframes: {
        // The indeterminate bar shown while a navigation is in flight.
        'nav-progress': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'nav-progress': 'nav-progress 1.1s ease-in-out infinite'
      }
    }
  },
  plugins: [tailwindcssAnimate],
};

export default config;
