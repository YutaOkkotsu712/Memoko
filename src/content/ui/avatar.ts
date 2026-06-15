// Memoko — state-driven avatar art (face + full-body sprite), pure inline SVG.
// No assets, no network; everything is generated as strings for the shadow DOM.
// States mirror src/core/health.ts. Poses extend states with 'watch' (streaming)
// and 'cheer' (handoff complete), plus the reactive 'hurt' pose and the
// idle/personality poses 'sit', 'laptop', 'book', 'nap', 'wave', 'yawn'
// and 'doodle'. Colors route through --mk-* CSS
// variables so the sprite tint syncs with the host theme (values set per
// [data-theme] in pill.css); fallbacks below are the dark-theme palette.

import type { HealthState } from '../../core/health';

/** Sprite poses: the four health states plus behavioral / idle poses. */
export type MemokoPose =
  | HealthState
  | 'watch'
  | 'cheer'
  | 'hurt'
  | 'sit'
  | 'laptop'
  | 'book'
  | 'nap'
  | 'wave'
  | 'yawn'
  | 'doodle'
  | 'swing'
  | 'smash'
  | 'punch'
  | 'cast'
  | 'roar'
  | 'raise'
  | 'point'
  | 'smug'
  | 'dodge'
  | 'clutch'
  | 'charge'
  | 'visor'
  | 'genjutsu'
  | 'deadpan'
  | 'flash'
  | 'menace'
  | 'fierce';

const HAIR = 'var(--mk-hair, #e893a8)';
const HAIR_PALE = 'var(--mk-hair-pale, #b69ca7)';
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
const BOOK = 'var(--mk-book, #9f8de2)';
const PAPER = 'var(--mk-paper, #f3ede2)';
const PAGE_LINE = 'var(--mk-page-line, #d6bfa8)';

/** Status tidbits — shown in the panel and reusable anywhere. */
export const MEMOKO_STATUS: Record<HealthState, string> = {
  fresh: 'Memoko is feeling fresh!',
  healthy: 'Memoko is cruising along.',
  heavy: 'Memoko is getting tired…',
  critical: 'Memoko is exhausted — hand off this chat.',
};

const stroke = (d: string, color: string, w: number): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"/>`;

const px = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  cls = '',
  opacity?: number
): string =>
  `<rect${cls ? ` class="${cls}"` : ''} x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${opacity === undefined ? '' : ` opacity="${opacity}"`}/>`;

/** Little ghost/soul blob centered on local (0,0); position via a wrapping <g>. */
const wisp = (cls: string): string =>
  `<path class="${cls}" d="M0 -2.6 q2.6 0 2.6 2.6 q0 2.1 -1.25 3.5 q-0.65 -0.9 -1.35 -0.9 t-1.35 0.9 Q-2.6 2.1 -2.6 0 q0 -2.6 2.6 -2.6 Z" fill="${WISP}" opacity="0.9"/>`;

function hairShell(hair: string): string {
  return (
    `<g shape-rendering="crispEdges">` +
    px(13, 0, 5, 1, hair) +
    px(12, 1, 7, 1, hair) +
    px(10, 2, 10, 1, hair) +
    px(9, 3, 12, 1, hair) +
    px(8, 4, 15, 1, hair) +
    px(21, 4, 2, 1, hair) +
    px(7, 5, 16, 1, hair) +
    px(22, 5, 2, 2, hair) +
    px(6, 6, 18, 1, hair) +
    px(23, 7, 2, 2, hair) +
    px(5, 7, 20, 1, hair) +
    px(4, 8, 21, 2, hair) +
    px(3, 10, 23, 2, hair) +
    px(3, 12, 24, 3, hair) +
    px(3, 15, 23, 3, hair) +
    px(4, 18, 22, 3, hair) +
    px(5, 21, 19, 3, hair) +
    px(7, 24, 16, 2, hair) +
    px(10, 26, 11, 1, hair) +
    px(4, 14, 2, 6, hair) +
    px(25, 9, 4, 3, hair) +
    px(26, 12, 4, 6, hair) +
    px(25, 18, 4, 5, hair) +
    px(22, 23, 5, 3, hair) +
    `</g>`
  );
}

