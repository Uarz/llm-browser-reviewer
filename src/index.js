#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { chromium } from "playwright";

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const DEFAULT_BROWSER_PROVIDER = "playwright";
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
  --browser-provider <value>  Browser provider: playwright|humanbrowser. Default: ${DEFAULT_BROWSER_PROVIDER}
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
  HUMANBROWSER_API_TOKEN=hb_live_... node src/index.js --url https://example.com --browser-provider humanbrowser --dry-run
`);
}

function parseArgs(argv) {
  const options = {
    model: DEFAULT_MODEL,
    browserProvider: DEFAULT_BROWSER_PROVIDER,
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
      } else if (key === "browser-provider") {
        if (!["playwright", "humanbrowser"].includes(value)) {
          throw new Error("--browser-provider must be playwright or humanbrowser");
        }
        options.browserProvider = value;
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
          htmlName: control.getAttribute("name") || "",
          accessibleLabel: pickText(control.getAttribute("aria-label") || control.innerText || control.getAttribute("placeholder"))
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

function toCleanString(value) {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function parseJsonObjectFromText(text) {
  const trimmed = toCleanString(text);
  if (!trimmed) {
    return null;
  }

  const fenceMatch = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return null;
    }

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function normalizeHumanBrowserHeadings(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_ITEMS)
    .map((heading) => {
      if (typeof heading === "string") {
        return { level: "", text: toCleanString(heading) };
      }

      if (!heading || typeof heading !== "object") {
        return null;
      }

      return {
        level: toCleanString(heading.level || heading.tag || heading.role),
        text: toCleanString(heading.text || heading.label || heading.name)
      };
    })
    .filter((heading) => heading && heading.text);
}

function normalizeHumanBrowserLinks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_ITEMS)
    .map((link) => {
      if (!link || typeof link !== "object") {
        return null;
      }

      return {
        text: toCleanString(link.text || link.label || link.name),
        href: toCleanString(link.href || link.url)
      };
    })
    .filter((link) => link && (link.text || link.href));
}

function normalizeHumanBrowserControls(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_ITEMS)
    .map((control) => {
      if (!control || typeof control !== "object") {
        return null;
      }

      return {
        tag: toCleanString(control.tag || control.role || control.type),
        type: toCleanString(control.type || control.inputType),
        htmlName: toCleanString(control.htmlName || control.name),
        accessibleLabel: toCleanString(control.accessibleLabel || control.label || control.text || control.placeholder)
      };
    })
    .filter((control) => control && (control.tag || control.type || control.htmlName || control.accessibleLabel));
}

function unwrapHumanBrowserSnapshotCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  for (const key of ["snapshot", "pageSnapshot", "browserSnapshot"]) {
    if (candidate[key] && typeof candidate[key] === "object" && !Array.isArray(candidate[key])) {
      return candidate[key];
    }
  }

  return candidate;
}

function normalizeHumanBrowserStructuredSnapshot(candidate, target) {
  const snapshot = unwrapHumanBrowserSnapshotCandidate(candidate);
  if (!snapshot) {
    return null;
  }

  const headings = normalizeHumanBrowserHeadings(snapshot.headings);
  const links = normalizeHumanBrowserLinks(snapshot.links);
  const controls = normalizeHumanBrowserControls(snapshot.controls);
  const normalized = {
    finalUrl: toCleanString(snapshot.finalUrl || snapshot.currentUrl || snapshot.url) || target,
    title: toCleanString(snapshot.title),
    metaDescription: toCleanString(snapshot.metaDescription || snapshot.description),
    headings,
    links,
    controls,
    bodyText: toCleanString(snapshot.bodyText || snapshot.pageText || snapshot.summary || snapshot.text)
  };

  const hasPageSignal =
    normalized.title ||
    normalized.metaDescription ||
    normalized.bodyText ||
    headings.length > 0 ||
    links.length > 0 ||
    controls.length > 0 ||
    normalized.finalUrl !== target;

  return hasPageSignal ? normalized : null;
}

function collectHumanBrowserOutputs(session) {
  const artifactData = [];
  const artifactTexts = [];

  for (const artifact of Array.isArray(session.artifacts) ? session.artifacts : []) {
    for (const part of Array.isArray(artifact.parts) ? artifact.parts : []) {
      if (part.kind === "data" && part.data && typeof part.data === "object" && !Array.isArray(part.data)) {
        artifactData.push(part.data);
      }

      if (part.kind === "text" && typeof part.text === "string") {
        artifactTexts.push(part.text);
      }
    }
  }

  return {
    artifactData,
    artifactTexts,
    resultText: typeof session.text === "string" ? session.text.trim() : ""
  };
}

function findHumanBrowserStructuredSnapshot(session, target) {
  const { artifactData, artifactTexts, resultText } = collectHumanBrowserOutputs(session);

  for (const data of artifactData) {
    const snapshot = normalizeHumanBrowserStructuredSnapshot(data, target);
    if (snapshot) {
      return { snapshot, source: "artifact-data" };
    }
  }

  for (const text of artifactTexts) {
    const parsed = parseJsonObjectFromText(text);
    const snapshot = normalizeHumanBrowserStructuredSnapshot(parsed, target);
    if (snapshot) {
      return { snapshot, source: "artifact-text" };
    }
  }

  const parsedResultText = parseJsonObjectFromText(resultText);
  const snapshot = normalizeHumanBrowserStructuredSnapshot(parsedResultText, target);
  return snapshot ? { snapshot, source: "result-text" } : null;
}

async function captureHumanBrowserSnapshot(target, options) {
  if (!process.env.HUMANBROWSER_API_TOKEN && !process.env.HB_TOKEN) {
    throw new Error("HUMANBROWSER_API_TOKEN or HB_TOKEN is required for --browser-provider humanbrowser.");
  }

  const humanbrowserModule = await import("@virixlabs/humanbrowser");
  const { runOnCloud } = humanbrowserModule.default ?? humanbrowserModule;

  let liveViewerUrl = null;
  const session = await runOnCloud({
    goal: [
      "Open the target URL in a HumanBrowser cloud browser and inspect the visible page for QA review.",
      "Return a compact JSON object with keys finalUrl, title, metaDescription, headings, links, controls, and bodyText.",
      "Use arrays for headings, links, and controls. If exact DOM extraction is unavailable, leave arrays empty and put a concise observed summary in bodyText.",
      "Do not include markdown or credentials in the final answer.",
      `Target URL: ${target}`
    ].join(" "),
    apiToken: process.env.HUMANBROWSER_API_TOKEN || process.env.HB_TOKEN,
    apiBase: process.env.HUMANBROWSER_API_BASE || undefined,
    profile: "llm-browser-reviewer",
    contextData: {
      targetUrl: target,
      requestedCapture: "page summary",
      outputShape: {
        finalUrl: "string",
        title: "string",
        metaDescription: "string",
        headings: [{ level: "string", text: "string" }],
        links: [{ text: "string", href: "string" }],
        controls: [{ tag: "string", type: "string", htmlName: "string", accessibleLabel: "string" }],
        bodyText: "concise visible-page summary"
      }
    },
    onStatus: (status) => {
      if (status && status.viewerUrl && !liveViewerUrl) {
        liveViewerUrl = status.viewerUrl;
        console.error(`HumanBrowser live viewer: ${liveViewerUrl}`);
      }
    }
  });

  const resultText = typeof session.text === "string" ? session.text.trim() : "";
  const viewerUrl = session.viewerUrl || liveViewerUrl || null;
  const structured = findHumanBrowserStructuredSnapshot(session, target);
  const structuredSnapshot = structured?.snapshot || {};

  const normalized = {
    capturedAt: new Date().toISOString(),
    automationTool: "HumanBrowser Cloud",
    requestedUrl: target,
    finalUrl: structuredSnapshot.finalUrl || target,
    title: structuredSnapshot.title || "",
    metaDescription: structuredSnapshot.metaDescription || "",
    headings: structuredSnapshot.headings || [],
    links: structuredSnapshot.links || [],
    controls: structuredSnapshot.controls || [],
    bodyText: trimText(structuredSnapshot.bodyText || resultText || ""),
    browserSignals: {
      consoleErrors: [],
      failedRequests: []
    },
    providerDetails: {
      provider: "humanbrowser",
      viewerUrl,
      taskId: session.taskId || null,
      state: session.state || "",
      structuredOutputAvailable: Boolean(structured),
      structuredOutputSource: structured?.source || null,
      summaryText: resultText || ""
    }
  };

  return normalized;
}

async function captureBrowserSnapshot(target, options) {
  if (options.browserProvider === "humanbrowser") {
    return captureHumanBrowserSnapshot(target, options);
  }
  return capturePageSnapshot(target, options);
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
  const snapshot = await captureBrowserSnapshot(target, options);
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
