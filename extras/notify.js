#!/usr/bin/env node
/**
 * Stop hook: desktop notification "Claude finished - your turn" when Claude
 * stops, with the project folder in the text so parallel sessions are
 * distinguishable. macOS (osascript), Linux (notify-send), Windows (toast via
 * PowerShell). Runs detached so it never delays Claude Code; any failure is silent.
 * Installed to ~/.claude/invent-kit/ by /agentic-kit-setup.
 */

const path = require('path');
const { spawn } = require('child_process');

const TITLE = 'Claude Code';

function command(message) {
  if (process.platform === 'darwin') {
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return ['osascript', ['-e', `display notification "${esc(message)}" with title "${esc(TITLE)}"`]];
  }
  if (process.platform === 'win32') {
    const esc = (s) => s.replace(/'/g, "''").replace(/[<>&]/g, '');
    const ps = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
      "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)",
      "$t = $xml.GetElementsByTagName('text')",
      `$t.Item(0).AppendChild($xml.CreateTextNode('${esc(TITLE)}')) > $null`,
      `$t.Item(1).AppendChild($xml.CreateTextNode('${esc(message)}')) > $null`,
      // Windows only shows toasts for a registered app id; PowerShell's own is always present.
      "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))",
    ].join('; ');
    return ['powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]];
  }
  return ['notify-send', [TITLE, message]];
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let cwd = '';
  try { cwd = JSON.parse(raw).cwd || ''; } catch {}
  const project = cwd ? path.basename(cwd) : '';
  const message = project ? `Claude finished in ${project} - your turn` : 'Claude finished - your turn';

  try {
    const [cmd, args] = command(message);
    spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  } catch {}
}

if (require.main === module) {
  main();
} else {
  module.exports = { command };
}
