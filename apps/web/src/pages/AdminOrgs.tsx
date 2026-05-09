import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/store'
import { useOrgTree } from '@/features/org/hooks/useOrgTree'
import type { OrgDivision, OrgGroup, OrgPart, OrgTeam } from '@/features/org/types'
import {
  createDivision,
  createGroup,
  createPart,
  createTeam,
  deleteDivision,
  deleteGroup,
  deletePart,
  deleteTeam,
  countDocsInPart,
  updateDivision,
  updateGroup,
  updatePart,
  updateTeam,
} from '@/features/org/admin-api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import { useT } from '@/lib/i18n'

type Level = 'division' | 'team' | 'group' | 'part'

interface AddTarget {
  level: Level
  parent: { division?: string; team?: string; group?: string }
  parentLabel: string
}

interface EditTarget {
  level: Level
  slug: string
  name: string
  parent: { division?: string; team?: string; group?: string }
}

interface DeleteTarget {
  level: Level
  slug: string
  name: string
  parent: { division?: string; team?: string; group?: string }
  childCount: number
  docCount?: number
}

export function AdminOrgsPage() {
  const t = useT()
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const { data, isPending, isError, error, refetch } = useOrgTree()
  const qc = useQueryClient()
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['orgs', 'tree'] })
  }, [qc])

  // Non-admins (and ?dev bypass with no user) are bounced to the home page.
  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className="px-6 py-10 text-sm text-gray-500">
        {t('common.loading')}
      </p>
    )
  }
  if (isError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <ErrorState
          title={t('page.adminOrgs.fetchFail')}
          description={error instanceof Error ? error.message : t('page.adminOrgs.fetchFailUnknown')}
          onRetry={() => void refetch()}
        />
      </div>
    )
  }
  const tree = Array.isArray(data) ? data : []

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid="admin-orgs-page">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">{t('page.adminOrgs.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {t('page.adminOrgs.subtitle')}
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() =>
            setAddTarget({
              level: 'division',
              parent: {},
              parentLabel: t('page.adminOrgs.parentTopLevel'),
            })
          }
        >
          {t('page.adminOrgs.addDivision')}
        </Button>
      </header>

      {tree.length === 0 ? (
        <Card>
          <p className="py-10 text-center text-sm text-gray-500">
            {t('page.adminOrgs.empty')}{' '}
            <button
              className="text-smsg-700 underline"
              onClick={() =>
                setAddTarget({
                  level: 'division',
                  parent: {},
                  parentLabel: t('page.adminOrgs.parentTopLevel'),
                })
              }
            >
              {t('page.adminOrgs.addDivision')}
            </button>
          </p>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="admin-orgs-tree">
          {tree.map((d) => (
            <DivisionRow
              key={d.id}
              division={d}
              onAdd={(t) => setAddTarget(t)}
              onEdit={(t) => setEditTarget(t)}
              onDelete={(t) => setDeleteTarget(t)}
            />
          ))}
        </div>
      )}

      {addTarget && (
        <AddNodeModal
          target={addTarget}
          onClose={() => setAddTarget(null)}
          onSuccess={() => {
            setAddTarget(null)
            refresh()
            toast.success(t('page.adminOrgs.added'))
          }}
        />
      )}
      {editTarget && (
        <EditNodeModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => {
            setEditTarget(null)
            refresh()
            toast.success(t('page.adminOrgs.edited'))
          }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => {
            setDeleteTarget(null)
            refresh()
            toast.success(t('page.adminOrgs.deleted'))
          }}
        />
      )}
    </div>
  )
}

// ── Tree rows ──────────────────────────────────────────────────────────
interface RowHandlers {
  onAdd: (t: AddTarget) => void
  onEdit: (t: EditTarget) => void
  onDelete: (t: DeleteTarget) => void
}

