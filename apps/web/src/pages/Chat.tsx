// 메인 페이지 — 대화로 백서를 만들고 코퍼스를 검색하는 채팅.
import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { AppOutletContext } from '@/App'
import { ChatView } from '@/features/chat/ChatView'

export function ChatPage() {
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()
  // 채팅은 전폭 — 좌/우 레일을 숨긴다.
  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
    }
  }, [setLeftRail, setRightRail])

  // 전폭 풀높이: main 의 세로 패딩(py-4/py-6)을 음수 마진으로 상쇄하고,
  // grid 상단 오프셋(breadcrumb 용 2rem)만큼 더 빼 정확히 뷰포트를 채운다.
  // 이렇게 해야 하단 고정 입력창이 fold 아래로 밀리지 않는다.
  return (
    <div className="-my-4 sm:-my-6 h-[calc(100vh-var(--header-h)-2rem)]">
      <ChatView />
    </div>
  )
}
