import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4174;
const url = `http://127.0.0.1:${port}/?demo=1&debug=1`;
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const server = spawn(command, ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  stdio: 'ignore',
  shell: process.platform === 'win32',
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // The server is expected to be unavailable during its short startup window.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Benchmark server did not start within 20 seconds.');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const navigationStart = performance.now();
  await page.goto(url, { waitUntil: 'networkidle' });
  const firstLoadMs = performance.now() - navigationStart;
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(async () => {
    const start = window.performance.now();
    let frames = 0;
    await new Promise((resolve) => {
      const sample = (now) => {
        frames += 1;
        if (now - start >= 1500) resolve();
        else window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);
    });
    const elapsedMs = window.performance.now() - start;
    const resources = window.performance.getEntriesByType('resource');
    const debug = window.__PEREVAL_DEBUG__;
    return {
      elapsedMs: Number(elapsedMs.toFixed(2)),
      fps: Number(((frames * 1000) / Math.max(1, elapsedMs)).toFixed(2)),
      frameTimeMs: Number((elapsedMs / Math.max(1, frames)).toFixed(2)),
      renderer: debug?.getRendererInfo?.() || null,
      state: debug?.getState?.() || null,
      resourceCount: resources.length,
      encodedBytes: resources.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
    };
  });

  const outputDir = path.join(root, 'docs', 'qa', 'final');
  await mkdir(outputDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    url,
    firstLoadMs: Number(firstLoadMs.toFixed(2)),
    pageErrors,
    consoleErrors,
    ...metrics,
  };
  await writeFile(path.join(outputDir, 'benchmark.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await page.screenshot({ path: path.join(outputDir, 'demo.png') });
  await browser.close();
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.kill();
}
