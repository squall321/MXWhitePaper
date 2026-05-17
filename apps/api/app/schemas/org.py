"""조직 트리(division/team/group/part) 요청·응답 모델."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


_SLUG = r"^[a-z0-9][a-z0-9-]{0,99}$"


# ── Division ────────────────────────────────────────────────────────────
class DivisionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(..., pattern=_SLUG)
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None


class DivisionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None


class DivisionRead(BaseModel):
    id: str
    slug: str
    name: str
    description: str | None = None


# ── Team ────────────────────────────────────────────────────────────────
class TeamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    division_slug: str = Field(..., pattern=_SLUG)
    slug: str = Field(..., pattern=_SLUG)
    name: str = Field(..., min_length=1, max_length=200)


class TeamUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)


class TeamRead(BaseModel):
    id: str
    division_id: str
    slug: str
    name: str


# ── Group ───────────────────────────────────────────────────────────────
class GroupCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    team_slug: str = Field(..., pattern=_SLUG)
    division_slug: str = Field(..., pattern=_SLUG)
    slug: str = Field(..., pattern=_SLUG)
    name: str = Field(..., min_length=1, max_length=200)
    # 'lab' is a team-direct unit that lives in the same `groups` table.
    kind: str = Field(default="group", pattern="^(group|lab)$")


class GroupUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    kind: str | None = Field(None, pattern="^(group|lab)$")


class GroupRead(BaseModel):
    id: str
    team_id: str
    slug: str
    name: str
    kind: str = "group"


# ── Part ────────────────────────────────────────────────────────────────
class PartCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group_slug: str = Field(..., pattern=_SLUG)
    team_slug: str = Field(..., pattern=_SLUG)
    division_slug: str = Field(..., pattern=_SLUG)
    slug: str = Field(..., pattern=_SLUG)
    name: str = Field(..., min_length=1, max_length=200)


class PartUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(None, min_length=1, max_length=200)
    # Optional move: if these are provided the part is re-parented under the
    # specified group. All three must be supplied together.
    target_division_slug: str | None = Field(None, pattern=_SLUG)
    target_team_slug: str | None = Field(None, pattern=_SLUG)
    target_group_slug: str | None = Field(None, pattern=_SLUG)
    # Optional rename of the part's slug within the (new) parent group.
    target_slug: str | None = Field(None, pattern=_SLUG)


class PartRead(BaseModel):
    id: str
    group_id: str
    slug: str
    name: str


# ── Tree (좌측 네비게이션) ─────────────────────────────────────────────
class PartNode(BaseModel):
    id: str
    slug: str
    name: str


class GroupNode(BaseModel):
    id: str
    slug: str
    name: str
    parts: list[PartNode] = Field(default_factory=list)


class TeamNode(BaseModel):
    id: str
    slug: str
    name: str
    groups: list[GroupNode] = Field(default_factory=list)


class DivisionNode(BaseModel):
    id: str
    slug: str
    name: str
    teams: list[TeamNode] = Field(default_factory=list)


class OrgTree(BaseModel):
    divisions: list[DivisionNode] = Field(default_factory=list)
