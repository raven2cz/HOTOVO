/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          light: '#f8fafc',
          dark: '#0b0f19',
        },
        panel: {
          light: '#ffffff',
          dark: '#141d2f',
        },
        border: {
          light: '#e2e8f0',
          dark: '#1f2d47',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-primary': '0 0 15px rgba(99, 102, 241, 0.15)',
        'glow-success': '0 0 15px rgba(16, 185, 129, 0.15)',
        'glow-warning': '0 0 15px rgba(245, 158, 11, 0.15)',
      }
    },
  },
  plugins: [],
}
