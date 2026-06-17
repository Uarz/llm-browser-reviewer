# Screening Answer

Thank you for the clarification. I have now built and published a dedicated LLM + browser automation demo project:

**Project name:** `llm-browser-reviewer`

**Repository:** https://github.com/Uarz/llm-browser-reviewer

**What it does:** It is a Node.js CLI project that uses Playwright to open a target web page, capture a structured browser snapshot, and send that snapshot to the OpenAI Responses API for an AI-generated QA review report.

**LLM API used:** OpenAI Responses API through the official `openai` Node.js SDK. The project reads `OPENAI_API_KEY` from the environment and calls `client.responses.create()` to generate the report. It also supports `OPENAI_BASE_URL` for OpenAI-compatible relay endpoints.

**Browser automation tool used:** Playwright with Chromium. I use it to navigate to local or live web pages, collect title, URL, metadata, headings, visible links, form controls, console warnings/errors, failed requests, and optional screenshots.

**Use case:** AI-assisted browser testing and page review. The project turns real browser-observed page state into a concise LLM-generated report with observations, risks, suggested automated tests, and follow-up questions for developers.

**Verification:** The Playwright dry-run path is verified locally and through GitHub Actions. The real LLM path requires an `OPENAI_API_KEY` and can optionally use an OpenAI-compatible `OPENAI_BASE_URL`. Secrets can be provided through environment variables or a local `.env` file, which is intentionally ignored by Git.

This project is directly related to LLM API usage and browser automation, rather than general API testing.
