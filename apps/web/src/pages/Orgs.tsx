import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { OrgTree } from '@/features/org/components/OrgTree'
import { Card } from '@/components/ui'
import type { AppOutletContext } from '@/App'

/**
 * Optional org browser. The page itself shows the tree as the main content,
 * so the AppShell sidebars are cleared on mount.
 */
export function OrgsPage() {
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()
  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])
  return (
    <section className="space-y-6">
      <header className="rounded-xl bg-gradient-to-br from-smsg-700 to-smsg-500 px-6 py-8 text-white shadow-md sm:px-8 sm:py-10">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">조직 트리</h1>
        <p className="mt-2 text-sm text-white/85">
          Division → Team → Group → Part 계층입니다. 각 노드를 펼쳐 백서 디렉토리를 탐색하세요.
        </p>
      </header>
      <Card padded="md">
        <OrgTree />
      </Card>
    </section>
  )
}
