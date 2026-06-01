'use client'

interface Props {
  title: string
  body: string
  confirmLabel: string
  confirmClass?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title, body, confirmLabel,
  confirmClass = 'bg-[#00D9FF] hover:bg-[#009CB8] text-[#0F1419]',
  onConfirm, onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#1E2431] border border-[#2A3142] rounded-lg p-6 max-w-sm w-full mx-4">
        <h3 className="font-semibold text-sm tracking-widest uppercase text-[#FFFFFF] mb-3">{title}</h3>
        <p className="text-[#FFFFFF] text-sm mb-6">{body}</p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 text-sm font-black tracking-widest uppercase rounded transition-colors cursor-pointer ${confirmClass}`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-[#2A3142] hover:bg-[#303848] text-[#FFFFFF] text-sm font-bold tracking-widest uppercase rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
