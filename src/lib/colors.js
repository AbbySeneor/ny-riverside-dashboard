// Treelyon × Riverside — UI aligned with Treelyon platform (deep navy canvas, slate
// surfaces, seafoam accent). Brand marks: public/brands/treelyon.png & riverside.png.

/** Corner radii for inline styles */
export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 14,
};

export const PALETTE = {
  bg: '#0a0e1b',
  paper: '#0c1222',
  elevated: '#161d2f',
  deep: '#05080f',
  ink: '#f4f6fb',
  bodyMuted: '#94a3b8',
  subtle: '#64748b',
  rule: '#1e293b',
  /** Primary mint / seafoam (nav active, CTAs, highlights) */
  forest: '#6ee7c5',
  moss: '#86efac',
  sage: '#7dd3fc',
  ochre: '#fcd34d',
  coral: '#fb7185',
  sky: '#60a5fa',
  /** Text on mint / bright fills */
  onAccent: '#0a1628',
  /** Floating chrome on satellite map */
  overlay: 'rgba(10, 14, 27, 0.94)',
  mapWell: '#050a14',
  bannerWarnBg: '#1c1912',
  bannerWarnText: '#fde68a',
  bannerWarnBorder: '#b45309',
  bannerCodeBg: '#111827',
};

export const FONTS = {
  display: "'Playfair Display', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
  body: "'Figtree', system-ui, sans-serif",
};

export const TREE_HEALTH_PAINT = {
  'circle-radius': [
    'interpolate',
    ['linear'],
    ['zoom'],
    13,
    1.5,
    16,
    ['interpolate', ['linear'], ['get', 'crown_diameter'], 0, 2, 15, 6],
    19,
    ['interpolate', ['linear'], ['get', 'crown_diameter'], 0, 4, 15, 14],
  ],
  'circle-color': [
    'match',
    ['get', 'health_class'],
    'critical',
    PALETTE.coral,
    'stressed',
    PALETTE.ochre,
    PALETTE.moss,
  ],
  'circle-stroke-width': 0.6,
  'circle-stroke-color': '#0f172a',
  'circle-opacity': 0.9,
};

export const SLOPE_RAMP = [
  { deg: 0, hex: '#0f172a' },
  { deg: 10, hex: '#334155' },
  { deg: 20, hex: '#fcd34d' },
  { deg: 30, hex: '#fb7185' },
  { deg: 45, hex: '#9f1239' },
];

export const LST_RAMP = [
  { f: 70, hex: '#1e3a5f' },
  { f: 78, hex: '#3b82c4' },
  { f: 84, hex: '#6ee7c5' },
  { f: 90, hex: '#fcd34d' },
  { f: 95, hex: '#fb7185' },
  { f: 100, hex: '#9f1239' },
];
