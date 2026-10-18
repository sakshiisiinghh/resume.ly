import { spawn } from "node:child_process";

// Runs the web server and the worker side by side and stops both if either one dies.
const processes = [
    { name: "web", file: "server/index.ts" },
    { name: "worker", file: "worker/index.ts" },
].map(({ name, file }) => ({ name, child: spawn(process.execPath, ["--import", "tsx", file], { stdio: "inherit" }) }));

let stopping = false;

function stop(code: number) {
    if (stopping) return;
    stopping = true;
    for (const { child } of processes) child.kill("SIGTERM");
    setTimeout(() => process.exit(code), 15_000).unref();
}

for (const { name, child } of processes) {
    child.on("exit", (code, signal) => {
        if (!stopping) console.error(JSON.stringify({ level: 50, service: "supervisor", msg: `${name} exited`, code, signal }));
        stop(code ?? 1);
    });
}

process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
