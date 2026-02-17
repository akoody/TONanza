import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#050510", // Deep Void
        surface: "rgba(26, 26, 46, 0.6)", // Glass panels
        "neon-blue": "#06b6d4", // cyan-500
        "brand-purple": "#F700FF",
        "brand-pink": "#A600FF",
        "electric-pink": "#FF0055", // Bright Electric Pink
        "cyan-deep": "#083344", // deep cyan
        "brand-gold": "#FFD700",
        "brand-amber": "#FFAA00",
      },
      fontFamily: {
        sans: ["Inter", "Kanit", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        "neon-blue": "0 0 15px rgba(6, 182, 212, 0.6)",
        "neon-gold": "0 0 25px rgba(255, 215, 0, 0.6)",
        "neon-pink": "0 0 20px rgba(247, 0, 255, 0.5)",
        "electric-pink": "0 0 20px rgba(255, 0, 85, 0.6)",
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(to right, #F700FF, #A600FF)",
        "gradient-gold": "linear-gradient(to right, #FFD700, #FFAA00)",
        "neon-grid": "linear-gradient(rgba(6, 182, 212, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.05) 1px, transparent 1px)"
      },
      keyframes: {
        "pulse-fast": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" }
        },
        "laser-pass": {
          "0%": { filter: "brightness(1) drop-shadow(0 0 0 transparent)" },
          "50%": { filter: "brightness(1.5) drop-shadow(0 0 10px cyan)" },
          "100%": { filter: "brightness(1) drop-shadow(0 0 0 transparent)" }
        },
        "shimmer": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" }
        }
      },
      animation: {
        "pulse-fast": "pulse-fast 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "laser-pass": "laser-pass 0.3s ease-out forwards",
        "shimmer": "shimmer 1.5s infinite"
      }
    }
  },
  plugins: []
};

export default config;
