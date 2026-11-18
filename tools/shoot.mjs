import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8471;
const chrome = `${process.env.HOME}/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`;
const browser = spawn(chrome, [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=9571',
  '--user-data-dir=/tmp/th-prof-9571', '--window-size=1280,720', 'about:blank',
], { stdio: 'ignore' });
const manifest = JSON.parse(readFileSync('shots.json', 'utf8'));
const errors = [];
mkdirSync('screenshots', { recursive: true });

try {
  let targets;
  for (let i = 0; i < 80; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:9571/json/list')).json();
      if (targets.length) break;
    } catch {}
    await delay(250);
  }
  if (!targets?.length) throw new Error('Chromium debugging target did not start');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      errors.push(details.exception?.description || details.text);
      console.error('PAGE EXCEPTION:', errors.at(-1));
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  function cmd(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, message => { clearTimeout(timer); resolve(message); });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  await cmd('Page.enable');
  await cmd('Runtime.enable');
  for (const scene of manifest) {
    await cmd('Page.navigate', { url: `http://127.0.0.1:${port}/${scene.url}&seed=1` });
    await delay(1600);
    const shot = await cmd('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
    writeFileSync(resolve('screenshots', scene.file), Buffer.from(shot.result.data, 'base64'));
  }
  await cmd('Page.navigate', { url: `http://127.0.0.1:${port}/` });
  await delay(700);
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  await delay(1200);
  await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 });
  const probe = await cmd('Runtime.evaluate', {
    expression: `({title:document.querySelector('.objective strong')?.textContent?.trim(),speed:document.querySelector('.speed b')?.textContent?.trim()})`,
    returnByValue: true,
  });
  const result = probe.result.result.value;
  console.log('LIVE PROBE:', JSON.stringify(result));
  const sizes = manifest.map(scene => ({ file: scene.file, bytes: statSync(resolve('screenshots', scene.file)).size }));
  console.log('SCREENSHOTS:', JSON.stringify(sizes));
  if (sizes.some(x => x.bytes < 30000 || x.bytes > 250000)) throw new Error('Screenshot size outside 30KB–250KB bounds');
  const hashes = manifest.map(scene => readFileSync(resolve('screenshots', scene.file)).toString('base64'));
  if (new Set(hashes).size !== manifest.length) throw new Error('Screenshots are not all different');
  if (!result.title || !result.speed || Number(result.speed) === 0) throw new Error('Live gameplay probe failed');
  if (errors.length) throw new Error(`Page raised ${errors.length} exception(s)`);
  ws.close();
} finally {
  browser.kill();
}
