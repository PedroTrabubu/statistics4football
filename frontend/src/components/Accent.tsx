/** Titular con las últimas `words` palabras en serif cursiva (el acento del
 * diseño: "Elige una *liga*", "para entender *cada partido*"). Funciona con
 * cualquier idioma sin tocar los textos: parte por el último espacio. */
export function Accent({ text, words = 1 }: { text: string; words?: number }) {
  if (words <= 0) return <>{text}</>;
  const parts = text.trim().split(/\s+/);
  if (parts.length <= words) return <em className="serif-accent">{text}</em>;
  const head = parts.slice(0, -words).join(" ");
  const tail = parts.slice(-words).join(" ");
  return (
    <>
      {head} <em className="serif-accent">{tail}</em>
    </>
  );
}
