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
          light: '#f7f8fb',
          dark: '#0a0b12',
        },
        panel: {
          light: '#ffffff',
          dark: '#12141d',
        },
        border: {
          light: '#e7e9f0',
          dark: '#222533',
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
