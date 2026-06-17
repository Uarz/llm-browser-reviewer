# LLM Browser Reviewer

LLM Browser Reviewer is a small, practical project that combines browser automation with an LLM API.

Repository: https://github.com/Uarz/llm-browser-reviewer

It uses Playwright to open a web page, collect a structured browser snapshot, and optionally capture a screenshot. It then sends that snapshot to the OpenAI Responses API to generate a concise QA-style review report.

## Why this project exists

This repository demonstrates two concrete skills:

- LLM API integration: calls the OpenAI Responses API from a Node.js CLI.
- Browser automation: uses Playwright Chromium to navigate pages and collect testable UI signals.

## Features

- Open any `http`, `https`, or local HTML page.
- Capture page title, URL, meta description, headings, visible links, visible controls, console warnings/errors, and failed network requests.
- Generate an LLM-based Markdown review report.
- Support `--dry-run` mode to verify browser automation without using an API key.
- Save reports and screenshots to local files.

## Requirements

- Node.js 20+
- An OpenAI API key for non-dry-run mode

## Setup

```bash
npm install
npx playwright install chromium
```

Create an environment variable:

```bash
export OPENAI_API_KEY="your-api-key"
```

On PowerShell:

```powershell
$env:OPENAI_API_KEY="your-api-key"
```

Or create a local `.env` file in the project root. This file is ignored by Git:

```text
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://your-relay.example.com/v1
OPENAI_MODEL=your-supported-model
```

For an OpenAI-compatible relay or gateway, also set `OPENAI_BASE_URL`:

```powershell
$env:OPENAI_BASE_URL="https://your-relay.example.com/v1"
$env:OPENAI_API_KEY="your-relay-key"
$env:OPENAI_MODEL="your-supported-model"
```

On macOS/Linux:

```bash
export OPENAI_BASE_URL="https://your-relay.example.com/v1"
export OPENAI_API_KEY="your-relay-key"
export OPENAI_MODEL="your-supported-model"
```

## Usage

Dry run against the included sample page:

```bash
npm run demo
```

Run with the OpenAI API:

```bash
npm run demo:llm
```

Review a live page:

```bash
node src/index.js --url https://example.com --output report.md
```

Save a screenshot too:

```bash
node src/index.js --url https://example.com --screenshot artifacts/example.png --output report.md
```

Choose a model:

```bash
node src/index.js --url https://example.com --model gpt-5.5 --output report.md
```

Use an OpenAI-compatible relay:

```bash
OPENAI_BASE_URL="https://your-relay.example.com/v1" OPENAI_API_KEY="your-relay-key" node src/index.js --url https://example.com --model your-supported-model --output report.md
```

## Example output

`npm run demo` writes a dry-run browser snapshot to:

```text
examples/dry-run-report.md
```

With `OPENAI_API_KEY` set, `npm run demo:llm` writes an LLM-generated review to:

```text
examples/llm-report.md
```

A sanitized sample generated from a real LLM run is available at:

```text
docs/sample-llm-report.md
```

## Screening question answers

**Last LLM API project:** `llm-browser-reviewer`, a Node.js CLI project that uses the OpenAI Responses API to generate QA-style review reports from browser-captured page snapshots.

**Browser automation tool used:** Playwright. It launches Chromium, navigates to a target URL or local HTML file, collects visible page content, headings, links, controls, console warnings/errors, failed requests, and optional screenshots.

## Notes

This project intentionally keeps the API key outside source control. Set `OPENAI_API_KEY` in the environment before running a real LLM review.

## Verification status

- Browser automation dry-run has been tested with Playwright against `examples/sample-page.html`.
- GitHub Actions runs the same dry-run in a clean CI environment.
- A real LLM API call has been verified through an OpenAI-compatible relay using `OPENAI_BASE_URL` and `gpt-5.4-mini`.
- No API key is committed to this repository.
