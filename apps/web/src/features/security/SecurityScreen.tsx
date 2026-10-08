import type { Session } from '@sm/client'
import { ThemeControls } from '../../theme/ThemeControls'
import { Button, Card } from '../auth/ui'
import { ChangePassword } from './ChangePassword'
import { DeleteAccount } from './DeleteAccount'
import { RotateRecoveryKey } from './RotateRecoveryKey'

export function SecurityScreen({
  session,
  onSessionChange,
  onBack,
  onDeleted,
}: {
  session: Session
  onSessionChange: (s: Session) => void
  onBack: () => void
  onDeleted: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Settings</h2>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      </div>
      <Card title="Appearance">
        <ThemeControls />
      </Card>
      <ChangePassword session={session} onSessionChange={onSessionChange} />
      <RotateRecoveryKey session={session} onSessionChange={onSessionChange} />
      <DeleteAccount session={session} onDeleted={onDeleted} />
    </div>
  )
}
