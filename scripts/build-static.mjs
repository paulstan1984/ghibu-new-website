import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			stdio: "inherit",
			shell: false,
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${signal ?? `code ${code}`}`));
		});
	});
}

try {
	await run(process.execPath, [path.join(root, "node_modules", "astro", "bin", "astro.mjs"), "build"]);
	await run(process.execPath, [path.join(root, "scripts", "export-static.mjs")]);
} catch (error) {
	console.error("Static export failed:", error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
