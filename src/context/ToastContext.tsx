import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Render Toast Notifications */}
      <div
        className="toast-stack"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((toast) => {
          const bg =
            toast.type === 'success'
              ? '#10B981'
              : toast.type === 'error'
              ? '#EF4444'
              : '#3B5BDB';

          const icon = toast.type === 'success' ? '✓' : toast.type === 'error' ? '⚠️' : 'ℹ️';

          return (
            <div
              key={toast.id}
              style={{
                pointerEvents: 'auto',
                background: bg,
                color: '#ffffff',
                padding: '12px 18px',
                borderRadius: 10,
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: 'Plus Jakarta Sans, sans-serif',
                minWidth: 260,
                maxWidth: 400,
                animation: 'slideInRight 0.25s ease-out forwards',
              }}
            >
              <span style={{ fontSize: 16 }}>{icon}</span>
              <span style={{ flex: 1, lineHeight: 1.3 }}>{toast.message}</span>
              <button
                onClick={() => removeToast(toast.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ffffff',
                  opacity: 0.8,
                  cursor: 'pointer',
                  fontSize: 16,
                  padding: 0,
                  marginLeft: 8,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
