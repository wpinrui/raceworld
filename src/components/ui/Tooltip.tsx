'use client'

import * as RadixTooltip from '@radix-ui/react-tooltip'

// Styled tooltip wrapper around Radix. Use for any hover hint — never the
// native `title` attribute (OS tooltips look out of place in a game UI).
export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 150,
}: {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  delay?: number
}) {
  return (
    <RadixTooltip.Provider delayDuration={delay}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-lg bg-[#2A3142] border border-[#303848] px-2.5 py-1.5 text-xs text-[#FFFFFF] shadow-lg shadow-black/40 select-none"
          >
            {content}
            <RadixTooltip.Arrow className="fill-[#2A3142]" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
