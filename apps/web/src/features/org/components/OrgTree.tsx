import { useState, useCallback } from 'react'
import { useOrgTree } from '../hooks/useOrgTree'
import type { OrgDivision, OrgTeam, OrgGroup, OrgPart } from '../types'

/**
 * Left-column expandable org tree: Division → Team → Group → Part.
 * Documents under each part will be added in a later sprint.
 *
 * Folding state lives in component-local Sets keyed by id.
 */
export function OrgTree() {
  const { data, isPending, isError, error } = useOrgTree()
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  if (isPending) {
    return <p className="px-3 py-2 text-sm text-gray-500">Loading…</p>
  }
  if (isError) {
    return (
      <p className="px-3 py-2 text-sm text-red-600">
        Failed to load org tree: {(error as Error).message}
      </p>
    )
  }
  if (!data || data.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-gray-500">
        No organisations yet.
      </p>
    )
  }

  return (
    <ul className="text-sm" role="tree">
      {data.map((division) => (
        <DivisionNode
          key={division.id}
          node={division}
          open={open}
          onToggle={toggle}
        />
      ))}
    </ul>
  )
}

interface NodeBaseProps {
  open: Set<string>
  onToggle: (id: string) => void
}

function DivisionNode({ node, open, onToggle }: { node: OrgDivision } & NodeBaseProps) {
  const isOpen = open.has(node.id)
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <RowButton
        depth={0}
        isOpen={isOpen}
        hasChildren={node.teams.length > 0}
        onClick={() => onToggle(node.id)}
        label={node.name}
      />
      {isOpen && node.teams.length > 0 && (
        <ul role="group">
          {node.teams.map((team) => (
            <TeamNode key={team.id} node={team} open={open} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  )
}

function TeamNode({ node, open, onToggle }: { node: OrgTeam } & NodeBaseProps) {
  const isOpen = open.has(node.id)
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <RowButton
        depth={1}
        isOpen={isOpen}
        hasChildren={node.groups.length > 0}
        onClick={() => onToggle(node.id)}
        label={node.name}
      />
      {isOpen && node.groups.length > 0 && (
        <ul role="group">
          {node.groups.map((group) => (
            <GroupNode key={group.id} node={group} open={open} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  )
}

function GroupNode({ node, open, onToggle }: { node: OrgGroup } & NodeBaseProps) {
  const isOpen = open.has(node.id)
  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <RowButton
        depth={2}
        isOpen={isOpen}
        hasChildren={node.parts.length > 0}
        onClick={() => onToggle(node.id)}
        label={node.name}
      />
      {isOpen && node.parts.length > 0 && (
        <ul role="group">
          {node.parts.map((part) => (
            <PartNode key={part.id} node={part} />
          ))}
        </ul>
      )}
    </li>
  )
}

function PartNode({ node }: { node: OrgPart }) {
  // Documents-under-part list is a Sprint 2+ task.
  return (
    <li role="treeitem">
      <div
        className="flex items-center gap-1 rounded px-2 py-1 text-smsg-900 hover:bg-smsg-100"
        style={{ paddingLeft: indentFor(3) }}
      >
        <span className="text-gray-400">·</span>
        <span>{node.name}</span>
      </div>
    </li>
  )
}

function RowButton({
  depth,
  isOpen,
  hasChildren,
  onClick,
  label,
}: {
  depth: number
  isOpen: boolean
  hasChildren: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-smsg-900 hover:bg-smsg-100"
      style={{ paddingLeft: indentFor(depth) }}
    >
      <span className="inline-block w-4 text-gray-500">
        {hasChildren ? (isOpen ? '▾' : '▸') : ''}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function indentFor(depth: number): string {
  return `${0.5 + depth * 0.75}rem`
}
