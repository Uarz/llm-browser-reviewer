# Screening Answer

Thank you for the clarification. I have now built and published a dedicated LLM + browser automation demo project:

**Project name:** `llm-browser-reviewer`

**Repository:** https://github.com/Uarz/llm-browser-reviewer

**What it does:** It is a Node.js CLI project that uses Playwright or HumanBrowser Cloud to open a target web page, capture browser-observed page context, and send that context to the OpenAI Responses API for an AI-generated QA review report.

**LLM API used:** OpenAI Responses API through the official `openai` Node.js SDK. The project reads `OPENAI_API_KEY` from the environment and calls `client.responses.create()` to generate the report. It also supports `OPENAI_BASE_URL` for OpenAI-compatible relay endpoints.

**Browser automation tools used:** Playwright with Chromium and HumanBrowser Cloud. I use Playwright to navigate to local or live web pages, collect title, URL, metadata, headings, visible links, form controls, console warnings/errors, failed requests, and optional screenshots. I use HumanBrowser Cloud as a remote browser provider that returns a live viewer URL and task output from a real cloud browser session.

**Use case:** AI-assisted browser testing and page review. The project turns real browser-observed page state into a concise LLM-generated report with observations, risks, suggested automated tests, and follow-up questions for developers.

**Verification:** The Playwright dry-run path is verified locally and through GitHub Actions. A real LLM run has also been completed successfully through an OpenAI-compatible relay using `OPENAI_BASE_URL` and `gpt-5.4-mini`. The HumanBrowser Cloud path has been verified against `https://example.com`, including a returned live viewer URL and a completed cloud-browser task. The project uses `HB_TOKEN` for HumanBrowser auth, while the SDK still accepts `HUMANBROWSER_API_TOKEN` as a legacy fallback. Secrets can be provided through environment variables or a local `.env` file, which is intentionally ignored by Git.

This project is directly related to LLM API usage and browser automation, rather than general API testing.