function pixelEyes(kind: 'bright' | 'calm' | 'alert' | 'tired'): string {
  if (kind === 'alert') {
    return (
      `<g class="mk-blink"><g class="mk-eyes">` +
      px(9, 17, 4, 5, INK) +
      px(19, 17, 4, 5, INK) +
      px(10, 17, 1, 1, '#fff') +
      px(20, 17, 1, 1, '#fff') +
      px(12, 20, 1, 1, '#fff', '', 0.8) +
      px(22, 20, 1, 1, '#fff', '', 0.8) +
      `</g></g>`
    );
  }
  if (kind === 'tired') {
    return (
      `<g class="mk-blink">` +
      px(9, 18, 5, 3, INK) +
      px(18, 18, 5, 3, INK) +
      px(9, 18, 5, 1, SKIN, '', 0.65) +
      px(18, 18, 5, 1, SKIN, '', 0.65) +
      `</g>`
    );
  }
  const y = kind === 'calm' ? 18 : 17;
  const h = kind === 'calm' ? 3 : 4;
  return (
    `<g class="mk-blink">` +
    px(10, y, 4, h, INK) +
    px(19, y, 4, h, INK) +
    px(11, y, 1, 1, '#fff', '', kind === 'calm' ? 0.75 : 1) +
    px(20, y, 1, 1, '#fff', '', kind === 'calm' ? 0.75 : 1) +
    `</g>`
  );
}

function features(pose: MemokoPose): string {
  switch (pose) {
    case 'fresh':
    case 'cheer':
      return (
        pixelEyes('bright') +
        px(14, 23, 4, 1, MOUTH) +
        px(13, 22, 1, 1, MOUTH) +
        px(18, 22, 1, 1, MOUTH) +
        px(8, 22, 3, 2, BLUSH, '', 0.75) +
        px(21, 22, 3, 2, BLUSH, '', 0.75)
      );
    case 'healthy':
      return (
        pixelEyes('calm') +
        px(14, 23, 3, 1, MOUTH) +
        px(8, 22, 3, 2, BLUSH, '', 0.45) +
        px(21, 22, 3, 2, BLUSH, '', 0.45)
      );
    case 'watch':
    case 'laptop':
      // Wide alert eyes + little "o" mouth. Pupils sit in .mk-eyes so the host
      // can shift them toward the cursor while she's attentive.
      return (
        pixelEyes('alert') +
        px(15, 23, 2, 2, MOUTH) +
        px(8, 22, 3, 2, BLUSH, '', 0.5) +
        px(21, 22, 3, 2, BLUSH, '', 0.5)
      );
    case 'hurt':
      return (
        stroke('M10 20 L13.8 18.7', INK, 1.35) +
        stroke('M18.2 18.7 L22 20', INK, 1.35) +
        stroke('M13.8 24.1 L15 23.1 L16 24.1 L17.2 23.1 L18.4 24.1', INK, 1.15) +
        px(8, 22, 3, 2, BLUSH, '', 0.38) +
        px(21, 21, 3, 2, BLUSH, '', 0.32)
      );
    case 'book':
      return (
        pixelEyes('calm') +
        px(14, 23, 3, 1, MOUTH) +
        px(13, 22, 1, 1, MOUTH) +
        px(8, 22, 3, 2, BLUSH, '', 0.5) +
        px(21, 22, 3, 2, BLUSH, '', 0.5)
      );
    case 'heavy':
      return (
        pixelEyes('tired') +
        px(14, 24, 3, 1, MOUTH) +
        px(17, 23, 1, 1, MOUTH) +
        `<path class="mk-sweat" d="M26 10 L29 14 L27 17 L24 17 L23 14 Z" fill="${SWEAT}"/>`
      );
    case 'critical':
      return (
        stroke('M10 18 L14 22 M14 18 L10 22', INK, 1.6) +
        stroke('M18 18 L22 22 M22 18 L18 22', INK, 1.6) +
        px(15, 24, 3, 3, INK)
      );
    case 'nap':
      return (
        px(9, 20, 5, 1, INK) +
        px(18, 20, 5, 1, INK) +
        px(14, 24, 3, 1, MOUTH) +
        px(8, 22, 3, 2, BLUSH, '', 0.65) +
        px(21, 22, 3, 2, BLUSH, '', 0.65)
      );
    case 'yawn':
      return (
        px(9, 19, 5, 1, INK) +
        px(18, 19, 5, 1, INK) +
        px(14, 23, 3, 4, MOUTH) +
        px(15, 25, 1, 1, '#fff', '', 0.25) +
        px(8, 22, 3, 2, BLUSH, '', 0.65) +
        px(21, 22, 3, 2, BLUSH, '', 0.65)
      );
    // Combat faces for the Anime Ultimates poses.
    case 'fierce':
      return (
        px(9, 15, 2, 1, INK) + px(11, 16, 2, 1, INK) +
        px(19, 16, 2, 1, INK) + px(21, 15, 2, 1, INK) +
        pixelEyes('alert') +
        px(13, 24, 6, 1, MOUTH) + px(13, 23, 1, 1, MOUTH) + px(18, 23, 1, 1, MOUTH)
      );
    case 'roar':
      return (
        px(9, 15, 2, 1, INK) + px(11, 16, 2, 1, INK) +
        px(19, 16, 2, 1, INK) + px(21, 15, 2, 1, INK) +
        pixelEyes('alert') +
        px(13, 23, 6, 4, MOUTH) + px(14, 24, 4, 2, '#7a2030')
      );
    case 'smug':
      return (
        pixelEyes('calm') +
        px(12, 15, 3, 1, INK, '', 0.55) + px(19, 15, 3, 1, INK, '', 0.55) +
        px(15, 23, 5, 1, MOUTH) + px(20, 22, 1, 1, MOUTH) +
        px(8, 22, 3, 2, BLUSH, '', 0.5) + px(21, 22, 3, 2, BLUSH, '', 0.5)
      );
    // 'sit' and 'wave' reuse the cheerful 'fresh' face below.
    default:
      return features('fresh');
  }
}

