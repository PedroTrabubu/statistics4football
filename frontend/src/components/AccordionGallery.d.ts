// Tipos de AccordionGallery.jsx (el componente es JavaScript, como lo da React Bits).
import type { CSSProperties, JSX, MouseEvent } from "react";

export interface AccordionGalleryItem {
  /** Sin imagen, el panel muestra `alt` o `label` en el centro. */
  image?: string;
  label?: string;
  link?: string;
  alt?: string;
  /** Fondo del panel detrás de la imagen (cualquier valor de `background`). */
  background?: string;
  /** Estilo extra de la imagen (por ejemplo, un filtro). */
  imageStyle?: CSSProperties;
  /** Sustituye a `fit` en este item. */
  fit?: "cover" | "contain";
}

export interface AccordionGalleryProps {
  items?: AccordionGalleryItem[];
  defaultIndex?: number;
  accentColor?: string;
  overlayColor?: string;
  textColor?: string;
  height?: number;
  gap?: number;
  radius?: number;
  expandRatio?: number;
  orientation?: "horizontal" | "vertical";
  duration?: number;
  ease?: string;
  parallax?: number;
  tilt?: number;
  stagger?: number;
  trigger?: "hover" | "click";
  showLabels?: boolean;
  grayscale?: boolean;
  /** "cover" (por defecto) recorta la imagen para llenar el panel; "contain" la muestra entera. */
  fit?: "cover" | "contain";
  /** Se llama al cambiar de panel abierto (no con el inicial). */
  onActiveChange?: (index: number) => void;
  /** Click en el panel ya abierto que tiene `link`. `event.preventDefault()` evita la navegación del enlace. */
  onLinkClick?: (event: MouseEvent<HTMLElement>, item: AccordionGalleryItem, index: number) => void;
  ariaLabel?: string;
  className?: string;
}

declare function AccordionGallery(props: AccordionGalleryProps): JSX.Element;
export default AccordionGallery;
