/**
 * Validate an Echo-3 capture bundle.
 *
 *   npx tsx src/cli.ts <bundle.zip | bundleDir> [--json]
 *
 * Pass the bundle ZIP, or a folder holding `images/` and `cameras/` (one
 * wrapper folder such as `bundle/` is tolerated). Exits 0 when there are no
 * errors, 1 when there are, 2 on bad usage.
 */
import fs from "node:fs";

import { validateBundle, type BundleReport } from "./bundle.js";

function printReport(report: BundleReport): void {
  for (const error of report.errors) {
    console.error(`error   [${error.code}] ${error.message}`);
  }
  for (const warning of report.warnings) {
    console.warn(`warning [${warning.code}] ${warning.message}`);
  }
  const verdict = report.errors.length === 0 ? "OK" : "INVALID";
  const details = [
    `${report.frameCount} frames`,
    `${report.errors.length} errors`,
    `${report.warnings.length} warnings`,
  ];
  if (report.wrapperFolder) details.push(`wrapper folder ${report.wrapperFolder}/`);
  if (report.orientation) {
    details.push(`orientation ${report.orientation} (${report.orientationSource})`);
  }
  console.log(`${verdict}: ${details.join(", ")}`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const [inputPath] = argv.filter((arg) => !arg.startsWith("--"));
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error("Usage: validate-bundle <bundle.zip | bundleDir> [--json]");
    process.exit(2);
  }
  const report = validateBundle(inputPath);
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  process.exit(report.errors.length === 0 ? 0 : 1);
}

main();
