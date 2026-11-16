// Opening a link in the user's own browser, as clicking it would: the kit launches nothing else and drives no
// browser (D23). Under WSL the browser is the Windows one.
import {execFile} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';

const isWsl = () =>
  process.platform === 'linux' && existsSync('/proc/version') && /microsoft/i.test(readFileSync('/proc/version', 'utf8'));

/** The command that opens `url` in the default browser on this system. */
export function openCommand(url: string, wsl = isWsl()): [string, string[], {cwd?: string}] {
  if (wsl) {
    return ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url.replaceAll("'", "''")}'`], {cwd: '/mnt/c'}];
  }
  if (process.platform === 'darwin') return ['open', [url], {}];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '""', url.replaceAll('&', '^&')], {}];
  return ['xdg-open', [url], {}];
}

export function openInBrowser(url: string): Promise<void> {
  // The kit's tests set this, so they can never open a tab in the user's browser.
  if (process.env.CIRCUIT_STUDIO_KIT_NO_BROWSER) return Promise.reject(new Error('opening a browser is disabled (CIRCUIT_STUDIO_KIT_NO_BROWSER)'));
  const [command, args, options] = openCommand(url);
  return new Promise((resolve, reject) => {
    execFile(command, args, options, error => error ? reject(new Error(`could not open the browser: ${error.message}`)) : resolve());
  });
}
