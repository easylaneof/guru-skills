import React from 'react';
import { AbsoluteFill, Img, useVideoConfig, staticFile } from 'remotion';
import { COLORS, GRAD, FONT_DISPLAY, FONT_BODY, BG_GRADIENT, gradientTextStyle } from '../../shared/design-tokens';
import type { CreativeProps } from '../../shared/types';

/**
 * PosterStill — статичный постер-креатив (старый «фейси»-стиль, без «до»-фото).
 * Полноэкранное фото результата + лого-бейдж, плашка-подарок, спарклы,
 * заголовок с золотым акцентом, саблайн, CTA. Подходит и для still, и для видео.
 *
 * assets:  after_image — фото результата (полный экран)
 * copy:    headline, headline_accent (золотом), subline, cta_button, gift_pill (плашка справа)
 * brand:   badge_text (лого слева)
 */
const sparkleSvg = (s: number) => (
  <svg width={s} height={s} viewBox="0 0 40 40" fill="none">
    <path d="M20 2 C 21 14, 26 19, 38 20 C 26 21, 21 26, 20 38 C 19 26, 14 21, 2 20 C 14 19, 19 14, 20 2 Z" fill="currentColor" />
  </svg>
);

export const PosterStill: React.FC<CreativeProps> = ({ assets, copy, brand }) => {
  const { width, height } = useVideoConfig();
  const k = Math.min(width, height) / 1080; // масштаб от меньшей стороны

  const objPos = copy.object_position || 'center 30%';
  // Масштаб заголовка и саблайна: когда крупный текст наезжает на лицо в кадре.
  // Кнопку CTA не трогаем — она внизу и лицо не перекрывает.
  const ts = Number(copy.text_scale) || 1;
  // Затемнение под текстом едет вниз вслед за ужатым текстом — иначе тень съедает
  // пол-кадра ради двух строк. При ts=1 значения те же, что были.
  const shadeStart = 38 + (1 - ts) * 90;
  const shadeMid = 68 + (1 - ts) * 45;
  // contain — когда важна вся композиция кадра целиком (шарж: голова + тонкая шея + мелкое тело).
  // Кроп cover в квадрате и баннере срезает низ и убивает контраст пропорций.
  const isContain = copy.object_fit === 'contain';

  // Спарклы (золотые точки-звёздочки) — фиксированные позиции в % кадра.
  const sparkles = [
    { x: 0.86, y: 0.10, s: 26 }, { x: 0.93, y: 0.20, s: 16 }, { x: 0.80, y: 0.22, s: 14 },
    { x: 0.07, y: 0.55, s: 20 }, { x: 0.90, y: 0.46, s: 22 }, { x: 0.12, y: 0.40, s: 14 },
  ];

  return (
    <AbsoluteFill style={{ background: BG_GRADIENT, fontFamily: FONT_BODY, overflow: 'hidden' }}>
      {/* Фото результата: cover на весь кадр либо целиком поверх размытой подложки */}
      {isContain && (
        <Img
          src={staticFile(assets.after_image)}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
            filter: 'blur(48px) saturate(1.1)', transform: 'scale(1.15)' }}
        />
      )}
      <Img
        src={staticFile(assets.after_image)}
        style={isContain
          ? { position: 'absolute', top: `${2 * k}%`, left: 0, right: 0, height: '70%', width: '100%', objectFit: 'contain', objectPosition: 'center top' }
          : { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: objPos }}
      />
      {/* Затемнение снизу под текст */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(14,10,8,0.45) 0%, transparent 20%, transparent ${shadeStart}%, rgba(14,10,8,0.72) ${shadeMid}%, rgba(14,10,8,0.96) 100%)` }} />

      {/* Спарклы */}
      {sparkles.map((sp, i) => (
        <div key={i} style={{ position: 'absolute', left: width * sp.x, top: height * sp.y, color: COLORS.GOLD, filter: 'drop-shadow(0 0 8px rgba(244,199,122,0.7))' }}>
          {sparkleSvg(sp.s * k)}
        </div>
      ))}

      {/* Лого-бейдж слева сверху */}
      <div style={{ position: 'absolute', top: 36 * k, left: 36 * k, display: 'flex', alignItems: 'center', gap: 10 * k,
        background: 'rgba(20,14,12,0.78)', border: `1px solid ${COLORS.BORDER}`, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        borderRadius: 9999, padding: `${11 * k}px ${22 * k}px` }}>
        <div style={{ width: 30 * k, height: 30 * k, borderRadius: 9 * k, background: GRAD, display: 'grid', placeItems: 'center', color: COLORS.DARK_TXT }}>
          {sparkleSvg(18 * k)}
        </div>
        <span style={{ fontSize: 30 * k, fontWeight: 700, color: COLORS.WHITE, fontFamily: FONT_DISPLAY }}>{brand.badge_text}</span>
      </div>

      {/* Плашка-подарок справа сверху */}
      {copy.gift_pill && (
        <div style={{ position: 'absolute', top: 36 * k, right: 36 * k, display: 'flex', alignItems: 'center', gap: 8 * k,
          background: 'rgba(20,14,12,0.78)', border: `1px solid ${COLORS.BORDER}`, backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          borderRadius: 9999, padding: `${11 * k}px ${22 * k}px`, fontSize: 26 * k, fontWeight: 600, color: COLORS.WHITE }}>
          <span style={{ color: COLORS.GOLD }}>{sparkleSvg(16 * k)}</span> {copy.gift_pill}
        </div>
      )}

      {/* Нижний блок текста */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: `0 ${56 * k}px ${60 * k}px`, textAlign: 'center' }}>
        <div style={{ fontSize: 92 * k * ts, fontFamily: FONT_DISPLAY, fontWeight: 800, color: COLORS.WHITE, letterSpacing: -2.5 * k * ts, lineHeight: 1.02, marginBottom: 16 * k }}>
          {copy.headline}{' '}
          {copy.headline_accent && <span style={gradientTextStyle}>{copy.headline_accent}</span>}
        </div>
        {copy.subline && (
          <div style={{ fontSize: 30 * k * ts, fontFamily: FONT_BODY, color: COLORS.MUTED, marginBottom: 28 * k }}>
            {copy.subline}
          </div>
        )}
        {copy.cta_button && (
          <div style={{ background: GRAD, borderRadius: 9999, padding: `${26 * k}px 0`, fontSize: 40 * k, fontFamily: FONT_BODY, fontWeight: 700,
            color: COLORS.DARK_TXT, textAlign: 'center', boxShadow: '0 12px 40px rgba(244,199,122,0.45)' }}>
            {copy.cta_button}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
