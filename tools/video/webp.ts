// The animated WebP of a rendered video, for a README (a README on GitHub does not play an MP4 inline): offered
// after the video, once (D26). Circuit Studio encodes MP4, WebM or PNG only, so the kit converts the video with
// ffmpeg when the machine has it (`CIRCUIT_STUDIO_KIT_FFMPEG` names another binary); without it, the WebP is
// simply not available and the kit says so.
import {execFile} from 'node:child_process';
import {statSync} from 'node:fs';
import {basename} from 'node:path';

/** Small enough for a README, smooth enough to follow a wire. */
export const WEBP = {width: 640, fps: 12, quality: 60};

const ffmpeg = () => process.env.CIRCUIT_STUDIO_KIT_FFMPEG ?? 'ffmpeg';

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg(), args, {maxBuffer: 16 * 1024 * 1024}, (error, stdout, stderr) => {
      if (!error) resolve(stdout);
      else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('the animated WebP needs ffmpeg on this machine (with its WebP encoder, libwebp), which was '
          + 'not found: install it (or set CIRCUIT_STUDIO_KIT_FFMPEG to its path), or skip the WebP'));
      } else reject(new Error(`ffmpeg failed: ${String(stderr).trim().split('\n').slice(-2).join(' ')}`));
    });
  });
}

/** Writes `<video>.webp` next to the video; returns the line `render` and `video webp` print. */
export async function makeWebp(video: string): Promise<string> {
  const encoders = await run(['-hide_banner', '-encoders']);
  if (!/libwebp_anim|libwebp/.test(encoders)) {
    throw new Error('this ffmpeg has no WebP encoder (libwebp): the animated WebP needs a build that has one');
  }
  const out = video.replace(/\.\w+$/, '') + '.webp';
  await run(['-hide_banner', '-loglevel', 'error', '-y', '-i', video,
    '-vf', `fps=${WEBP.fps},scale=${WEBP.width}:-2:flags=lanczos`, '-c:v', 'libwebp_anim', '-lossless', '0',
    '-quality', String(WEBP.quality), '-compression_level', '6', '-loop', '0', '-an', out]);
  return `WebP: .circuitstudio/media/${basename(out)} (${WEBP.width} px wide, ${WEBP.fps} fps, `
    + `${(statSync(out).size / 1e6).toFixed(1)} MB), for a README.`;
}
