import { create } from 'zustand'

export interface ToastMessage {
  id: string
  title?: string
  description?: string
  variant?: 'default' | 'destructive'
}

interface ToastState {
  toasts: ToastMessage[]
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${Date.now()}`
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }))

    // Auto remove after 5 seconds
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, 5000)
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))

/**
 * Hook to show toast notifications
 */
export function useToast() {
  const addToast = useToastStore((state) => state.addToast)

  return {
    toast: (options: Omit<ToastMessage, 'id'>) => {
      addToast(options)
    },
    success: (description: string) => {
      addToast({ title: 'Success', description, variant: 'default' })
    },
    error: (description: string) => {
      addToast({ title: 'Error', description, variant: 'destructive' })
    },
  }
}
