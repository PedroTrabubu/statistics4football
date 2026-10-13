import { useRef, useEffect, useState, useCallback } from 'react';
import { gsap } from 'gsap';

import './AccordionGallery.css';

// AccordionGallery de React Bits (variante JS + CSS), adaptado. Todo lo añadido
// es opcional y sin pasarlo se comporta como el original:
// - `fit` ('cover' | 'contain', también por item): con 'contain' la imagen se
//   ve entera y centrada sobre `item.background`, y crece con el panel.
// - `item.background` (fondo CSS del panel) e `item.imageStyle` (estilo de la imagen).
// - `onActiveChange(index)`: se llama al cambiar de panel, no con el inicial.
// - `onLinkClick(event, item, index)`: al pulsar el panel ya abierto; con
//   `event.preventDefault()` se navega con el router en vez de recargar.
// - `ariaLabel` para la lista.
// Arreglos:
// - La capa que oscurece los paneles cerrados también oscurecía el abierto.
// - Con `trigger="click"`, el primer click abre el panel y no sigue el enlace:
//   el foco del mousedown ya lo activaba y el click navegaba a la primera.
// - Las flechas mueven el foco (y con él el panel abierto), y solo el panel
//   abierto entra en el orden de tabulación.
// Sin la directiva 'use client' del original: es de Next.js y en Vite no hace nada.

const DEFAULT_ITEMS = [
  { image: 'https://picsum.photos/id/1015/900/1200', label: 'Canyon', link: '#' },
  { image: 'https://picsum.photos/id/1018/900/1200', label: 'Ridgeline', link: '#' },
  { image: 'https://picsum.photos/id/1039/900/1200', label: 'Falls', link: '#' },
  { image: 'https://picsum.photos/id/1043/900/1200', label: 'Harbour', link: '#' },
  { image: 'https://picsum.photos/id/1044/900/1200', label: 'Skyline', link: '#' }
];

