export function ShowcaseIntro({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <header className="showcase-intro">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="title">{title}</h1>
    </header>
  )
}
