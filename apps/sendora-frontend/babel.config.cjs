module.exports = {
  presets: [
    [
      "@babel/preset-env",
      {
        targets: { node: "current" },
        // Transform ESM import/export to CJS so Jest can run route handlers
        modules: "commonjs",
      },
    ],
  ],
};
