import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        deep: {
          bgFrom: "#0f172a",
          bgVia: "#042f2e",
          bgTo: "#0f172a"
        },
        action: {
          pink: "#ec4899",
          pinkHover: "#f472b6"
        },
        jackpot: {
          goldA: "#fcd34d",
          goldB: "#eab308"
        }
      },
      fontFamily: {
        sans: ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      boxShadow: {
        action: "0 0 28px rgba(236, 72, 153, 0.45)",
        glow: "0 0 38px rgba(45, 212, 191, 0.25)"
      },
      keyframes: {
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.015)" }
        },
        pulseLine: {
          "0%, 100%": { opacity: "0.35" },
          "50%": { opacity: "0.9" }
        }
      },
      animation: {
        breathe: "breathe 2.8s ease-in-out infinite",
        pulseLine: "pulseLine 1.2s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
