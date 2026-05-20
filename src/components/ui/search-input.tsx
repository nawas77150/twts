import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
}

export function SearchInput({ value, onChange, placeholder, className, inputClassName }: SearchInputProps) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        placeholder={placeholder ?? 'Cari...'}
        value={value}
        onChange={(e) => { onChange(e.target.value) }}
        className={`text-xs border-[#EFF3F4] ${inputClassName ?? 'pl-8 h-8'}`}
      />
      <Search className="w-3.5 h-3.5 text-[#71767B] absolute left-2.5 top-1/2 -translate-y-1/2" />
      {value && (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71767B] hover:text-[#0F1419]"
          onClick={() => { onChange('') }}
        >
          ×
        </button>
      )}
    </div>
  )
}
