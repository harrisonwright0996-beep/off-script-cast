// First open: the right install steps for this device. On iPhone the installed app keeps its own
// storage, so a phone installs first and unlocks afterwards. Reminders need the installed app too.
import { h, screen, button, announce } from './dom.js';
import { thisDevice, mustInstall, safariHasDots } from '../device.js';

const BROWSER_FLAG = 'off-script-cast-in-browser';

// Chrome on Android offers a real install button: its offer comes once, early, so it is kept here.
let offer = null;
let offered = () => {}; // an offer that comes after the steps are on screen
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offer = e;
    offered();
  });
}

function inBrowserChosen() {
  try {
    return localStorage.getItem(BROWSER_FLAG) === '1';
  } catch {
    return false;
  }
}

// On Android the app and the browser share what is saved, so a phone with its lines has nothing to
// install for, whichever way it was opened.
export const needsInstall = (hasLines = false) => mustInstall(thisDevice()) && !inBrowserChosen() && !(hasLines && thisDevice().startsWith('android'));

const SHARE_STEPS = [
  'Tap Share (the square with an arrow pointing up).',
  'Scroll down and tap Add to Home Screen. You may need to tap View More first.',
  'If you see Open as Web App, leave it on. Tap Add.',
  'Close Safari and open Off Script from your Home Screen.',
];
const SAFARI = ['Tap the three dots next to the address bar.', ...SHARE_STEPS];
const CHROME_ANDROID = [
  'Tap the three dots at the top right of Chrome.',
  'Tap Add to Home screen or Install app.',
  'Tap Install, then open Off Script from your Home screen.',
];
const OTHER_ANDROID = [
  'Open the browser menu (three dots or three lines).',
  'Tap Install or Add to Home screen. On Samsung Internet, tap Add page to, then Home screen.',
  'Cannot see that? Tap Copy link below and open it in Chrome.',
  'Open Off Script from your Home screen.',
];

const STEPS = {
  'ios-safari': { name: 'iPhone or iPad', lead: 'Add Off Script to your Home Screen. It takes a few seconds, and then it works like an app, even with no signal.', steps: SAFARI },
  'ios-other': { name: 'iPhone or iPad, not in Safari', lead: 'This needs Safari, the blue compass app.', steps: ['Tap Copy link below.', 'Open Safari and paste the link in the address bar.', 'Follow the steps there.'], copy: true },
  'in-app': {
    name: 'Inside another app',
    lead: 'This link has opened inside another app, and Off Script cannot be installed from here.',
    steps: ['Look for the three dots or the compass icon, and choose Open in Safari or Open in Chrome.', 'Cannot see that? Tap Copy link below, then paste it into Safari on an iPhone or Chrome on Android.'],
    copy: true,
  },
  'android-chrome': { name: 'Android', lead: 'Install Off Script. It takes a few seconds, and then it works like an app, even with no signal.', steps: CHROME_ANDROID },
  'android-other': { name: 'Android, not in Chrome', lead: 'Add Off Script to your Home screen.', steps: OTHER_ANDROID, copy: true },
};

const list = (steps) => h('ol', { class: 'steps' }, steps.map((s) => h('li', {}, s)));

// The drawings: one for each step, a phone's screen with a pulsing ring where the finger goes. Drawn
// here, not photographed, so they are small and work with no signal. The steps beside them say it all
// in words, so a screen reader is not sent through them.
const tap = () => h('span', { class: 'demo-tap' });
const bar = (...kids) => h('div', { class: 'demo-bar' }, ...kids);
const address = () => h('span', { class: 'demo-address' }, 'off-script-cast.pages.dev');
const icon = () => h('img', { class: 'demo-icon', src: 'icons/icon-192.png', alt: '' });
const row = (text, on = false) => h('div', { class: 'demo-row' }, h('span', {}, text), on ? tap() : null);
const sheet = (...kids) => h('div', { class: 'demo-sheet' }, ...kids);
const homeScreen = () =>
  h('div', { class: 'demo-home' }, ['', '', '', ''].map(() => h('span', { class: 'demo-app' })), h('div', { class: 'demo-mine' }, icon(), h('span', {}, 'Off Script'), tap()));
const addSheet = (word) =>
  sheet(
    h('div', { class: 'demo-sheet-top' }, h('span', {}, 'Cancel'), h('strong', {}, word), h('span', { class: 'demo-add' }, 'Add', tap())),
    h('div', { class: 'demo-row' }, icon(), h('span', {}, 'Off Script')),
  );

const SAFARI_SHARE = () => sheet(row('Copy'), row('Add to Favourites'), row('Add to Home Screen', true));
const SAFARI_ADD = () => addSheet('Add to Home Screen');
const DOTS_FRAMES = [
  () => [bar(address(), h('span', { class: 'demo-dots' }, '•••', tap()))],
  () => [sheet(row('Share', true), row('Add to Bookmarks'), row('Find on Page')), bar(address(), h('span', { class: 'demo-dots' }, '•••'))],
  SAFARI_SHARE,
  SAFARI_ADD,
  homeScreen,
];
const SHARE_FRAMES = [() => [bar(h('span', { class: 'demo-share' }, '↑', tap())), h('p', { class: 'demo-url' }, 'off-script-cast.pages.dev')], SAFARI_SHARE, SAFARI_ADD, homeScreen];
const CHROME_FRAMES = [
  () => [h('div', { class: 'demo-bar demo-top' }, address(), h('span', { class: 'demo-dots' }, '⋮', tap()))],
  () => [sheet(row('New tab'), row('Bookmarks'), row('Add to Home screen', true))],
  () => [addSheet('Install app')],
  homeScreen,
];

