import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Avatar initials: 1st letter of first name + 1st/2nd letters of last name (e.g. "Jan Kowalski" -> "JKO")
export function getInitials(fullName: string | null | undefined) {
  if (!fullName) return 'U'
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  const firstName = parts[0]
  const lastName = parts[parts.length - 1]
  return (firstName.charAt(0) + lastName.slice(0, 2)).toUpperCase()
}
