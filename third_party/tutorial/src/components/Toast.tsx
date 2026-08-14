"use client";

import { useEffect, useState } from "react";

interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
const listeners: Set<(toast: Toast) => void> = new Set();

export function showToast(message: string, type: "success" | "error" | "info" = "info") {
  const toast: Toast = { id: `toast-${++toastId}`, message, type };
  listeners.forEach(l => l(toast));
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 3000);
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white animate-toast-in ${
            toast.type === "success" ? "bg-green-600" :
            toast.type === "error" ? "bg-red-600" : "bg-gray-800"
          }`}
        >
          {toast.message}
        </div>
      ))}
      <style jsx>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-toast-in {
          animation: toastIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}