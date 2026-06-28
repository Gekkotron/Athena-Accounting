/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Hanken Grotesk — distinctive grotesque for UI/body
        sans: ['"Hanken Grotesk Variable"', '"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        // Fraunces — characterful variable serif for display + italic emphasis
        display: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        // JetBrains Mono — tabular numerals for amounts
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Warm-cool charcoal base — not pure slate, has a tiny bit of warmth
        ink: {
          950: '#0b0d11',   // page background
          900: '#11141a',   // surfaces, cards
          850: '#161a21',   // hover / secondary surface
          800: '#1d2230',   // borders strong
          700: '#272d3b',   // dividers, ring
          600: '#3a4252',
          500: '#5b6478',
          400: '#7c8493',
          300: '#a0a7b4',
          200: '#cdd2db',
          100: '#e6e8ed',   // body text
          50:  '#f4f5f8',   // hero text
        },
        // Sage emerald — softer than tailwind emerald, paper-friendly
        sage: {
          50:  '#eef9f4',
          100: '#d6f1e4',
          200: '#aee2cb',
          300: '#7dd3c0',   // primary positive
          400: '#52baa6',
          500: '#349e8b',
          600: '#247c6e',
          700: '#1d6258',
          800: '#194f48',
          900: '#16413b',
        },
        // Terracotta — softer than rose for negatives, warm
        clay: {
          50:  '#fcf2ee',
          100: '#f7dfd5',
          200: '#efbeae',
          300: '#e69782',
          400: '#dc7861',   // primary negative
          500: '#c75a45',
          600: '#a64635',
          700: '#83392c',
          800: '#693026',
          900: '#592a23',
        },
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(0,0,0,0.2), 0 1px 0 rgba(255,255,255,0.03) inset',
        'card': '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 32px -16px rgba(0,0,0,0.6)',
      },
      backgroundImage: {
        'noise':
          // Tiny SVG noise overlay baked as data URI — no external request.
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.045 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
      },
    },
  },
  plugins: [],
};
