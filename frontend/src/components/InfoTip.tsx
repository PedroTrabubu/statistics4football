import { type ReactNode, useId, useRef, useState } from "react";

/** Una "i" con una nota emergente, con el aspecto de la de la fuerza de los
 * picks. Con raton se abre al pasar por encima; en tactil y con teclado, al
 * pulsarla; Escape o salir del boton la cierran. */
export function InfoTip({
  label,
  children,
  popoverClassName,
}: {
  label: string;
  children: ReactNode;
  /** Clase extra de la nota (ej. una nota más ancha con su propio diseño). */
  popoverClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const hovering = useRef(false);
  const id = useId();

  return (
    <span
      className="pick-info info-tip"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = true;
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        hovering.current = false;
        setOpen(false);
      }}
    >
      <button
        type="button"
        className="pick-info-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => hovering.current || !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && (
        <span className={popoverClassName ? `pick-info-popover ${popoverClassName}` : "pick-info-popover"} id={id} role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}
