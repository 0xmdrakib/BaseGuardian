import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Premium "Midnight Sapphire" palette. Existing utility names stay
        // intact so this is a color-only refresh with no layout changes.
        white: "#f7faff",
        black: "#02050c",
        neutral: {
          50: "#f7faff",
          100: "#eef3fb",
          200: "#dce5f1",
          300: "#bac7d8",
          400: "#8795a8",
          500: "#657184",
          600: "#485366",
          700: "#303a4c",
          800: "#1d2638",
          900: "#101829",
          950: "#060b16",
        },
        blue: {
          50: "#eff7ff",
          100: "#dbeeff",
          200: "#bfdeff",
          300: "#91c7ff",
          400: "#62a8ff",
          500: "#4387ff",
          600: "#2b67f5",
          700: "#2453df",
          800: "#2345b4",
          900: "#223e8e",
          950: "#172756",
        },
        emerald: {
          50: "#edfff8",
          100: "#d4fbea",
          200: "#adf4d6",
          300: "#7ee8c0",
          400: "#55d6a5",
          500: "#32b98b",
          600: "#218f6b",
          700: "#1f7258",
          800: "#1d5b49",
          900: "#194b3d",
          950: "#0a2b24",
        },
        amber: {
          50: "#fff9e8",
          100: "#fff1cc",
          200: "#fbe0a3",
          300: "#f3c969",
          400: "#dfae49",
          500: "#bd8730",
          600: "#996723",
          700: "#795020",
          800: "#64411f",
          900: "#54371e",
          950: "#301b0d",
        },
        rose: {
          50: "#fff1f3",
          100: "#ffe2e7",
          200: "#ffcbd6",
          300: "#fca9ba",
          400: "#f27d9b",
          500: "#dc587c",
          600: "#bd385f",
          700: "#9d2c4f",
          800: "#832846",
          900: "#70263f",
          950: "#3e0f20",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};

export default config;
