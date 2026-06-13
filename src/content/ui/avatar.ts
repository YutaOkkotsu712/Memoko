// Memoko — state-driven avatar art (face + full-body sprite), pure inline SVG.
// No assets, no network; everything is generated as strings for the shadow DOM.
// States mirror src/core/health.ts. Poses extend states with 'watch' (streaming)
// and 'cheer' (handoff complete), plus the idle/personality poses 'sit',
// 'laptop', 'nap', 'wave', 'yawn' and 'doodle'. Colors route through --mk-* CSS
// variables so the sprite tint syncs with the host theme (values set per
// [data-theme] in pill.css); fallbacks below are the dark-theme palette.

import type { HealthState } from '../../core/health';

/** Sprite poses: the four health states plus behavioral / idle poses. */
export type MemokoPose =
  | HealthState
  | 'watch'
  | 'cheer'
  | 'sit'
  | 'laptop'
  | 'nap'
  | 'wave'
  | 'yawn'
  | 'doodle';

const HAIR = 'var(--mk-hair, #e893a8)';
const INK = 'var(--mk-ink, #503a44)';
const SKIN = 'var(--mk-skin, #ffd9c4)';
const SKIN_PALE = 'var(--mk-skin-pale, #efdfd6)';
const LIMB = 'var(--mk-limb, #f2bd97)';
const LIMB_PALE = 'var(--mk-limb-pale, #ddc4b4)';
const DRESS = 'var(--mk-dress, #6f86ad)';
const DRESS_PALE = 'var(--mk-dress-pale, #8a93a6)';
const SHOE = 'var(--mk-shoe, #56404c)';
const MOUTH = 'var(--mk-mouth, #cf6a78)';
const BLUSH = 'var(--mk-blush, #ff9eb0)';
const SWEAT = 'var(--mk-sweat, #8fd0f5)';
const WISP = 'var(--mk-wisp, #aac8e4)';
const SPARK = 'var(--mk-spark, #ffcf6e)';
// Laptop palette — only the 'laptop' pose uses these.
const LID = 'var(--mk-lid, #43506a)';
const DECK = 'var(--mk-deck, #b7c2d6)';
const SCREEN = 'var(--mk-screen, #cdeaff)';

/** Status tidbits — shown in the panel and reusable anywhere. */
export const MEMOKO_STATUS: Record<HealthState, string> = {
  fresh: 'Memoko is feeling fresh!',
  healthy: 'Memoko is cruising along.',
  heavy: 'Memoko is getting tired…',
  critical: 'Memoko is exhausted — hand off this chat.',
};

const stroke = (d: string, color: string, w: number): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;

/** Little ghost/soul blob centered on local (0,0); position via a wrapping <g>. */
const wisp = (cls: string): string =>
  `<path class="${cls}" d="M0 -2.6 q2.6 0 2.6 2.6 q0 2.1 -1.25 3.5 q-0.65 -0.9 -1.35 -0.9 t-1.35 0.9 Q-2.6 2.1 -2.6 0 q0 -2.6 2.6 -2.6 Z" fill="${WISP}" opacity="0.9"/>`;

