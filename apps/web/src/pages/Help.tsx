// 보조 페이지 — MX White Paper 사용 설명.
import { Link } from 'react-router-dom'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-smsg-gray-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-smsg-gray-700">{children}</div>
    </section>
  )
}

export function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-smsg-gray-900">사용 설명</h1>
      <p className="mt-2 text-sm text-smsg-gray-500">
        MX White Paper 는 백서를 대화로 만들고 위키처럼 탐색하는 지식 저장소입니다.
      </p>

      <Section title="채팅으로 백서 만들기 (메인)">
        <p>
          첫 화면(<Link to="/" className="text-smsg-blue-700 underline">채팅</Link>)에서 대화로 백서를
          작성하고 기존 백서를 검색합니다. 예를 들어 "배터리 안전 시험 절차를 정리해서 새 백서로
          만들어줘" 라고 하면 AI 가 내용을 문서로 저장하고 링크를 돌려줍니다.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>새 문서 생성 · 기존 문서에 섹션 추가 · 코퍼스 검색을 대화 중에 자동으로 수행합니다.</li>
          <li>산문·설명은 한국어로, 키워드·변수명·수식 등 원문 표기는 그대로 보존합니다.</li>
          <li>도구 실행 결과(생성된 문서·검색 결과)는 카드로 표시되고 클릭하면 해당 문서로 이동합니다.</li>
        </ul>
      </Section>

      <Section title="위키 탐색 · 검색">
        <p>
          <Link to="/home" className="text-smsg-blue-700 underline">위키 홈</Link> 에서 최근 문서와
          분류를 둘러볼 수 있습니다. 어디서든 <kbd className="rounded border px-1">⌘K</kbd>(또는
          Ctrl+K)로 빠른 검색·이동, <kbd className="rounded border px-1">⌘P</kbd> 로 문서 빠른 전환을
          엽니다.
        </p>
      </Section>

      <Section title="직접 문서 만들기 · 가져오기">
        <p>
          <Link to="/docs/new" className="text-smsg-blue-700 underline">새 문서</Link> 로 에디터에서 직접
          작성하거나, <Link to="/docs/import" className="text-smsg-blue-700 underline">가져오기</Link> 로
          Word/PowerPoint/CSV 파일을 백서로 변환할 수 있습니다.
        </p>
      </Section>

      <Section title="AI(LLM) 연결">
        <p>
          채팅의 AI 는 vLLM 등 OpenAI 호환 엔드포인트에 연결됩니다. 서버 환경변수
          <code className="mx-1 rounded bg-smsg-gray-050 px-1">LLM_BACKEND=openai</code>,
          <code className="mx-1 rounded bg-smsg-gray-050 px-1">LLM_BASE_URL</code>,
          <code className="mx-1 rounded bg-smsg-gray-050 px-1">LLM_MODEL</code> 로 주소만 잡으면 됩니다.
          미설정이면 mock 모드로 동작해 도구 흐름을 그대로 시연합니다.
        </p>
      </Section>
    </div>
  )
}
