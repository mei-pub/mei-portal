import { create } from 'zustand'
import type { PayloadMessage } from '@/types'

interface PayloadState {
  // Messages for API request (OpenAI compatible format)
  messages: PayloadMessage[]

  // Actions
  setMessages: (messages: PayloadMessage[]) => void
  addMessage: (message: PayloadMessage) => void
  clearMessages: () => void
  getPayload: () => { messages: PayloadMessage[] }
}

export const usePayloadStore = create<PayloadState>((set, get) => ({
  messages: [],

  setMessages: (messages) => set({ messages }),

  addMessage: (message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }))
  },

  clearMessages: () => set({ messages: [] }),

  getPayload: () => ({
    messages: get().messages,
  }),
}))
