import esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["main.ts"],
	bundle: true,
	format: "cjs",
	platform: "browser",
	target: "es2018",
	external: ["obsidian", "electron"],
	outfile: "main.js",
	logLevel: "info"
});
