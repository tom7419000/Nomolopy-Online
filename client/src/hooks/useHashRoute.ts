/**
 * Minimales Hash-Routing: `#/` = Startseite, `#/room/CODE` = Raum.
 * Hash statt Pfad, damit teilbare Links auch unter einem Unterpfad
 * (z. B. https://example.de/playhub/#/room/AB3D7) ohne Server-Rewrites
 * funktionieren.
 */

import { useEffect, useState } from 'react';

export type Route = { page: 'home' } | { page: 'room'; code: string };

export function parseHash(hash: string): Route {
  const m = /^#\/room\/([A-Za-z0-9]{3,10})/.exec(hash);
  if (m) return { page: 'room', code: m[1].toUpperCase() };
  return { page: 'home' };
}

export function roomHash(code: string): string {
  return `#/room/${code}`;
}

export function navigate(route: Route): void {
  const target = route.page === 'room' ? roomHash(route.code) : '#/';
  if (window.location.hash !== target) window.location.hash = target;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Vollständiger, teilbarer Link zu einem Raum. */
export function roomLink(code: string): string {
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return `${base}${roomHash(code)}`;
}