const WAIT = 3500; // long enough to read a step
const stillMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Plays the steps round, with the step in words lit beside the drawing. It stops for good at a tap, so
// no one has to read against the clock, and never starts by itself for a phone set to reduce motion.
function demo(steps, frames) {
  const items = steps.map((s) => h('li', {}, s));
  const shown = h('div', { class: 'demo-screen', 'aria-hidden': 'true' });
  const count = h('span', { class: 'demo-count' });
  let at = 0;
  let timer = null;
  const draw = () => {
    shown.replaceChildren(...[frames[at]()].flat());
    items.forEach((li, i) => li.classList.toggle('on', i === at));
    count.textContent = `Step ${at + 1} of ${steps.length}`;
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    pause.textContent = 'Play';
  };
  const play = () => {
    timer = setInterval(() => {
      if (!shown.isConnected) return clearInterval(timer); // this screen has gone
      at = (at + 1) % steps.length;
      draw();
    }, WAIT);
    pause.textContent = 'Pause';
  };
  const move = (by) => () => {
    stop();
    at = (at + by + steps.length) % steps.length;
    draw();
  };
  const pause = button('Pause', () => (timer ? stop() : play()));
  draw();
  if (stillMotion()) pause.textContent = 'Play';
  else play();
  return [h('div', { class: 'demo' }, shown, h('div', { class: 'demo-controls' }, button('Back', move(-1)), count, button('Next', move(1)), pause)), h('ol', { class: 'steps demo-steps' }, items)];
}

// A phone with a drawing gets the steps played out; any other gets them as a list.
function shownSteps(kind, info) {
  if (kind === 'android-chrome') return demo(info.steps, CHROME_FRAMES);
  if (kind !== 'ios-safari') return [list(info.steps)];
  return safariHasDots(navigator.userAgent) ? demo(SAFARI, DOTS_FRAMES) : demo(SHARE_STEPS, SHARE_FRAMES);
}

export function showInstall(ctx) {
  const kind = thisDevice();
  const info = STEPS[kind] || STEPS['ios-safari'];
  const carryOn = () => {
    try {
      localStorage.setItem(BROWSER_FLAG, '1');
    } catch {
      // private browsing: carry on anyway
    }
    ctx.go(ctx.model ? 'today' : 'unlock');
  };
  const copy = async () => {
    try {
      const stuck = new Promise((_, reject) => setTimeout(reject, 1500)); // a phone that never answers
      await Promise.race([navigator.clipboard.writeText(location.href.split('#')[0]), stuck]);
      announce('Link copied');
      said.textContent = 'Copied. Now paste it into your browser.';
    } catch {
      said.textContent = location.href.split('#')[0];
    }
  };
  const said = h('p', { class: 'help', role: 'status' });
  const all = h('div', { class: 'all-steps' });
  const others = button('Not your device? See all the steps', () => {
    others.remove();
    for (const [key, x] of Object.entries(STEPS)) if (key !== kind) all.append(h('h2', { tabindex: '-1' }, x.name), h('p', {}, x.lead), list(x.steps));
    all.querySelector('h2').focus(); // the button that had focus has gone
  }, { class: 'btn link' });
  const install =
    kind.startsWith('android')
      ? button('Install Off Script', async () => {
          if (!offer) {
            said.textContent = 'Your phone has not offered to install yet. Follow the steps above.';
            return;
          }
          offer.prompt();
          const { outcome } = await offer.userChoice;
          offer = null;
          if (outcome !== 'accepted') return;
          install.remove();
          said.textContent = 'Installed. Open Off Script from your Home screen.';
        }, { class: 'btn primary' })
      : null;
  // Other browsers only ever offer it themselves: no offer, no button.
  if (install && kind !== 'android-chrome' && !offer) {
    install.hidden = true;
    offered = () => (install.hidden = false);
  }
  ctx.root.append(
    screen({
      title: 'Install Off Script',
      body: [h('p', { class: 'lead' }, info.lead), ...shownSteps(kind, info), kind === 'ios-safari' ? h('p', { class: 'help' }, 'Looks different? Share is the square with an arrow, at the bottom of the screen, or the top on an iPad. Already added it? Open Off Script from your Home Screen.') : null, info.copy ? button('Copy link', copy, { class: 'btn' }) : null, said, others, all],
      footer: [install, kind.startsWith('ios') || kind === 'in-app' ? h('p', { class: 'help' }, 'If you carry on here and install later, you will start again.') : null, button('Carry on without installing', carryOn, { class: 'btn link' })].filter(Boolean),
    }),
  );
}
