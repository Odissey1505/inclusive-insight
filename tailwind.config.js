/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        card: v('card'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        primary: { DEFAULT: '#5B9BD5', soft: v('primary-soft'), dark: v('primary-dark') },
        mint: { DEFAULT: '#8CCFB5', soft: v('mint-soft'), dark: v('mint-dark') },
        sun: { DEFAULT: '#F4D38B', soft: v('sun-soft'), dark: v('sun-dark') },
        coral: { DEFAULT: '#ECA5A0', soft: v('coral-soft'), dark: v('coral-dark') },
      },
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(37,52,74,.04), 0 4px 16px rgba(37,52,74,.06)',
        lift: '0 2px 4px rgba(37,52,74,.06), 0 12px 32px rgba(37,52,74,.12)',
      },
    },
  },
  plugins: [],
};
