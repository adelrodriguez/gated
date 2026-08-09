export function CodeBlock({ children, label }: { children: string; label: string }) {
  return (
    <figure className="code-block">
      <figcaption>{label}</figcaption>
      <pre>
        <code>{children}</code>
      </pre>
    </figure>
  )
}