/** Head in a 32×32 coordinate space (no <svg> wrapper). */
function head(pose: MemokoPose): string {
  const facePose: MemokoPose =
    pose === 'sit' || pose === 'wave' ? 'fresh' :
    pose === 'book' ? 'book' :
    pose;
  const pale = pose === 'critical';
  const skin = pale ? SKIN_PALE : SKIN;
  const hair = pale ? HAIR_PALE : HAIR;
  return (
    `<g shape-rendering="crispEdges">` +
    hairShell(hair) +
    px(8, 11, 15, 13, skin) +
    px(7, 13, 2, 7, skin) +
    px(23, 13, 2, 6, skin) +
    px(9, 24, 12, 2, skin) +
    px(10, 26, 10, 1, skin) +
    px(7, 10, 7, 7, hair) +
    px(13, 9, 4, 5, hair) +
    px(17, 8, 4, 2, hair) +
    px(20, 10, 3, 6, hair) +
    px(9, 16, 2, 4, hair) +
    px(20, 17, 2, 2, hair) +
    features(facePose)
    + `</g>`
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
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">${extras}${head(state)}</svg>`;
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
    case 'hurt':
      return hurtSvg(size);
    case 'sit':
      return sitSvg(size);
    case 'laptop':
      return laptopSvg(size);
    case 'book':
      return bookSvg(size);
    case 'nap':
      return napSvg(size);
    case 'wave':
      return waveSvg(size);
    case 'yawn':
      return yawnSvg(size);
    case 'doodle':
      return doodleSvg(size);
    case 'swing':
    case 'smash':
    case 'punch':
    case 'cast':
    case 'roar':
    case 'raise':
    case 'point':
    case 'smug':
    case 'dodge':
    case 'clutch':
    case 'charge':
    case 'visor':
    case 'genjutsu':
    case 'deadpan':
    case 'flash':
    case 'menace':
      return comboSvg(pose, size);
    default:
      return standSvg(pose, size);
  }
}

