import Resource from './resource.js'
import ResourceSnapshot from './resource_snapshot.js'
import Doctor from './doctor.js'
import Install from './install.js'
import Capabilities from './capabilities.js'
import ModuleAdd from './module_add.js'
import ModuleRemove from './module_remove.js'
import Ui from './ui.js'
import StorageMigrate from './storage_migrate.js'
import Gaps from './gaps.js'
import Upgrade from './upgrade.js'
import AdulaOutbox from './adula_outbox.js'
import AdulaRuntimeHealth from './adula_runtime_health.js'
import AdulaUploadsPrune from './adula_uploads_prune.js'
import AdulaRestoreReconcile from './adula_restore_reconcile.js'
import BackupCreate from './backup_create.js'
import BackupRestoreFiles from './backup_restore_files.js'
import BackupRestoreTest from './backup_restore_test.js'
import BackupVerify from './backup_verify.js'
import BackupVerifySnapshot from './backup_verify_snapshot.js'
const commands = [
  Resource,
  ResourceSnapshot,
  Doctor,
  Install,
  Capabilities,
  ModuleAdd,
  ModuleRemove,
  Ui,
  StorageMigrate,
  Gaps,
  Upgrade,
  AdulaOutbox,
  AdulaRuntimeHealth,
  AdulaUploadsPrune,
  AdulaRestoreReconcile,
  BackupCreate,
  BackupRestoreFiles,
  BackupRestoreTest,
  BackupVerify,
  BackupVerifySnapshot,
]
export async function getMetaData() {
  return commands.map((command) => {
    command.boot()
    return command.serialize()
  })
}
export async function getCommand(meta: { commandName: string }) {
  return commands.find((command) => command.commandName === meta.commandName) ?? null
}
