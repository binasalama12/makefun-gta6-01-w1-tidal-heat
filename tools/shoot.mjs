import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
const serverScript = resolve(repository, 'serve.ts');
const manifestPath = resolve(repository, 'shots.json');
const screenshotDirectory = resolve(repository, 'screenshots');
const origin = 'http://127.0.0.1:8917';
const debugAddress = 'http://127.0.0.1:9571';
const chromePath = resolve(homedir(), '.cache/ms-playwright/chromium-1194/chrome-linux/chrome');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pageErrors = [];
let serverProcess;
let browserProcess;
let socket;

function recordError(source, message) {
  pageErrors.push({ source, message: String(message) });
}

async function waitForHttp(url, child, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The process may still be starting.
    }
    await delay(100);
  }
  throw new Error(`${label} did not become ready`);
}

try {
  await mkdir(screenshotDirectory, { recursive: true });
  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: repository,
    stdio: 'ignore',
  });
  serverProcess.once('error', error => recordError('server', error.message));
  await waitForHttp(`${origin}/`, serverProcess, 'Static server');

  browserProcess = spawn(chromePath, [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--hide-scrollbars',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9571',
    '--user-data-dir=/tmp/tidal-heat-shoot-profile',
    '--window-size=1280,720',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForHttp(`${debugAddress}/json/list`, browserProcess, 'Chromium');

  const targets = await (await fetch(`${debugAddress}/json/list`)).json();
  const pageTarget = targets.find(target => target.type === 'page');
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target');

  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let commandId = 0;
  const pendingCommands = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      recordError('exception', details.exception?.description ?? details.text ?? 'Page exception');
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' ');
      recordError('console', text || 'console.error');
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      recordError('log', message.params.entry.text);
    }

    if (message.id && pendingCommands.has(message.id)) {
      const pending = pendingCommands.get(message.id);
      pendingCommands.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message);
    }
  });

  function command(method, params = {}) {
    return new Promise((resolveCommand, rejectCommand) => {
      const id = ++commandId;
      const timer = setTimeout(() => {
        pendingCommands.delete(id);
        rejectCommand(new Error(`CDP timed out: ${method}`));
      }, 15000);
      pendingCommands.set(id, { resolve: resolveCommand, reject: rejectCommand, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  await command('Page.enable');
  await command('Runtime.enable');
  await command('Log.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  for (const shot of manifest) {
    if (typeof shot.url !== 'string' || typeof shot.file !== 'string' || basename(shot.file) !== shot.file) {
      throw new Error('Each shot must provide a query string and a plain file name');
    }
    const query = shot.url.startsWith('?') ? shot.url : `?${shot.url}`;
    await command('Page.navigate', { url: `${origin}/${query}` });
    await delay(1600);
    const captured = await command('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 88,
      fromSurface: true,
    });
    await writeFile(resolve(screenshotDirectory, shot.file), Buffer.from(captured.result.data, 'base64'));
  }
} catch (error) {
  recordError('driver', error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  for (const child of [browserProcess, serverProcess]) {
    if (child && child.exitCode === null) child.kill('SIGTERM');
  }
  console.log(JSON.stringify({ pageErrors }, null, 2));
}