const suit = (pale = false): string => pale ? DRESS_PALE : DRESS;
const limb = (pale = false): string => pale ? LIMB_PALE : LIMB;

function boot(x: number, y: number): string {
  return px(x, y, 7, 3, SHOE) + px(x + 1, y - 1, 4, 1, SHOE);
}

function standingLegs(pale = false): string {
  return (
    `<g class="sp-legA">${stroke('M21.4 32.5 L21.4 44.2', limb(pale), 2.5)}${boot(19, 44)}</g>` +
    `<g class="sp-legB">${stroke('M26.6 32.5 L26.6 44.2', limb(pale), 2.5)}${boot(25, 44)}</g>`
  );
}

function arm(cls: string, d: string, pale = false, handX = 0, handY = 0): string {
  return `<g class="${cls}">${stroke(d, limb(pale), 2.8)}${px(handX, handY, 3, 3, limb(pale))}</g>`;
}

/** Wide braced fighting stance: feet staggered and planted. */
function braceLegs(pale = false): string {
  return (
    `<g class="sp-legA">${stroke('M21.0 32.5 L18.6 44.2', limb(pale), 2.5)}${boot(16, 44)}</g>` +
    `<g class="sp-legB">${stroke('M27.0 32.5 L29.0 44.2', limb(pale), 2.5)}${boot(28, 44)}</g>`
  );
}

