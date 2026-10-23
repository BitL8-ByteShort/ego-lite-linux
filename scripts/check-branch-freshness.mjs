#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function checkBranchFreshness({
  cwd = process.cwd(),
  runGit = (args) =>
    spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }),
  log = console.log,
} = {}) {
  const remote =
    runGit(["remote", "get-url", "upstream"]).status === 0
      ? "upstream"
      : "origin";
  if (runGit(["fetch", "--quiet", remote, "dev"]).status !== 0) {
    log(`⚠ skip branch-freshness check: cannot fetch ${remote}/dev (offline?)`);
    return 0;
  }
  if (
    runGit(["merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD"]).status === 0
  )
    return 0;
  log(`✗ Your branch is behind ${remote}/dev — sync before committing:`);
  log(
    `    git fetch ${remote} dev && git rebase ${remote}/dev   # or: git merge ${remote}/dev`,
  );
  return 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = checkBranchFreshness();
}
