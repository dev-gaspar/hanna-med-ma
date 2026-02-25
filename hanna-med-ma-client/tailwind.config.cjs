/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#53489E',
          50: '#E8E6F5',
          100: '#D1CEEB',
          200: '#A39DD7',
          300: '#766BC3',
          400: '#53489E',
          500: '#42397E',
          600: '#322B5F',
          700: '#211C3F',
          800: '#110E20',
          900: '#000000',
        },
        background: {
          DEFAULT: '#FFFFFF',
          secondary: '#F2F8FF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        lg: "0.5rem",
        md: "0.375rem",
        sm: "0.25rem",
      },
    },
  },
  plugins: [],
}
