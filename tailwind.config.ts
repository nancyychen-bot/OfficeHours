import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f7f7f5", // Notion-like light gray
        line: "#e9e9e7",
      },
    },
  },
  plugins: [],
};

export default config;