function features(pose: MemokoPose): string {
  switch (pose) {
    case 'fresh':
    case 'cheer':
      return (
        stroke('M9.7 19.9 Q12 17.1 14.3 19.9', INK, 1.7) +
        stroke('M17.7 19.9 Q20 17.1 22.3 19.9', INK, 1.7) +
        `<path d="M13.3 22.4 A2.7 2.7 0 0 0 18.7 22.4 Z" fill="${MOUTH}"/>` +
        `<g fill="${BLUSH}" opacity="0.8">
           <ellipse cx="9.9" cy="22.3" rx="2" ry="1.15"/>
           <ellipse cx="22.1" cy="22.3" rx="2" ry="1.15"/>
         </g>`
      );
    case 'healthy':
      return (
        `<g class="mk-blink">
           <ellipse cx="12" cy="19.6" rx="1.8" ry="2.4" fill="${INK}"/>
           <ellipse cx="20" cy="19.6" rx="1.8" ry="2.4" fill="${INK}"/>
           <circle cx="12.65" cy="18.65" r="0.7" fill="#fff"/>
           <circle cx="20.65" cy="18.65" r="0.7" fill="#fff"/>
         </g>` +
        stroke('M13.9 22.9 Q16 24.8 18.1 22.9', INK, 1.5) +
        `<g fill="${BLUSH}" opacity="0.45">
           <ellipse cx="9.9" cy="22.3" rx="2" ry="1.15"/>
           <ellipse cx="22.1" cy="22.3" rx="2" ry="1.15"/>
         </g>`
      );
    case 'watch':
    case 'laptop':
      // Wide sparkly eyes + little "o" mouth. Pupils sit in .mk-eyes so the host
      // can shift them toward the cursor while she's attentive.
      return (
        `<g class="mk-blink"><g class="mk-eyes">
           <ellipse cx="12" cy="19.4" rx="2.1" ry="2.7" fill="${INK}"/>
           <ellipse cx="20" cy="19.4" rx="2.1" ry="2.7" fill="${INK}"/>
           <circle cx="12.8" cy="18.3" r="0.85" fill="#fff"/>
           <circle cx="20.8" cy="18.3" r="0.85" fill="#fff"/>
           <circle cx="11.3" cy="20.4" r="0.45" fill="#fff" opacity="0.85"/>
           <circle cx="19.3" cy="20.4" r="0.45" fill="#fff" opacity="0.85"/>
         </g></g>` +
        `<ellipse cx="16" cy="23.3" rx="1.35" ry="1.6" fill="${MOUTH}"/>` +
        `<g fill="${BLUSH}" opacity="0.5">
           <ellipse cx="9.9" cy="22.3" rx="2" ry="1.15"/>
           <ellipse cx="22.1" cy="22.3" rx="2" ry="1.15"/>
         </g>`
      );
    case 'heavy':
      return (
        stroke('M9.7 19.1 Q12 20.7 14.3 19.1', INK, 1.7) +
        stroke('M17.7 19.1 Q20 20.7 22.3 19.1', INK, 1.7) +
        stroke('M13.4 23.4 q1.3 -1.2 2.6 0 q1.3 1.2 2.6 0', INK, 1.5) +
        `<path class="mk-sweat" d="M25.9 10.6 C27.8 13.5 27.4 15.4 25.9 15.6 C24.4 15.4 24 13.5 25.9 10.6 Z" fill="${SWEAT}"/>`
      );
    case 'critical':
      return (
        stroke('M10.2 18 L13.8 21.2 M13.8 18 L10.2 21.2', INK, 1.8) +
        stroke('M18.2 18 L21.8 21.2 M21.8 18 L18.2 21.2', INK, 1.8) +
        `<ellipse cx="16" cy="24.1" rx="1.7" ry="2.1" fill="${INK}"/>`
      );
    case 'nap':
      // Peaceful closed eyes (gentle lids), soft smile, warm blush.
      return (
        stroke('M9.6 20 Q12 21.7 14.4 20', INK, 1.6) +
        stroke('M17.6 20 Q20 21.7 22.4 20', INK, 1.6) +
        stroke('M14.1 23.2 Q16 24.3 17.9 23.2', INK, 1.4) +
        `<g fill="${BLUSH}" opacity="0.7">
           <ellipse cx="9.7" cy="22.5" rx="2.1" ry="1.2"/>
           <ellipse cx="22.3" cy="22.5" rx="2.1" ry="1.2"/>
         </g>`
      );
    case 'yawn':
      // Eyes squeezed shut, a big open yawn, deep blush.
      return (
        stroke('M9.6 19.4 Q12 17.5 14.4 19.4', INK, 1.6) +
        stroke('M17.6 19.4 Q20 17.5 22.4 19.4', INK, 1.6) +
        `<ellipse cx="16" cy="23.6" rx="2.1" ry="2.7" fill="${MOUTH}"/>` +
        `<ellipse cx="16" cy="24.6" rx="1.05" ry="1.1" fill="#fff" opacity="0.22"/>` +
        `<g fill="${BLUSH}" opacity="0.7">
           <ellipse cx="9.7" cy="22" rx="2.1" ry="1.2"/>
           <ellipse cx="22.3" cy="22" rx="2.1" ry="1.2"/>
         </g>`
      );
    // 'sit' and 'wave' reuse the cheerful 'fresh' face below.
    default:
      return features('fresh');
  }
}

