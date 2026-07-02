#!/usr/bin/env node
import { runCli } from './index.js';

const { exitCode } = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  log: (l) => console.log(l),
  error: (l) => console.error(l),
});
process.exit(exitCode);
