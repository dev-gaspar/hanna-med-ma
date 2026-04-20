/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: "class",
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		extend: {
			fontFamily: {
				sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
				serif: ["Newsreader", "ui-serif", "Georgia", "serif"],
				mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
			},
			colors: {
				// Neutral scale — warm, low-chroma (wired via CSS vars so dark mode swaps cleanly)
				n: {
					0: "var(--n-0)",
					50: "var(--n-50)",
					100: "var(--n-100)",
					150: "var(--n-150)",
					200: "var(--n-200)",
					300: "var(--n-300)",
					400: "var(--n-400)",
					500: "var(--n-500)",
					600: "var(--n-600)",
					700: "var(--n-700)",
					800: "var(--n-800)",
					900: "var(--n-900)",
				},
				// Primary — muted deep teal
				p: {
					50: "var(--p-50)",
					100: "var(--p-100)",
					200: "var(--p-200)",
					300: "var(--p-300)",
					400: "var(--p-400)",
					500: "var(--p-500)",
					600: "var(--p-600)",
					700: "var(--p-700)",
					800: "var(--p-800)",
					900: "var(--p-900)",
				},
				// Legacy aliases so older code/text classes keep compiling until refactored.
				primary: {
					DEFAULT: "var(--p-600)",
					50: "var(--p-50)",
					100: "var(--p-100)",
					200: "var(--p-200)",
					300: "var(--p-300)",
					400: "var(--p-400)",
					500: "var(--p-500)",
					600: "var(--p-600)",
					700: "var(--p-700)",
					800: "var(--p-800)",
					900: "var(--p-900)",
				},
				background: {
					DEFAULT: "var(--n-0)",
					secondary: "var(--n-50)",
				},
			},
			borderRadius: {
				none: "0",
				sm: "4px",
				DEFAULT: "6px",
				md: "6px",
				lg: "10px",
				xl: "14px",
				"2xl": "18px",
			},
			boxShadow: {
				soft: "0 1px 2px 0 rgba(20,19,17,0.04), 0 1px 3px 0 rgba(20,19,17,0.06)",
				pop: "0 10px 40px -20px rgba(20,19,17,0.18)",
				deep: "0 20px 60px -30px rgba(20,19,17,0.25)",
			},
			fontSize: {
				"2xs": ["10px", "14px"],
			},
		},
	},
	plugins: [],
};
