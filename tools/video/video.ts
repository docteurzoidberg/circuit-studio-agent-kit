// `.circuitstudio/video.json`: what the `wiring-video` skill set up for this project (D27), so it never asks twice.
//
//   settings    Circuit Studio's video settings (the Auto Video dialog's), chosen once: its defaults, set in the
//               page (then read back by `studio sync`), or answered in the chat (`video settings key=value`)
//   scenes      the camera scenes saved in the page, kept with the settings
//   outputs     what `render` writes besides the video, chosen after the first one (D26): a poster image
//   automation  later: how the video is rendered again without the user (CI, hook)
//
// A missing section means "not chosen yet": the skill asks when it gets there. `render` passes `settings` to the
// page, so the same file gives the same video on any machine, whatever Circuit Studio's defaults become; `build`
// copies them into the project, so the page's Auto Video dialog shows them.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {kitPath} from '../project.ts';

export type VideoSettings = Record<string, unknown>;

export interface VideoFile {
  settings?: VideoSettings;
  scenes?: unknown[];
  outputs?: {poster?: boolean};
  automation?: unknown;
}

/** What the page's `videoSettings()` answers (docs/AUTOMATION_API.md). */
export interface VideoSettingsInfo {
  settings: VideoSettings;
  source: 'project' | 'defaults';
  presets: Record<string, VideoSettings>;
  choices: Record<string, (string | number)[]>;
}

export const VIDEO_FILE = '.circuitstudio/video.json';

export function readVideo(root: string): VideoFile {
  const file = kitPath(root, 'video.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as VideoFile : {};
}

export function writeVideo(root: string, video: VideoFile): void {
  writeFileSync(kitPath(root, 'video.json', {create: true}), `${JSON.stringify(video, null, 1)}\n`);
}

/** One line: what the video will look like. */
export function describeSettings(settings: VideoSettings): string {
  const width = Number(settings.width);
  return [`mode ${settings.mode}`, `${width} × ${Math.round(width * 9 / 16)}`, `${settings.fps} fps`, String(settings.format),
    `background ${settings.backgroundPresetId}`, `HUD ${settings.hudStyle}`, `labels ${settings.labels}`].join(', ');
}

/** `key=value` arguments, values read as numbers or booleans when they look like one. */
export function parseAssignments(args: string[]): VideoSettings {
  const parsed: VideoSettings = {};
  for (const arg of args) {
    const at = arg.indexOf('=');
    if (at <= 0) throw new Error(`expected key=value, got "${arg}"`);
    const key = arg.slice(0, at), text = arg.slice(at + 1);
    parsed[key] = text === 'true' || text === 'on' ? true : text === 'false' || text === 'off' ? false
      : text !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
  }
  return parsed;
}

/**
 * The settings asked for: a preset, then `key=value` changes, on top of `base`. `info` is the page's answer for
 * them; a value it did not keep (out of its list, or a key it does not know) is an error naming what is allowed.
 */
export function checkRequested(requested: VideoSettings, info: VideoSettingsInfo): void {
  const refused: string[] = [];
  for (const [key, value] of Object.entries(requested)) {
    if (!(key in info.settings)) refused.push(`${key}: not a video setting (${Object.keys(info.settings).filter(k => k !== 'version' && k !== 'overrides').join(', ')})`);
    else if (JSON.stringify(info.settings[key]) !== JSON.stringify(value)) {
      refused.push(`${key}=${JSON.stringify(value)} not accepted${info.choices[key] ? `: one of ${info.choices[key].join(', ')}` : ''}`);
    }
  }
  if (refused.length) throw new Error(`Circuit Studio refused these video settings:\n${refused.join('\n')}`);
}

/** For the skill's questions: the presets and the settings that have a fixed list of values. */
export function describeChoices(info: VideoSettingsInfo): string {
  const lines = ['presets:'];
  for (const [name, preset] of Object.entries(info.presets)) lines.push(`  ${name}: ${describeSettings(preset)}`);
  lines.push('settings with a fixed list:');
  for (const [key, values] of Object.entries(info.choices)) lines.push(`  ${key}: ${values.join(', ')}`);
  lines.push('other settings (numbers, colours, on/off): '
    + Object.keys(info.settings).filter(k => !(k in info.choices) && k !== 'version' && k !== 'overrides').join(', '));
  return lines.join('\n');
}