/** Combat / action poses for the Anime Ultimates. One rig, arms vary per pose. */
function comboSvg(pose: MemokoPose, size: number): string {
  const w = Math.round((size * 48) / 50);
  let arms = '';
  let face: MemokoPose = 'fierce';
  let lean = 0;
  let headRot = 0;
  let legs = standingLegs();
  switch (pose) {
    case 'swing': // two-handed weapon raised high to her right
      legs = braceLegs();
      arms = arm('sp-armA', 'M20.4 23 L25.6 15.4', false, 25, 13) +
        arm('sp-armB', 'M27.6 23 L28.6 14.4', false, 27.5, 12);
      headRot = -6;
      break;
    case 'smash': // two-handed overhead (hammer)
      legs = braceLegs();
      arms = arm('sp-armA', 'M20.4 22.6 L24.6 12.8', false, 24, 10.6) +
        arm('sp-armB', 'M27.6 22.6 L26.6 12.4', false, 26, 10.2);
      headRot = -4;
      break;
    case 'punch': // right fist thrust forward, left pulled to hip
      arms = arm('sp-armB', 'M27.8 23 L35 21.4', false, 35, 20) +
        arm('sp-armA', 'M20.2 23 L17.4 26', false, 16, 26);
      headRot = 3;
      break;
    case 'cast': // both palms pushed forward
      arms = arm('sp-armA', 'M20.4 23 L25 24.4', false, 25, 23.4) +
        arm('sp-armB', 'M27.6 23 L33 23', false, 33, 22);
      headRot = 2;
      break;
    case 'roar': // leaning forward, arms back, shouting
      face = 'roar';
      arms = arm('sp-armA', 'M20.2 23 L16.6 26.6', false, 15, 26) +
        arm('sp-armB', 'M27.8 23 L31.4 26.6', false, 31, 26);
      lean = 6;
      headRot = 6;
      break;
    case 'raise': // one arm raised straight up
      arms = arm('sp-armB', 'M27.8 22.6 L30 12.4', false, 29, 11) +
        arm('sp-armA', 'M20.2 23 L18.8 30', false, 17.5, 30);
      headRot = -3;
      break;
    case 'point': // one arm extended forward, confident
      face = 'smug';
      arms = arm('sp-armB', 'M27.8 23 L35 19.4', false, 35, 18) +
        arm('sp-armA', 'M20.2 23 L19 30', false, 18, 30);
      headRot = 2;
      break;
    case 'smug': // arms crossed over the chest
      face = 'smug';
      arms = `<g class="sp-armA">${stroke('M20.6 24 L26.4 27.2', LIMB, 2.8)}${px(26, 26, 3, 3, LIMB)}</g>` +
        `<g class="sp-armB">${stroke('M27.4 24 L21.6 27.2', LIMB, 2.8)}${px(19, 26, 3, 3, LIMB)}</g>`;
      break;
    case 'dodge': // calm Ultra-Instinct lean, arms loose
      face = 'watch';
      arms = arm('sp-armA', 'M20.2 23 L17.8 29.6', false, 16.5, 29) +
        arm('sp-armB', 'M27.8 23 L30.2 29.6', false, 30, 29);
      lean = -10;
      headRot = -6;
      break;
    case 'clutch': // hunched, hands up by the head (despair)
      face = 'hurt';
      legs = braceLegs();
      arms = arm('sp-armA', 'M20.4 23.4 L18.4 18', false, 17, 16.5) +
        arm('sp-armB', 'M27.6 23.4 L29.6 18', false, 29, 16.5);
      lean = 4;
      headRot = 10;
      break;
    case 'charge': // braced power-up, fists clenched low
      legs = braceLegs();
      arms = `<g class="sp-armA">${stroke('M20.2 23 L18.4 29.2', LIMB, 2.8)}${px(17.4, 28.8, 3.4, 3.4, LIMB)}</g>` +
        `<g class="sp-armB">${stroke('M27.8 23 L29.6 29.2', LIMB, 2.8)}${px(28, 28.8, 3.4, 3.4, LIMB)}</g>`;
      lean = 5;
      headRot = 4;
      break;
    case 'visor': // one hand up at her temple
      arms = arm('sp-armB', 'M27.8 23 L25.6 16.6', false, 23.4, 14.8) +
        arm('sp-armA', 'M20.2 23 L19 30', false, 18, 30);
      headRot = 3;
      break;
    case 'genjutsu': // one hand raised by the face, calm
      face = 'smug';
      arms = arm('sp-armB', 'M27.8 23 L29.4 16', false, 28.4, 14) +
        arm('sp-armA', 'M20.2 23 L19 30', false, 18, 30);
      headRot = -2;
      break;
    case 'deadpan': // flat, arms at sides, unimpressed
      face = 'healthy';
      arms = arm('sp-armA', 'M20 23 L19.4 31', false, 18, 31) +
        arm('sp-armB', 'M28 23 L28.6 31', false, 28, 31);
      break;
    case 'flash': // both hands thrust together forward-right (Final Flash)
      legs = braceLegs();
      arms = arm('sp-armA', 'M20.4 23 L31 22', false, 31.5, 20.6) +
        arm('sp-armB', 'M27.6 23 L33.4 22', false, 34, 20.6);
      lean = 3;
      headRot = 3;
      break;
    case 'menace': // arms flung out wide, head back (time-stop)
      face = 'smug';
      arms = arm('sp-armA', 'M20.2 23 L12.8 16.8', false, 11, 15) +
        arm('sp-armB', 'M27.8 23 L35.2 16.8', false, 35, 15);
      headRot = -8;
      break;
    default:
      break;
  }
  const headInner = headRot ? `<g transform="rotate(${headRot} 16 17.6)">${head(face)}</g>` : head(face);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-combo sp-${pose}" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g transform="rotate(${lean} 24 46)"><g class="sp-bob">` +
    legs +
    dress(21) +
    arms +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${headInner}</g></g>` +
    `</g></g></svg>`
  );
}

function dress(y: number, pale = false, seated = false): string {
  const cloth = suit(pale);
  const skirtTop = y + (seated ? 5 : 6);
  const skirtBottom = y + (seated ? 13 : 14);
  return (
    px(20, y, 8, 6, cloth) +
    `<path d="M19 ${skirtTop} L29 ${skirtTop} L32 ${skirtBottom} L16 ${skirtBottom} Z" fill="${cloth}"/>`
  );
}

/** Standing rigs for fresh / healthy / heavy (walk / run / trudge). */
function standSvg(pose: MemokoPose, size: number): string {
  const cls = pose === 'fresh' ? 'sp-run' : pose === 'heavy' ? 'sp-trudge' : 'sp-walk';
  const lean = pose === 'heavy' ? 13 : pose === 'fresh' ? 9 : 4;
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp ${cls}" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g transform="rotate(${lean} 24 46)"><g class="sp-bob">` +
    standingLegs() +
    dress(21) +
    arm('sp-armA', 'M19.8 23 L18.8 31', false, 17, 31) +
    arm('sp-armB', 'M28.2 23 L29.2 31', false, 28, 31) +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${head(pose)}</g></g>` +
    `</g></g></svg>`
  );
}

/** Streaming: standing still, hands clasped, head tipped up. The head is wrapped
 *  in .mk-track and the pupils in .mk-eyes so the host can drive cursor tracking. */
function watchSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-watch" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<path class="sp-spark" d="M38 3.6 l2.2 3 -2.2 3 -2.2 -3 Z" fill="${SPARK}"/>` +
    `<g class="sp-bob">` +
    standingLegs() +
    dress(21) +
    stroke('M20 23 L23 30', LIMB, 2.6) +
    stroke('M28 23 L25 30', LIMB, 2.6) +
    px(22, 29, 5, 3, SKIN) +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)"><g class="mk-track"><g transform="rotate(-7 16 17.6)">${head('watch')}</g></g></g></g>` +
    `</g></svg>`
  );
}

