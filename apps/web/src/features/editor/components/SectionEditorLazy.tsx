import { Suspense, lazy, type ComponentProps } from 'react'

/**
 * Lazy proxy around `SectionEditor`. The underlying chunk pulls in BlockNote
 * (~600 KB+) and Mantine's UI shell, which the read-mode visit doesn't need.
 *
 * Splitting at this boundary lets reader-only loads of `<DocumentReader />`
 * skip the editor surface bundle entirely. Vite emits a separate chunk for
 * `SectionEditor.tsx` and its `@blocknote/*` + `@mantine` deps.
 */
const SectionEditorImpl = lazy(() =>
  import('./SectionEditor').then((m) => ({ default: m.SectionEditor })),
)

type SectionEditorProps = ComponentProps<typeof SectionEditorImpl>

export function SectionEditor(props: SectionEditorProps) {
  return (
    <Suspense
      fallback={
        <div
          data-section-editor-loading
          className="rounded border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-500"
        >
          에디터 로딩 중…
        </div>
      }
    >
      <SectionEditorImpl {...props} />
    </Suspense>
  )
}