const AccordionGallery = ({
  items = DEFAULT_ITEMS,
  defaultIndex = 2,
  accentColor = '#ffffff',
  overlayColor = '#060010',
  textColor = '#ffffff',
  height = 460,
  gap = 10,
  radius = 16,
  expandRatio = 0.52,
  orientation = 'horizontal',
  duration = 0.6,
  ease = 'power3.out',
  parallax = 0.5,
  tilt = 8,
  stagger = 0.06,
  trigger = 'hover',
  showLabels = true,
  grayscale = true,
  fit = 'cover',
  onActiveChange,
  onLinkClick,
  ariaLabel = 'Image accordion gallery',
  className = ''
}) => {
  const rootRef = useRef(null);
  const panelRefs = useRef([]);
  const mediaRefs = useRef([]);
  const barRefs = useRef([]);
  const textRefs = useRef([]);
  const tlRef = useRef(null);
  const firstRunRef = useRef(true);
  const mediaSizeRef = useRef(320);
  // Panel pulsado y si ya estaba abierto al pulsar (ver handleClick).
  const pressRef = useRef(null);

  const vertical = orientation === 'vertical';
  const count = items.length;
  const [active, setActive] = useState(Math.min(Math.max(defaultIndex, 0), count - 1));

  const prefersReduced =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const applyLayout = useCallback(
    animate => {
      const panels = panelRefs.current;
      if (!panels.length) return;

      const r = Math.min(Math.max(expandRatio, 0.2), 0.9);
      const grow = count > 1 ? (r * (count - 1)) / (1 - r) : 1;
      const mediaSize = mediaSizeRef.current;

      tlRef.current?.kill();
      const dur = animate && !prefersReduced ? duration : 0;
      const tl = gsap.timeline();

      panels.forEach((panel, i) => {
        if (!panel) return;
        const isActive = i === active;
        const media = mediaRefs.current[i];
        const bar = barRefs.current[i];
        const text = textRefs.current[i];

        const rot = isActive ? 0 : i < active ? tilt : -tilt;
        const rotProp = vertical ? { rotateX: -rot } : { rotateY: rot };

        // --ag-dim va en el panel: la capa que oscurece es hermana de la
        // imagen y solo lo hereda de ahi (en el original iba en la imagen y
        // el panel abierto tambien quedaba oscurecido).
        tl.to(
          panel,
          { flexGrow: isActive ? grow : 1, ...rotProp, '--ag-dim': isActive ? 0 : 0.35, duration: dur, ease },
          0
        );

        if (media) {
          const drift = Math.max(-1.5, Math.min(1.5, active - i));
          const shift = drift * parallax * mediaSize * 0.06;
          const gray = grayscale ? (isActive ? 0 : 1) : 0;
          tl.to(
            media,
            {
              xPercent: -50,
              yPercent: -50,
              x: vertical ? 0 : isActive ? 0 : shift,
              y: vertical ? (isActive ? 0 : shift) : 0,
              '--ag-gray': gray,
              duration: dur,
              ease
            },
            0
          );
        }

        if (showLabels && bar && text) {
          if (isActive) {
            tl.to([bar, text], { opacity: 1, x: 0, duration: dur, ease, stagger: prefersReduced ? 0 : stagger }, 0);
          } else {
            tl.to([bar, text], { opacity: 0, x: -14, duration: dur * 0.6, ease }, 0);
          }
        }
      });

      tlRef.current = tl;
    },
    [
      active,
      count,
      expandRatio,
      duration,
      ease,
      vertical,
      tilt,
      parallax,
      grayscale,
      showLabels,
      stagger,
      prefersReduced
    ]
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const total = vertical ? rect.height : rect.width;
      const usable = Math.max(total - gap * (count - 1), 120);
      const size = Math.max(140, usable * Math.min(Math.max(expandRatio, 0.2), 0.9) * 1.22);
      mediaSizeRef.current = size;
      el.style.setProperty('--ag-media-size', `${size}px`);
      applyLayout(!firstRunRef.current);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyLayout, gap, count, expandRatio, vertical]);

  useEffect(() => {
    applyLayout(!firstRunRef.current);
    firstRunRef.current = false;
  }, [applyLayout]);

  useEffect(
    () => () => {
      tlRef.current?.kill();
    },
    []
  );

  const activate = i => {
    if (i === active) return;
    setActive(i);
    onActiveChange?.(i);
  };

  const handleEnter = i => {
    if (trigger === 'hover') activate(i);
  };

  const handlePointerDown = i => {
    pressRef.current = { index: i, wasActive: i === active };
  };

  const handleClick = (i, e) => {
    // Con raton o tactil, el foco llega antes que el click y ya ha abierto el
    // panel: cuenta si estaba abierto al pulsar. Con teclado (Enter) no hay
    // pulsacion previa y vale el estado actual.
    const press = pressRef.current;
    pressRef.current = null;
    const wasActive = press && press.index === i ? press.wasActive : i === active;
    if (!wasActive) {
      e.preventDefault();
      activate(i);
      return;
    }
    if (items[i].link) onLinkClick?.(e, items[i], i);
  };

  const focusPanel = i => panelRefs.current[i]?.focus();

  const handleKeyDown = (i, e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusPanel((i + 1) % count);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusPanel((i - 1 + count) % count);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`accordion-gallery${vertical ? ' accordion-gallery--vertical' : ''}${className ? ` ${className}` : ''}`}
      style={{
        '--ag-accent': accentColor,
        '--ag-overlay': overlayColor,
        '--ag-text': textColor,
        '--ag-gap': `${gap}px`,
        '--ag-radius': `${radius}px`,
        height: vertical ? `${Math.round(height * 1.6)}px` : `${height}px`
      }}
      role="list"
      aria-label={ariaLabel}
    >
      {items.map((item, i) => {
        const isActive = i === active;
        const contain = (item.fit ?? fit) === 'contain';
        const Tag = item.link ? 'a' : 'div';
        return (
          <Tag
            key={i}
            ref={el => (panelRefs.current[i] = el)}
            className={`ag-panel${isActive ? ' ag-panel--active' : ''}${contain ? ' ag-panel--contain' : ''}`}
            style={{ borderRadius: `${radius}px` }}
            href={item.link || undefined}
            onClick={e => handleClick(i, e)}
            onPointerDown={() => handlePointerDown(i)}
            onMouseEnter={() => handleEnter(i)}
            onFocus={() => activate(i)}
            onKeyDown={e => handleKeyDown(i, e)}
            role="listitem"
            tabIndex={isActive ? 0 : -1}
            aria-current={isActive ? 'true' : undefined}
            aria-label={item.label}
          >
            <span className="ag-panel__frame">
              <span
                className="ag-panel__media"
                ref={el => (mediaRefs.current[i] = el)}
                style={item.background ? { background: item.background } : undefined}
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.alt || item.label || ''}
                    style={item.imageStyle}
                    draggable="false"
                  />
                ) : (
                  <span className="ag-panel__fallback">{item.alt || item.label}</span>
                )}
              </span>
              <span className="ag-panel__overlay" aria-hidden="true" />
            </span>
            {showLabels && (
              <span className="ag-panel__label" aria-hidden="true">
                <span className="ag-panel__bar" ref={el => (barRefs.current[i] = el)} />
                <span className="ag-panel__text" ref={el => (textRefs.current[i] = el)}>
                  {item.label}
                </span>
              </span>
            )}
          </Tag>
        );
      })}
    </div>
  );
};

export default AccordionGallery;