function DivisionRow({
  division,
  onAdd,
  onEdit,
  onDelete,
}: { division: OrgDivision } & RowHandlers) {
  const t = useT()
  const teams = Array.isArray(division.teams) ? division.teams : []
  return (
    <Card>
      <NodeRow
        depth={0}
        slug={division.slug}
        name={division.name}
        levelLabel={t('page.adminOrgs.level.division')}
        onEdit={() =>
          onEdit({
            level: 'division',
            slug: division.slug,
            name: division.name,
            parent: {},
          })
        }
        onDelete={() =>
          onDelete({
            level: 'division',
            slug: division.slug,
            name: division.name,
            parent: {},
            childCount: teams.length,
          })
        }
        addButton={
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onAdd({
                level: 'team',
                parent: { division: division.slug },
                parentLabel: division.name,
              })
            }
          >
            {t('page.adminOrgs.addTeam')}
          </Button>
        }
      />
      {teams.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-smsg-100 pl-4">
          {teams.map((t) => (
            <TeamRow
              key={t.id}
              team={t}
              divisionSlug={division.slug}
              divisionName={division.name}
              onAdd={onAdd}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

function TeamRow({
  team,
  divisionSlug,
  divisionName,
  onAdd,
  onEdit,
  onDelete,
}: {
  team: OrgTeam
  divisionSlug: string
  divisionName: string
} & RowHandlers) {
  const t = useT()
  const groups = Array.isArray(team.groups) ? team.groups : []
  return (
    <li>
      <NodeRow
        depth={1}
        slug={team.slug}
        name={team.name}
        levelLabel={t('page.adminOrgs.level.team')}
        onEdit={() =>
          onEdit({
            level: 'team',
            slug: team.slug,
            name: team.name,
            parent: { division: divisionSlug },
          })
        }
        onDelete={() =>
          onDelete({
            level: 'team',
            slug: team.slug,
            name: team.name,
            parent: { division: divisionSlug },
            childCount: groups.length,
          })
        }
        addButton={
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onAdd({
                level: 'group',
                parent: { division: divisionSlug, team: team.slug },
                parentLabel: `${divisionName} / ${team.name}`,
              })
            }
          >
            {t('page.adminOrgs.addGroup')}
          </Button>
        }
      />
      {team.groups.length > 0 && (
        <ul className="mt-1 space-y-1 border-l-2 border-smsg-100 pl-4">
          {team.groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              divisionSlug={divisionSlug}
              teamSlug={team.slug}
              parentLabel={`${divisionName} / ${team.name}`}
              onAdd={onAdd}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function GroupRow({
  group,
  divisionSlug,
  teamSlug,
  parentLabel,
  onAdd,
  onEdit,
  onDelete,
}: {
  group: OrgGroup
  divisionSlug: string
  teamSlug: string
  parentLabel: string
} & RowHandlers) {
  const t = useT()
  return (
    <li>
      <NodeRow
        depth={2}
        slug={group.slug}
        name={group.name}
        levelLabel={t('page.adminOrgs.level.group')}
        onEdit={() =>
          onEdit({
            level: 'group',
            slug: group.slug,
            name: group.name,
            parent: { division: divisionSlug, team: teamSlug },
          })
        }
        onDelete={() =>
          onDelete({
            level: 'group',
            slug: group.slug,
            name: group.name,
            parent: { division: divisionSlug, team: teamSlug },
            childCount: group.parts.length,
          })
        }
        addButton={
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onAdd({
                level: 'part',
                parent: {
                  division: divisionSlug,
                  team: teamSlug,
                  group: group.slug,
                },
                parentLabel: `${parentLabel} / ${group.name}`,
              })
            }
          >
            {t('page.adminOrgs.addPart')}
          </Button>
        }
      />
      {group.parts.length > 0 && (
        <ul className="mt-1 space-y-1 border-l-2 border-smsg-100 pl-4">
          {group.parts.map((p) => (
            <PartRow
              key={p.id}
              part={p}
              divisionSlug={divisionSlug}
              teamSlug={teamSlug}
              groupSlug={group.slug}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function PartRow({
  part,
  divisionSlug,
  teamSlug,
  groupSlug,
  onEdit,
  onDelete,
}: {
  part: OrgPart
  divisionSlug: string
  teamSlug: string
  groupSlug: string
  onEdit: (t: EditTarget) => void
  onDelete: (t: DeleteTarget) => void
}) {
  const t = useT()
  return (
    <li>
      <NodeRow
        depth={3}
        slug={part.slug}
        name={part.name}
        levelLabel={t('page.adminOrgs.level.part')}
        onEdit={() =>
          onEdit({
            level: 'part',
            slug: part.slug,
            name: part.name,
            parent: {
              division: divisionSlug,
              team: teamSlug,
              group: groupSlug,
            },
          })
        }
        onDelete={() =>
          onDelete({
            level: 'part',
            slug: part.slug,
            name: part.name,
            parent: {
              division: divisionSlug,
              team: teamSlug,
              group: groupSlug,
            },
            childCount: 0,
          })
        }
      />
    </li>
  )
}

function NodeRow({
  depth,
  slug,
  name,
  levelLabel,
  onEdit,
  onDelete,
  addButton,
}: {
  depth: number
  slug: string
  name: string
  levelLabel: string
  onEdit: () => void
  onDelete: () => void
  addButton?: ReactNode
}) {
  const t = useT()
  return (
    <div
      className="flex items-center justify-between rounded-md py-1 hover:bg-smsg-50"
      data-testid={`org-node-${slug}`}
      data-depth={depth}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-smsg-100 px-2 py-0.5 text-[10px] font-semibold text-smsg-700">
          {levelLabel}
        </span>
        <span className="font-medium text-smsg-900">{name}</span>
        <span className="text-xs text-gray-500">/{slug}</span>
      </div>
      <div className="flex items-center gap-1">
        {addButton}
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={t('page.adminOrgs.editAria', { name })}>
          {t('page.adminOrgs.editName')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={t('page.adminOrgs.deleteAria', { name })}
          className="text-red-600 hover:bg-red-50"
        >
          {t('page.adminOrgs.deleteIcon')}
        </Button>
      </div>
    </div>
  )
}

// ── Modals ─────────────────────────────────────────────────────────────
function AddNodeModal({
  target,
  onClose,
  onSuccess,
}: {
  target: AddTarget
  onClose: () => void
  onSuccess: () => void
}) {
  const t = useT()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const labelKeys: Record<Level, string> = {
    division: 'page.adminOrgs.level.division',
    team: 'page.adminOrgs.level.team',
    group: 'page.adminOrgs.level.group',
    part: 'page.adminOrgs.level.part',
  }
  const title = t('page.adminOrgs.addTitle', { label: t(labelKeys[target.level]) })

  async function submit() {
    if (!slug || !name) {
      toast.warn(t('page.adminOrgs.requireSlugName'))
      return
    }
    setSubmitting(true)
    try {
      if (target.level === 'division') {
        await createDivision({ slug, name })
      } else if (target.level === 'team') {
        await createTeam({
          division_slug: target.parent.division!,
          slug,
          name,
        })
      } else if (target.level === 'group') {
        await createGroup({
          division_slug: target.parent.division!,
          team_slug: target.parent.team!,
          slug,
          name,
        })
      } else {
        await createPart({
          division_slug: target.parent.division!,
          team_slug: target.parent.team!,
          group_slug: target.parent.group!,
          slug,
          name,
        })
      }
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message ?? t('page.adminOrgs.addFail'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('page.adminOrgs.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={submitting}>
            {t('page.adminOrgs.add')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          {t('page.adminOrgs.parent')}: <span className="font-medium">{target.parentLabel}</span>
        </p>
        <Field label={t('page.adminOrgs.slugLabel')}>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('page.adminOrgs.slugPlaceholder')}
            aria-label={t('page.adminOrgs.slugLabel')}
            autoFocus
          />
        </Field>
        <Field label={t('page.adminOrgs.nameLabel')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('page.adminOrgs.namePlaceholder')}
            aria-label={t('page.adminOrgs.nameLabel')}
          />
        </Field>
      </div>
    </Modal>
  )
}

function EditNodeModal({
  target,
  onClose,
  onSuccess,
}: {
  target: EditTarget
  onClose: () => void
  onSuccess: () => void
}) {
  const t = useT()
  const [name, setName] = useState(target.name)
  const [submitting, setSubmitting] = useState(false)
  const labelKeys: Record<Level, string> = {
    division: 'page.adminOrgs.level.division',
    team: 'page.adminOrgs.level.team',
    group: 'page.adminOrgs.level.group',
    part: 'page.adminOrgs.level.part',
  }

  async function submit() {
    if (!name) {
      toast.warn(t('page.adminOrgs.requireName'))
      return
    }
    setSubmitting(true)
    try {
      if (target.level === 'division') {
        await updateDivision(target.slug, { name })
      } else if (target.level === 'team') {
        await updateTeam(target.parent.division!, target.slug, { name })
      } else if (target.level === 'group') {
        await updateGroup(
          target.parent.division!,
          target.parent.team!,
          target.slug,
          { name },
        )
      } else {
        await updatePart(
          target.parent.division!,
          target.parent.team!,
          target.parent.group!,
          target.slug,
          { name },
        )
      }
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message ?? t('page.adminOrgs.editFail'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('page.adminOrgs.editTitle', { label: t(labelKeys[target.level]) })}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('page.adminOrgs.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={submitting}>
            {t('page.adminOrgs.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-gray-500">slug: {target.slug}</p>
        <Field label={t('page.adminOrgs.nameLabel')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t('page.adminOrgs.nameLabel')}
            autoFocus
          />
        </Field>
      </div>
    </Modal>
  )
}

function DeleteConfirmModal({
  target,
  onClose,
  onSuccess,
}: {
  target: DeleteTarget
  onClose: () => void
  onSuccess: () => void
}) {
  const t = useT()
  const [submitting, setSubmitting] = useState(false)
  const [docCount, setDocCount] = useState<number | null>(null)
  const labelKeys: Record<Level, string> = {
    division: 'page.adminOrgs.level.division',
    team: 'page.adminOrgs.level.team',
    group: 'page.adminOrgs.level.group',
    part: 'page.adminOrgs.level.part',
  }

  // Fetch doc count when deleting a part — show warning.
  useEffect(() => {
    if (target.level === 'part') {
      countDocsInPart(target.slug)
        .then(setDocCount)
        .catch(() => setDocCount(null))
    }
  }, [target.level, target.slug])

  async function submit() {
    setSubmitting(true)
    try {
      if (target.level === 'division') {
        await deleteDivision(target.slug)
      } else if (target.level === 'team') {
        await deleteTeam(target.parent.division!, target.slug)
      } else if (target.level === 'group') {
        await deleteGroup(
          target.parent.division!,
          target.parent.team!,
          target.slug,
        )
      } else {
        await deletePart(
          target.parent.division!,
          target.parent.team!,
          target.parent.group!,
          target.slug,
        )
      }
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { error?: { message?: string } } } }
      toast.error(e.response?.data?.error?.message ?? t('page.adminOrgs.deleteFail'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('page.adminOrgs.deleteTitle', { label: t(labelKeys[target.level]) })}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('page.adminOrgs.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={submitting}>
            {t('page.adminOrgs.delete')}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          {t('page.adminOrgs.confirmDelete', { name: target.name, slug: target.slug })}
        </p>
        {target.childCount > 0 && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            {t('page.adminOrgs.warnChildren', { n: target.childCount })}
          </p>
        )}
        {target.level === 'part' && docCount !== null && docCount > 0 && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">
            {t('page.adminOrgs.warnDocs', { n: docCount })}
          </p>
        )}
      </div>
    </Modal>
  )
}