/** Handoff done: banzai — both arms up, fresh face, waving. */
function cheerSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-cheer" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<path class="sp-spark" d="M9.5 9 l2 2.7 -2 2.7 -2 -2.7 Z" fill="${SPARK}"/>` +
    `<path class="sp-spark sp-spark2" d="M40 12 l1.6 2.2 -1.6 2.2 -1.6 -2.2 Z" fill="${SPARK}"/>` +
    `<g class="sp-bob">` +
    standingLegs() +
    dress(21) +
    arm('sp-armA', 'M20.2 22.6 L16.3 16.8', false, 14, 15) +
    arm('sp-armB', 'M27.8 22.6 L31.7 16.8', false, 31, 15) +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${head('cheer')}</g></g>` +
    `</g></svg>`
  );
}

/** Damage flinch: quick recoil with bent knees and a pinched expression. */
function hurtSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-hurt" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-flinch">` +
    `<g class="sp-legA">${stroke('M21.7 32.5 L20.9 38.8 L22.2 44.2', LIMB, 2.5)}${boot(19, 44)}</g>` +
    `<g class="sp-legB">${stroke('M26.3 32.5 L27.1 38.8 L25.8 44.2', LIMB, 2.5)}${boot(24, 44)}</g>` +
    dress(21) +
    `<g class="sp-armA">${stroke('M20.1 23 L18.4 26.2 L19.6 29.4', LIMB, 2.6)}${px(18, 29, 3, 3, LIMB)}</g>` +
    `<g class="sp-armB">${stroke('M27.9 23 L29.6 26.2 L28.4 29.4', LIMB, 2.6)}${px(28, 29, 3, 3, LIMB)}</g>` +
    `<g class="sp-headG"><g transform="translate(12.2 1.0) scale(0.72)"><g transform="rotate(-12 16 17.6)">${head('hurt')}</g></g></g>` +
    `</g></svg>`
  );
}

/** Critical: lying KO with a rising soul. */
function lyingSvg(size: number): string {
  const w = Math.round((size * 64) / 50);
  return (
    `<svg viewBox="0 0 64 50" width="${w}" height="${size}" class="sp sp-lying" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-legStraight">${stroke('M37.5 43.2 L52 43.2', LIMB_PALE, 2.5)}${boot(52, 42)}</g>` +
    `<g class="sp-legBent">${stroke('M37 43 L44 38 L49 44', LIMB_PALE, 2.5)}${boot(48, 44)}</g>` +
    `<path d="M24 37 L37 36 L43 45 L23 45 Z" fill="${DRESS_PALE}"/>` +
    stroke('M28 39 L37 36', LIMB_PALE, 2.4) +
    stroke('M27 41 L32 45', LIMB_PALE, 2.4) +
    `<g transform="translate(2.6 25.6) scale(0.72)"><g transform="rotate(-8 16 17.6)">${head('critical')}</g></g>` +
    `<g transform="translate(14.5 39.5) scale(0.95)">${wisp('sp-soul')}</g>` +
    `</svg>`
  );
}

