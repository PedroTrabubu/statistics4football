/** Con ratón, una fila deslizable también se arrastra: pulsar y mover. Si se
 * ha arrastrado, el clic de después no abre el enlace que había debajo.
 * Mientras dura, `marker` lleva `data-dragging` (para el cursor, sin
 * seleccionar texto ni encajar las tarjetas). Devuelve la función que lo quita. */
export function dragToScroll(scroller: HTMLElement, marker: HTMLElement = scroller): () => void {
  let drag: { x: number; left: number; moved: boolean } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    if (scroller.scrollWidth - scroller.clientWidth <= 1) return;
    drag = { x: event.clientX, left: scroller.scrollLeft, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      scroller.setPointerCapture?.(event.pointerId);
      marker.dataset.dragging = "";
    }
    scroller.scrollLeft = drag.left - dx;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (drag?.moved && scroller.hasPointerCapture?.(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    delete marker.dataset.dragging;
    // El clic llega justo después: se deja la marca hasta entonces.
    if (drag?.moved) setTimeout(() => (drag = null));
    else drag = null;
  };
  const onClick = (event: MouseEvent) => {
    if (!drag?.moved) return;
    event.preventDefault();
    event.stopPropagation();
    drag = null;
  };
  scroller.addEventListener("pointerdown", onPointerDown);
  scroller.addEventListener("pointermove", onPointerMove);
  scroller.addEventListener("pointerup", onPointerUp);
  scroller.addEventListener("pointercancel", onPointerUp);
  scroller.addEventListener("click", onClick, true);
  return () => {
    scroller.removeEventListener("pointerdown", onPointerDown);
    scroller.removeEventListener("pointermove", onPointerMove);
    scroller.removeEventListener("pointerup", onPointerUp);
    scroller.removeEventListener("pointercancel", onPointerUp);
    scroller.removeEventListener("click", onClick, true);
  };
}
