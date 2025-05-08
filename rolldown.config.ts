import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";
import copy from "rollup-plugin-copy";

export default defineConfig({
  input: "src/server.ts",
  output: {
    format: "esm",
  },
  platform: "node",
  plugins: [
    dts(),
    copy({
      targets: [{ src: ["package.json"], dest: "dist" }],
    }),
  ],
});
