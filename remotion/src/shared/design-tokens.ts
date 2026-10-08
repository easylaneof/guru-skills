export const COLORS = {
  BG_TOP:   '#1A130E',
  BG_MID:   '#14100E',
  BG_BOT:   '#0E0A08',
  GOLD:     '#F4C77A',
  PEACH:    '#F39A8B',
  WHITE:    '#F6EFE7',
  MUTED:    'rgba(246,239,231,0.55)',
  CARD_BG:  'rgba(246,239,231,0.06)',
  BORDER:   'rgba(246,239,231,0.14)',
  DARK_TXT: '#1A130E',
} as const;

export const GRAD = 'linear-gradient(135deg, #F4C77A 0%, #F39A8B 100%)';

export const FONT_DISPLAY = "'Unbounded', system-ui, sans-serif";
export const FONT_BODY    = "'Manrope', system-ui, sans-serif";

export const gradientTextStyle: React.CSSProperties = {
  background: GRAD,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

export const BG_GRADIENT = [
  'radial-gradient(60% 50% at 75% 10%, rgba(244,199,122,0.16) 0%, transparent 65%)',
  `linear-gradient(180deg, ${COLORS.BG_TOP} 0%, ${COLORS.BG_MID} 55%, ${COLORS.BG_BOT} 100%)`,
].join(', ');
