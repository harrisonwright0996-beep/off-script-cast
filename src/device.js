// Which device and browser this is, and so which install steps it needs. Pure, so every kind can
// be tested from a user agent.
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Snapchat|Twitter|LinkedInApp|MicroMessenger|Pinterest|WhatsApp|Teams|GSA\//;

export function detect({ ua = '', platform = '', touch = 0, standalone = false } = {}) {
  if (standalone) return 'standalone';
  const ios = /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touch > 1);
  const android = /Android/.test(ua);
  if ((ios || android) && (IN_APP.test(ua) || (android && /; wv\)/.test(ua)))) return 'in-app';
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua) ? 'ios-other' : 'ios-safari';
  if (android) return /SamsungBrowser|Firefox|OPR\//.test(ua) || !/Chrome/.test(ua) ? 'android-other' : 'android-chrome';
  return 'desktop';
}

export const thisDevice = () =>
  detect({
    ua: navigator.userAgent,
    platform: navigator.platform,
    touch: navigator.maxTouchPoints,
    standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
  });

// A phone or tablet must install first: on iPhone the installed app has its own storage, so what is
// unlocked in the browser would stay in the browser. A laptop can carry on where it is.
export const mustInstall = (kind) => kind !== 'standalone' && kind !== 'desktop';
