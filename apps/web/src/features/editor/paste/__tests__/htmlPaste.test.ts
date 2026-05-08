import { describe, it, expect } from 'vitest'
import { htmlToBlocks } from '../htmlPaste'
import type {
  CodeBlock,
  Heading4Block,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  QuoteBlock,
  TableBlock,
} from '@/types/document'

/**
 * Coverage matrix — 26 inputs spanning Word / Notion / web typical pastes.
 *
 *  1. plain `<p>`
 *  2. `<h1>`/`<h2>` → level 2
 *  3. `<h3>` → level 3
 *  4. `<h4>` / `<h5>` / `<h6>` → level 4
 *  5. inline `<strong>`/`<b>`
 *  6. inline `<em>`/`<i>`
 *  7. inline `<s>`/`<del>`
 *  8. inline `<code>`
 *  9. inline `<a>` — external
 * 10. inline `<a>` — wiki-slug shape
 * 11. `<ul>` simple
 * 12. `<ol>` simple
 * 13. nested `<ul>` → indent prefix
 * 14. `<table>` with `<thead>` + `<tbody>`
 * 15. `<table>` with implicit header (first row of <th>)
 * 16. `<table>` no thead, no <th>
 * 17. `<blockquote>`
 * 18. `<pre><code class="language-ts">`
 * 19. `<pre>` with no code child
 * 20. standalone `<img>`
 * 21. `<figure><img><figcaption>`
 * 22. `<p><img></p>` (Notion)
 * 23. `<form>` / `<button>` / `<script>` dropped
 * 24. `<svg>` dropped with warning
 * 25. unknown tag (`<custom-element>`) recurses
 * 26. Word's MS gunk (`<o:p>`, conditional comments)
 */

