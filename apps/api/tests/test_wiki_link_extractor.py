"""wiki_link_extractor 단위 테스트.

Grammar:  [[slug]] | [[slug|display]] | [[slug#1.1.1]] | [[slug#1.1.1|display]]
"""
from __future__ import annotations

from app.services.wiki_link_extractor import extract_wiki_links


def _doc(sections: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "id": "01J9X1Y2Z3A4B5C6D7E8F9G0H1",
        "slug": "host",
        "title": "host",
        "summary": None,
        "metadata": {"division": "MX", "owners": ["x"], "confidentiality": "internal"},
        "sections": sections,
    }


def _section(level: int, title: str, blocks: list[dict] | None = None,
             subsections: list[dict] | None = None) -> dict:
    return {
        "id": "01J9X1Y2Z3A4B5C6D7E8F9G0S1",
        "level": level,
        "title": title,
        "blocks": blocks or [],
        "subsections": subsections or [],
    }


def _para(text: str) -> dict:
    return {"type": "paragraph", "id": "01J9X1Y2Z3A4B5C6D7E8F9G0B1", "text": text}


def test_plain_link() -> None:
    doc = _doc([_section(1, "t", [_para("see [[other-doc]] for details")])])
    links = extract_wiki_links(doc)
    assert len(links) == 1
    assert links[0]["target_slug"] == "other-doc"
    assert links[0]["anchor"] is None
    assert links[0]["display"] is None


def test_link_with_display() -> None:
    doc = _doc([_section(1, "t", [_para("read [[foo|이 문서]] please")])])
    links = extract_wiki_links(doc)
    assert len(links) == 1
    assert links[0]["target_slug"] == "foo"
    assert links[0]["display"] == "이 문서"


def test_link_with_anchor() -> None:
    doc = _doc([_section(1, "t", [_para("see [[foo#1.1.1]]")])])
    links = extract_wiki_links(doc)
    assert len(links) == 1
    assert links[0]["anchor"] == "1.1.1"
    assert links[0]["display"] is None


def test_link_with_anchor_and_display() -> None:
    doc = _doc([_section(1, "t", [_para("see [[foo#2.3|섹션 2.3]]")])])
    links = extract_wiki_links(doc)
    assert len(links) == 1
    assert links[0]["target_slug"] == "foo"
    assert links[0]["anchor"] == "2.3"
    assert links[0]["display"] == "섹션 2.3"


def test_link_inside_list_and_table_cell() -> None:
    list_block = {
        "type": "list",
        "id": "01J9X1Y2Z3A4B5C6D7E8F9G0B2",
        "style": "bullet",
        "items": ["참고 [[doc-a]]", "그리고 [[doc-b#1]]"],
    }
    table_block = {
        "type": "table",
        "id": "01J9X1Y2Z3A4B5C6D7E8F9G0B3",
        "headers": ["see [[doc-c]]"],
        "rows": [["row [[doc-d|d]]"]],
    }
    doc = _doc([_section(1, "t", [list_block, table_block])])
    links = extract_wiki_links(doc)
    slugs = sorted(l["target_slug"] for l in links)
    assert slugs == ["doc-a", "doc-b", "doc-c", "doc-d"]


def test_link_inside_section_title_picked_up() -> None:
    doc = _doc([
        _section(1, "참고 [[ref-doc#1.1]] 자료", [
            _para("body text only")
        ])
    ])
    links = extract_wiki_links(doc)
    assert len(links) == 1
    assert links[0]["target_slug"] == "ref-doc"
    assert links[0]["anchor"] == "1.1"
    assert "section" in links[0]["source_path"]
    assert "title" in links[0]["source_path"]


def test_no_false_positives_spaces_and_uppercase() -> None:
    """`[ [foo] ]` (공백 있음) 와 `[[Foo]]` (대문자) 는 매칭 안 됨."""
    doc = _doc([_section(1, "t", [_para(
        "공백 [ [foo] ] 와 대문자 [[Foo]] 는 무시. 정상 [[bar]] 만 매칭."
    )])])
    links = extract_wiki_links(doc)
    assert len(links) == 1
    assert links[0]["target_slug"] == "bar"


def test_anchor_with_more_than_three_segments_rejected() -> None:
    """1.1.1.1 은 anchor 정규식에서 제외돼 매칭 자체가 일어나지 않음."""
    doc = _doc([_section(1, "t", [_para("bad [[foo#1.1.1.1]] noise")])])
    links = extract_wiki_links(doc)
    # 정규식이 #1.1.1 까지 잡고 ]] 가 안 닫혀 전체 매칭 실패해야 함.
    assert links == []


def test_hangul_slug_supported() -> None:
    """Polish D — slug 가 한글이어도 매칭되어야 한다."""
    doc = _doc([_section(1, "t", [_para("참고: [[분기결산]] 와 [[월결산#1.1|월결산]]")])])
    links = extract_wiki_links(doc)
    slugs = sorted(l["target_slug"] for l in links)
    assert slugs == ["분기결산", "월결산"]
    moncl = next(l for l in links if l["target_slug"] == "월결산")
    assert moncl["anchor"] == "1.1"
    assert moncl["display"] == "월결산"
