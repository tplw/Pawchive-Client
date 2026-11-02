/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "rgb(var(--base) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        favorite: "rgb(var(--favorite) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Helvetica", "Helvetica Neue", "Arial", "sans-serif"],
      },
      borderRadius: {
        lg: "6px",
        xl: "8px",
        "2xl": "10px",
        xl2: "10px",
      },
      opacity: {
        6: "0.06",
        7: "0.07",
        8: "0.08",
        12: "0.12",
        15: "0.15",
        18: "0.18",
        22: "0.22",
        35: "0.35",
        45: "0.45",
        55: "0.55",
        65: "0.65",
        85: "0.85",
      },
      boxShadow: {
        lift: "0 0 0 1px rgb(var(--accent) / 0.22), 0 12px 34px -18px rgb(var(--accent) / 0.42)",
        glow: "0 0 0 1px rgb(var(--accent) / 0.3), 0 10px 28px -14px rgb(var(--accent) / 0.45)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-500px 0" },
          "100%": { backgroundPosition: "500px 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "slide-up": "slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        shimmer: "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};