describe('htmlToBlocks — basics', () => {
  it('plain paragraph', () => {
    const r = htmlToBlocks('<p>Hello world</p>')
    expect(r.blocks.length).toBe(1)
    const p = r.blocks[0] as ParagraphBlock
    expect(p.type).toBe('paragraph')
    expect(p.text).toBe('Hello world')
    expect(p.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('h1/h2 → heading-4 with level 2', () => {
    const r = htmlToBlocks('<h1>Title</h1><h2>Sub</h2>')
    expect(r.blocks.length).toBe(2)
    const h1 = r.blocks[0] as Heading4Block
    const h2 = r.blocks[1] as Heading4Block
    expect(h1.type).toBe('heading-4')
    expect(h1.title).toBe('Title')
    expect(h1.meta?.level).toBe(2)
    expect(h2.meta?.level).toBe(2)
  })

  it('h3 → level 3', () => {
    const r = htmlToBlocks('<h3>Three</h3>')
    expect((r.blocks[0] as Heading4Block).meta?.level).toBe(3)
  })

  it('h4/h5/h6 → level 4', () => {
    const r = htmlToBlocks('<h4>F</h4><h5>F</h5><h6>S</h6>')
    expect(r.blocks.length).toBe(3)
    for (const b of r.blocks) {
      expect((b as Heading4Block).meta?.level).toBe(4)
    }
  })
})

describe('htmlToBlocks — inline markdown-lite', () => {
  it('bold via <strong>/<b>', () => {
    const r = htmlToBlocks('<p>a <strong>bold</strong> b</p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('a **bold** b')
  })

  it('italic via <em>/<i>', () => {
    const r = htmlToBlocks('<p><em>tilt</em></p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('*tilt*')
  })

  it('strikethrough via <s>/<del>', () => {
    const r = htmlToBlocks('<p><del>old</del></p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('~~old~~')
  })

  it('inline code', () => {
    const r = htmlToBlocks('<p>see <code>fn()</code></p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('see `fn()`')
  })

  it('external link → [label](url)', () => {
    const r = htmlToBlocks('<p>see <a href="https://example.com">site</a></p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe(
      'see [site](https://example.com)',
    )
  })

  it('wiki-slug link → [[slug]]', () => {
    const r = htmlToBlocks('<p>see <a href="my-doc">Mine</a></p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('see [[my-doc]]')
  })

  it('escapes md-lite metacharacters in raw text', () => {
    const r = htmlToBlocks('<p>a*b ~c~ `d`</p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('a\\*b \\~c\\~ \\`d\\`')
  })
})

describe('htmlToBlocks — lists', () => {
  it('simple <ul>', () => {
    const r = htmlToBlocks('<ul><li>a</li><li>b</li></ul>')
    const lst = r.blocks[0] as ListBlock
    expect(lst.type).toBe('list')
    expect(lst.style).toBe('bullet')
    expect(lst.items).toEqual(['a', 'b'])
  })

  it('simple <ol>', () => {
    const r = htmlToBlocks('<ol><li>a</li><li>b</li></ol>')
    const lst = r.blocks[0] as ListBlock
    expect(lst.style).toBe('number')
    expect(lst.items).toEqual(['a', 'b'])
  })

  it('nested <ul> → 2-space indent prefix', () => {
    const html = '<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>'
    const r = htmlToBlocks(html)
    const lst = r.blocks[0] as ListBlock
    expect(lst.items).toEqual(['a', '  a1', '  a2', 'b'])
  })
})

describe('htmlToBlocks — tables', () => {
  it('explicit thead + tbody', () => {
    const html =
      '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
    const r = htmlToBlocks(html)
    const t = r.blocks[0] as TableBlock
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('implicit header (first row of <th>)', () => {
    const html =
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    const r = htmlToBlocks(html)
    const t = r.blocks[0] as TableBlock
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('no header — promotes first row', () => {
    const html = '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>'
    const r = htmlToBlocks(html)
    const t = r.blocks[0] as TableBlock
    expect(t.headers).toEqual(['A', 'B'])
    expect(t.rows).toEqual([['1', '2']])
  })

  it('preserves inline markup inside cells', () => {
    const html =
      '<table><tr><th>X</th></tr><tr><td><strong>hi</strong></td></tr></table>'
    const r = htmlToBlocks(html)
    expect((r.blocks[0] as TableBlock).rows[0]).toEqual(['**hi**'])
  })
})

describe('htmlToBlocks — quote / code / image', () => {
  it('blockquote', () => {
    const r = htmlToBlocks('<blockquote>truth</blockquote>')
    const q = r.blocks[0] as QuoteBlock
    expect(q.type).toBe('quote')
    expect(q.text).toBe('truth')
  })

  it('pre+code with language hint', () => {
    const r = htmlToBlocks('<pre><code class="language-ts">const x = 1</code></pre>')
    const c = r.blocks[0] as CodeBlock
    expect(c.type).toBe('code')
    expect(c.language).toBe('ts')
    expect(c.code).toBe('const x = 1')
  })

  it('pre with no code child → text language', () => {
    const r = htmlToBlocks('<pre>raw\nblock</pre>')
    const c = r.blocks[0] as CodeBlock
    expect(c.language).toBe('text')
    expect(c.code).toBe('raw\nblock')
  })

  it('standalone img → image block with src in meta.note', () => {
    const r = htmlToBlocks('<img src="https://x/y.png" alt="cat">')
    const i = r.blocks[0] as ImageBlock
    expect(i.type).toBe('image')
    expect(i.imageId).toBe('')
    expect(i.alt).toBe('cat')
    expect(i.caption).toBe('cat')
    expect(i.meta?.note).toBe('src:https://x/y.png')
  })

  it('figure → image with caption', () => {
    const r = htmlToBlocks(
      '<figure><img src="https://x/y.png" alt="alt"><figcaption>cap</figcaption></figure>',
    )
    const i = r.blocks[0] as ImageBlock
    expect(i.type).toBe('image')
    expect(i.caption).toBe('cap')
  })

  it('p>img only → just image block', () => {
    const r = htmlToBlocks('<p><img src="https://x/y.png"></p>')
    expect(r.blocks.length).toBe(1)
    expect(r.blocks[0]!.type).toBe('image')
  })
})

describe('htmlToBlocks — drop / fallback', () => {
  it('drops form/button/script', () => {
    const html =
      '<p>before</p><form><button>x</button></form><script>alert(1)</script><p>after</p>'
    const r = htmlToBlocks(html)
    expect(r.blocks.length).toBe(2)
    expect((r.blocks[0] as ParagraphBlock).text).toBe('before')
    expect((r.blocks[1] as ParagraphBlock).text).toBe('after')
  })

  it('drops svg with warning', () => {
    const r = htmlToBlocks('<p>a</p><svg><circle/></svg><p>b</p>')
    expect(r.warnings).toContain('svg dropped')
    expect(r.blocks.length).toBe(2)
  })

  it('recurses into unknown tags', () => {
    const r = htmlToBlocks('<custom><p>inside</p></custom>')
    expect(r.blocks.length).toBe(1)
    expect((r.blocks[0] as ParagraphBlock).text).toBe('inside')
  })

  it('strips Word MS-Office gunk', () => {
    const html =
      '<!--StartFragment--><o:p><p>real</p></o:p><!--EndFragment-->'
    const r = htmlToBlocks(html)
    expect(r.blocks.length).toBe(1)
    expect((r.blocks[0] as ParagraphBlock).text).toBe('real')
  })

  it('decodes named + numeric entities', () => {
    const r = htmlToBlocks('<p>a &amp; b &#65; &#x42;</p>')
    expect((r.blocks[0] as ParagraphBlock).text).toBe('a & b A B')
  })

  it('handles malformed close tags gracefully', () => {
    const r = htmlToBlocks('<p>open<br></p>')
    expect(r.blocks.length).toBe(1)
    expect((r.blocks[0] as ParagraphBlock).text).toBe('open\n')
  })
})
