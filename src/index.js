#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { chromium } from "playwright";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TEXT_CHARS = 8000;
const MAX_ITEMS = 30;

function printHelp() {
  console.log(`
LLM Browser Reviewer

Usage:
  node src/index.js --url <url-or-local-html> [options]

Options:
  --url <value>          URL or local HTML file to review.
  --task <value>         Review focus for the LLM.
  --model <value>        OpenAI model name. Default: ${DEFAULT_MODEL}
  --output <path>        Write the Markdown report to a file.
  --screenshot <path>    Save a full-page screenshot.
  --timeout <ms>         Navigation timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --headful              Run the browser with a visible window.
  --dry-run              Skip the LLM call and output the browser snapshot.
  --help                 Show this help message.

Examples:
  node src/index.js --url https://example.com --dry-run
  OPENAI_API_KEY=... node src/index.js --url https://example.com --output report.md
  OPENAI_BASE_URL=https://your-openai-compatible-relay/v1 OPENAI_API_KEY=... node src/index.js --url https://example.com --model gpt-4o-mini --output report.md
`);
}

function parseArgs(argv) {
  const options = {
    model: DEFAULT_MODEL,
    timeout: DEFAULT_TIMEOUT_MS,
    task: "Evaluate this page as an AI developer tester. Identify UX, reliability, accessibility, and automation-testing observations.",
    dryRun: false,
    headful: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--headful") {
      options.headful = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      if (key === "timeout") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--timeout must be a positive number");
        }
        options.timeout = parsed;
      } else {
        options[key] = value;
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function normalizeTarget(input) {
  if (!input) {
    throw new Error("Missing --url. Run with --help for examples.");
  }

  if (/^https?:\/\//i.test(input) || /^file:\/\//i.test(input)) {
    return input;
  }

  const absolutePath = path.resolve(input);
  await fs.access(absolutePath);
  return pathToFileURL(absolutePath).href;
}

function trimText(text, limit = MAX_TEXT_CHARS) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit)}... [truncated]`;
}

async function capturePageSnapshot(target, options) {
  const consoleErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({ headless: !options.headful });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 }
  });

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleErrors.push({
        type: message.type(),
        text: message.text()
      });
    }
  });

  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "unknown"
    });
  });

  try {
    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: options.timeout
    });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    if (options.screenshot) {
      await fs.mkdir(path.dirname(path.resolve(options.screenshot)), { recursive: true });
      await page.screenshot({ path: options.screenshot, fullPage: true });
    }

    const snapshot = await page.evaluate(({ maxItems, maxTextChars }) => {
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      };

      const pickText = (value) => (value || "").replace(/\s+/g, " ").trim();

      const links = Array.from(document.querySelectorAll("a[href]"))
        .filter(isVisible)
        .slice(0, maxItems)
        .map((link) => ({
          text: pickText(link.innerText || link.getAttribute("aria-label")),
          href: link.href
        }));

      const controls = Array.from(document.querySelectorAll("button, input, textarea, select"))
        .filter(isVisible)
        .slice(0, maxItems)
        .map((control) => ({
          tag: control.tagName.toLowerCase(),
          type: control.getAttribute("type") || "",
          name: control.getAttribute("name") || "",
          label: pickText(control.innerText || control.getAttribute("aria-label") || control.getAttribute("placeholder"))
        }));

      const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .filter(isVisible)
        .slice(0, maxItems)
        .map((heading) => ({
          level: heading.tagName.toLowerCase(),
          text: pickText(heading.innerText)
        }));

      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
      const bodyText = pickText(document.body?.innerText || "").slice(0, maxTextChars);

      return {
        title: document.title,
        finalUrl: window.location.href,
        metaDescription,
        headings,
        links,
        controls,
        bodyText
      };
    }, { maxItems: MAX_ITEMS, maxTextChars: MAX_TEXT_CHARS });

    return {
      capturedAt: new Date().toISOString(),
      automationTool: "Playwright Chromium",
      requestedUrl: target,
      ...snapshot,
      bodyText: trimText(snapshot.bodyText),
      browserSignals: {
        consoleErrors: consoleErrors.slice(0, MAX_ITEMS),
        failedRequests: failedRequests.slice(0, MAX_ITEMS)
      }
    };
  } finally {
    await browser.close();
  }
}

function buildPrompt(snapshot, task) {
  return `You are an AI developer tester reviewing a web page captured through browser automation.

Task:
${task}

Use the page snapshot below. Produce a concise Markdown report with:
1. Executive summary
2. Key observations
3. Potential issues or risks
4. Suggested automated test cases
5. Follow-up questions for developers

Page snapshot:
${JSON.stringify(snapshot, null, 2)}
`;
}

async function runOpenAIReview(prompt, model) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required unless --dry-run is used.");
  }

  const clientOptions = {
    apiKey: process.env.OPENAI_API_KEY
  };

  if (process.env.OPENAI_BASE_URL) {
    clientOptions.baseURL = process.env.OPENAI_BASE_URL;
  }

  const client = new OpenAI(clientOptions);

  const response = await client.responses.create({
    model,
    input: prompt
  });

  return response.output_text || JSON.stringify(response.output, null, 2);
}

function renderDryRunReport(snapshot, task) {
  return `# LLM Browser Reviewer Dry Run

This dry run skipped the OpenAI API call and shows the browser automation snapshot that would be sent to the LLM.

## Task

${task}

## Browser Automation

- Tool: ${snapshot.automationTool}
- Requested URL: ${snapshot.requestedUrl}
- Final URL: ${snapshot.finalUrl}
- Captured at: ${snapshot.capturedAt}

## Page Summary

- Title: ${snapshot.title || "(none)"}
- Meta description: ${snapshot.metaDescription || "(none)"}
- Headings captured: ${snapshot.headings.length}
- Visible links captured: ${snapshot.links.length}
- Visible controls captured: ${snapshot.controls.length}
- Console warnings/errors captured: ${snapshot.browserSignals.consoleErrors.length}
- Failed requests captured: ${snapshot.browserSignals.failedRequests.length}

## Snapshot JSON

\`\`\`json
${JSON.stringify(snapshot, null, 2)}
\`\`\`
`;
}

async function writeOrPrint(report, outputPath) {
  if (!outputPath) {
    console.log(report);
    return;
  }

  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });
  await fs.writeFile(absoluteOutput, report, "utf8");
  console.log(`Report written to ${absoluteOutput}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const target = await normalizeTarget(options.url);
  const snapshot = await capturePageSnapshot(target, options);
  const prompt = buildPrompt(snapshot, options.task);
  const report = options.dryRun
    ? renderDryRunReport(snapshot, options.task)
    : await runOpenAIReview(prompt, options.model);

  await writeOrPrint(report, options.output);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