// ---- idle / personality poses --------------------------------------------

/** Shared seated lower body: hips ≈ y34, legs dangle straight and swing. */
function dangleLegs(): string {
  return (
    `<g class="sp-dangleA">${stroke('M21.6 33.6 L21.6 45', LIMB, 2.5)}${boot(18, 45)}</g>` +
    `<g class="sp-dangleB">${stroke('M26.4 33.6 L26.4 45', LIMB, 2.5)}${boot(24, 45)}</g>`
  );
}

/** Reading legs: closer together and calmer so the silhouette feels tucked in. */
function bookLegs(): string {
  return (
    `<g class="sp-dangleA">${stroke('M22.4 33.8 L22 44.2', LIMB, 2.5)}${boot(18, 44)}</g>` +
    `<g class="sp-dangleB">${stroke('M25.6 33.8 L26 44.2', LIMB, 2.5)}${boot(23, 44)}</g>`
  );
}

/** Seated dress: the standing skirt shifted down ~3px so she reads as sitting. */
const SEATED_DRESS = dress(24, false, true);

/** Sit: perched on the edge, hands on the lap, feet swinging. */
function sitSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-sit" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-sitbob">` +
    dangleLegs() +
    SEATED_DRESS +
    stroke('M20.4 25.6 L21.8 32.6', LIMB, 2.5) +
    stroke('M27.6 25.6 L26.2 32.6', LIMB, 2.5) +
    `<g class="sp-headG"><g transform="translate(12.4 3.4) scale(0.72)">${head('sit')}</g></g>` +
    `</g></svg>`
  );
}

/** Laptop: seated, a tiny laptop on her lap, hands tapping, head tipped down. */
function laptopSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-laptop" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-sitbob">` +
    dangleLegs() +
    SEATED_DRESS +
    `<g class="sp-headG"><g transform="translate(12.4 3.0) scale(0.72)"><g transform="rotate(9 16 17.6)">${head('laptop')}</g></g></g>` +
    `<g class="sp-lap">` +
    px(18, 27, 12, 6, LID, 'sp-lap-lid') +
    px(20, 28, 8, 3, SCREEN, 'sp-lap-scr') +
    px(16, 33, 17, 3, DECK) +
    `</g>` +
    `<g class="sp-type-l">${stroke('M20.4 25.8 L22.6 32.8', LIMB, 2.4)}</g>` +
    `<g class="sp-type-r">${stroke('M27.6 25.8 L25.4 32.8', LIMB, 2.4)}</g>` +
    `</g></svg>`
  );
}

/** Reading: seated with a little open book and a gentle page flutter. */
function bookSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-book" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-bookbob">` +
    bookLegs() +
    SEATED_DRESS +
    `<g class="sp-headG"><g transform="translate(12.4 3.1) scale(0.72)"><g transform="rotate(7 16 17.6)">${head('book')}</g></g></g>` +
    `<g class="sp-book-wrap">` +
    `<path d="M16 28 L24 27 L24 36 L16 37 Z" fill="${BOOK}" opacity="0.95"/>` +
    `<path d="M24 27 L32 28 L32 37 L24 36 Z" fill="${BOOK}" opacity="0.9"/>` +
    `<path class="sp-pageL" d="M17 28.5 L23.5 27.8 L23.5 35.5 L17 36.2 Z" fill="${PAPER}" stroke="${INK}" stroke-width="0.8"/>` +
    `<path class="sp-pageR" d="M24.5 27.8 L31 28.5 L31 36.2 L24.5 35.5 Z" fill="${PAPER}" stroke="${INK}" stroke-width="0.8"/>` +
    `<path d="M24 27.3 L24 35.8" stroke="${BOOK}" stroke-width="1.1" stroke-linecap="square"/>` +
    `<path d="M18.2 30.4 L22.2 30" stroke="${PAGE_LINE}" stroke-width="0.75" stroke-linecap="square"/>` +
    `<path d="M18.2 32 L22.2 31.6" stroke="${PAGE_LINE}" stroke-width="0.75" stroke-linecap="square"/>` +
    `<path d="M25.8 30 L29.8 30.4" stroke="${PAGE_LINE}" stroke-width="0.75" stroke-linecap="square"/>` +
    `<path d="M25.8 31.6 L29.8 32" stroke="${PAGE_LINE}" stroke-width="0.75" stroke-linecap="square"/>` +
    `</g>` +
    arm('sp-armA', 'M20.4 25.8 L20.7 32', false, 19, 31) +
    arm('sp-armB', 'M27.6 25.8 L27.3 32', false, 26, 31) +
    `</g></svg>`
  );
}

/** Nap: slumped to one side, head lolled, slow breathing. The "zzz" is drawn by
 *  the host in the pill spot so it can rise past the sprite bounds. */
function napSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-nap" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-napbob"><g transform="rotate(-9 24 40)">` +
    dangleLegs() +
    SEATED_DRESS +
    stroke('M20.4 25.6 L20 33.4', LIMB, 2.4) +
    stroke('M27.6 25.6 L26 33', LIMB, 2.4) +
    `<g class="sp-headG"><g transform="translate(12.4 3.6) scale(0.72)"><g transform="rotate(20 16 17.6)">${head('nap')}</g></g></g>` +
    `</g></g></svg>`
  );
}

