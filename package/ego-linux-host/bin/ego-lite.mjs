#!/usr/bin/env node
import { runCli } from "../dist/src/cli.js";
process.exitCode = await runCli(["open", ...process.argv.slice(2)]);