/** Head in a 32×32 coordinate space (no <svg> wrapper). */
function head(pose: MemokoPose): string {
  const facePose: MemokoPose = pose === 'sit' || pose === 'wave' ? 'fresh' : pose;
  const pale = pose === 'critical';
  const skin = pale ? SKIN_PALE : SKIN;
  const ahoge = pale
    ? 'M15.8 6.8 C16.6 5 19 4.3 21 5.4'
    : 'M15.6 6.8 C14.2 4.6 14.9 2.7 17.9 2.3';
  return (
    `<circle cx="16" cy="15.8" r="12.4" fill="${HAIR}"/>` +
    `<ellipse cx="4.9" cy="20.5" rx="2.7" ry="5.6" fill="${HAIR}"/>` +
    `<ellipse cx="27.1" cy="20.5" rx="2.7" ry="5.6" fill="${HAIR}"/>` +
    `<circle cx="16" cy="17.6" r="10" fill="${skin}"/>` +
    `<path d="M6.05 18.2 C6.05 9.8 10.3 6.3 16 6.3 C21.7 6.3 25.95 9.8 25.95 18.2 C24.7 14.7 23.5 13.3 22.1 12.6 C22.6 14.3 22.4 16.1 21.5 17.4 C20.1 14.3 18.3 12.7 16 12.5 C13.7 12.7 11.9 14.3 10.5 17.4 C9.6 16.1 9.4 14.3 9.9 12.6 C8.5 13.3 7.3 14.7 6.05 18.2 Z" fill="${HAIR}"/>` +
    stroke(ahoge, HAIR, 1.7) +
    features(facePose)
  );
}

/** Face-only icon (used in the panel header). */
export function faceSvg(state: HealthState, size: number): string {
  const extras =
    state === 'critical'
      ? `<g transform="translate(21.5 26.5)">${wisp('mk-wisp')}</g>`
      : state === 'fresh'
        ? `<g fill="${SPARK}"><path d="M27.3 5.2 l1.5 2 -1.5 2 -1.5 -2 Z"/><path d="M4.6 8 l1.1 1.5 -1.1 1.5 -1.1 -1.5 Z"/></g>`
        : '';
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" style="display:block;overflow:visible">${extras}${head(state)}</svg>`;
}

/** Full-body sprite. Dispatches to a rig per pose. */
export function spriteSvg(pose: MemokoPose, size: number): string {
  switch (pose) {
    case 'critical':
      return lyingSvg(size);
    case 'watch':
      return watchSvg(size);
    case 'cheer':
      return cheerSvg(size);
    case 'sit':
      return sitSvg(size);
    case 'laptop':
      return laptopSvg(size);
    case 'nap':
      return napSvg(size);
    case 'wave':
      return waveSvg(size);
    case 'yawn':
      return yawnSvg(size);
    case 'doodle':
      return doodleSvg(size);
    default:
      return standSvg(pose, size);
  }
}

