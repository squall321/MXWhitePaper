/**
 * Org tree types for the left-column tree navigation.
 *
 * Backend contract (Sprint 1, Backend Agent): GET /api/v1/orgs/tree
 * returns a Division[] tree where each level carries id/name/slug and
 * its child collection. The Document leaves are not embedded in the
 * tree response; the FE will lazy-load documents per part later.
 *
 * Until BE lands, the typed stub in `./api.ts` returns an empty array.
 */

export interface OrgPart {
  id: string
  slug: string
  name: string
}

export interface OrgGroup {
  id: string
  slug: string
  name: string
  parts: OrgPart[]
}

export interface OrgTeam {
  id: string
  slug: string
  name: string
  groups: OrgGroup[]
}

export interface OrgDivision {
  id: string
  slug: string
  name: string
  teams: OrgTeam[]
}

export type OrgTree = OrgDivision[]