/** Greeting wave: standing, one arm up waving, happy. */
function waveSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-wave" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<path class="sp-spark" d="M34 5.4 l1.8 2.5 -1.8 2.5 -1.8 -2.5 Z" fill="${SPARK}"/>` +
    `<g class="sp-bob">` +
    standingLegs() +
    dress(21) +
    arm('sp-armA', 'M20.2 22.6 L19.3 30.4', false, 18, 30) +
    arm('sp-armB', 'M27.8 22.6 L31.7 16.6', false, 31, 15) +
    `<g class="sp-headG"><g transform="translate(12.4 0.5) scale(0.72)">${head('wave')}</g></g>` +
    `</g></svg>`
  );
}

/** Yawn + stretch: seated, both arms reaching up, squeezed eyes. */
function yawnSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-yawn" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-yawnbob">` +
    dangleLegs() +
    SEATED_DRESS +
    arm('sp-stretchA', 'M20.4 25.2 L15.4 16.8', false, 14, 15) +
    arm('sp-stretchB', 'M27.6 25.2 L32.6 16.8', false, 32, 15) +
    `<g class="sp-headG"><g transform="translate(12.4 3.0) scale(0.72)"><g transform="rotate(-8 16 17.6)">${head('yawn')}</g></g></g>` +
    `</g></svg>`
  );
}

/** Doodling: seated, a notepad on her lap, pencil hand scribbling. */
function doodleSvg(size: number): string {
  const w = Math.round((size * 48) / 50);
  return (
    `<svg viewBox="0 0 48 50" width="${w}" height="${size}" class="sp sp-doodle" aria-hidden="true" shape-rendering="crispEdges" style="display:block;overflow:visible">` +
    `<g class="sp-doodlebob">` +
    dangleLegs() +
    SEATED_DRESS +
    `<g class="sp-headG"><g transform="translate(12.4 3.0) scale(0.72)"><g transform="rotate(12 16 17.6)">${head('laptop')}</g></g></g>` +
    `<g class="sp-pad"><path d="M17 30 L30 29 L31 35 L18 36 Z" fill="#f3ede2" stroke="${INK}" stroke-width="0.8"/>` +
    stroke('M20 31.7 L27.4 31', INK, 0.6) +
    stroke('M20.4 33.2 L27.8 32.5', INK, 0.6) +
    `</g>` +
    stroke('M20.4 25.8 L21.4 32', LIMB, 2.4) +
    `<g class="sp-scribble">${stroke('M27.6 25.8 L26.3 31.4', LIMB, 2.4)}` +
    `<path d="M26.3 31.4 L24.1 34" stroke="#d8a24a" stroke-width="1.5" stroke-linecap="round"/>` +
    `<circle cx="23.9" cy="34.2" r="0.6" fill="${INK}"/></g>` +
    `</g></svg>`
  );
}
