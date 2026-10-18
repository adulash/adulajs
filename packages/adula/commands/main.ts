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
import App from './app.js'
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
  App,
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
