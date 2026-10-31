// First open: the right install steps for this device. On iPhone the installed app keeps its own
// storage, so a phone installs first and unlocks afterwards. Reminders need the installed app too.
import { h, screen, button, announce } from './dom.js';
import { thisDevice, mustInstall } from '../device.js';

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

const SAFARI = [
  'Tap the three dots next to the address bar. No three dots? Skip this: the Share button is at the bottom of the screen, or the top on an iPad.',
  'Tap Share (the square with an arrow pointing up).',
  'Scroll down and tap Add to Home Screen. You may need to tap View More first.',
  'If you see Open as Web App, leave it on. Tap Add.',
  'Close Safari and open Off Script from your Home Screen.',
];
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
      body: [h('p', { class: 'lead' }, info.lead), list(info.steps), kind === 'ios-safari' ? h('p', { class: 'help' }, 'Already added it? Open Off Script from your Home Screen.') : null, info.copy ? button('Copy link', copy, { class: 'btn' }) : null, said, others, all],
      footer: [install, kind.startsWith('ios') || kind === 'in-app' ? h('p', { class: 'help' }, 'If you carry on here and install later, you will start again.') : null, button('Carry on without installing', carryOn, { class: 'btn link' })].filter(Boolean),
    }),
  );
}
