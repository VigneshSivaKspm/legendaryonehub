import React from 'react';
import { Trash2 } from 'lucide-react';

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  title?: string;
  itemName?: string;
  description?: React.ReactNode;
  isDeleting?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function DeleteConfirmationModal({
  isOpen,
  title = 'Delete Item',
  itemName,
  description,
  isDeleting = false,
  confirmText = 'Delete Permanently',
  cancelText = 'Cancel',
  onConfirm,
  onClose,
}: DeleteConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="modal-box"
        style={{
          width: '100%',
          maxWidth: 440,
          padding: 28,
          background: '#FFFFFF',
          borderRadius: 16,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          {/* Circular soft red/pink background with vector Trash2 icon */}
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: '#FEE2E2',
              color: '#DC2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
            }}
          >
            <Trash2 size={28} strokeWidth={2.2} />
          </div>

          <div
            style={{
              fontFamily: 'Plus Jakarta Sans',
              fontWeight: 800,
              fontSize: 18,
              color: '#1E293B',
              marginBottom: 6,
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontSize: 13.5,
              color: '#64748B',
              lineHeight: 1.5,
            }}
          >
            {description || (
              <>
                Are you sure you want to delete {itemName ? <strong>"{itemName}"</strong> : 'this item'}? This action cannot be undone.
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ flex: 1, justifyContent: 'center' }}
            disabled={isDeleting}
            onClick={onClose}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1, justifyContent: 'center', background: '#DC2626', border: 'none' }}
            disabled={isDeleting}
            onClick={onConfirm}
          >
            {isDeleting ? 'Deleting...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