/** Standing rigs for fresh / healthy / heavy (walk / run / trudge). */
function standSvg(pose: MemokoPose, size: number): string {
  const cls = pose === 'fresh' ? 'sp-run' : pose === 'heavy' ? 'sp-trudge' : 'sp-walk';
  const lean = pose === 'heavy' ? 13 : pose === 'fresh' ? 9 : 4;
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp ${cls}" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g transform="rotate(${lean} 24 46)"><g class="sp-bob">` +
    `<g class="sp-legA">${stroke('M21.4 32.5 L21.4 44.2', LIMB, 2.5)}<circle cx="22.2" cy="45" r="2" fill="${SHOE}"/></g>` +
    `<g class="sp-legB">${stroke('M26.6 32.5 L26.6 44.2', LIMB, 2.5)}<circle cx="27.4" cy="45" r="2" fill="${SHOE}"/></g>` +
    `<path d="M20.4 21 L27.6 21 C29.6 25.2 30.6 29.3 31.2 33.6 L16.8 33.6 C17.4 29.3 18.4 25.2 20.4 21 Z" fill="${DRESS}"/>` +
    `<g class="sp-armA">${stroke('M20.2 22.6 L19.3 30.4', LIMB, 2.3)}</g>` +
    `<g class="sp-armB">${stroke('M27.8 22.6 L28.7 30.4', LIMB, 2.3)}</g>` +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${head(pose)}</g></g>` +
    `</g></g></svg>`
  );
}

/** Streaming: standing still, hands clasped, head tipped up. The head is wrapped
 *  in .mk-track and the pupils in .mk-eyes so the host can drive cursor tracking. */
function watchSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-watch" aria-hidden="true" style="display:block;overflow:visible">` +
    `<path class="sp-spark" d="M38 3.6 l2.2 3 -2.2 3 -2.2 -3 Z" fill="${SPARK}"/>` +
    `<g class="sp-bob">` +
    `${stroke('M21.4 32.5 L21.4 44.2', LIMB, 2.5)}<circle cx="22.2" cy="45" r="2" fill="${SHOE}"/>` +
    `${stroke('M26.6 32.5 L26.6 44.2', LIMB, 2.5)}<circle cx="27.4" cy="45" r="2" fill="${SHOE}"/>` +
    `<path d="M20.4 21 L27.6 21 C29.6 25.2 30.6 29.3 31.2 33.6 L16.8 33.6 C17.4 29.3 18.4 25.2 20.4 21 Z" fill="${DRESS}"/>` +
    `${stroke('M20.2 22.6 C19.6 26.2 21 28.8 23.2 29.6', LIMB, 2.3)}` +
    `${stroke('M27.8 22.6 C28.4 26.2 27 28.8 24.8 29.6', LIMB, 2.3)}` +
    `<circle cx="24" cy="29.6" r="1.7" fill="${SKIN}"/>` +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)"><g class="mk-track"><g transform="rotate(-7 16 17.6)">${head('watch')}</g></g></g></g>` +
    `</g></svg>`
  );
}

/** Handoff done: banzai — both arms up, fresh face, waving. */
function cheerSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-cheer" aria-hidden="true" style="display:block;overflow:visible">` +
    `<path class="sp-spark" d="M9.5 9 l2 2.7 -2 2.7 -2 -2.7 Z" fill="${SPARK}"/>` +
    `<path class="sp-spark sp-spark2" d="M40 12 l1.6 2.2 -1.6 2.2 -1.6 -2.2 Z" fill="${SPARK}"/>` +
    `<g class="sp-bob">` +
    `${stroke('M21.4 32.5 L21.4 44.2', LIMB, 2.5)}<circle cx="22.2" cy="45" r="2" fill="${SHOE}"/>` +
    `${stroke('M26.6 32.5 L26.6 44.2', LIMB, 2.5)}<circle cx="27.4" cy="45" r="2" fill="${SHOE}"/>` +
    `<path d="M20.4 21 L27.6 21 C29.6 25.2 30.6 29.3 31.2 33.6 L16.8 33.6 C17.4 29.3 18.4 25.2 20.4 21 Z" fill="${DRESS}"/>` +
    `<g class="sp-armA">${stroke('M20.2 22.6 L16.3 16.8', LIMB, 2.3)}</g>` +
    `<g class="sp-armB">${stroke('M27.8 22.6 L31.7 16.8', LIMB, 2.3)}</g>` +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${head('cheer')}</g></g>` +
    `</g></svg>`
  );
}

/** Critical: lying KO with a rising soul. */
function lyingSvg(size: number): string {
  const w = Math.round((size * 64) / 50);
  return (
    `<svg viewBox="0 0 64 50" width="${w}" height="${size}" class="sp sp-lying" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="sp-legStraight">${stroke('M37.5 43.2 L52 43.2', LIMB_PALE, 2.5)}<circle cx="53.5" cy="43.3" r="2" fill="${SHOE}"/></g>` +
    `<g class="sp-legBent"><path d="M37 43.8 L43.5 37.6 L48 44.4" fill="none" stroke="${LIMB_PALE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="49" cy="45" r="2" fill="${SHOE}"/></g>` +
    `<path d="M24 37.6 L36.5 36.8 L42.6 45.4 L23.4 45.4 Z" fill="${DRESS_PALE}"/>` +
    stroke('M28 39 Q32.5 34.5 37 35.8', LIMB_PALE, 2.3) +
    stroke('M27 40.4 L32 45.4', LIMB_PALE, 2.3) +
    `<g transform="translate(2.6 25.6) scale(0.72)"><g transform="rotate(-8 16 17.6)">${head('critical')}</g></g>` +
    `<g transform="translate(14.5 39.5) scale(0.95)">${wisp('sp-soul')}</g>` +
    `</svg>`
  );
}

