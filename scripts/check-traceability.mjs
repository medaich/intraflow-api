import fs from "node:fs";
import path from "node:path";

const traceabilityPath = path.resolve(process.cwd(), "docs/TEST_TRACEABILITY.md");

if (!fs.existsSync(traceabilityPath)) {
  console.error(`Error: Traceability file not found at ${traceabilityPath}`);
  process.exit(1);
}

const content = fs.readFileSync(traceabilityPath, "utf8");
const lines = content.split("\n");

let totalRows = 0;
let errors = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line.startsWith("|") || !line.endsWith("|")) continue;

  const cols = line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

  if (cols.length < 4) continue;
  const [rule, fileRaw, testNameRaw, status] = cols;

  // Skip table header and separator rows
  if (
    rule.includes("Rule / Requirement") ||
    rule.startsWith(":---") ||
    rule.startsWith("---") ||
    fileRaw.startsWith(":---") ||
    fileRaw.startsWith("---")
  ) {
    continue;
  }

  const file = fileRaw.replace(/`/g, "").trim();
  const testName = testNameRaw.replace(/`/g, "").trim();

  if (!file || !testName || file.toLowerCase() === "n/a") continue;

  totalRows++;
  const resolvedFile = path.resolve(process.cwd(), file);

  if (!fs.existsSync(resolvedFile)) {
    console.error(
      `Line ${i + 1}: Referenced test file does not exist: "${file}" (Rule: "${rule}")`,
    );
    errors++;
    continue;
  }

  const fileContent = fs.readFileSync(resolvedFile, "utf8");

  // Check if literal test or describe title exists in the file
  const hasLiteralTitle =
    fileContent.includes(`'${testName}'`) ||
    fileContent.includes(`"${testName}"`) ||
    fileContent.includes(`\`${testName}\``) ||
    fileContent.includes(testName);

  if (!hasLiteralTitle) {
    console.error(
      `Line ${i + 1}: Exact test name not found in "${file}":\n  Missing title: "${testName}"\n  Rule: "${rule}"`,
    );
    errors++;
  }
}

if (errors > 0) {
  console.error(`\nTraceability check failed: ${errors} mismatch(es) found out of ${totalRows} rows.`);
  process.exit(1);
} else {
  console.log(`Traceability check passed: all ${totalRows} test rules verified against actual test suites.`);
  process.exit(0);
}
