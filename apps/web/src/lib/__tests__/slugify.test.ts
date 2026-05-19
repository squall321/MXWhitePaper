import { describe, it, expect } from 'vitest'
import { slugify, isValidSlug } from '../slugify'

describe('slugify', () => {
  it('영문 일반 — 공백을 하이픈으로', () => {
    expect(slugify('Monthly Report')).toBe('monthly-report')
  })

  it('대문자 → 소문자', () => {
    expect(slugify('CPU')).toBe('cpu')
  })

  it('underscore → 하이픈', () => {
    expect(slugify('hello_world')).toBe('hello-world')
  })

  it('연속 공백 → 하이픈 1 개', () => {
    expect(slugify('  많은    공백  ')).toBe('많은-공백')
  })

  it('한글 그대로 유지', () => {
    expect(slugify('안드로이드 운영체제')).toBe('안드로이드-운영체제')
  })

  it('특수문자 제거 (괄호 포함)', () => {
    expect(slugify('안드로이드(운영체제)/10')).toBe('안드로이드운영체제10')
  })

  it('슬래시 / 별표 등 모두 제거', () => {
    expect(slugify('AMD/GPU/RX 5000 시리즈')).toBe('amdgpurx-5000-시리즈')
  })

  it('영문+숫자 혼합', () => {
    expect(slugify('iPhone 15 Pro Max')).toBe('iphone-15-pro-max')
  })

  it('빈 입력 → untitled', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('whitespace 만 → untitled', () => {
    expect(slugify('   ')).toBe('untitled')
  })

  it('특수문자만 → untitled', () => {
    expect(slugify('*** ! @ #')).toBe('untitled')
  })

  it('100 자 cap', () => {
    const long = 'a'.repeat(150)
    expect(slugify(long).length).toBe(100)
  })

  it('연속 하이픈 → 1 개로 collapse', () => {
    expect(slugify('a---b')).toBe('a-b')
  })

  it('양 끝 하이픈 제거', () => {
    expect(slugify('-hello-')).toBe('hello')
  })
})

describe('isValidSlug', () => {
  it('정상 slug', () => {
    expect(isValidSlug('monthly-report')).toBe(true)
    expect(isValidSlug('안드로이드')).toBe(true)
    expect(isValidSlug('iphone-15-pro')).toBe(true)
  })

  it('대문자 거부', () => {
    expect(isValidSlug('Monthly')).toBe(false)
  })

  it('공백 거부', () => {
    expect(isValidSlug('hello world')).toBe(false)
  })

  it('빈 문자열 거부', () => {
    expect(isValidSlug('')).toBe(false)
  })

  it('하이픈으로 시작 거부', () => {
    expect(isValidSlug('-hello')).toBe(false)
  })
})
