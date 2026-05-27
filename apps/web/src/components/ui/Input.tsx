import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'

// `text-base sm:text-sm` keeps the compact 14px on desktop but forces 16px
// on mobile (≤ 640px) — iOS Safari auto-zooms when focusing an input whose
// effective font-size is < 16px, which is jarring on every form interaction.
const FIELD_BASE =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base sm:text-sm text-gray-900 ' +
  'placeholder:text-gray-400 ' +
  'transition-colors duration-fast ' +
  'hover:border-gray-400 ' +
  'focus:border-smsg-500 focus:outline-none focus:shadow-focus ' +
  'disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 ' +
  'aria-[invalid=true]:border-red-500 aria-[invalid=true]:shadow-[0_0_0_3px_rgba(220,38,38,.15)]'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  invalid?: boolean
  prefix?: ReactNode
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, prefix, suffix, ...rest },
  ref,
) {
  if (prefix || suffix) {
    return (
      <div
        className={cn(
          'flex items-center gap-1 rounded-md border border-gray-300 bg-white pl-2 pr-2 transition-colors duration-fast hover:border-gray-400 focus-within:border-smsg-500 focus-within:shadow-focus',
          invalid && 'border-red-500 focus-within:shadow-[0_0_0_3px_rgba(220,38,38,.15)]',
          className,
        )}
      >
        {prefix && <span className="text-xs text-gray-500">{prefix}</span>}
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-base sm:text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
          {...rest}
        />
        {suffix && <span className="text-xs text-gray-500">{suffix}</span>}
      </div>
    )
  }

  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, className)}
      {...rest}
    />
  )
})

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, 'resize-y leading-relaxed', className)}
      {...rest}
    />
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(FIELD_BASE, 'pr-8 appearance-none bg-[length:14px] bg-no-repeat',
        // chevron via inline SVG
        "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236B7280'><path d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z'/></svg>\")]",
        'bg-[right_0.5rem_center]',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  )
})

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  children: ReactNode
  className?: string
}

/** Label + helper-text + error envelope for any of the field primitives. */
export function Field({ label, hint, error, required, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cn('block', className)}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {!error && hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
