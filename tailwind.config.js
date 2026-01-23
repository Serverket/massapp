/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      backgroundImage: {
        'massapp-flare': 'radial-gradient(circle at 15% 15%, rgba(14, 165, 233, 0.14), transparent 55%), radial-gradient(circle at 85% 20%, rgba(99, 102, 241, 0.18), transparent 52%), radial-gradient(circle at 45% 75%, rgba(168, 85, 247, 0.14), transparent 60%), linear-gradient(#020617, #050a22)',
      },
    },
  },
  plugins: [],
}