// ---- idle / personality poses --------------------------------------------

/** Shared seated lower body: hips ≈ y34, legs dangle straight and swing. */
function dangleLegs(): string {
  return (
    `<g class="sp-dangleA">${stroke('M21.6 33.6 L21.6 45', LIMB, 2.5)}<circle cx="21.6" cy="46" r="2" fill="${SHOE}"/></g>` +
    `<g class="sp-dangleB">${stroke('M26.4 33.6 L26.4 45', LIMB, 2.5)}<circle cx="26.4" cy="46" r="2" fill="${SHOE}"/></g>`
  );
}

/** Seated dress: the standing skirt shifted down ~3px so she reads as sitting. */
const SEATED_DRESS =
  `<path d="M20.4 24 L27.6 24 C29.6 28.2 30.6 31.3 31.2 35.6 L16.8 35.6 C17.4 31.3 18.4 28.2 20.4 24 Z" fill="${DRESS}"/>`;

/** Sit: perched on the edge, hands on the lap, feet swinging. */
function sitSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-sit" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="sp-sitbob">` +
    dangleLegs() +
    SEATED_DRESS +
    stroke('M20.4 25.6 C19.3 28.6 19.8 31.2 21.8 32.6', LIMB, 2.3) +
    stroke('M27.6 25.6 C28.7 28.6 28.2 31.2 26.2 32.6', LIMB, 2.3) +
    `<g class="sp-headG"><g transform="translate(12.4 3.4) scale(0.72)">${head('sit')}</g></g>` +
    `</g></svg>`
  );
}

/** Laptop: seated, a tiny laptop on her lap, hands tapping, head tipped down. */
function laptopSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-laptop" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="sp-sitbob">` +
    dangleLegs() +
    SEATED_DRESS +
    `<g class="sp-headG"><g transform="translate(12.4 3.0) scale(0.72)"><g transform="rotate(9 16 17.6)">${head('laptop')}</g></g></g>` +
    `<g class="sp-lap">` +
    `<path class="sp-lap-lid" d="M18.4 26.4 L29.2 26.4 L30.4 33.2 L17.2 33.2 Z" fill="${LID}"/>` +
    `<rect class="sp-lap-scr" x="19.2" y="27.4" width="9.6" height="4.7" rx="0.6" fill="${SCREEN}"/>` +
    `<path d="M16 33.2 L31.6 33.2 L32.6 35.4 L15 35.4 Z" fill="${DECK}"/>` +
    `</g>` +
    `<g class="sp-type-l">${stroke('M20.4 25.8 C19.4 29 20.6 31.6 22.6 32.8', LIMB, 2.3)}</g>` +
    `<g class="sp-type-r">${stroke('M27.6 25.8 C28.6 29 27.4 31.6 25.4 32.8', LIMB, 2.3)}</g>` +
    `</g></svg>`
  );
}

/** Nap: slumped to one side, head lolled, slow breathing. The "zzz" is drawn by
 *  the host in the pill spot so it can rise past the sprite bounds. */
function napSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-nap" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="sp-napbob"><g transform="rotate(-9 24 40)">` +
    dangleLegs() +
    SEATED_DRESS +
    stroke('M20.4 25.6 C18.8 28.4 18.6 31.4 20 33.4', LIMB, 2.3) +
    stroke('M27.6 25.6 C28.4 28.8 27.8 31.6 26 33', LIMB, 2.3) +
    `<g class="sp-headG"><g transform="translate(12.4 3.6) scale(0.72)"><g transform="rotate(20 16 17.6)">${head('nap')}</g></g></g>` +
    `</g></g></svg>`
  );
}

/** Greeting wave: standing, one arm up waving, happy. */
function waveSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-wave" aria-hidden="true" style="display:block;overflow:visible">` +
    `<path class="sp-spark" d="M34 5.4 l1.8 2.5 -1.8 2.5 -1.8 -2.5 Z" fill="${SPARK}"/>` +
    `<g class="sp-bob">` +
    `${stroke('M21.4 32.5 L21.4 44.2', LIMB, 2.5)}<circle cx="22.2" cy="45" r="2" fill="${SHOE}"/>` +
    `${stroke('M26.6 32.5 L26.6 44.2', LIMB, 2.5)}<circle cx="27.4" cy="45" r="2" fill="${SHOE}"/>` +
    `<path d="M20.4 21 L27.6 21 C29.6 25.2 30.6 29.3 31.2 33.6 L16.8 33.6 C17.4 29.3 18.4 25.2 20.4 21 Z" fill="${DRESS}"/>` +
    `<g class="sp-armA">${stroke('M20.2 22.6 L19.3 30.4', LIMB, 2.3)}</g>` +
    `<g class="sp-armB">${stroke('M27.8 22.6 L31.7 16.6', LIMB, 2.3)}<circle cx="31.9" cy="16.2" r="1.5" fill="${SKIN}"/></g>` +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${head('wave')}</g></g>` +
    `</g></svg>`
  );
}

/** Yawn + stretch: seated, both arms reaching up, squeezed eyes. */
function yawnSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-yawn" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="sp-yawnbob">` +
    dangleLegs() +
    SEATED_DRESS +
    `<g class="sp-stretchA">${stroke('M20.4 25.2 L15.4 16.8', LIMB, 2.3)}<circle cx="15.2" cy="16.4" r="1.4" fill="${SKIN}"/></g>` +
    `<g class="sp-stretchB">${stroke('M27.6 25.2 L32.6 16.8', LIMB, 2.3)}<circle cx="32.8" cy="16.4" r="1.4" fill="${SKIN}"/></g>` +
    `<g class="sp-headG"><g transform="translate(12.4 3.0) scale(0.72)"><g transform="rotate(-8 16 17.6)">${head('yawn')}</g></g></g>` +
    `</g></svg>`
  );
}

/** Doodling: seated, a notepad on her lap, pencil hand scribbling. */
function doodleSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-doodle" aria-hidden="true" style="display:block;overflow:visible">` +
    `<g class="sp-doodlebob">` +
    dangleLegs() +
    SEATED_DRESS +
    `<g class="sp-headG"><g transform="translate(12.4 3.0) scale(0.72)"><g transform="rotate(12 16 17.6)">${head('laptop')}</g></g></g>` +
    `<g class="sp-pad"><path d="M17.4 30.4 L29.2 29.2 L30.6 34.8 L18.4 36 Z" fill="#f3ede2" stroke="${INK}" stroke-width="0.6"/>` +
    stroke('M20 31.7 L27.4 31', INK, 0.6) +
    stroke('M20.4 33.2 L27.8 32.5', INK, 0.6) +
    `</g>` +
    stroke('M20.4 25.8 C19.1 28.6 19.6 31 21.4 32', LIMB, 2.3) +
    `<g class="sp-scribble">${stroke('M27.6 25.8 C28.9 28.2 28.1 30.4 26.3 31.4', LIMB, 2.3)}` +
    `<path d="M26.3 31.4 L24.1 34" stroke="#d8a24a" stroke-width="1.5" stroke-linecap="round"/>` +
    `<circle cx="23.9" cy="34.2" r="0.6" fill="${INK}"/></g>` +
    `</g></svg>`
  );
}
