/** Same theme the page previously passed to the Tailwind Play CDN at runtime. */
module.exports = {
  content: ["../../templates/**/*.html"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Aquawax Pro"', '"Nunito Sans"', "system-ui", "sans-serif"],
      },
      colors: {
        ember: { DEFAULT: "#ff5406", hover: "#e84a00" },
        verdant: "#00b33f",
        sunset: "#ff6d00",
        signal: "#ff3400",
        graphite: "#2f2f2f",
        fog: "#f5f5f5",
        muted: "#6b6b6b",
        hairline: "#ebebeb",
      },
      borderRadius: {
        "3xl": "26px",
      },
    },
  },
};
