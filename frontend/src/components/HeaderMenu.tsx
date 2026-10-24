import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { IconTick } from "./icons";

export interface HeaderMenuOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Idioma del texto de la opcion, si no es el de la pagina. */
  lang?: string;
}

/** Selector de la barra superior (tema, idioma): un boton con la opcion
 * elegida que abre un menu. Teclado: flechas, Inicio/Fin, Enter y Escape; al
 * pulsar fuera, se cierra. */
export function HeaderMenu<T extends string>({
  className,
  options,
  value,
  onChange,
  buttonLabel,
  buttonContent,
  menuLabel,
}: {
  className: string;
  options: HeaderMenuOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** aria-label y title del boton. */
  buttonLabel: string;
  buttonContent: ReactNode;
  menuLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  // Al abrir, el foco va a la opción elegida (elegir otra cierra el menú, así
  // que currentIndex no cambia con él abierto).
  useEffect(() => {
    if (!open) return;
    itemRefs.current[currentIndex]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, currentIndex]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const choose = (next: T) => {
    onChange(next);
    close();
  };

  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const items = itemRefs.current;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(items.length - 1);
    else if (event.key === "Escape") close();
    else if (event.key === "Tab") setOpen(false);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  };

  return (
    <div className={className} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="theme-switch-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={buttonLabel}
        title={buttonLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
      >
        {buttonContent}
      </button>
      {open && (
        <div id={menuId} className="theme-menu" role="menu" aria-label={menuLabel} onKeyDown={onMenuKeyDown}>
          {options.map((option, i) => {
            const checked = option.value === value;
            return (
              <button
                key={option.value}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                className="theme-menu-item"
                onClick={() => choose(option.value)}
              >
                {option.icon}
                <span lang={option.lang}>{option.label}</span>
                {checked && <IconTick className="theme-menu-tick" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
