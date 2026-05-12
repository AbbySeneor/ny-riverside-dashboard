/** Keys must match data-prep/config.py SITES */
export const SITE_LIST = [
  { id: "west_harlem", label: "West Harlem Forest", acres: 7.5 },
  { id: "morningside", label: "Morningside Park", acres: 12.1 },
  { id: "highbridge", label: "Highbridge Park", acres: 18.7 },
  { id: "inwood_hill", label: "Inwood Hill Park", acres: 73.0 },
  { id: "van_cortlandt", label: "Van Cortlandt Park", acres: 635 },
  { id: "pelham_bay", label: "Pelham Bay Park", acres: 778 },
];

export function resolveSiteId() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("site");
  if (q && SITE_LIST.some((s) => s.id === q)) return q;
  const env = import.meta.env.VITE_SITE_ID;
  if (env && SITE_LIST.some((s) => s.id === env)) return env;
  try {
    const stored = localStorage.getItem("treelyon_site_id");
    if (stored && SITE_LIST.some((s) => s.id === stored)) return stored;
  } catch {
    /* ignore */
  }
  return "west_harlem";
}

export function siteLabel(id) {
  return SITE_LIST.find((s) => s.id === id)?.label ?? id;
}

export function siteAcres(id) {
  return SITE_LIST.find((s) => s.id === id)?.acres ?? null;
}
